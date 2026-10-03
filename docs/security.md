# Security

## Threat model
A single-user journal that may sit on the public internet behind Caddy/nginx. Realistic attackers: someone guessing the password, a stranger probing for unauthenticated routes, a phishing link that abuses the login redirect, a stolen cookie. Out of scope: other users (there are none), a compromised host.

## What is protected, and how
- **Auth gate.** `src/proxy.ts` checks the session cookie on every path except `/login`, `/api/health`, static assets and `/api/uploads`; pages get a redirect to `/login?next=`, `/api/*` gets 401 JSON.
- **Defence in depth.** `requireAuth()` in the `(app)` layout, `isAuthenticated()` as the first line of every server action and of every API route (uploads are outside the proxy matcher, so the route itself checks).
- **Session.** JWT HS256 (algorithm pinned, `exp` required), 30 days, `HttpOnly; SameSite=Lax; Secure` in production. The signing key is `SHA-256(SESSION_SECRET + ":" + APP_PASSWORD)` (Web Crypto, so it also runs in the proxy).
- **Password.** `APP_PASSWORD` is compared in constant time. Login is refused, with a message on the login page, while it is unset or still `change-me` (case-insensitive).
- **Redirect.** `?next=` only accepts same-origin paths; the result of URL normalisation must not start with `//` (`/.//evil`, `/a/..//evil`, `/\evil`, tabs/newlines are all rejected).
- **Throttle** (`src/lib/login-guard.ts`, in memory, resets on restart):
  - *Per client:* key = the **last** `X-Forwarded-For` entry (the one your proxy appended; the leftmost is client-controlled), else `x-real-ip`, else `local` (all clients share it); max 64 chars. 5 failures lock that key for 60 s, then the counter restarts. A client's failures are forgotten 10 min after its last one; at most 5,000 keys are kept (oldest evicted).
  - *Global, header-independent:* every password check goes through one queue, one at a time, whatever the headers or parallelism. Within a 10-minute window the first 20 checks are immediate, then each waits 1 s longer than the last (max 10 s), so an attacker gets at most about 6 guesses a minute (about 380 an hour in a measured simulated hour). At most 5 checks may be running or waiting; further attempts get "wait a few minutes" without being checked or counted. A successful login gives its slot back. Constants: `GLOBAL_*` in `login-guard.ts`.
  - Nothing here locks you out for good: per-client locks expire after 60 s and the global limiter only delays. Someone flooding the form can keep the queue full, and then your attempt is turned away or waits up to 10 s per queued guess (about a minute at worst after they stop; nothing is remembered once they do). Your existing session keeps working throughout, and a restart clears all counters.
- **Uploads.** Auth first; 10 MB cap by Content-Length and, for chunked bodies, a streaming byte counter (413 as soon as the limit is crossed); type decided by magic bytes, name generated server-side. Served with `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=31536000, immutable` (names are random).
- **Exports** (csv/json/db): auth, `Cache-Control: no-store`, `nosniff`; CSV cells that look like formulas are prefixed.
- **Headers/CSP.** All global response headers live in `next.config.ts` (see architecture.md → Auth): frame denial, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `img-src 'self' data: blob:`, `no-store` on exports; uploads keep their own sandboxed CSP. HSTS belongs on the proxy.
- **Container.** The entrypoint starts as root only to `chown` `/data`, then drops to the unprivileged `node` user; compose sets `no-new-privileges`.

## Known limitations
- Sessions are stateless: logout only deletes the cookie. **Log out everywhere** by changing `APP_PASSWORD` or `SESSION_SECRET` and restarting. Changing either invalidates every session once.
- No 2FA, one user, no audit log.
- The throttle is per process and in memory; with several instances each has its own counters.
- Uploads are never garbage-collected; chunked uploads are buffered (up to the 10 MB cap) before being parsed.
- Markdown images from other sites are blocked by the CSP (they would leak your IP).

## Deployer checklist
1. HTTPS only, with HSTS at the proxy.
2. Proxy must **overwrite** `X-Forwarded-For` (not append client values) and pass `Host`/`X-Forwarded-Host`.
3. Cap request bodies at about 12 MB at the proxy.
4. Never publish port 3000; bind it to 127.0.0.1.
5. Real `APP_PASSWORD` (12+ random chars) and `SESSION_SECRET` from `openssl rand -hex 32`.
6. Back up `/data`; keep Next.js and React patched.
