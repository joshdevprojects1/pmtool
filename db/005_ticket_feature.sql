-- Many-to-many ticket <-> feature.
-- A ticket can deliver work for several features; a feature collects many
-- tickets. Replaces the single ticket.feature_id lookup.

create table ticket_feature (
    workspace_id  uuid not null references workspace(id),
    ticket_id     uuid not null references ticket(id)  on delete cascade,
    feature_id    uuid not null references feature(id) on delete cascade,
    created_by    uuid references app_user(id),
    created_at    timestamptz not null default now(),
    primary key (ticket_id, feature_id)
);

create index idx_ticket_feature_feature on ticket_feature (feature_id);

-- Backfill from the old single-valued column, then drop it.
insert into ticket_feature (workspace_id, ticket_id, feature_id)
select workspace_id, id, feature_id from ticket where feature_id is not null;

alter table ticket drop column feature_id;

alter table ticket_feature enable row level security;
create policy tenant_isolation on ticket_feature
    using (workspace_id = current_setting('app.workspace_id')::uuid);
