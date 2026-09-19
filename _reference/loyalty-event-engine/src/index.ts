import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { publicRouter } from "./routes/public";
import { customerRouter } from "./routes/customer";
import { adminRouter } from "./routes/admin";
import { webhookRouter } from "./routes/webhooks";
import { startWorkers } from "./workers/scheduler";

const app = express();

// Capture the raw request body so inbound webhook signatures can be verified
// over the exact bytes that were signed. req.rawBody is read in webhooks/inbound.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);

app.use("/", publicRouter);
app.use("/customer", customerRouter);
app.use("/admin", adminRouter);
app.use("/webhooks", webhookRouter);

app.use((_req, res) => res.status(404).json({ error: "not found" }));

// Centralized error handler.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`[delicate-event-engine] listening on :${port}`);
  startWorkers();
});
