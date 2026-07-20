-- Ingestion worker support.

-- Daily API budget tracking per org (architecture doc section 10: the
-- scheduler must never eat the customer's Salesforce API allowance).
alter table org_connection add column api_calls_today integer not null default 0;
alter table org_connection add column api_calls_date date;

-- Where auth material lives in dev. Production stores an encrypted refresh
-- token; the scaffold also allows an env-provided access token (see README).
alter table org_connection add column auth_note text;
