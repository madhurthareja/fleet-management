// Notification Service: sends SMS through a mock stub (or Twilio) and records sent/failed status.
const { createApp, finalize } = require('../shared/http');
const { authenticate, authorize, internalOrRoles } = require('../shared/auth');
const db = require('../shared/db');
const config = require('../config');

const mockSmsProvider = {
  name: 'mock',
  outbox: [], // inspectable in tests
  async send(to, body) {
    if (/0000$/.test(to) || /FAIL/i.test(to)) throw new Error('Mock SMS gateway rejected the number');
    const id = 'MOCK' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.outbox.push({ to, body, id });
    return { id };
  },
};

const twilioProvider = {
  name: 'twilio',
  async send(to, body) {
    const { accountSid, authToken, from } = config.twilio;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Twilio error');
    return { id: data.sid };
  },
};

function create({ smsProvider } = {}) {
  const provider = smsProvider || (config.smsProvider === 'twilio' ? twilioProvider : mockSmsProvider);
  const app = createApp('notification-service');

  async function deliver({ phone, userId, message, eventType, vehicleId }) {
    let status = 'sent';
    let error = null;
    let providerId = null;
    try {
      providerId = (await provider.send(phone, message)).id;
    } catch (e) {
      status = 'failed';
      error = e.message;
    }
    const info = db
      .get()
      .prepare(
        `INSERT INTO notifications (recipient_phone, recipient_user_id, message, event_type, vehicle_id, status, provider, provider_message_id, error, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(phone, userId || null, message, eventType || null, vehicleId || null, status, provider.name, providerId, error, new Date().toISOString());
    return db.get().prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
  }

  app.post('/send', internalOrRoles('admin'), async (req, res) => {
    const { message, eventType, vehicleId, recipients, phone, userIds } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });

    const targets = [];
    if (phone) targets.push({ phone });
    if (recipients === 'admins' || userIds || Array.isArray(recipients)) {
      const rows = db.get().prepare('SELECT id, phone, role FROM users WHERE phone IS NOT NULL').all();
      const ids = new Set([...(userIds || []), ...(Array.isArray(recipients) ? recipients : [])]);
      for (const u of rows) {
        if ((recipients === 'admins' && u.role === 'admin') || ids.has(u.id)) targets.push({ phone: u.phone, userId: u.id });
      }
    }
    if (targets.length === 0) return res.status(400).json({ error: 'No valid recipients' });

    const seen = new Set();
    const results = [];
    for (const t of targets) {
      if (seen.has(t.phone)) continue;
      seen.add(t.phone);
      results.push(await deliver({ ...t, message, eventType, vehicleId }));
    }
    res.status(201).json({ notifications: results });
  });

  app.get('/', authenticate, authorize('admin', 'operator'), (req, res) => {
    const { status, vehicleId } = req.query;
    let sql = 'SELECT * FROM notifications WHERE 1=1';
    const params = [];
    if (status) {
      if (!['sent', 'failed'].includes(status)) return res.status(400).json({ error: 'status must be sent or failed' });
      sql += ' AND status = ?';
      params.push(status);
    }
    if (vehicleId) {
      sql += ' AND vehicle_id = ?';
      params.push(Number(vehicleId));
    }
    res.json(db.get().prepare(sql + ' ORDER BY id DESC').all(...params));
  });

  app.get('/:id', authenticate, authorize('admin', 'operator'), (req, res) => {
    const row = db.get().prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Notification not found' });
    res.json(row);
  });

  app.provider = provider;
  return finalize(app);
}

module.exports = { create, mockSmsProvider };
