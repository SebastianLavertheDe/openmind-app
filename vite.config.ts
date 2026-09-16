import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createRequire } from "node:module";

const resolveWorkerDependency = createRequire(import.meta.url).resolve;
const domFreeDocumentDependencies = [
  "decode-named-character-reference",
  "hast-util-from-html-isomorphic"
] as const;

function resolveDomFreeDocumentDependency(id: string): string | undefined {
  return domFreeDocumentDependencies.includes(id as typeof domFreeDocumentDependencies[number])
    ? resolveWorkerDependency(id)
    : undefined;
}

export default defineConfig(({ command }) => ({
  root: "renderer",
  base: "./",
  plugins: [react()],
  worker: {
    plugins: () => [{
      name: "dom-free-document-parsing",
      // Unified's entity and HTML parsers provide worker-safe exports. Their
      // browser exports call document.createElement and cannot run in a Worker.
      enforce: "pre",
      resolveId: resolveDomFreeDocumentDependency
    }]
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      // worker.plugins only participates in Rollup's production worker build.
      // During dev, optimizeDeps otherwise pre-bundles the browser exports into
      // the worker module graph before that hook can run.
      ...(command === "serve" ? Object.fromEntries(domFreeDocumentDependencies.map(id => [id, resolveWorkerDependency(id)])) : {})
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
          // Crepe loads code languages on demand. Grouping every language and
          // Lezer grammar together would make a plain document load them all.
          if (normalized.includes("/prosemirror-") || normalized.includes("/prosemirror-virtual-cursor/")) return "vendor-document-editor";
          if (normalized.includes("/@vue/") || normalized.includes("/vue/")) return "vendor-vue";
          if (normalized.includes("/@milkdown/crepe/node_modules/katex/")) return "vendor-crepe-math";
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
}));
