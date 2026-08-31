import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          // package.json has "type": "module", so Vite's default output for
          // this target is ESM (index.mjs). Force CommonJS instead: preload
          // scripts run with sandbox: true (src/main/index.ts), and
          // sandboxed preload scripts have to be CommonJS -- Electron's
          // sandboxed preload environment doesn't support ESM. This also
          // keeps the built filename (index.js) matching what
          // src/main/index.ts's join(__dirname, "../preload/index.js")
          // actually expects to find.
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
    server: {
      // Lets the renderer's dev server be opened directly in a regular
      // browser (electron-vite runs one alongside the Electron window) and
      // still resolve puzzle fetches -- useful for fast UI iteration without
      // relaunching Electron. window.api is the primary path once actually
      // running inside Electron (src/renderer/src/importer/fetchPuzzle.ts);
      // this proxy is what makes the same code work in a plain browser tab
      // too. See design.md section 2.2/8.
      proxy: {
        "/api/puzzle": {
          target: "https://sudokupad.app",
          changeOrigin: true,
        },
      },
    },
  },
});
