import { Router } from "express";
import { routeOptimizerWebhook } from "../webhooks/inbound";
import { asyncHandler } from "../lib/http";

export const webhookRouter = Router();

// The Route Optimizer posts completion events here.
webhookRouter.post("/route-optimizer", asyncHandler(routeOptimizerWebhook));
