import type { NextFunction, Request, Response } from "express";
import { isAuthenticated } from "../lib/session";

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}
