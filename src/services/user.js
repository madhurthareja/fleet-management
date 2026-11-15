// User Service: login, JWT issuing, profile, user listing (admin).
const bcrypt = require('bcryptjs');
const { createApp, finalize } = require('../shared/http');
const { sign, authenticate, authorize } = require('../shared/auth');
const db = require('../shared/db');

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, phone: u.phone };
}

function create() {
  const app = createApp('user-service');

  app.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
    const user = db.get().prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ token: sign(user), user: publicUser(user) });
  });

  app.post('/register', authenticate, authorize('admin'), (req, res) => {
    const { username, password, role, phone } = req.body || {};
    if (!username || !password || !role) return res.status(400).json({ error: 'username, password and role are required' });
    if (!['admin', 'operator', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (db.get().prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const info = db
      .get()
      .prepare('INSERT INTO users (username, password_hash, role, phone) VALUES (?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 8), role, phone || null);
    res.status(201).json(publicUser(db.get().prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
  });

  app.get('/me', authenticate, (req, res) => {
    const user = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(publicUser(user));
  });

  app.get('/', authenticate, authorize('admin'), (req, res) => {
    res.json(db.get().prepare('SELECT * FROM users').all().map(publicUser));
  });

  return finalize(app);
}

module.exports = { create };
