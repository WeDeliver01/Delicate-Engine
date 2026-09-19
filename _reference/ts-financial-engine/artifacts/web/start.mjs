import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = {
  ...process.env,
  PORT: process.env.PORT ?? "3000",
  BASE_PATH: process.env.BASE_PATH ?? "/",
};

const vite = spawn(
  resolve(__dirname, "node_modules/.bin/vite"),
  [
    "--config",
    resolve(__dirname, "vite.config.ts"),
    "--host",
    "0.0.0.0",
  ],
  {
    stdio: ["ignore", "inherit", "inherit"],
    env,
    cwd: __dirname,
  },
);

vite.on("error", (err) => {
  process.stderr.write(`Failed to start vite: ${err.message}\n`);
  process.exit(1);
});

vite.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

process.on("SIGTERM", () => vite.kill("SIGTERM"));
process.on("SIGINT", () => vite.kill("SIGINT"));
