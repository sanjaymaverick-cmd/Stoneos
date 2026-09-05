import type { NextFunction, Request, Response } from "express";
import {
  AUTH_MAX,
  AUTHENTICATED_RATE_MAX,
  AUTH_WINDOW_MS,
  RATE_MAX,
  RATE_WINDOW_MS,
} from "../config";

type Bucket = { count: number; resetAt: number };
const general = new Map<string, Bucket>();
const auth = new Map<string, Bucket>();

function hit(
  map: Map<string, Bucket>,
  key: string,
  windowMs: number,
  max: number,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const now = Date.now();
  const current = map.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  bucket.count += 1;
  map.set(key, bucket);
  res.setHeader("RateLimit-Limit", max);
  res.setHeader("RateLimit-Remaining", Math.max(0, max - bucket.count));
  if (bucket.count > max) {
    res.status(429).json({ statusCode: 429, message: "Too many requests" });
    return;
  }
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/health") || req.path.startsWith("/api/docs")) return next();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (req.path.startsWith("/api/v1/auth/login")) {
    return hit(auth, ip, AUTH_WINDOW_MS, AUTH_MAX, req, res, next);
  }
  const bearer = req.headers.authorization ?? "";
  if (bearer.startsWith("Bearer ")) {
    return hit(general, `auth:${ip}:${bearer.slice(7, 23)}`, RATE_WINDOW_MS, AUTHENTICATED_RATE_MAX, req, res, next);
  }
  return hit(general, ip, RATE_WINDOW_MS, RATE_MAX, req, res, next);
}

export function resetRateLimitState() {
  general.clear();
  auth.clear();
}
