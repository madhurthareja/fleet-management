// Central configuration. Every value can be overridden with an environment variable.
module.exports = {
  jwtSecret: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  internalToken: process.env.INTERNAL_SERVICE_TOKEN || 'internal-service-token',
  dbFile: process.env.DB_FILE || ':memory:', // use e.g. ./fleet.db for persistence
  apiKeys: (process.env.GATEWAY_API_KEYS || 'demo-key-123,mobile-app-key-456')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.RATE_LIMIT_MAX || 100),
  },
  ports: {
    gateway: Number(process.env.GATEWAY_PORT || process.env.PORT || 3000),
    users: Number(process.env.USER_SERVICE_PORT || 3001),
    vehicles: Number(process.env.VEHICLE_SERVICE_PORT || 3002),
    telemetry: Number(process.env.TELEMETRY_SERVICE_PORT || 3003),
    maps: Number(process.env.GEO_SERVICE_PORT || 3004),
    notifications: Number(process.env.NOTIFICATION_SERVICE_PORT || 3005),
  },
  geocoder: process.env.GEOCODER || 'osm',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search',
  smsProvider: process.env.SMS_PROVIDER || 'mock',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_FROM || '',
  },
  criticalEvents: ['engine_fault', 'low_battery', 'emergency_stop'],
  vehicleStatuses: ['active', 'idle', 'maintenance', 'offline'],
};
