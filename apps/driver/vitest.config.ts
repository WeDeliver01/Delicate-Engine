import { defineConfig } from "vitest/config";

// Only the pure modules. Anything importing expo-* or react-native needs a device, not a test
// runner, and pretending otherwise is how a suite becomes a wall of mocks nobody trusts.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
