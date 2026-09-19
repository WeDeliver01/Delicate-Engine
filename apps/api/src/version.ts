/** Injected at build time by the Docker image (APP_VERSION=git sha); falls back for dev. */
export const APP_VERSION = process.env["APP_VERSION"] ?? "dev";
