-- =============================================================================
-- Salesforce-Linked PM Platform - PostgreSQL schema v0.1
-- Target: PostgreSQL 15+
-- Conventions:
--   * Every tenant-scoped table carries workspace_id; row-level security
--     enforces isolation via the app.workspace_id session setting.
--   * All timestamps are timestamptz (UTC).
--   * change_event is append-only and range-partitioned by month.
--   * No Salesforce metadata bodies are stored anywhere - identity + hashes only.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive emails

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type org_type          as enum ('production', 'sandbox', 'scratch');
create type change_operation  as enum ('create', 'update', 'delete');
create type change_source     as enum ('source_tracking', 'audit_trail', 'cicd');
create type suggestion_status as enum ('pending', 'accepted', 'rejected', 'expired');
create type link_entity_type  as enum ('feature', 'ticket', 'document');
create type link_origin       as enum ('manual', 'suggestion');
create type doc_parent_type   as enum ('workspace', 'project', 'feature', 'ticket');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table workspace (
    id                    uuid primary key default gen_random_uuid(),
    name                  text not null,
    plan                  text not null default 'trial',
    -- linking engine settings (per-workspace tuning lives here until it
    -- outgrows a single row)
    link_score_threshold  numeric(3,2) not null default 0.70
                          check (link_score_threshold between 0 and 1),
    ticket_key_regex      text not null default '[A-Z][A-Z0-9]+-[0-9]+',
    created_at            timestamptz not null default now()
);

create table app_user (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    email         citext not null,
    display_name  text not null,
    role          text not null default 'member'
                  check (role in ('admin', 'member', 'viewer')),
    -- Salesforce usernames this person deploys/changes under, used by the
    -- linking engine to attribute change authors to ticket assignees.
    sf_usernames  text[] not null default '{}',
    created_at    timestamptz not null default now(),
    unique (workspace_id, email)
);

create table org_connection (
    id                       uuid primary key default gen_random_uuid(),
    workspace_id             uuid not null references workspace(id),
    sf_org_id                char(18) not null,
    org_type                 org_type not null,
    label                    text not null,            -- "UAT sandbox", "Prod"
    instance_url             text not null,
    oauth_refresh_token_enc  bytea not null,           -- encrypted w/ per-tenant key
    api_budget_daily         integer not null default 5000 check (api_budget_daily > 0),
    status                   text not null default 'active'
                             check (status in ('active', 'paused', 'error')),
    last_synced_at           timestamptz,
    created_at               timestamptz not null default now(),
    unique (workspace_id, sf_org_id)
);

-- ---------------------------------------------------------------------------
-- PM core
-- ---------------------------------------------------------------------------
create table project (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    key           text not null,                       -- "PROJ" -> tickets PROJ-142
    name          text not null,
    status        text not null default 'active'
                  check (status in ('active', 'archived')),
    created_at    timestamptz not null default now(),
    unique (workspace_id, key)
);

create table feature (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    project_id    uuid not null references project(id),
    name          text not null,
    description   text,
    status        text not null default 'open',
    sort_order    integer not null default 0,
    created_at    timestamptz not null default now()
);

create table ticket (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    project_id    uuid not null references project(id),
    feature_id    uuid references feature(id),
    number        integer not null,                    -- key = project.key || '-' || number
    title         text not null,
    description   text,
    status        text not null default 'open',        -- workflow states are app-level config at MVP
    priority      smallint not null default 3 check (priority between 1 and 5),
    assignee_id   uuid references app_user(id),
    created_by    uuid references app_user(id),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (project_id, number)
);

