-- Workspace invites (multi-workspace signup) and password resets.
-- Neither flow sends email: invite/reset links are returned to the creator
-- to deliver out-of-band. Tokens are stored hashed, shown once.

create table workspace_invite (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references workspace(id),
    email         citext not null,
    role          text not null default 'member'
                  check (role in ('admin', 'member', 'viewer')),
    token_hash    text not null unique,
    invited_by    uuid references app_user(id),
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    accepted_at   timestamptz
);
create index idx_invite_workspace on workspace_invite (workspace_id)
    where accepted_at is null;

alter table workspace_invite enable row level security;
create policy tenant_isolation on workspace_invite
    using (workspace_id = current_setting('app.workspace_id')::uuid);

create table password_reset (
    token_hash  text primary key,                      -- sha256(reset token)
    user_id     uuid not null references app_user(id) on delete cascade,
    created_by  uuid references app_user(id),
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz
);

alter table password_reset enable row level security;
create policy tenant_isolation on password_reset
    using (exists (
        select 1 from app_user u
        where u.id = user_id
          and u.workspace_id = current_setting('app.workspace_id')::uuid
    ));
