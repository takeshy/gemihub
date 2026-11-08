import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  // Drive's HTML must carry the complete runtime: file:// cannot load the web build's chunks.
  ...(mode === "drive" ? {
    publicDir: false,
    build: {
      outDir: "dist/drive",
      cssCodeSplit: false,
      modulePreload: false,
      rollupOptions: {
        input: "src/main.tsx",
        output: { format: "iife", inlineDynamicImports: true, entryFileNames: "preview.js", assetFileNames: "preview.[ext]" },
      },
    },
  } : { build: { rollupOptions: { input: { main: "index.html", visualReview: "visual-review.html" } } } }),
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
}));
