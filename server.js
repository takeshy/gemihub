import express from "express";
import compression from "compression";
import morgan from "morgan";
import crypto from "node:crypto";
import { createRequestHandler } from "@react-router/express";
import path from "node:path";

const build = await import("./build/server/index.js");
const app = express();

const MAIN_APP_DOMAIN = process.env.GEMIHUB_MAIN_DOMAIN || "gemihub.net";

function isHubworkHost(domain) {
  // Dev: bare localhost is the main app; *.localhost is a hubwork slug.
  if (domain === "localhost" || domain.startsWith("localhost:")) return false;
  if (domain === MAIN_APP_DOMAIN) return false;
  if (domain === `www.${MAIN_APP_DOMAIN}`) return false;
  // Internal probes and direct Cloud Run URLs never carry a hubwork hostname.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false; // IPv4 literal
  if (domain === "::1" || domain.startsWith("[")) return false; // IPv6 literal
  if (domain.endsWith(".run.app")) return false;
  // Slug subdomains + any registered custom domain fall through to here.
  return true;
}

// 301 redirect from www to the apex domain. Must run before any other
// middleware so static assets and the React Router handler never see it.
app.use((req, res, next) => {
  const host = req.headers.host;
  if (!host) return next();
  const domain = host.split(":")[0].toLowerCase();
  if (domain === `www.${MAIN_APP_DOMAIN}`) {
    res.redirect(301, `https://${MAIN_APP_DOMAIN}${req.originalUrl}`);
    return;
  }
  next();
});

app.use(compression());

// Static assets with long cache
app.use(
  "/assets",
  express.static(path.join("build", "client", "assets"), {
    immutable: true,
    maxAge: "1y",
  })
);
app.use(express.static("build/client", { maxAge: "1h" }));
app.use(express.static("public", { maxAge: "1h" }));
app.use(morgan("tiny"));


// Hubwork domains (slug subdomains + custom domains): rewrite "/" to
// "/__gemihub_root" so the catch-all route handles it instead of _index.tsx
// (which redirects to /lp). @react-router/express builds its Request from
// req.originalUrl, so we must rewrite that too — modifying req.url alone is
// silently ignored downstream.
app.get("/", (req, res, next) => {
  // Cloud Run startup/liveness probes use User-Agent "GoogleHC/1.0" and do
  // not carry a real hubwork hostname — leave their request alone so the
  // _index.tsx loader can respond with its usual 302.
  const ua = req.headers["user-agent"] || "";
  if (ua.startsWith("GoogleHC/")) return next();
  const host = req.headers.host;
  if (!host) return next();
  const domain = host.split(":")[0];
  if (!isHubworkHost(domain)) return next();
  req.url = "/__gemihub_root";
  req.originalUrl = "/__gemihub_root";
  next();
});

app.all("*", createRequestHandler({ build }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
