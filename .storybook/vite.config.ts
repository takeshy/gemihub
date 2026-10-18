import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Keep template rendering independent from the React Router application
// compiler and all server-only middleware in the root Vite config.
export default defineConfig({
  resolve: {
    alias: { mermaid: fileURLToPath(new URL("../app/utils/mermaid-compat.ts", import.meta.url)) },
  },
  plugins: [tailwindcss(), tsconfigPaths()],
});
