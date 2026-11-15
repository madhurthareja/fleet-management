// API Gateway: API key verification, rate limiting, routing/forwarding, and error mapping.
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const crypto = require('crypto');
const config = require('../config');
const openapi = require('../docs/openapi');

const ROUTES = [
  { prefix: '/api/users', service: 'users' },
  { prefix: '/api/vehicles', service: 'vehicles' },
  { prefix: '/api/telemetry', service: 'telemetry' },
  { prefix: '/api/maps', service: 'maps' },
  { prefix: '/api/notifications', service: 'notifications' },
];

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  const middleware = (req, res, next) => {
    const key = req.headers['x-api-key'] || req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests, please slow down' });
    }
    next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function create({ urls, apiKeys = config.apiKeys, rateLimit = config.rateLimit, timeoutMs = 5000 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/health', (req, res) => res.json({ service: 'api-gateway', status: 'ok', routes: ROUTES.map((r) => r.prefix) }));
  app.get('/api-docs.json', (req, res) => res.json(openapi));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Fleet Management API' }));

  const limiter = rateLimiter(rateLimit);
  app.rateLimiter = limiter;
  const fullPath = (req) => req.baseUrl + req.path;
  const isPublicAsset = (req) => req.method === 'GET' && fullPath(req).startsWith('/api/maps/ui');
  const toService = (req) => ROUTES.find((r) => fullPath(req) === r.prefix || fullPath(req).startsWith(r.prefix + '/'));

  app.use('/api', (req, res, next) => (isPublicAsset(req) ? next() : limiter(req, res, next)));
  app.use('/api', (req, res, next) => {
    if (isPublicAsset(req)) return next();
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Missing API key (send it in the x-api-key header)' });
    if (!apiKeys.some((k) => safeEqual(k, String(key)))) return res.status(403).json({ error: 'Invalid API key' });
    next();
  });

  app.use(express.json());

  app.use('/api', async (req, res) => {
    const route = toService(req);
    if (!route) return res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });

    const target = urls[route.service] + (fullPath(req).slice(route.prefix.length) || '/');
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const headers = {
      'x-request-id': req.headers['x-request-id'] || crypto.randomUUID(),
      'x-forwarded-for': req.ip,
    };
    for (const h of ['authorization', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
    let body;
    if (!['GET', 'HEAD', 'DELETE'].includes(req.method) && req.body !== undefined && Object.keys(req.body).length) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.body);
    }

    try {
      const upstream = await fetch(target + qs, { method: req.method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      res.status(upstream.status);
      const type = upstream.headers.get('content-type');
      if (type) res.set('content-type', type);
      res.set('x-request-id', headers['x-request-id']);
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      if (e.name === 'TimeoutError') return res.status(504).json({ error: `${route.service} service timed out` });
      res.status(503).json({ error: `${route.service} service unavailable` });
    }
  });
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Gateway error' });
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

module.exports = { create, ROUTES, rateLimiter };
