// Starts all five services and the gateway in a single process, each on its own port.
const config = require('./config');
const db = require('./shared/db');
const gateway = require('./gateway/gateway');
const user = require('./services/user');
const vehicle = require('./services/vehicle');
const telemetry = require('./services/telemetry');
const geo = require('./services/geo');
const notification = require('./services/notification');

function listen(app, port) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

async function startAll({ ports = config.ports, geocoder, smsProvider, gatewayOptions = {} } = {}) {
  db.init();
  const urls = {};
  const servers = {};
  const apps = {
    users: user.create(),
    vehicles: vehicle.create({ urls }),
    telemetry: telemetry.create({ urls }),
    maps: geo.create({ geocoder }),
    notifications: notification.create({ smsProvider }),
  };
  for (const [name, app] of Object.entries(apps)) {
    servers[name] = await listen(app, ports[name] ?? 0);
    urls[name] = `http://127.0.0.1:${servers[name].address().port}`;
  }
  const gw = gateway.create({ urls, ...gatewayOptions });
  servers.gateway = await listen(gw, ports.gateway ?? 0);
  urls.gateway = `http://127.0.0.1:${servers.gateway.address().port}`;
  const close = () => Promise.all(Object.values(servers).map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); })));
  return { urls, servers, gateway: gw, close };
}

module.exports = { startAll };

async function seedDemo(gw) {
  const H = { 'x-api-key': config.apiKeys[0], 'content-type': 'application/json' };
  const call = async (method, path, body, token) =>
    (await fetch(gw + path, { method, headers: { ...H, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) })).json();
  const { token } = await call('POST', '/api/users/login', { username: 'admin', password: 'admin123' });
  const fleet = [
    ['DL01AB1001', 'Tata Ace', 28.6315, 77.2167, 3],
    ['DL01AB1002', 'Mahindra Bolero', 28.6129, 77.2295, null],
    ['DL01AB1003', 'Ashok Leyland Dost', 28.5355, 77.391, null],
    ['HR26CD2001', 'Eicher Pro', 28.4595, 77.0266, null],
    ['MH02EF3001', 'Tata 407', 19.076, 72.8777, null],
  ];
  const ids = [];
  for (const [plate, model, lat, lng, driverId] of fleet) ids.push((await call('POST', '/api/vehicles', { plate, model, lat, lng, driverId }, token)).id);
  await call('PATCH', `/api/vehicles/${ids[0]}/status`, { status: 'active' }, token);
  await call('PATCH', `/api/vehicles/${ids[1]}/status`, { status: 'maintenance' }, token);
  await call('POST', '/api/telemetry', { vehicleId: ids[0], lat: 28.632, lng: 77.218, speed: 38, battery: 71 }, token);
  await call('POST', '/api/telemetry', { vehicleId: ids[2], lat: 28.5355, lng: 77.391, speed: 0, battery: 8, event: 'low_battery' }, token);
  await call('POST', '/api/telemetry', { vehicleId: ids[3], lat: 28.4595, lng: 77.0266, speed: 0, event: 'emergency_stop' }, token);
}

if (require.main === module) {
  startAll().then(async ({ urls }) => {
    if (process.env.DEMO_SEED === '1') await seedDemo(urls.gateway);
    console.log('Fleet Management System running');
    console.table(urls);
    console.log(`Swagger UI : ${urls.gateway}/api-docs`);
    console.log(`Map UI     : ${urls.gateway}/api/maps/ui/`);
    console.log(`API keys   : ${config.apiKeys.join(', ')}`);
  });
}
