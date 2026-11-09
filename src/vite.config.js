// vite.config.js
import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

const dt = new Date();
const version = `"${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}-${dt.getHours()}-${dt.getMinutes()}-${dt.getSeconds()}"`;

const fullReloadAlways = {
  name: "full-reload-always",
  handleHotUpdate({ server }) {
    server.ws.send({ type: "full-reload" });
    return [];
  },
};

export default defineConfig(({ command }) => ({
  base: "/OS-DPI-1/",
  resolve: {
    alias: {
      components: path.resolve("./components"),
      app: path.resolve("."),
      css: path.resolve("./css"),
    },
  },
  optimizeDeps: {
    include: ["tracky-mouse"],
  },
  build: {
    sourcemap: true,
    minify: false,
    target: "esnext",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: "./index.html",
        "service-worker": "./service-worker.js",
      },
      output: {
        entryFileNames: `[name].js`,
        chunkFileNames: `[name].js`,
        assetFileNames: `[name].[ext]`,
      },
    },
  },
  define: {
    APP_VERSION: version,
    // A dev key in .env is for `npm start` on the developer's own machine
    // only. Never let any build carry it: anything in the bundle is public,
    // and everyone using the site would be spending that key.
    ...(command === "build" && { "import.meta.env.VITE_GROQ_API_KEY": '""' }),
  },
  plugins: [react(), fullReloadAlways],
}));
