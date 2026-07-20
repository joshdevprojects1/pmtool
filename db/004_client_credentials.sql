-- Commercial auth: per-org auth mode. client_credentials pairs with a
-- dedicated integration user (Salesforce Integration license, API-only
-- profile) designated as the run-as user on the installed connected app.
alter table org_connection add column auth_mode text not null
    default 'oauth_refresh'
    check (auth_mode in ('oauth_refresh', 'client_credentials', 'env'));
