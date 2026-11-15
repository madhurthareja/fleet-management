# Fleet Management System — Part 2

Submitted by Madhur Thareja, 2023EBCS412

Geolocation + SMS integrations, an Express API gateway, Swagger/OpenAPI docs, and a Mocha/Chai test suite.

**Live:** https://fleet-management-tdum.onrender.com (free tier — first request after idle takes 30-50s)

```
Browser / client ──► API Gateway :3000 ──► User Service          :3001  /api/users/*
 (x-api-key, JWT)   • API-key check    ├─► Vehicle/Fleet Service :3002  /api/vehicles/*
                    • rate limit       ├─► Telemetry Service     :3003  /api/telemetry/*
                    • routing/errors   ├─► Geolocation Service   :3004  /api/maps/*     ─► OpenStreetMap / Google
                    • Swagger UI       └─► Notification Service  :3005  /api/notifications/* ─► mock SMS / Twilio
                                         (shared SQLite database: users, vehicles, telemetry, notifications)
```

Each service is an independent Express app on its own port, run together in one Node process. They call each other over HTTP (Vehicle/Telemetry → Notification, Vehicle → Geolocation).

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

36 tests, 7 flows: login/JWT, vehicle registration, telemetry storage, status update → SMS, RBAC, nearby search (mocked geocoder), gateway API-key/rate-limit/503.

## Integrations

**Geolocation** (`GEOCODER=osm|google|mock`) — address → lat/lng on vehicle registration, `/api/maps/geocode`, and `/api/maps/nearby?address=`. Telemetry GPS readings update the vehicle's last position. `/api/maps/nearby?lat&lng&radius_km` returns vehicles in range, nearest first (haversine). `/api/maps/vehicles/geojson` feeds the Leaflet map.

**SMS** (`SMS_PROVIDER=mock|twilio`) — mock provider stores every message and fails numbers ending in `0000`. Each attempt is saved in `notifications` with `status = sent|failed`, provider id, and error; query failed ones at `GET /api/notifications?status=failed`. Sends to all admins on `engine_fault`, `low_battery` (battery < 15%), or `emergency_stop`; sends to admins + assigned driver on a status change. Switching to Twilio only needs the `TWILIO_*` env vars.

## Gateway behaviour

| Situation | Response |
|---|---|
| no `x-api-key` | 401 |
| unknown key | 403 |
| over `RATE_LIMIT_MAX` requests/window per key | 429 + `Retry-After` (`X-RateLimit-*` headers on every call) |
| unknown `/api/...` route | 404 |
| malformed JSON | 400 |
| target service down / timeout (5s) | 503 / 504 |

`/health`, `/api-docs`, and the map page are public. JWTs are verified by the services; the gateway forwards `Authorization`.

## Deliverables

| Deliverable | Where |
|---|---|
| OpenAPI docs | `src/docs/openapi.js`, served at `/api-docs` |
| Gateway code | `src/gateway/gateway.js` |
| Tests | `test/api.test.js` |
| Deployment | https://fleet-management-tdum.onrender.com · `Dockerfile` included for local/other hosts |
| Screenshots | `docs/screenshots/` |

Screenshots: `1-map-nearby-vehicles.png` (geolocation + nearby search), `2-sms-notification-log-ui.png` / `2b-sms-notification-api.png` (SMS), `3-gateway-routing-apikey-ratelimit.png` (gateway), `4-swagger-ui.png` / `4b-swagger-ui-endpoint-detail.png` (docs). Regenerate with `npm run start:demo` then `npm run screenshots` (needs Playwright + Chrome).

## Security notes

Change `JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`, and `GATEWAY_API_KEYS` before real use; the demo users/keys are for testing only. The rate limiter is in-memory, per process.