create table document (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    parent_type   doc_parent_type not null,
    parent_id     uuid not null,                       -- app-enforced polymorphic ref
    title         text not null,
    body          text,                                -- markdown; attachments in object storage
    created_by    uuid references app_user(id),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Salesforce data: components, deployments, change ledger
-- ---------------------------------------------------------------------------

-- Logical metadata component, normalized ACROSS orgs: the same Flow in a
-- sandbox and in production resolves to one row here.
create table component (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references workspace(id),
    component_type  text not null,                     -- Flow, ApexClass, CustomField, ...
    api_name        text not null,                     -- e.g. Opportunity.Amount__c
    label           text,
    first_seen_at   timestamptz not null default now(),
    unique (workspace_id, component_type, api_name)
);

create table deployment (
    id                 uuid primary key default gen_random_uuid(),
    workspace_id       uuid not null references workspace(id),
    org_connection_id  uuid not null references org_connection(id),
    external_ref       text not null,                  -- CI run id / SF deploy request id
    commit_sha         text,
    commit_message     text,                           -- parsed for ticket keys
    deployed_by        text,
    deployed_at        timestamptz not null,
    received_at        timestamptz not null default now(),
    unique (org_connection_id, external_ref)
);

create table deployment_component (
    deployment_id  uuid not null references deployment(id),
    component_id   uuid not null references component(id),
    primary key (deployment_id, component_id)
);

-- Append-only change ledger. Partitioned monthly by occurred_at; the PK and
-- dedupe key therefore include occurred_at.
create table change_event (
    id                 uuid not null default gen_random_uuid(),
    workspace_id       uuid not null references workspace(id),
    org_connection_id  uuid not null references org_connection(id),
    component_id       uuid not null references component(id),
    operation          change_operation not null,
    author_username    text,                           -- SF username; joined to app_user.sf_usernames
    occurred_at        timestamptz not null,
    source             change_source not null,
    source_ref         text,                           -- audit trail row id / deployment id
    content_hash       text,                           -- hash of retrieved metadata, never the body
    ingested_at        timestamptz not null default now(),
    primary key (id, occurred_at),
    unique (org_connection_id, component_id, occurred_at, source)  -- re-poll dedupe
) partition by range (occurred_at);

-- Partition management is a scheduled job in production; first partitions:
create table change_event_2026_07 partition of change_event
    for values from ('2026-07-01') to ('2026-08-01');
create table change_event_2026_08 partition of change_event
    for values from ('2026-08-01') to ('2026-09-01');

-- ---------------------------------------------------------------------------
-- Linking
-- ---------------------------------------------------------------------------

-- Scored (change_event, ticket) candidates awaiting human review.
-- Never auto-applied.
create table link_suggestion (
    id                 uuid primary key default gen_random_uuid(),
    workspace_id       uuid not null references workspace(id),
    change_event_id    uuid not null,
    change_occurred_at timestamptz not null,
    ticket_id          uuid not null references ticket(id),
    score              numeric(4,3) not null check (score between 0 and 1),
    signals            jsonb not null default '{}',    -- which heuristics fired + weights
    status             suggestion_status not null default 'pending',
    resolved_by        uuid references app_user(id),
    resolved_at        timestamptz,
    created_at         timestamptz not null default now(),
    foreign key (change_event_id, change_occurred_at)
        references change_event (id, occurred_at),
    unique (change_event_id, change_occurred_at, ticket_id)
);

-- Confirmed attribution: "this change was delivered under this ticket."
-- Historical fact; written on suggestion accept or manual link.
create table ticket_change (
    workspace_id       uuid not null references workspace(id),
    ticket_id          uuid not null references ticket(id),
    change_event_id    uuid not null,
    change_occurred_at timestamptz not null,
    origin             link_origin not null,
    suggestion_id      uuid references link_suggestion(id),
    created_by         uuid references app_user(id),
    created_at         timestamptz not null default now(),
    primary key (ticket_id, change_event_id),
    foreign key (change_event_id, change_occurred_at)
        references change_event (id, occurred_at)
);

-- Durable map: "this component implements this feature/ticket/document."
-- Upserted when a suggestion is accepted; powers feature component pages.
create table component_link (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    component_id  uuid not null references component(id),
    entity_type   link_entity_type not null,
    entity_id     uuid not null,                       -- app-enforced polymorphic ref
    origin        link_origin not null,
    created_by    uuid references app_user(id),
    created_at    timestamptz not null default now(),
    unique (component_id, entity_type, entity_id)
);

-- ---------------------------------------------------------------------------
-- Indexes (beyond those implied by PKs/uniques)
-- ---------------------------------------------------------------------------
create index idx_change_event_component  on change_event (workspace_id, component_id, occurred_at desc);
create index idx_change_event_org_time   on change_event (org_connection_id, occurred_at desc);
create index idx_change_event_author     on change_event (workspace_id, author_username, occurred_at desc);
create index idx_suggestion_review_queue on link_suggestion (workspace_id, created_at desc) where status = 'pending';
create index idx_suggestion_ticket       on link_suggestion (ticket_id);
create index idx_ticket_board            on ticket (workspace_id, project_id, status);
create index idx_ticket_assignee         on ticket (assignee_id) where assignee_id is not null;
create index idx_component_link_entity   on component_link (entity_type, entity_id);
create index idx_feature_project         on feature (project_id);
create index idx_document_parent         on document (parent_type, parent_id);

-- ---------------------------------------------------------------------------
-- Row-level security: tenant isolation on every workspace-scoped table.
-- The API sets `set local app.workspace_id = '<uuid>'` per transaction.
-- ---------------------------------------------------------------------------
alter table workspace enable row level security;
create policy tenant_isolation on workspace
    using (id = current_setting('app.workspace_id')::uuid);

do $$
declare
    t text;
begin
    foreach t in array array[
        'app_user', 'org_connection', 'project', 'feature', 'ticket',
        'document', 'component', 'deployment', 'change_event',
        'link_suggestion', 'ticket_change', 'component_link'
    ] loop
        execute format('alter table %I enable row level security', t);
        execute format(
            'create policy tenant_isolation on %I using (workspace_id = current_setting(''app.workspace_id'')::uuid)',
            t
        );
    end loop;
end $$;

-- deployment_component has no workspace_id; it is reachable only through
-- deployment, which is RLS-protected. Restrict it via join-based policy:
alter table deployment_component enable row level security;
create policy tenant_isolation on deployment_component
    using (exists (
        select 1 from deployment d
        where d.id = deployment_id
          and d.workspace_id = current_setting('app.workspace_id')::uuid
    ));
