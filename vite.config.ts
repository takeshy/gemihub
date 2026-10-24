import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { createLogger, defineConfig, type Logger, type Plugin } from "vite";
import type { LogLevel, RollupLog } from "rollup";
import tsconfigPaths from "vite-tsconfig-paths";

/** PDF.js fetches these files by their original names from its worker. */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("pdfjs-dist/package.json");
  const { version } = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version: string };
  const prefix = `pdfjs/${version}/`;
  const assets = new Map<string, string>();
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    const source = path.join(path.dirname(packagePath), directory);
    for (const name of fs.readdirSync(source)) {
      if (fs.statSync(path.join(source, name)).isFile()) {
        assets.set(`${prefix}${directory}/${name}`, path.join(source, name));
      }
    }
  }
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || "/", "http://localhost").pathname;
        const source = assets.get(pathname.slice(1));
        if (!source) return next();
        const contentType = source.endsWith(".wasm") ? "application/wasm"
          : source.endsWith(".js") ? "text/javascript" : "application/octet-stream";
        res.setHeader("Content-Type", contentType);
        res.end(fs.readFileSync(source));
      });
    },
    generateBundle() {
      if (this.environment.config.build.ssr) return;
      for (const [fileName, source] of assets) {
        this.emitFile({ type: "asset", fileName, source: fs.readFileSync(source) });
      }
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
        if (domain === "localhost" || domain === "gemihub.net" || domain === "www.gemihub.net") return next();

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

function filterBuildLog(
  level: LogLevel,
  log: RollupLog,
  handler: (level: LogLevel, log: RollupLog) => void
) {
  if (log.code === "DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE_INTO_ANOTHER_CHUNK") return;
  if (log.code === "SOURCEMAP_ERROR" && log.message.includes("Can't resolve original location")) return;
  handler(level, log);
}

const viteLogger = createLogger();
const customLogger: Logger = {
  ...viteLogger,
  warn(msg, options) {
    if (msg.includes("dynamic import will not move module into another chunk")) return;
    viteLogger.warn(msg, options);
  },
  warnOnce(msg, options) {
    if (msg.includes("dynamic import will not move module into another chunk")) return;
    viteLogger.warnOnce(msg, options);
  },
};

export default defineConfig({
  customLogger,
  plugins: [pdfjsAssets(), hubworkRootPage(), serveWasmAssets(), tailwindcss(), reactRouter(), tsconfigPaths()],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onLog: filterBuildLog,
    },
  },
  server: {
    host: true,
    port: Number(process.env.PORT) || 8132,
    allowedHosts: true,
  },
});
