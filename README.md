# Fleet Management System — Part 2

Submitted by Madhur Thareja, 2023EBCS412

Third-party integrations (geolocation + SMS), an Express API gateway, Swagger/OpenAPI docs and a Mocha/Chai test suite.

```
Browser / client ──► API Gateway :3000 ──► User Service          :3001  /api/users/*
 (x-api-key, JWT)   • API-key check    ├─► Vehicle/Fleet Service :3002  /api/vehicles/*
                    • rate limit       ├─► Telemetry Service     :3003  /api/telemetry/*
                    • routing/errors   ├─► Geolocation Service   :3004  /api/maps/*     ─► OpenStreetMap / Google
                    • Swagger UI       └─► Notification Service  :3005  /api/notifications/* ─► mock SMS / Twilio
                                         (shared SQLite database: users, vehicles, telemetry, notifications)
```

All services run in one Node process, but each is an independent Express app on its own port and they talk to each other over HTTP (Vehicle/Telemetry → Notification, Vehicle → Geolocation). 

## Install & run

Requires Node 18+ (tested on 22).

```bash
npm install
npm run start:demo     # seeded demo data, offline geocoder  → http://localhost:3000
# or: npm start        # empty fleet, real OpenStreetMap geocoding
```

| What | URL |
|---|---|
| Swagger UI | http://localhost:3000/api-docs (raw spec: `/api-docs.json`) |
| Map UI (Leaflet) | http://localhost:3000/api/maps/ui/ |
| Health | http://localhost:3000/health |

**API keys:** `demo-key-123`, `mobile-app-key-456` · **Users:** `admin/admin123`, `operator/operator123`, `driver/driver123`

### Demo

```bash
KEY="x-api-key: demo-key-123"
TOKEN=$(curl -s localhost:3000/api/users/login -H "$KEY" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s "localhost:3000/api/maps/nearby?lat=28.6139&lng=77.2090&radius_km=5" -H "$KEY" -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH localhost:3000/api/vehicles/1/status -H "$KEY" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"maintenance"}'      # triggers SMS
curl -s localhost:3000/api/notifications -H "$KEY" -H "Authorization: Bearer $TOKEN"
```

## Tests

```bash
npm install
npm test
```

## Integrations

**Geolocation** (`GEOCODER=osm|google|mock`) — address → lat/lng (used when registering a vehicle with an address, `/api/maps/geocode`, and `/api/maps/nearby?address=`); GPS readings from telemetry are stored and update the vehicle's last position; `/api/maps/nearby` returns vehicles within `radius_km` using the haversine formula, nearest first; `/api/maps/vehicles/geojson` feeds the Leaflet map. 

**SMS** (`SMS_PROVIDER=mock|twilio`) — the mock provider stores every message and can simulate failures (numbers ending in `0000`). Every attempt is saved in the `notifications` table with `status = sent|failed`, provider id and error, and is queryable at `GET /api/notifications?status=failed`. SMS is sent to all admins when telemetry reports `engine_fault`, `low_battery` (or battery < 15 %) or `emergency_stop`, and to admins + the assigned driver when a vehicle's status really changes. Switching to Twilio only needs the `TWILIO_*` variables.

## Gateway behaviour

| Situation | Response |
|---|---|
| no `x-api-key` | 401 |
| unknown key | 403 |
| more than `RATE_LIMIT_MAX` requests/window per key | 429 + `Retry-After` (headers `X-RateLimit-*` on every call) |
| unknown `/api/...` route | 404 |
| malformed JSON | 400 |
| target service down / timeout (5 s) | 503 / 504 |

`/health`, `/api-docs` and the static map page are public. JWTs are verified by the services themselves; the gateway forwards `Authorization`.

## Deliverables

| Deliverable | Where |
|---|---|
| OpenAPI docs | `src/docs/openapi.js`, served at `/api-docs` |
| Gateway code | `src/gateway/gateway.js` |
| Tests | `test/api.test.js` |
| Deployment | not deployed from this environment; `Dockerfile` included (`docker build -t fleet . && docker run -p 3000:3000 fleet`), works on Render/Railway/Fly as-is |
| Screenshots | `docs/screenshots/` (see below) |

Screenshots: `1-map-nearby-vehicles.png` (geolocation + nearby search), `2-sms-notification-log-ui.png` and `2b-sms-notification-api.png` (SMS generation), `3-gateway-routing-apikey-ratelimit.png` (gateway), `4-swagger-ui.png` / `4b-…detail.png` (docs). Regenerate with `npm run start:demo` then `npm run screenshots` (needs Playwright + Chrome). The map tiles are blank in the captured images only because the sandbox that produced them had no access to openstreetmap.org; the markers, search circle and results are real.

## Security notes
Change `JWT_SECRET`, `INTERNAL_SERVICE_TOKEN` and `GATEWAY_API_KEYS` before any real deployment; the demo users and keys are for testing only. The rate limiter is in-memory (per process).
