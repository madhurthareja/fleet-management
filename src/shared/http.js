const express = require('express');
const config = require('../config');

/** Creates an express app with JSON parsing, health check and JSON error handling. */
function createApp(name) {
  const app = express();
  app.use(express.json());
  app.get('/health', (req, res) => res.json({ service: name, status: 'ok' }));
  return app;
}

function finalize(app) {
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function callService(baseUrl, path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-internal-token': config.internalToken },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 503, data: { error: 'Service unreachable' } };
  }
}

module.exports = { createApp, finalize, callService };
