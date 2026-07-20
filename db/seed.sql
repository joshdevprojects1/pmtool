-- Dev seed: one workspace, one user, one org connection, one project/feature/ticket.
insert into workspace (id, name, plan) values
  ('00000000-0000-0000-0000-000000000001', 'Dev workspace', 'dev');

insert into app_user (id, workspace_id, email, display_name, role, sf_usernames) values
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'josh@example.com', 'Josh Hilger', 'admin',
   array['Josh Hilger']);

insert into org_connection (id, workspace_id, sf_org_id, org_type, label,
                            instance_url, oauth_refresh_token_enc, api_budget_daily) values
  ('00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-000000000001',
   '00D000000000000AAA', 'sandbox', 'dev org',
   'https://example.my.salesforce.com', '\x00', 5000);

insert into project (id, workspace_id, key, name) values
  ('00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001', 'PROJ', 'First project');

insert into feature (id, workspace_id, project_id, name) values
  ('00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003', 'First feature');

insert into ticket (id, workspace_id, project_id, number, title,
                    status, assignee_id, started_at, finished_at) values
  ('00000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003',
   1, 'First ticket', 'in_progress',
   '00000000-0000-0000-0000-000000000002',
   now() - interval '7 days', now() + interval '1 day');

insert into ticket_feature (workspace_id, ticket_id, feature_id) values
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000004');
