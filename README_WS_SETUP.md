# Real-time (WebSocket) Stable Setup

## Backend (ASGI)
Use an ASGI server (recommended `uvicorn`) instead of `runserver` for consistent WebSocket behavior.

### Install
pip install uvicorn[standard]

### Run
cd backend
uvicorn mujard.asgi:application --host 127.0.0.1 --port 8000 --reload

Or with Daphne:
daphne -b 127.0.0.1 -p 8000 mujard.asgi:application

## Frontend
Environment variables (.env.local):

NEXT_PUBLIC_API_HOST=127.0.0.1
NEXT_PUBLIC_API_PORT=8000
NEXT_PUBLIC_API_PROTO=http
# NEXT_PUBLIC_WS_PROTO=wss  # enable when behind TLS

`src/lib/config.ts` centralizes API & WS base URLs.

## Reconnect Logic
`apiClient.connectSocketWithRetry(conversationId)` implements exponential backoff (configurable) to auto-retry transient drops.

## Production Notes
- Put a reverse proxy (nginx / caddy) terminating TLS; pass through `websocket` upgrade.
- Use `wss://` in production via setting `NEXT_PUBLIC_WS_PROTO=wss`.
- Prefer Redis channel layer in production (set `REDIS_URL` env) for multi-process scaling.

## Troubleshooting
| Symptom | Cause | Fix |
| ------- | ----- | --- |
| 404 on /ws/... with runserver | WSGI path only | Use uvicorn/daphne |
| Immediate close | Auto-reload or duplicate connections | Ensure single useEffect dependency & retry wrapper |
| Auth fails | Missing `?token=` param | Ensure token present (handled automatically now) |
| No broadcast between workers | InMemory channel layer | Configure Redis `REDIS_URL` |

## Security
- Access token is sent via query param for WebSocket. In production, consider short-lived access tokens and enforce HTTPS/WSS.
- Optionally implement server-side expiry check + periodic `ping`.

## Next Improvements
- Heartbeat ping/pong
- Presence (last_seen/online)
- Typing indicators

## Web Push (Messages) Quick Start

1) Backend `.env` (in backend/ folder):

```
VAPID_PUBLIC_KEY=BK...your_public
VAPID_PRIVATE_KEY=KJ...your_private
VAPID_CONTACT_EMAIL=mailto:you@example.com
```

2) Frontend `.env.local`:

```
NEXT_PUBLIC_API_HOST=localhost
NEXT_PUBLIC_API_PORT=8000
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BK...your_public
```

3) Install + migrate:
- Backend: `pip install -r backend/requirements.txt` then `python backend/manage.py migrate`
- Frontend: `npm i` then `npm run dev`

4) In the app, visit Settings and click "تفعيل الإشعارات"; grant browser permission.

5) Send a message from user B to user A. Even with A's tab closed, a push notification should appear. Clicking it opens `/conversation/<id>`.
