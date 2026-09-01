import { Router, type IRouter } from "express";
import healthRouter from "./health";
import setupRouter from "./setup";
import marketRouter from "./market";
import auctionsRouter from "./auctions";
import itemsRouter from "./items";
import leaderboardsRouter from "./leaderboards";
import playersRouter from "./players";
import dataRouter from "./data";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(setupRouter);
router.use(marketRouter);
router.use(auctionsRouter);
router.use(itemsRouter);
router.use(leaderboardsRouter);
router.use(playersRouter);
router.use(dataRouter);
router.use(adminRouter);

export default router;
