import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": srcDir,
      "@components": path.join(srcDir, "components"),
      "@pages": path.join(srcDir, "pages"),
      "@store": path.join(srcDir, "store"),
      "@types": path.join(srcDir, "types"),
      "@utils": path.join(srcDir, "utils"),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  preview: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
