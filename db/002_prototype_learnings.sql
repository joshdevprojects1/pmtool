-- Changes that came out of the prototype phase.

-- Work windows: the author+time linking signal needs to know when a ticket
-- was actively worked. The prototype used explicit windows; production
-- derives them from status transitions later, but the columns are the API.
alter table ticket add column started_at timestamptz;
alter table ticket add column finished_at timestamptz;

-- A default partition so the scaffold works without a partition-management
-- job. Production replaces this with scheduled monthly partitions.
create table if not exists change_event_default partition of change_event default;

-- Component enrichment (e.g. descriptions fetched from the Tooling API).
-- Learned from the prototype: the description_key signal needs somewhere to
-- put enrichment data without widening the identity table.
create table component_meta (
    component_id  uuid primary key references component(id),
    description   text,
    updated_at    timestamptz not null default now()
);
alter table component_meta enable row level security;
create policy tenant_isolation on component_meta
    using (exists (
        select 1 from component c
        where c.id = component_id
          and c.workspace_id = current_setting('app.workspace_id')::uuid
    ));
