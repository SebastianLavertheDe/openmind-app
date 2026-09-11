import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createRequire } from "node:module";

const resolveWorkerDependency = createRequire(import.meta.url).resolve;

export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react()],
  worker: {
    plugins: () => [{
      name: "dom-free-document-parsing",
      // Unified's entity and HTML parsers provide worker-safe exports. Their
      // browser exports call document.createElement and cannot run in a Worker.
      enforce: "pre",
      resolveId: (id) => id === "decode-named-character-reference" || id === "hast-util-from-html-isomorphic"
        ? resolveWorkerDependency(id) : undefined
    }]
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared")
    }
  },
  // Production artifacts must not contain React's development JSX source
  // annotations, which would leak absolute checkout paths into the package.
  esbuild: {
    jsxDev: false
  },
  build: {
    outDir: "../.build/renderer",
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("/node_modules/")) return undefined;
          if (normalized.includes("/react-dom/")) return "vendor-react-dom";
          if (normalized.includes("/react/")) return "vendor-react";
          if (normalized.includes("/lucide-react/")) return "vendor-icons";
          if (normalized.includes("/highlight.js/")) return "vendor-highlight";
          if (
            normalized.includes("/@codemirror/view/") ||
            normalized.includes("/@codemirror/state/") ||
            normalized.includes("/node_modules/crelt/") ||
            normalized.includes("/node_modules/style-mod/") ||
            normalized.includes("/node_modules/w3c-keyname/")
          ) return "vendor-editor";
          if (normalized.includes("/@codemirror/") || normalized.includes("/@lezer/")) return "vendor-editor-language";
          if (
            normalized.includes("/react-markdown/") ||
            normalized.includes("/remark-") ||
            normalized.includes("/rehype-") ||
            normalized.includes("/unified/") ||
            normalized.includes("/micromark") ||
            normalized.includes("/mdast-") ||
            normalized.includes("/hast-") ||
            normalized.includes("/unist-")
          ) return "vendor-markdown";
          if (normalized.includes("/diff/")) return "vendor-diff";
          if (normalized.includes("/zod/")) return "vendor-zod";
          return undefined;
        }
      }
    }
  },
  test: {
    // 仅保留最小 test 配置供 vitest 在缺省 config 时回退使用。
    // 真正的测试与覆盖率配置在 vitest.config.ts(项目根为 root,便于跨 renderer/electron/shared 收集 coverage)。
    environment: "jsdom",
    include: ["../electron/**/*.test.ts", "./**/*.test.ts", "./**/*.test.tsx", "../shared/**/*.test.ts"]
  }
});
