import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Сборка — один самодостаточный index.html: JS, CSS, текстуры и фото меню
// вшиты в base64, поэтому файл запускается двойным кликом (file://) и с GitHub Pages.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 12000,
    reportCompressedSize: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
