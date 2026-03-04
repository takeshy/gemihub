import fs from "node:fs";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

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

export default defineConfig({
  plugins: [serveWasmAssets(), tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    host: true,
    port: Number(process.env.PORT) || 8132,
    allowedHosts: true,
  },
});
