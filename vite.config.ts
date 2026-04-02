import fs from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/** Basic Auth gate for /hubwork/admin routes (runs before React Router). */
function adminBasicAuth(): Plugin {
  return {
    name: "admin-basic-auth",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/hubwork/admin")) return next();

        const creds = process.env.HUBWORK_ADMIN_CREDENTIALS;
        if (!creds || !creds.includes(":")) return next();
        const sep = creds.indexOf(":");
        const user = creds.slice(0, sep);
        const pass = creds.slice(sep + 1);

        const header = req.headers.authorization || "";
        if (header.startsWith("Basic ")) {
          const decoded = Buffer.from(header.slice(6), "base64").toString();
          const sep = decoded.indexOf(":");
          if (sep !== -1 && decoded.slice(0, sep) === user && decoded.slice(sep + 1) === pass) {
            return next();
          }
        }

        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="Hubwork Admin"');
        res.end("Unauthorized");
      });
    },
  };
}

/** Serve .wasm plugin assets directly, bypassing Vite's ESM transform. */
function serveWasmAssets(): Plugin {
  return {
    name: "serve-wasm-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const url = new URL(req.url, "http://localhost");
        const asset = url.searchParams.get("asset");
        if (!asset?.endsWith(".wasm")) return next();
        const match = url.pathname.match(/^\/api\/plugins\/([^/]+)$/);
        if (!match) return next();
        const filePath = path.join("data", "plugins", match[1], asset);
        if (!fs.existsSync(filePath)) return next();
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Cache-Control", "max-age=86400");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

/** Intercept root "/" requests on Hubwork custom domains before React Router. */
function hubworkRootPage(): Plugin {
  return {
    name: "hubwork-root-page",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (url !== "/" && url !== "") return next();
        const host = req.headers.host;
        if (!host) return next();
        const domain = host.split(":")[0];
        if (domain === "localhost" || domain === "gemihub.online" || domain === "www.gemihub.online") return next();

        try {
          const mod = await server.ssrLoadModule("/app/services/hubwork-page.server.ts");
          const request = new Request(`http://${host}${url}`, {
            headers: new Headers(
              Object.entries(req.headers)
                .filter((e): e is [string, string] => typeof e[1] === "string")
            ),
          });
          const response: Response = await mod.serveHubworkRootPage(request);
          if (!response) return next();
          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
          const body = await response.arrayBuffer();
          res.end(Buffer.from(body));
        } catch (e: unknown) {
          if (e instanceof Response) {
            res.statusCode = e.status;
            res.end(await e.text());
          } else {
            console.error("[hubwork-root-page]", e);
            return next();
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [adminBasicAuth(), hubworkRootPage(), serveWasmAssets(), tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    host: true,
    port: Number(process.env.PORT) || 8132,
    allowedHosts: true,
  },
});
