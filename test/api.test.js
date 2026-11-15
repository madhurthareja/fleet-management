// Mocha + Chai integration tests. The whole system (5 services + gateway) is started in-process
// on ephemeral ports, with a mocked geocoder and a spy SMS provider (no external network needed).
const { expect } = require('chai');
const request = require('supertest');
const { startAll } = require('../src/start');
const { haversineKm } = require('../src/services/geo');
const db = require('../src/shared/db');

const KEY = 'test-key';

// Mocked geolocation service: deterministic addresses, one that always fails.
const mockGeocoder = async (address) => {
  if (/broken/i.test(address)) throw new Error('provider down');
  const places = { 'connaught place': { lat: 28.6315, lng: 77.2167 }, 'india gate': { lat: 28.6129, lng: 77.2295 }, mumbai: { lat: 19.076, lng: 72.8777 } };
  const k = Object.keys(places).find((p) => address.toLowerCase().includes(p));
  return k ? { ...places[k], displayName: address } : null;
};

// Spy SMS provider that records every message; numbers ending 0000 fail.
const sentSms = [];
const smsProvider = {
  name: 'test-sms',
  async send(to, body) {
    if (/0000$/.test(to)) throw new Error('simulated carrier failure');
    sentSms.push({ to, body });
    return { id: 'T' + sentSms.length };
  },
};

