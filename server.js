import express from "express";
import compression from "compression";
import morgan from "morgan";
import crypto from "node:crypto";
import { createRequestHandler } from "@react-router/express";
import path from "node:path";

const build = await import("./build/server/index.js");
const app = express();

const MAIN_APP_DOMAIN = process.env.GEMIHUB_MAIN_DOMAIN || "gemihub.online";

function isHubworkHost(domain) {
  // Dev: bare localhost is the main app; *.localhost is a hubwork slug.
  if (domain === "localhost" || domain.startsWith("localhost:")) return false;
  if (domain === MAIN_APP_DOMAIN) return false;
  // Slug subdomains + any registered custom domain fall through to here.
  return true;
}

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

// Basic Auth for admin routes
app.use("/hubwork/admin", (req, res, next) => {
  const creds = process.env.HUBWORK_ADMIN_CREDENTIALS;
  if (!creds || !creds.includes(":")) {
    // No credentials configured — deny access instead of silently skipping
    res.status(401).set("WWW-Authenticate", 'Basic realm="Hubwork Admin"').end("Unauthorized");
    return;
  }
  const sep0 = creds.indexOf(":");
  const user = creds.slice(0, sep0);
  const pass = creds.slice(sep0 + 1);

  const header = req.headers.authorization || "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString();
    const sep = decoded.indexOf(":");
    if (sep !== -1) {
      const inputUser = decoded.slice(0, sep);
      const inputPass = decoded.slice(sep + 1);
      // Use timing-safe comparison to prevent timing attacks
      const userMatch = inputUser.length === user.length &&
        crypto.timingSafeEqual(Buffer.from(inputUser), Buffer.from(user));
      const passMatch = inputPass.length === pass.length &&
        crypto.timingSafeEqual(Buffer.from(inputPass), Buffer.from(pass));
      if (userMatch && passMatch) {
        return next();
      }
    }
  }

  res.status(401).set("WWW-Authenticate", 'Basic realm="Hubwork Admin"').end("Unauthorized");
});

// Hubwork domains (slug subdomains + custom domains): rewrite "/" to
// "/__gemihub_root" so the catch-all route handles it instead of _index.tsx
// (which redirects to /lp).
app.get("/", (req, res, next) => {
  const host = req.headers.host;
  if (!host) return next();
  const domain = host.split(":")[0];
  if (!isHubworkHost(domain)) return next();
  req.url = "/__gemihub_root";
  next();
});

app.all("*", createRequestHandler({ build }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
