import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A separate, static build for the public product demo. It reuses the app's
// theme tokens and presentational components, but has no server, model or
// account wiring; every bot, message and memory row is synthetic.
export default defineConfig({
  root: fileURLToPath(new URL("./demo-site", import.meta.url)),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: process.env.DEMO_OUT_DIR ?? fileURLToPath(new URL("./site/demo", import.meta.url)),
    emptyOutDir: true,
  },
});
