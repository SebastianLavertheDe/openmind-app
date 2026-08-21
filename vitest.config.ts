import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * 独立的测试/覆盖率配置。
 *
 * 之所以不把 coverage 放进 vite.config.ts,是因为 vite.config.ts 的 root 必须保持为 "renderer"
 * (Vite dev server 与构建都以此为基准)。但 vitest 的 coverage 收集以 root 为基准 ——
 * 当 root=renderer 时,electron/ 与 shared/ 这两个目录在 root 之外,coverage instrumenter
 * 不会插桩它们,导致覆盖率恒为 0。
 *
 * 这里把 root 设为项目根,让 renderer/electron/shared 三处的源码都能被
 * 正常插桩与统计。
 */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./renderer/src/test-setup.ts"],
    include: [
      "electron/**/*.test.ts",
      "renderer/src/**/*.test.ts",
      "renderer/src/**/*.test.tsx",
      "shared/**/*.test.ts"
    ],
    coverage: {
      // 用 istanbul provider(基于源码插桩)。v8 原生 coverage 在 vitest 转译后、
      // 且 root ≠ 项目根时收不到数据;istanbul 插桩可靠。
      provider: "istanbul",
      reporter: ["text", "text-summary", "html", "json-summary"],
      reportsDirectory: ".coverage",
      // all: true 让报告包含所有匹配 include 的文件(哪怕没被任何测试执行到),
      // 这样覆盖率才反映真实"已测 vs 未测"全貌。
      all: true,
      extensions: ["ts", "tsx"],
      include: [
        "electron/**/*.ts",
        "renderer/src/**/*.{ts,tsx}",
        "shared/**/*.ts"
      ],
      exclude: [
        // 类型声明 / barrel / 入口
        "**/*.d.ts",
        "**/index.ts",
        "**/index.tsx",
        // Electron entrypoints are exercised by the real-process E2E gate;
        // importing them into jsdom would not test the actual main/preload
        // boundary and would distort the renderer-focused coverage report.
        "**/electron/main.ts",
        "**/electron/preload.ts",
        "**/renderer/src/main.tsx",
        // 测试与脚本自身
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/scripts/**",
        // 构建产物
        "**/.build/**",
        "**/dist/**",
        "**/node_modules/**"
      ],
      // 阈值:补测后从宽松底线(40/35)上调,防止覆盖率回退。
      // 当前整体覆盖 ~73/62/70/77,留余量设 70/60。
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 60,
        lines: 70
      }
    }
  }
});
