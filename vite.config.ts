import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/build/**", "**/release/**", "**/.venv/**", "**/data/**", "**/tmp/**", "**/.tmp/**"] },
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
