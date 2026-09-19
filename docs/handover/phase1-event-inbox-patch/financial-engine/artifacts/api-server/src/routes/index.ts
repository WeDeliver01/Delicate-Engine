import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin.js";
import driverRouter from "./driver.js";
import eventsRouter from "./events.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin", adminRouter as unknown as IRouter);
router.use("/driver", driverRouter as unknown as IRouter);
router.use("/events", eventsRouter);

export default router;
