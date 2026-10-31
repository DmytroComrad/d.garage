import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare({ configPath: process.env.WRANGLER_CONFIG })],
  build: { sourcemap: false, target: "es2022" },
});
