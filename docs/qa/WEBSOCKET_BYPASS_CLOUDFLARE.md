# WebSocket Disconnect Fix via Cloudflare Bypass

## TL;DR
- WebSocket connections to `/ws/...` were closing after ~24 seconds with code `1006` despite healthy ping/pong heartbeats.
- Cloudflare's proxy aggressively closes idle WebSocket tunnels even when heartbeat frames are exchanged.
- We now route WebSocket traffic through a dedicated subdomain (`ws.mutabaka.com`) that **bypasses** Cloudflare (gray cloud) while keeping HTTP traffic proxied.
- Mobile and web clients default to the new endpoint. Backend allows the new host and Nginx already keeps long-lived sockets alive.

## Root Cause Recap
- Authentication and handshake succeeded (`[WS AUTH] ✅ Authenticated user ...`).
- Ping/pong heartbeats ran every 10 seconds; the last successful exchange logged just before disconnects.
- Nginx timeouts were raised to 600s and confirmed not to be the culprit.
- Cloudflare closes "inactive" WebSocket tunnels (policy limit ~100 seconds for some plans). The termination happens upstream, producing the `1006` (abnormal close) observed on the server.

## Implemented Changes
1. **Backend**
   - Added `ws.mutabaka.com` (and staging variant) to Django `ALLOWED_HOSTS` + `CSRF_TRUSTED_ORIGINS` to accept handshake requests.
2. **Mobile App**
   - Default WebSocket base URLs now point to `wss://ws.mutabaka.com/ws` (production) and `wss://ws.staging.mutabaka.com/ws` (staging).
   - `.env.example` updated so Expo overrides stay aligned.
3. **Web Frontend**
   - Config now supports independent WebSocket host/port/base environment variables.
   - `.env.local` documents the new defaults (`ws.mutabaka.com`).
4. **Documentation**
   - This runbook captures the mitigation steps plus Cloudflare requirements.

## Cloudflare / DNS Action Items
Perform these changes in the Cloudflare dashboard (or via API/terraform) before deploying:

1. **Create DNS Records**
   - `ws.mutabaka.com` → origin server IP (e.g., `91.98.95.210`).
   - `ws.staging.mutabaka.com` → staging origin (if different).
   - Ensure the orange cloud is **disabled** (gray cloud) to bypass Cloudflare for these hosts.

2. **Optional Tweaks for main domain** (if keeping Cloudflare in front of HTTPS):
   - Enable "WebSockets" toggle (always keep on).
   - Disable "Rocket Loader" and "Auto Minify" to avoid script rewrites touching WS handshake.
   - Use "Development Mode" temporarily while validating.

> ⚠️ Without the gray-cloud bypass, Cloudflare will keep dropping long-lived sockets and the issue will persist.

## Client Configuration
Nothing to change if you use the repo defaults. For custom deployments:

- **Mobile Expo:** override via `EXPO_PUBLIC_WS_BASE_URL` (no trailing slash). Example: `wss://ws.example.com/ws`.
- **Next.js Frontend:**
  - `NEXT_PUBLIC_WS_HOST=ws.example.com`
  - `NEXT_PUBLIC_WS_PORT=443`
  - Or set `NEXT_PUBLIC_WS_BASE=wss://ws.example.com`

## Verification Checklist
1. Update DNS + Cloudflare settings and wait for propagation.
2. From a machine outside Cloudflare, run: `wscat -c wss://ws.mutabaka.com/ws/inbox/` (authenticate as usual) and ensure socket stays open >2 minutes.
3. Test from mobile app & web frontend; confirm heartbeats continue past 5 minutes without `1006`.
4. Monitor backend logs for `[WS AUTH]` and absence of abnormal closes.

## Follow-up Ideas
- Add Synthetic monitor (e.g., health check) that keeps a WebSocket session alive and alerts if it drops prematurely.
- Consider Cloudflare Tunnel (Argo Tunnel) if you must keep traffic within Cloudflare while retaining stable WebSockets.
- Evaluate migrating push events to Pusher/SSE as a secondary channel if WebSockets become inaccessible for some ISPs.
