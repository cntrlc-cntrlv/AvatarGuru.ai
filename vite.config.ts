import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target for API proxy: uses BACKEND_URL when running inside Docker,
// falls back to localhost:5000 for plain local dev.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:6000";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    fs: {
      allow: ["./client", "./shared", "./"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**"],
    },
    proxy: {
      // Forward all /api/* requests to the Flask backend
      "/api": {
        target: backendUrl,
        changeOrigin: true,
      },
      // Forward /collections/* (TTS audio served by Flask)
      "/collections": {
        target: backendUrl,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist/spa",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});
