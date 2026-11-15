// Telemetry Service: stores GPS/battery/speed readings and raises SMS alerts for critical events.
const { createApp, finalize, callService } = require('../shared/http');
const { authenticate, authorize } = require('../shared/auth');
const db = require('../shared/db');
const config = require('../config');

function create({ urls }) {
  const app = createApp('telemetry-service');

  app.post('/', authenticate, authorize('admin', 'operator', 'driver'), async (req, res) => {
    const { vehicleId, lat, lng, speed, battery, event } = req.body || {};
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId is required' });
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: 'lat and lng must be valid numbers' });
    }
    if (battery != null && (typeof battery !== 'number' || battery < 0 || battery > 100)) {
      return res.status(400).json({ error: 'battery must be a number between 0 and 100' });
    }
    const vehicle = db.get().prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const now = new Date().toISOString();
    const info = db
      .get()
      .prepare('INSERT INTO telemetry (vehicle_id, lat, lng, speed, battery, event, recorded_at) VALUES (?,?,?,?,?,?,?)')
      .run(vehicle.id, lat, lng, speed ?? null, battery ?? null, event || null, now);
    // Keep the vehicle's last known position in sync.
    db.get().prepare('UPDATE vehicles SET lat = ?, lng = ?, last_seen = ? WHERE id = ?').run(lat, lng, now, vehicle.id);

    // Critical event (explicit, or implied by a very low battery) => SMS to admins.
    let eventType = event;
    if (!eventType && battery != null && battery < 15) eventType = 'low_battery';
    let notifications = [];
    if (eventType && config.criticalEvents.includes(eventType)) {
      const n = await callService(urls.notifications, '/send', {
        method: 'POST',
        body: {
          message: `CRITICAL: ${eventType.replace('_', ' ')} on vehicle ${vehicle.plate} at (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          eventType,
          vehicleId: vehicle.id,
          recipients: 'admins',
        },
      });
      notifications = n.ok ? n.data.notifications : [];
    }
    res.status(201).json({
      reading: db.get().prepare('SELECT * FROM telemetry WHERE id = ?').get(info.lastInsertRowid),
      notifications,
    });
  });

  app.get('/vehicle/:vehicleId', authenticate, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const rows = db.get().prepare('SELECT * FROM telemetry WHERE vehicle_id = ? ORDER BY id DESC LIMIT ?').all(req.params.vehicleId, limit);
    res.json(rows);
  });

  app.get('/vehicle/:vehicleId/latest', authenticate, (req, res) => {
    const row = db.get().prepare('SELECT * FROM telemetry WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1').get(req.params.vehicleId);
    if (!row) return res.status(404).json({ error: 'No telemetry for this vehicle' });
    res.json(row);
  });

  return finalize(app);
}

module.exports = { create };
