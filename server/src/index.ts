import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { auth } from "./auth.js";
import { problemHandler, Problem } from "./problem.js";
import { tickets } from "./routes/tickets.js";
import { suggestions } from "./routes/suggestions.js";
import { features } from "./routes/features.js";
import { changes } from "./routes/changes.js";
import { components } from "./routes/components.js";
import { ingest } from "./routes/ingest.js";
import { orgs, orgsCallback } from "./routes/orgs.js";
import { authRoutes } from "./routes/authRoutes.js";
import { users } from "./routes/users.js";
import { search } from "./routes/search.js";
import { sprints } from "./routes/sprints.js";
import { invites } from "./routes/invites.js";

const app = express();

// Public routes first: HMAC-authed ingest, state-authed OAuth callback.
app.use("/v1/ingest", ingest);
app.use("/v1/orgs/callback", orgsCallback);

app.use(express.json());
// Login/register/logout/me manage their own credentials.
app.use("/v1/auth", authRoutes);
app.use("/v1", auth);
app.use("/v1/users", users);
app.use("/v1/search", search);
app.use("/v1/sprints", sprints);
app.use("/v1/invites", invites);
app.use("/v1/tickets", tickets);
app.use("/v1/suggestions", suggestions);
app.use("/v1/features", features);
app.use("/v1/changes", changes);
app.use("/v1/components", components);
app.use("/v1/orgs", orgs);

// Production: serve the built front end from the same process (the web app
// uses hash routing, so static files + index.html are all that is needed).
const webDist = process.env.WEB_DIST ?? path.resolve("web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
}

app.use((_req, _res, next) => next(new Problem(404, "Not found")));
app.use(problemHandler);

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`pmtool api on http://localhost:${port}`));
