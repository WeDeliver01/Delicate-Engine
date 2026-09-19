import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // NestJS relies on legacy (experimental) decorators + emitDecoratorMetadata, which esbuild
    // cannot produce; SWC can. Keep this in sync with tsconfig.nest.json.
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["test/_*.test.ts", "**/node_modules/**"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ["./test/setup.ts"],
  },
});
