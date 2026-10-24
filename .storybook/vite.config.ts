import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Keep template rendering independent from the React Router application
// compiler and all server-only middleware in the root Vite config.
export default defineConfig({
  plugins: [tailwindcss(), tsconfigPaths()],
});
