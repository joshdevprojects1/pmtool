# pmtool — Salesforce-linked project management

Production scaffold. Express + TypeScript API on PostgreSQL (row-level
security, RFC 9457 errors, HMAC ingest), Vite + React front end. The design
comes from the architecture doc v0.4; the behavior was validated first by the
zero-dependency prototype (linking_prototype.py and friends) against a live
Salesforce org.

Hosting: see DEPLOY.md for the GitHub -> Railway setup (auto-deploy on push,
migrations applied automatically on boot).

## Layout

    db/         migrations + seed (001 = the validated Postgres schema)
    server/     API service (Express 4, pg, TypeScript)
    web/        front end (Vite, React, TypeScript)

## First run

Prereqs: Node 20+, Docker (or a local Postgres 15+).

    # 1. database
    docker compose up -d
    # wait a few seconds for postgres to accept connections, then:
    docker compose exec -T db psql -U pmtool -d pmtool < db/001_schema.sql
    docker compose exec -T db psql -U pmtool -d pmtool < db/002_prototype_learnings.sql
    docker compose exec -T db psql -U pmtool -d pmtool < db/003_ingestion.sql
    docker compose exec -T db psql -U pmtool -d pmtool < db/004_client_credentials.sql
    docker compose exec -T db psql -U pmtool -d pmtool < db/005_ticket_feature.sql
    docker compose exec -T db psql -U pmtool -d pmtool < db/seed.sql

    # 2. api  (http://localhost:8080)
    cd server && cp ../.env.example .env && npm install && npm run dev

    # 3. web  (http://localhost:5173, proxies /v1 to the api)
    cd web && npm install && npm run dev

    # 4. ingestion worker (optional but the point of the product)
    cd server && npm run worker

## Connecting your Salesforce org (dev mode)

The worker needs Salesforce credentials. Easiest dev path - let the worker
ask the Salesforce CLI for a fresh token on every poll (no expiry problems):

    # once:
    sf org login web --alias devorg
    # in server/.env:
    SF_CLI_ALIAS=devorg

Alternative (manual): put SF_ACCESS_TOKEN + SF_INSTANCE_URL from
`sf org display -o devorg --json` in server/.env - but note CLI access
tokens expire after a few hours ("Session expired or invalid" in the worker
log means it is time to refresh them).

Then point the seeded org connection at your instance (or POST /v1/orgs to
add one). The worker polls every org with status=active once a minute:
SourceMember first, SetupAuditTrail fallback, description enrichment, budget
tracking against api_budget_daily, then rescoring. Watch its log while you
create a field in Setup - the suggestion should appear in the web app within
a minute.

## Connecting orgs the production way (OAuth connected app)

One-time Salesforce setup (in the org you want to connect, or any org that
will act as the auth home): Setup -> App Manager -> New Connected App ->
enable OAuth settings. Callback URL: http://localhost:8080/v1/orgs/callback
Scopes: "Manage user data via APIs (api)" and "Perform requests at any time
(refresh_token, offline_access)". Save, wait ~10 minutes for propagation,
then copy the Consumer Key/Secret into server/.env as SF_CLIENT_ID /
SF_CLIENT_SECRET, and generate TOKEN_ENC_KEY (command in .env.example).

Then in the web app: Orgs tab -> enter a label -> Connect. A Salesforce
login/approve tab opens; on approval the callback stores the org with an
AES-256-GCM-encrypted refresh token, and the worker starts polling it on the
next tick - no CLI, no expiring tokens. The worker prefers per-org OAuth
tokens and only falls back to SF_CLI_ALIAS / SF_ACCESS_TOKEN for orgs
without one.

Dev auth: the seed creates one workspace and .env.example maps the token
dev-token to it. The web app sends that token automatically.

## What is real vs. stubbed

Real: RLS-enforced multi-tenancy (every request runs inside a transaction
with app.workspace_id set), the linking engine (noisy-or scoring with the
weak-alone-type policy learned from live-org data), suggestion accept/reject
with 409 race handling, HMAC-verified idempotent deployment ingest, cursor
pagination, problem+json errors.

Stubbed / TODO: Salesforce OAuth connect flow and polling workers (the
prototype's sf_ingest_spike.py is the reference), API token management
(tokens live in .env), documents, SSO, per-workspace threshold tuning UI.

## Honest caveat

This scaffold was written in an offline environment: it type-checks against
ambient shims, but npm install and a real compile happen for the first time
on your machine. Expect a small number of first-run type or import fixes -
paste any errors back and they will be quick to resolve.

## Commercial auth: dedicated integration user + client credentials

The recommended pattern for customer orgs (matches Salesforce's own guidance):

1. Customer creates a dedicated integration user using the free API-only
   "Salesforce Integration" license (Minimum Access - API Only Integrations
   profile), plus a permission set granting exactly: API Enabled and
   View Setup and Configuration. Nothing else - the tool is read-only.
2. Customer installs your connected app in their org (admin approves it once)
   and sets the integration user as the app's client-credentials run-as user
   (Connected app -> Manage -> Edit Policies -> Client Credentials Flow).
3. In pmtool's Orgs tab, choose "Client credentials", paste the org's
   My Domain URL, Connect. The server validates the setup immediately by
   exchanging a token and reading the org id - no browser dance, no refresh
   token stored, and nothing breaks when an admin leaves the company.

Run db/004_client_credentials.sql to add the auth_mode column. The
interactive OAuth flow remains available for trials and quick evaluation.
