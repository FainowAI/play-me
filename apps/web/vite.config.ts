import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// O apps/server só aceita a origem http://127.0.0.1:5173 (e localhost:5173); porta fixa.
// ninguém enquadra a página: o clique de "Aprovar e criar" não pode ser roubado por clickjacking
const FRAME_HEADERS = { "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // fs.allow: sem isso o dev server serve a raiz do workspace em /@fs (data/*.sqlite, logs) a qualquer origem localhost
  server: { host: "127.0.0.1", port: 5173, strictPort: true, fs: { allow: [".", "../../design", "../../node_modules"] }, headers: FRAME_HEADERS },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true, headers: FRAME_HEADERS },
});
