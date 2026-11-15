// Vehicle/Fleet Service: registration, retrieval, status updates (with SMS), deletion (admin only).
const { createApp, finalize, callService } = require('../shared/http');
const { authenticate, authorize } = require('../shared/auth');
const db = require('../shared/db');
const config = require('../config');

function create({ urls }) {
  const app = createApp('vehicle-service');
  const read = (id) => db.get().prepare('SELECT * FROM vehicles WHERE id = ?').get(id);

  app.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
    const { plate, model, address, lat, lng, driverId } = req.body || {};
    if (!plate || typeof plate !== 'string') return res.status(400).json({ error: 'plate is required' });
    if (db.get().prepare('SELECT 1 FROM vehicles WHERE plate = ?').get(plate)) {
      return res.status(409).json({ error: 'A vehicle with this plate already exists' });
    }
    let position = { lat: lat ?? null, lng: lng ?? null };
    if (address && (lat == null || lng == null)) {
      const g = await callService(urls.maps, `/internal/geocode?address=${encodeURIComponent(address)}`);
      if (g.ok) position = { lat: g.data.lat, lng: g.data.lng };
      else if (g.status === 404) return res.status(422).json({ error: 'Address could not be geocoded' });
      else return res.status(502).json({ error: 'Geolocation service unavailable' });
    }
    const info = db
      .get()
      .prepare('INSERT INTO vehicles (plate, model, status, address, lat, lng, driver_id, last_seen) VALUES (?,?,?,?,?,?,?,?)')
      .run(plate, model || null, 'idle', address || null, position.lat, position.lng, driverId || null, position.lat != null ? new Date().toISOString() : null);
    res.status(201).json(read(info.lastInsertRowid));
  });

  app.get('/', authenticate, (req, res) => {
    const { status } = req.query;
    const rows = status
      ? db.get().prepare('SELECT * FROM vehicles WHERE status = ?').all(status)
      : db.get().prepare('SELECT * FROM vehicles').all();
    res.json(rows);
  });

  app.get('/:id', authenticate, (req, res) => {
    const v = read(req.params.id);
    if (!v) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(v);
  });

  app.patch('/:id/status', authenticate, authorize('admin', 'operator', 'driver'), async (req, res) => {
    const { status } = req.body || {};
    if (!config.vehicleStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${config.vehicleStatuses.join(', ')}` });
    }
    const v = read(req.params.id);
    if (!v) return res.status(404).json({ error: 'Vehicle not found' });
    if (v.status === status) return res.json({ vehicle: v, notifications: [] });

    db.get().prepare('UPDATE vehicles SET status = ? WHERE id = ?').run(status, v.id);
    const userIds = v.driver_id ? [v.driver_id] : [];
    const n = await callService(urls.notifications, '/send', {
      method: 'POST',
      body: {
        message: `Vehicle ${v.plate} status changed: ${v.status} -> ${status}`,
        eventType: 'status_change',
        vehicleId: v.id,
        recipients: 'admins',
        userIds,
      },
    });
    res.json({ vehicle: read(v.id), notifications: n.ok ? n.data.notifications : [], notificationError: n.ok ? undefined : 'Notification service unavailable' });
  });

  app.delete('/:id', authenticate, authorize('admin'), (req, res) => {
    const info = db.get().prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Vehicle not found' });
    res.status(204).end();
  });

  return finalize(app);
}

module.exports = { create };
