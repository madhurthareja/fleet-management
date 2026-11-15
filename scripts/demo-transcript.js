// Runs real requests against a running gateway and prints a readable transcript (used for the screenshots).
const GW = process.env.GW || 'http://127.0.0.1:3000';
const KEY = process.env.KEY || 'demo-key-123';
async function show(title, method, path, { key = KEY, token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(GW + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  let out = text;
  try { out = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  if (out.length > 700) out = out.slice(0, 700) + '\n  ...';
  const rl = res.headers.get('x-ratelimit-remaining');
  console.log(`# ${title}\n$ curl -X ${method} ${path}${key ? ` -H "x-api-key: ${key}"` : ''}${token ? ' -H "Authorization: Bearer <jwt>"' : ''}`);
  console.log(`HTTP ${res.status}${rl !== null ? `   (X-RateLimit-Remaining: ${rl})` : ''}\n${out}\n`);
  return res;
}
(async () => {
  const mode = process.argv[2];
  const login = await (await fetch(GW + '/api/users/login', { method: 'POST', headers: { 'x-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json();
  const token = login.token;
  if (mode === 'gateway') {
    await show('1. No API key -> 401', 'GET', '/api/vehicles', { key: null });
    await show('2. Wrong API key -> 403', 'GET', '/api/vehicles', { key: 'bad-key' });
    await show('3. Valid key routed to Vehicle Service', 'GET', '/api/vehicles?status=active', { token });
    await show('4. Routed to Geolocation Service', 'GET', '/api/maps/nearby?lat=28.6139&lng=77.2090&radius_km=5', { token });
    await show('5. Unknown route -> 404', 'GET', '/api/billing/invoices', { token });
    let last;
    for (let i = 0; i < 105; i++) last = await fetch(GW + '/api/users/me', { headers: { 'x-api-key': 'burst-key' } });
    console.log(`# 6. Burst of 105 requests with one key -> last response\nHTTP ${last.status}  Retry-After: ${last.headers.get('retry-after')}s  X-RateLimit-Remaining: ${last.headers.get('x-ratelimit-remaining')}\n${await last.text()}`);
  } else if (mode === 'sms') {
    await show('Status change triggers SMS (admin + assigned driver)', 'PATCH', '/api/vehicles/3/status', { token, body: { status: 'active' } });
    await show('Critical telemetry event triggers SMS', 'POST', '/api/telemetry', { token, body: { vehicleId: 3, lat: 28.5355, lng: 77.391, speed: 0, event: 'engine_fault' } });
    await show('Failed SMS (number rejected by mock carrier) is recorded', 'POST', '/api/notifications/send', { token, body: { message: 'Test to bad number', phone: '+910000000000' } });
    await show('Notification log filtered by status=failed', 'GET', '/api/notifications?status=failed', { token });
  }
})();
