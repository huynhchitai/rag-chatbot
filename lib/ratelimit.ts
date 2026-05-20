import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

// Allow local dev without Upstash: skip rate limiting if not configured.
const enabled = Boolean(url && token);

const redis = enabled ? new Redis({ url: url!, token: token! }) : null;

export const uploadLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(3, "1 d"),
      prefix: "rl:upload",
      analytics: false,
    })
  : null;

export const chatLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(20, "1 d"),
      prefix: "rl:chat",
      analytics: false,
    })
  : null;

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "anon";
}

export async function check(
  limiter: Ratelimit | null,
  key: string,
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  if (!limiter) return { allowed: true, remaining: Infinity, reset: 0 };
  const r = await limiter.limit(key);
  return { allowed: r.success, remaining: r.remaining, reset: r.reset };
}
