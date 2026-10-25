/**
 * Minimal in-memory per-IP rate limiter for the payment routes (SERVER ONLY).
 *
 * Fixed-window counters, one Map entry per ip+route; entries are pruned when
 * a window passes. Best-effort protection suited to a single-process demo —
 * not a distributed or durable solution (documented in the README).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

function pruneExpired(now: number): void {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSeconds: number; status: 429 } {
  const now = Date.now();
  pruneExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)), status: 429 };
  }
  bucket.count += 1;
  return { ok: true };
}

/** Best-effort client identity for rate limiting (proxy header or local). */
export function clientKey(request: Request, route: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "local";
  return `${route}:${ip}`;
}
