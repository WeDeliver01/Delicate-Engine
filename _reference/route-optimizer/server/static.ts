import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");

  const driverHtml = indexHtml
    .replace(
      '<meta name="theme-color" content="#ea5c0b" />',
      '<meta name="theme-color" content="#1a1a2e" />'
    )
    .replace(
      '<meta name="apple-mobile-web-app-title" content="Delicate Courier" />',
      '<meta name="apple-mobile-web-app-title" content="Delicate Driver" />'
    )
    .replace(
      '<meta name="application-name" content="Delicate Courier" />',
      '<meta name="application-name" content="Delicate Driver" />'
    )
    .replace(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
      '<link rel="apple-touch-icon" href="/driver-apple-touch-icon.png" />'
    )
    .replace(
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
      '<link rel="apple-touch-icon" sizes="180x180" href="/driver-apple-touch-icon.png" />'
    )
    .replace(
      '<title>Delicate Courier — Route Optimizer v6</title>',
      '<title>Delicate Driver</title>'
    )
    .replace(
      '</head>',
      '  <link rel="manifest" href="/driver-manifest.json" />\n  </head>'
    );

  app.use("/driver/{*path}", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(driverHtml);
  });

  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
