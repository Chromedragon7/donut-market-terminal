import type { NextFunction, Request, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, Bucket>();
  return (req, res, next) => {
    const key = `${opts.keyPrefix}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || existing.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > opts.max) {
      res.status(429).json({ error: "Too many requests, slow down." });
      return;
    }
    next();
  };
}
