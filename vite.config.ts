import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  /* GitHub Pages serves project sites from https://<user>.github.io/<repo>/,
     so assets must resolve under that prefix. The deploy workflow passes
     BASE_PATH; local dev keeps "/". */
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Allow the sandbox preview host (and any tunnel) to load the dev server.
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
});