describe('Fleet Management System', function () {
  let system, gw;

  const api = (method, path, token) => {
    const r = request(gw)[method](path).set('x-api-key', KEY);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const login = async (username, password) => (await api('post', '/api/users/login').send({ username, password })).body;

  before(async () => {
    system = await startAll({
      ports: {},
      geocoder: mockGeocoder,
      smsProvider,
      gatewayOptions: { apiKeys: [KEY], rateLimit: { windowMs: 60_000, max: 1000 } },
    });
    gw = system.urls.gateway;
  });
  after(() => system.close());

  let adminToken, operatorToken, driverToken;
  before(async () => {
    adminToken = (await login('admin', 'admin123')).token;
    operatorToken = (await login('operator', 'operator123')).token;
    driverToken = (await login('driver', 'driver123')).token;
  });

  // ---------------------------------------------------------------- Flow 1
  describe('1. User login and JWT verification', () => {
    it('logs in with valid credentials and returns a JWT', async () => {
      const res = await api('post', '/api/users/login').send({ username: 'admin', password: 'admin123' });
      expect(res.status).to.equal(200);
      expect(res.body.token).to.be.a('string').with.length.greaterThan(20);
      expect(res.body.user).to.include({ username: 'admin', role: 'admin' });
      expect(res.body.user).to.not.have.property('password_hash');
    });
    it('rejects wrong credentials with 401', async () => {
      const res = await api('post', '/api/users/login').send({ username: 'admin', password: 'nope' });
      expect(res.status).to.equal(401);
    });
    it('returns 400 when fields are missing', async () => {
      const res = await api('post', '/api/users/login').send({ username: 'admin' });
      expect(res.status).to.equal(400);
    });
    it('accepts a valid token on a protected endpoint (/me)', async () => {
      const res = await api('get', '/api/users/me', adminToken);
      expect(res.status).to.equal(200);
      expect(res.body.username).to.equal('admin');
    });
    it('rejects missing and tampered tokens with 401', async () => {
      expect((await api('get', '/api/users/me')).status).to.equal(401);
      const res = await api('get', '/api/users/me', adminToken.slice(0, -3) + 'abc');
      expect(res.status).to.equal(401);
    });
  });

  // ---------------------------------------------------------------- Flow 2
  describe('2. Vehicle registration and retrieval', () => {
    let vehicleId;
    it('registers a vehicle and geocodes its address', async () => {
      const res = await api('post', '/api/vehicles', operatorToken).send({ plate: 'DL01AA0001', model: 'Tata Ace', address: 'Connaught Place, New Delhi' });
      expect(res.status).to.equal(201);
      expect(res.body).to.include({ plate: 'DL01AA0001', status: 'idle' });
      expect(res.body.lat).to.be.closeTo(28.6315, 0.0001);
      vehicleId = res.body.id;
    });
    it('retrieves the vehicle by id and in the list', async () => {
      const one = await api('get', `/api/vehicles/${vehicleId}`, driverToken);
      expect(one.status).to.equal(200);
      expect(one.body.plate).to.equal('DL01AA0001');
      const list = await api('get', '/api/vehicles', driverToken);
      expect(list.body.map((v) => v.plate)).to.include('DL01AA0001');
    });
    it('rejects duplicate plates (409), missing plate (400), unknown id (404)', async () => {
      expect((await api('post', '/api/vehicles', adminToken).send({ plate: 'DL01AA0001' })).status).to.equal(409);
      expect((await api('post', '/api/vehicles', adminToken).send({ model: 'x' })).status).to.equal(400);
      expect((await api('get', '/api/vehicles/99999', adminToken)).status).to.equal(404);
    });
    it('returns 422 when the address cannot be geocoded', async () => {
      const res = await api('post', '/api/vehicles', adminToken).send({ plate: 'XX00NOADDR', address: 'Atlantis' });
      expect(res.status).to.equal(422);
    });
  });

  // ---------------------------------------------------------------- Flow 3
  describe('3. Vehicle telemetry submission and storage', () => {
    let vehicleId;
    before(async () => {
      vehicleId = (await api('post', '/api/vehicles', adminToken).send({ plate: 'DL01TT0003', lat: 28.5, lng: 77.1 })).body.id;
    });
    it('stores a reading and updates the vehicle position', async () => {
      const res = await api('post', '/api/telemetry', driverToken).send({ vehicleId, lat: 28.61, lng: 77.23, speed: 40, battery: 80 });
      expect(res.status).to.equal(201);
      expect(res.body.reading).to.include({ vehicle_id: vehicleId, lat: 28.61, speed: 40 });
      expect(res.body.notifications).to.have.length(0);

      const latest = await api('get', `/api/telemetry/vehicle/${vehicleId}/latest`, adminToken);
      expect(latest.body.lng).to.equal(77.23);
      const vehicle = await api('get', `/api/vehicles/${vehicleId}`, adminToken);
      expect(vehicle.body.lat).to.equal(28.61); // GPS coordinates persisted on the vehicle
      expect(db.get().prepare('SELECT COUNT(*) c FROM telemetry WHERE vehicle_id=?').get(vehicleId).c).to.equal(1);
    });
    it('validates the payload', async () => {
      expect((await api('post', '/api/telemetry', driverToken).send({ vehicleId, lat: 'x', lng: 1 })).status).to.equal(400);
      expect((await api('post', '/api/telemetry', driverToken).send({ vehicleId, lat: 95, lng: 1 })).status).to.equal(400);
      expect((await api('post', '/api/telemetry', driverToken).send({ vehicleId: 9999, lat: 1, lng: 1 })).status).to.equal(404);
    });
    it('keeps history newest first', async () => {
      await api('post', '/api/telemetry', driverToken).send({ vehicleId, lat: 28.7, lng: 77.3 });
      const hist = await api('get', `/api/telemetry/vehicle/${vehicleId}`, adminToken);
      expect(hist.body).to.have.length(2);
      expect(hist.body[0].lat).to.equal(28.7);
    });
  });

  // ---------------------------------------------------------------- Flow 4
  describe('4. Status update and SMS notification triggering', () => {
    let vehicleId;
    before(async () => {
      vehicleId = (await api('post', '/api/vehicles', adminToken).send({ plate: 'DL01SS0004', lat: 28.6, lng: 77.2, driverId: 3 })).body.id;
    });
    it('sends SMS to the admin and assigned driver and records them as sent', async () => {
      sentSms.length = 0;
      const res = await api('patch', `/api/vehicles/${vehicleId}/status`, operatorToken).send({ status: 'active' });
      expect(res.status).to.equal(200);
      expect(res.body.vehicle.status).to.equal('active');
      expect(res.body.notifications.map((n) => n.status)).to.deep.equal(['sent', 'sent']);
      expect(sentSms.map((s) => s.to)).to.have.members(['+919000000001', '+919000000003']);
      expect(sentSms[0].body).to.match(/DL01SS0004.*idle -> active/);

      const stored = await api('get', `/api/notifications?vehicleId=${vehicleId}`, adminToken);
      expect(stored.body).to.have.length(2);
      expect(stored.body[0]).to.include({ event_type: 'status_change', provider: 'test-sms' });
    });
    it('does not notify when the status is unchanged', async () => {
      const res = await api('patch', `/api/vehicles/${vehicleId}/status`, operatorToken).send({ status: 'active' });
      expect(res.body.notifications).to.have.length(0);
    });
    it('raises an SMS on a critical telemetry event', async () => {
      sentSms.length = 0;
      const res = await api('post', '/api/telemetry', driverToken).send({ vehicleId, lat: 28.6, lng: 77.2, event: 'engine_fault' });
      expect(res.body.notifications).to.have.length(1);
      expect(sentSms[0].body).to.match(/CRITICAL: engine fault on vehicle DL01SS0004/);
    });
    it('treats battery < 15% as a low_battery event', async () => {
      const res = await api('post', '/api/telemetry', driverToken).send({ vehicleId, lat: 28.6, lng: 77.2, battery: 9 });
      expect(res.body.notifications[0].event_type).to.equal('low_battery');
    });
    it('records failed deliveries with the error', async () => {
      const created = await api('post', '/api/users/register', adminToken).send({ username: 'ghost', password: 'pw', role: 'admin', phone: '+910000000000' });
      expect(created.status).to.equal(201);
      const res = await api('post', '/api/notifications/send', adminToken).send({ message: 'hello', userIds: [created.body.id] });
      expect(res.body.notifications[0]).to.include({ status: 'failed', error: 'simulated carrier failure' });
      const failed = await api('get', '/api/notifications?status=failed', adminToken);
      expect(failed.body.every((n) => n.status === 'failed')).to.equal(true);
      expect(failed.body.length).to.be.greaterThan(0);
    });
    it('rejects an invalid status', async () => {
      const res = await api('patch', `/api/vehicles/${vehicleId}/status`, operatorToken).send({ status: 'flying' });
      expect(res.status).to.equal(400);
    });
  });

  // ---------------------------------------------------------------- Flow 5
  describe('5. Role-based access control', () => {
    let vehicleId;
    before(async () => {
      vehicleId = (await api('post', '/api/vehicles', adminToken).send({ plate: 'DL01RB0005', lat: 28.6, lng: 77.2 })).body.id;
    });
    it('forbids a driver from deleting a vehicle (403)', async () => {
      const res = await api('delete', `/api/vehicles/${vehicleId}`, driverToken);
      expect(res.status).to.equal(403);
    });
    it('forbids an operator from deleting a vehicle (403)', async () => {
      expect((await api('delete', `/api/vehicles/${vehicleId}`, operatorToken)).status).to.equal(403);
    });
    it('rejects unauthenticated deletes (401)', async () => {
      expect((await api('delete', `/api/vehicles/${vehicleId}`)).status).to.equal(401);
    });
    it('forbids drivers from registering vehicles or listing users', async () => {
      expect((await api('post', '/api/vehicles', driverToken).send({ plate: 'NOPE' })).status).to.equal(403);
      expect((await api('get', '/api/users', driverToken)).status).to.equal(403);
      expect((await api('get', '/api/notifications', driverToken)).status).to.equal(403);
    });
    it('lets an admin delete the vehicle (204) and then 404s', async () => {
      expect((await api('delete', `/api/vehicles/${vehicleId}`, adminToken)).status).to.equal(204);
      expect((await api('get', `/api/vehicles/${vehicleId}`, adminToken)).status).to.equal(404);
    });
  });

  // ---------------------------------------------------------------- Flow 6
  describe('6. Nearby vehicle search (mocked geolocation)', () => {
    before(async () => {
      await api('post', '/api/vehicles', adminToken).send({ plate: 'NEAR-1', address: 'India Gate, New Delhi' }); // ~2.4 km from Connaught Place
      await api('post', '/api/vehicles', adminToken).send({ plate: 'FAR-MUM', address: 'Mumbai' }); // ~1150 km away
    });
    it('haversine distance is accurate (Delhi to Mumbai ~1150 km)', () => {
      expect(haversineKm(28.6139, 77.209, 19.076, 72.8777)).to.be.closeTo(1153, 10);
    });
    it('returns only vehicles inside the radius, nearest first', async () => {
      const res = await api('get', '/api/maps/nearby?lat=28.6315&lng=77.2167&radius_km=5', driverToken);
      expect(res.status).to.equal(200);
      const plates = res.body.vehicles.map((v) => v.plate);
      expect(plates).to.include('NEAR-1').and.to.include('DL01AA0001');
      expect(plates).to.not.include('FAR-MUM');
      const d = res.body.vehicles.map((v) => v.distance_km);
      expect(d).to.deep.equal([...d].sort((a, b) => a - b));
      expect(res.body.vehicles.find((v) => v.plate === 'NEAR-1').distance_km).to.be.closeTo(2.4, 0.2);
    });
    it('geocodes an address (mocked) as the search centre', async () => {
      const res = await api('get', '/api/maps/nearby?address=Mumbai&radius_km=10', driverToken);
      expect(res.body.vehicles.map((v) => v.plate)).to.deep.equal(['FAR-MUM']);
    });
    it('validates input and surfaces provider failures', async () => {
      expect((await api('get', '/api/maps/nearby?lat=abc&lng=1', driverToken)).status).to.equal(400);
      expect((await api('get', '/api/maps/nearby?lat=1&lng=1&radius_km=-3', driverToken)).status).to.equal(400);
      expect((await api('get', '/api/maps/nearby?address=Atlantis', driverToken)).status).to.equal(404);
      expect((await api('get', '/api/maps/nearby?address=broken', driverToken)).status).to.equal(502);
    });
    it('returns GeoJSON for map display', async () => {
      const res = await api('get', '/api/maps/vehicles/geojson', driverToken);
      expect(res.body.type).to.equal('FeatureCollection');
      expect(res.body.features[0].geometry.type).to.equal('Point');
    });
  });

  // ---------------------------------------------------------------- Flow 7
  describe('7. API Gateway: API key verification, routing and errors', () => {
    it('rejects requests without an API key (401)', async () => {
      const res = await request(gw).get('/api/vehicles');
      expect(res.status).to.equal(401);
      expect(res.body.error).to.match(/API key/);
    });
    it('rejects an invalid API key (403)', async () => {
      const res = await request(gw).get('/api/vehicles').set('x-api-key', 'wrong');
      expect(res.status).to.equal(403);
    });
    it('routes all five prefixes to their services', async () => {
      const paths = ['/api/users/me', '/api/vehicles', '/api/telemetry/vehicle/1', '/api/maps/vehicles/geojson', '/api/notifications'];
      for (const p of paths) {
        const res = await api('get', p, adminToken);
        expect(res.status, p).to.equal(200);
      }
    });
    it('returns 404 for unknown gateway routes and 400 for malformed JSON', async () => {
      expect((await api('get', '/api/unknown/thing', adminToken)).status).to.equal(404);
      const bad = await request(gw).post('/api/users/login').set('x-api-key', KEY).set('content-type', 'application/json').send('{not json');
      expect(bad.status).to.equal(400);
    });
    it('leaves docs and health public and serves the OpenAPI spec', async () => {
      expect((await request(gw).get('/health')).status).to.equal(200);
      const spec = await request(gw).get('/api-docs.json');
      expect(spec.body.openapi).to.match(/^3\./);
      expect(Object.keys(spec.body.paths)).to.include('/api/vehicles/{id}/status');
      expect((await request(gw).get('/api-docs/')).status).to.equal(200);
    });
    it('returns 503 when a backend service is down', async () => {
      const dead = await startAll({ ports: {}, gatewayOptions: { apiKeys: [KEY] } });
      await new Promise((r) => dead.servers.vehicles.close(r)); // kill only the vehicle service
      const res = await request(dead.urls.gateway).get('/api/vehicles').set('x-api-key', KEY);
      expect(res.status).to.equal(503);
      expect(res.body.error).to.match(/vehicles service unavailable/);
      await dead.close();
      db.init(); // dead system re-initialised the shared in-memory db; restore a fresh one for later tests
    });
  });

  describe('7b. API Gateway: rate limiting', () => {
    let limited;
    before(async () => {
      limited = await startAll({ ports: {}, gatewayOptions: { apiKeys: [KEY, 'other-key'], rateLimit: { windowMs: 60_000, max: 3 } } });
    });
    after(() => limited.close());

    it('allows requests up to the limit then answers 429 with Retry-After', async () => {
      const statuses = [];
      let last;
      for (let i = 0; i < 5; i++) {
        last = await request(limited.urls.gateway).get('/api/users/me').set('x-api-key', KEY);
        statuses.push(last.status);
      }
      expect(statuses).to.deep.equal([401, 401, 401, 429, 429]); // 401 = reached the service (no JWT), 429 = throttled
      expect(last.headers).to.have.property('retry-after');
      expect(last.headers['x-ratelimit-remaining']).to.equal('0');
    });
    it('tracks limits per API key', async () => {
      const res = await request(limited.urls.gateway).get('/api/users/me').set('x-api-key', 'other-key');
      expect(res.status).to.equal(401); // other key still has quota
    });
  });
});
