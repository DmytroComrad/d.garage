import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare({ configPath: process.env.WRANGLER_CONFIG })],
  // Без вбудовування файлів у CSS: шрифти в data: блокує наша політика безпеки (font-src 'self').
  build: { sourcemap: false, target: "es2022", assetsInlineLimit: 0 },
});
