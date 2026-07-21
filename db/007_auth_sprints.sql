-- Auth (email + password sessions) and sprints.

-- Null means the account has not been claimed yet: registering with a
-- seeded/invited email sets the password on the existing row.
alter table app_user add column password_hash text;

-- Browser sessions. Looked up by token hash BEFORE a workspace context
-- exists (same system-path pattern as ingest org resolution), so RLS here
-- protects the workspace-scoped listing paths only.
create table user_session (
    token_hash    text primary key,                    -- sha256(session token)
    workspace_id  uuid not null references workspace(id),
    user_id       uuid not null references app_user(id) on delete cascade,
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null
);
create index idx_user_session_expiry on user_session (expires_at);

alter table user_session enable row level security;
create policy tenant_isolation on user_session
    using (workspace_id = current_setting('app.workspace_id')::uuid);

-- Sprints: a time-boxed batch of tickets within a project.
create table sprint (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    project_id    uuid not null references project(id),
    name          text not null,
    goal          text,
    starts_on     date,
    ends_on       date,
    status        text not null default 'planned'
                  check (status in ('planned', 'active', 'completed')),
    created_at    timestamptz not null default now()
);
create index idx_sprint_project on sprint (workspace_id, project_id, status);

alter table sprint enable row level security;
create policy tenant_isolation on sprint
    using (workspace_id = current_setting('app.workspace_id')::uuid);

-- Ticket membership: null = backlog.
alter table ticket add column sprint_id uuid references sprint(id);
create index idx_ticket_sprint on ticket (sprint_id) where sprint_id is not null;
