/**
 * A fixed-window rate limiter.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * It is a speed bump. The counters live in the memory of one server instance,
 * and this application runs on Netlify Functions where instances come and go
 * and several serve traffic at once. Somebody determined enough to spread
 * attempts across instances gets a multiple of the limit, and a deploy resets
 * every counter.
 *
 * That is worth being explicit about, because "we have rate limiting" is the
 * kind of sentence that stops people asking. What this stops is the cheap,
 * high-volume version — a script hammering one address on one connection — and
 * that is the shape almost all of it takes. What it does not stop is a
 * distributed attempt, and the honest fix for that is a shared store (Redis,
 * or a Postgres table) which is a real dependency and a real decision, not
 * something to slip in under "add basic rate limiting".
 *
 * Fixed window rather than sliding: a sliding window needs the timestamp of
 * every hit, which is more memory per key and more to get wrong, for a
 * smoother boundary nobody here is troubled by. The cost of a fixed window is
 * that a caller can spend the full allowance at the end of one window and
 * again at the start of the next. For a login form that is 10 attempts in
 * quick succession instead of 5, which is still not a credential-stuffing run.
 *
 * Pure and I/O-free apart from the clock, which is injected.
 */

export interface RateLimitResult {
  ok: boolean
  /** Attempts left in this window, after counting the current one. */
  remaining: number
  /** When the window resets, so a caller can say how long to wait. */
  resetAt: number
  /** Whole seconds until reset, for a Retry-After header. */
  retryAfterSeconds: number
}

export interface RateLimitRule {
  /** Attempts permitted per window. */
  limit: number
  windowMs: number
}

interface Bucket {
  count: number
  resetAt: number
}

/**
 * A limiter over one namespace of keys.
 *
 * Instances are module-level singletons at the call site, so the counters
 * survive between requests on the same server instance and nothing else.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly rule: RateLimitRule) {}

  check(key: string, now: number): RateLimitResult {
    this.sweep(now)

    const existing = this.buckets.get(key)
    const bucket = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + this.rule.windowMs }

    bucket.count += 1
    this.buckets.set(key, bucket)

    const remaining = Math.max(0, this.rule.limit - bucket.count)
    return {
      ok: bucket.count <= this.rule.limit,
      remaining,
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    }
  }

  /** Forget a key — called after a success, so one good login clears the count. */
  reset(key: string): void {
    this.buckets.delete(key)
  }

  /**
   * Drop expired buckets so the map cannot grow without bound.
   *
   * Every key is an address or an IP, both attacker-supplied, so an unbounded
   * map is a way to exhaust an instance's memory by varying the key — which
   * would turn a defence into the vulnerability.
   */
  private sweep(now: number): void {
    if (this.buckets.size < 1_000) return
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key)
    }
  }

  /** Test seam. */
  get size(): number {
    return this.buckets.size
  }
}

/**
 * Who is calling, as well as it can be known behind a proxy.
 *
 * `x-forwarded-for` is a client-supplied header and trivially spoofed, so this
 * is not identity — it is a bucketing key. Netlify overwrites it with the real
 * peer address, which is what makes it useful here; treat it as advisory
 * anywhere that matters more than this.
 */
export function callerKey(headers: Headers, fallback = 'unknown'): string {
  const forwarded = headers.get('x-nf-client-connection-ip')
    ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? headers.get('x-real-ip')
  return forwarded || fallback
}
