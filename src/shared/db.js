// Shared SQLite database.
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('../config');

let db;

function init(file = config.dbFile) {
  if (db) db.close();
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','operator','driver')),
      phone TEXT
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate TEXT UNIQUE NOT NULL,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      address TEXT,
      lat REAL,
      lng REAL,
      driver_id INTEGER REFERENCES users(id),
      last_seen TEXT
    );
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      speed REAL,
      battery REAL,
      event TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_phone TEXT NOT NULL,
      recipient_user_id INTEGER,
      message TEXT NOT NULL,
      event_type TEXT,
      vehicle_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('sent','failed')),
      provider TEXT NOT NULL,
      provider_message_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);
  seed();
  return db;
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO users (username, password_hash, role, phone) VALUES (?,?,?,?)');
  insert.run('admin', bcrypt.hashSync('admin123', 8), 'admin', '+919000000001');
  insert.run('operator', bcrypt.hashSync('operator123', 8), 'operator', '+919000000002');
  insert.run('driver', bcrypt.hashSync('driver123', 8), 'driver', '+919000000003');
}

function get() {
  if (!db) init();
  return db;
}

module.exports = { init, get };
