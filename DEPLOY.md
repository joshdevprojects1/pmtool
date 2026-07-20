# Deploying pmtool (GitHub -> Railway)

Push to `main` = live deploy. Migrations in `db/*.sql` apply automatically on
every boot (tracked in `schema_migrations`; `seed.sql` only runs when
`SEED=true` and the database is empty).

## 1. GitHub

The repo is already initialized and committed locally. Create an empty repo
on GitHub (private is fine, no README/license — it must be empty), then:

    git remote add origin https://github.com/<you>/pmtool.git
    git push -u origin main

## 2. Railway project

1. https://railway.app -> New Project -> **Deploy from GitHub repo** -> pick
   `pmtool`. Railway detects the Dockerfile and builds it. This service is
   the **API + web app**.
2. In the same project: **+ New -> Database -> PostgreSQL**.
3. **+ New -> GitHub repo** -> pick `pmtool` again. This second service is
   the **worker**. In its Settings -> Deploy -> Custom Start Command:

       node server/dist/worker.js

   (The worker does not need migrations; the API service runs them.)

## 3. Variables

Generate secrets locally first:

    node -e "console.log('TOKEN_ENC_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
    node -e "console.log('API token: app-' + require('crypto').randomBytes(24).toString('hex'))"

**API service** (Variables tab):

    DATABASE_URL   = ${{Postgres.DATABASE_URL}}      <- reference variable
    API_TOKENS     = <api-token>:00000000-0000-0000-0000-000000000001
    VITE_API_TOKEN = <same api-token>                <- baked into the web build
    TOKEN_ENC_KEY  = <generated hex key>
    APP_BASE_URL   = https://<your-api-domain>       <- after step 4
    SEED           = true
    SF_CLIENT_ID   = <connected app consumer key>
    SF_CLIENT_SECRET = <connected app consumer secret>
    SF_LOGIN_URL   = https://login.salesforce.com

**Worker service**: `DATABASE_URL`, `TOKEN_ENC_KEY`, `SF_CLIENT_ID`,
`SF_CLIENT_SECRET`, `SF_LOGIN_URL` (same values).

Notes:
- The `${{Postgres.DATABASE_URL}}` reference uses Railway's private network -
  no TLS needed. If you ever point at a public URL instead, also set
  `DATABASE_SSL=true`.
- The workspace uuid in API_TOKENS is the seeded workspace. SEED=true is
  inert once the database has data; you can remove it after first boot.
- Do NOT keep `dev-token` in production API_TOKENS.

## 4. Domain + Salesforce callback

1. API service -> Settings -> Networking -> **Generate Domain** (or attach
   your own). Set `APP_BASE_URL` to that https URL and redeploy.
2. In your Salesforce connected app, add the callback URL:

       https://<your-api-domain>/v1/orgs/callback

3. Open `https://<your-api-domain>`, go to the Orgs tab, connect your org.
   The worker starts polling it within a minute.

## 5. Day-to-day

- Merge/push to `main` -> Railway rebuilds both services; the API service
  runs any new `db/*.sql` files before starting. Name new migrations with
  the next number (006_..., 007_...) and never edit an already-applied file.
- CI (GitHub Actions) typechecks server and web on every push/PR.
- Logs: each Railway service has a Logs tab; the worker logs every poll.

## Honest limitations

- Auth is a single static token baked into the web bundle - fine for
  personal/team-internal use behind an unguessable token, but it is not
  real user auth. Anyone with the URL + token has full access. SSO/logins
  are still on the TODO list.
- Rotating the API token requires updating API_TOKENS + VITE_API_TOKEN and
  redeploying (the token lives in the built JS).
- Railway hobby plan is ~$5/mo plus usage; an always-on API + worker +
  Postgres typically lands around $10-15/mo total.
