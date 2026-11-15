// OpenAPI 3.0 description of the Fleet Management System, as exposed by the API Gateway.
const err = (description, example) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: example } } },
});
const json = (schemaRef, example) => ({
  'application/json': { schema: typeof schemaRef === 'string' ? { $ref: `#/components/schemas/${schemaRef}` } : schemaRef, ...(example ? { example } : {}) },
});
const ok = (description, schema, example) => ({ description, content: json(schema, example) });

// Responses every gateway-routed call can produce.
const gatewayErrors = {
  400: err('Invalid request (malformed JSON or validation failure)', 'Invalid JSON body'),
  401: err('Missing API key', 'Missing API key (send it in the x-api-key header)'),
  403: err('Invalid API key', 'Invalid API key'),
  429: { ...err('Rate limit exceeded', 'Too many requests, please slow down'), headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds until the window resets' } } },
  503: err('Target service unavailable', 'vehicles service unavailable'),
  504: err('Target service timed out', 'vehicles service timed out'),
};
const jwtErrors = {
  401: err('Missing/invalid/expired JWT, or missing API key', 'Invalid or expired token'),
  403: err('Authenticated but role not allowed', 'Forbidden: requires role admin'),
};
const secured = [{ ApiKeyAuth: [], BearerAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 1 };

const vehicleExample = { id: 1, plate: 'DL01AB1234', model: 'Tata Ace', status: 'idle', address: 'Connaught Place, New Delhi', lat: 28.6315, lng: 77.2167, driver_id: 3, last_seen: '2026-11-15T10:00:00.000Z' };
const notificationExample = { id: 1, recipient_phone: '+919000000001', recipient_user_id: 1, message: 'Vehicle DL01AB1234 status changed: idle -> active', event_type: 'status_change', vehicle_id: 1, status: 'sent', provider: 'mock', provider_message_id: 'MOCKlx3k9a1b', error: null, created_at: '2026-11-15T10:05:00.000Z' };

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Fleet Management System API',
    version: '1.0.0',
    description:
      'All requests go through the **API Gateway** and need an `x-api-key` header. Protected endpoints also need a JWT (`Authorization: Bearer <token>`) obtained from `POST /api/users/login`.\n\n' +
      '**Demo API keys:** `demo-key-123`, `mobile-app-key-456`.\n\n' +
      '**Demo users:** `admin / admin123`, `operator / operator123`, `driver / driver123`.\n\n' +
      '**Roles:** `admin` (everything), `operator` (manage vehicles, read notifications), `driver` (submit telemetry, update status).\n\n' +
      'Rate limit: 100 requests/minute per API key (headers `X-RateLimit-*`).\n\n' +
      'Click **Authorize** and fill in both the API key and the JWT to try protected endpoints.',
  },
  servers: [{ url: '/', description: 'API Gateway (this server)' }],
  tags: [
    { name: 'Users', description: 'User Service — `/api/users/*`' },
    { name: 'Vehicles', description: 'Vehicle/Fleet Service — `/api/vehicles/*`' },
    { name: 'Telemetry', description: 'Telemetry Service — `/api/telemetry/*`' },
    { name: 'Maps', description: 'Geolocation Service — `/api/maps/*`' },
    { name: 'Notifications', description: 'Notification Service — `/api/notifications/*`' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Gateway API key' },
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT from POST /api/users/login' },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      LoginRequest: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string', example: 'admin' }, password: { type: 'string', example: 'admin123' } } },
      User: { type: 'object', properties: { id: { type: 'integer' }, username: { type: 'string' }, role: { type: 'string', enum: ['admin', 'operator', 'driver'] }, phone: { type: 'string', nullable: true } } },
      LoginResponse: { type: 'object', properties: { token: { type: 'string' }, user: { $ref: '#/components/schemas/User' } } },
      RegisterRequest: { type: 'object', required: ['username', 'password', 'role'], properties: { username: { type: 'string' }, password: { type: 'string' }, role: { type: 'string', enum: ['admin', 'operator', 'driver'] }, phone: { type: 'string', example: '+919812345678' } } },
      VehicleCreate: {
        type: 'object', required: ['plate'],
        properties: {
          plate: { type: 'string', example: 'DL01AB1234' }, model: { type: 'string', example: 'Tata Ace' },
          address: { type: 'string', description: 'Geocoded to lat/lng when no coordinates are given', example: 'Connaught Place, New Delhi' },
          lat: { type: 'number', example: 28.6315 }, lng: { type: 'number', example: 77.2167 }, driverId: { type: 'integer', example: 3 },
        },
      },
      Vehicle: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, plate: { type: 'string' }, model: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'idle', 'maintenance', 'offline'] }, address: { type: 'string', nullable: true },
          lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true }, driver_id: { type: 'integer', nullable: true }, last_seen: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      StatusUpdate: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'idle', 'maintenance', 'offline'] } } },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, recipient_phone: { type: 'string' }, recipient_user_id: { type: 'integer', nullable: true }, message: { type: 'string' },
          event_type: { type: 'string', nullable: true }, vehicle_id: { type: 'integer', nullable: true }, status: { type: 'string', enum: ['sent', 'failed'] },
          provider: { type: 'string', example: 'mock' }, provider_message_id: { type: 'string', nullable: true }, error: { type: 'string', nullable: true }, created_at: { type: 'string', format: 'date-time' },
        },
      },
      StatusUpdateResponse: { type: 'object', properties: { vehicle: { $ref: '#/components/schemas/Vehicle' }, notifications: { type: 'array', items: { $ref: '#/components/schemas/Notification' } } } },
      TelemetryCreate: {
        type: 'object', required: ['vehicleId', 'lat', 'lng'],
        properties: {
          vehicleId: { type: 'integer', example: 1 }, lat: { type: 'number', example: 28.61 }, lng: { type: 'number', example: 77.23 },
          speed: { type: 'number', example: 42.5 }, battery: { type: 'number', minimum: 0, maximum: 100, example: 80 },
          event: { type: 'string', enum: ['engine_fault', 'low_battery', 'emergency_stop'], description: 'Critical events trigger an SMS to all admins' },
        },
      },
      Telemetry: {
        type: 'object',
        properties: { id: { type: 'integer' }, vehicle_id: { type: 'integer' }, lat: { type: 'number' }, lng: { type: 'number' }, speed: { type: 'number', nullable: true }, battery: { type: 'number', nullable: true }, event: { type: 'string', nullable: true }, recorded_at: { type: 'string', format: 'date-time' } },
      },
      TelemetryResponse: { type: 'object', properties: { reading: { $ref: '#/components/schemas/Telemetry' }, notifications: { type: 'array', items: { $ref: '#/components/schemas/Notification' } } } },
      SendNotification: {
        type: 'object', required: ['message'],
        properties: { message: { type: 'string' }, eventType: { type: 'string' }, vehicleId: { type: 'integer' }, recipients: { type: 'string', enum: ['admins'] }, phone: { type: 'string', description: 'Send directly to a phone number' }, userIds: { type: 'array', items: { type: 'integer' } } },
      },
      Geocode: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, displayName: { type: 'string' } } },
      NearbyResponse: {
        type: 'object',
        properties: {
          center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, radius_km: { type: 'number' }, count: { type: 'integer' },
          vehicles: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/Vehicle' }, { type: 'object', properties: { distance_km: { type: 'number' } } }] } },
        },
      },
    },
  },
  paths: {
    '/api/users/login': {
      post: {
        tags: ['Users'], summary: 'Log in and obtain a JWT', security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: json('LoginRequest') },
        responses: {
          200: ok('Login successful', 'LoginResponse', { token: 'eyJhbGciOiJIUzI1NiIs...', user: { id: 1, username: 'admin', role: 'admin', phone: '+919000000001' } }),
          400: err('Missing username or password', 'username and password are required'),
          401: err('Invalid credentials or missing API key', 'Invalid credentials'),
          403: gatewayErrors[403], 429: gatewayErrors[429], 503: gatewayErrors[503],
        },
      },
    },
    '/api/users/register': {
      post: {
        tags: ['Users'], summary: 'Create a user (admin only)', security: secured,
        requestBody: { required: true, content: json('RegisterRequest', { username: 'ravi', password: 'S3cret!', role: 'driver', phone: '+919812345678' }) },
        responses: { 201: ok('User created', 'User'), 400: gatewayErrors[400], ...jwtErrors, 409: err('Username taken', 'Username already exists'), 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/users/me': {
      get: { tags: ['Users'], summary: 'Current user profile', security: secured, responses: { 200: ok('Profile', 'User'), ...jwtErrors, 404: err('User deleted', 'User not found'), 429: gatewayErrors[429], 503: gatewayErrors[503] } },
    },
    '/api/users': {
      get: { tags: ['Users'], summary: 'List users (admin only)', security: secured, responses: { 200: ok('Users', { type: 'array', items: { $ref: '#/components/schemas/User' } }), ...jwtErrors, 429: gatewayErrors[429], 503: gatewayErrors[503] } },
    },
    '/api/vehicles': {
      post: {
        tags: ['Vehicles'], summary: 'Register a vehicle (admin, operator)', description: 'If `address` is given without `lat`/`lng`, it is geocoded through the Geolocation Service.', security: secured,
        requestBody: { required: true, content: json('VehicleCreate') },
        responses: {
          201: ok('Vehicle registered', 'Vehicle', vehicleExample), 400: err('plate missing', 'plate is required'), ...jwtErrors,
          409: err('Duplicate plate', 'A vehicle with this plate already exists'), 422: err('Address not found', 'Address could not be geocoded'), 502: err('Geolocation service unavailable', 'Geolocation service unavailable'), 429: gatewayErrors[429], 503: gatewayErrors[503],
        },
      },
      get: {
        tags: ['Vehicles'], summary: 'List vehicles', security: secured,
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'idle', 'maintenance', 'offline'] } }],
        responses: { 200: ok('Vehicles', { type: 'array', items: { $ref: '#/components/schemas/Vehicle' } }, [vehicleExample]), 401: jwtErrors[401], 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/vehicles/{id}': {
      get: { tags: ['Vehicles'], summary: 'Get a vehicle', security: secured, parameters: [idParam], responses: { 200: ok('Vehicle', 'Vehicle', vehicleExample), 401: jwtErrors[401], 404: err('Not found', 'Vehicle not found'), 429: gatewayErrors[429], 503: gatewayErrors[503] } },
      delete: { tags: ['Vehicles'], summary: 'Delete a vehicle (admin only)', security: secured, parameters: [idParam], responses: { 204: { description: 'Deleted' }, ...jwtErrors, 404: err('Not found', 'Vehicle not found'), 429: gatewayErrors[429], 503: gatewayErrors[503] } },
    },
    '/api/vehicles/{id}/status': {
      patch: {
        tags: ['Vehicles'], summary: 'Update operational status (admin, operator, driver)',
        description: 'On a real change, an SMS is sent to all admins and the assigned driver, and recorded as `sent` or `failed`.', security: secured, parameters: [idParam],
        requestBody: { required: true, content: json('StatusUpdate', { status: 'maintenance' }) },
        responses: { 200: ok('Updated', 'StatusUpdateResponse', { vehicle: { ...vehicleExample, status: 'maintenance' }, notifications: [notificationExample] }), 400: err('Invalid status', 'status must be one of: active, idle, maintenance, offline'), ...jwtErrors, 404: err('Not found', 'Vehicle not found'), 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/telemetry': {
      post: {
        tags: ['Telemetry'], summary: 'Submit a telemetry reading (admin, operator, driver)',
        description: 'Stores the reading and updates the vehicle\'s last known position. A critical `event` (engine_fault, low_battery, emergency_stop) — or battery below 15% — triggers an SMS to admins.', security: secured,
        requestBody: { required: true, content: json('TelemetryCreate', { vehicleId: 1, lat: 28.61, lng: 77.23, speed: 0, battery: 9, event: 'emergency_stop' }) },
        responses: {
          201: ok('Stored', 'TelemetryResponse', { reading: { id: 7, vehicle_id: 1, lat: 28.61, lng: 77.23, speed: 0, battery: 9, event: 'emergency_stop', recorded_at: '2026-11-15T10:10:00.000Z' }, notifications: [notificationExample] }),
          400: err('Invalid payload', 'lat and lng must be valid numbers'), ...jwtErrors, 404: err('Unknown vehicle', 'Vehicle not found'), 429: gatewayErrors[429], 503: gatewayErrors[503],
        },
      },
    },
    '/api/telemetry/vehicle/{vehicleId}': {
      get: {
        tags: ['Telemetry'], summary: 'Telemetry history (newest first)', security: secured,
        parameters: [{ name: 'vehicleId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } }],
        responses: { 200: ok('Readings', { type: 'array', items: { $ref: '#/components/schemas/Telemetry' } }), 401: jwtErrors[401], 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/telemetry/vehicle/{vehicleId}/latest': {
      get: {
        tags: ['Telemetry'], summary: 'Latest reading', security: secured, parameters: [{ name: 'vehicleId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: ok('Reading', 'Telemetry'), 401: jwtErrors[401], 404: err('None yet', 'No telemetry for this vehicle'), 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/maps/geocode': {
      get: {
        tags: ['Maps'], summary: 'Address → coordinates (OpenStreetMap Nominatim / Google)', security: secured,
        parameters: [{ name: 'address', in: 'query', required: true, schema: { type: 'string' }, example: 'Connaught Place, New Delhi' }],
        responses: { 200: ok('Coordinates', 'Geocode', { lat: 28.6315, lng: 77.2167, displayName: 'Connaught Place, New Delhi, India' }), 400: err('Missing address', 'address query parameter is required'), 401: jwtErrors[401], 404: err('No match', 'Address could not be geocoded'), 502: err('Provider failure', 'Geocoding provider failed'), 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/maps/nearby': {
      get: {
        tags: ['Maps'], summary: 'Vehicles within X km of a point', description: 'Give either `lat`+`lng` or an `address`. Results are sorted by distance (haversine).', security: secured,
        parameters: [
          { name: 'lat', in: 'query', schema: { type: 'number' }, example: 28.6139 }, { name: 'lng', in: 'query', schema: { type: 'number' }, example: 77.209 },
          { name: 'address', in: 'query', schema: { type: 'string' } }, { name: 'radius_km', in: 'query', schema: { type: 'number', default: 5, maximum: 1000 }, example: 10 },
        ],
        responses: { 200: ok('Nearby vehicles', 'NearbyResponse', { center: { lat: 28.6139, lng: 77.209 }, radius_km: 10, count: 1, vehicles: [{ ...vehicleExample, distance_km: 2.601 }] }), 400: err('Invalid coordinates/radius', 'Valid lat/lng (or address) is required'), 401: jwtErrors[401], 404: err('Address not found', 'Address could not be geocoded'), 502: err('Provider failure', 'Geocoding provider failed'), 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/maps/vehicles/geojson': {
      get: { tags: ['Maps'], summary: 'All positioned vehicles as GeoJSON', security: secured, responses: { 200: ok('FeatureCollection', { type: 'object' }), 401: jwtErrors[401], 429: gatewayErrors[429], 503: gatewayErrors[503] } },
    },
    '/api/maps/ui/': {
      get: { tags: ['Maps'], summary: 'Interactive Leaflet map (public HTML page)', description: 'Open `/api/maps/ui/` in a browser. The page signs in and calls the API through the gateway.', responses: { 200: { description: 'HTML page', content: { 'text/html': { schema: { type: 'string' } } } } } },
    },
    '/api/notifications': {
      get: {
        tags: ['Notifications'], summary: 'List SMS notifications and delivery status (admin, operator)', security: secured,
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['sent', 'failed'] } }, { name: 'vehicleId', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: ok('Notifications', { type: 'array', items: { $ref: '#/components/schemas/Notification' } }, [notificationExample]), 400: err('Bad filter', 'status must be sent or failed'), ...jwtErrors, 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/notifications/send': {
      post: {
        tags: ['Notifications'], summary: 'Send an SMS (admin only)', description: 'Phone numbers ending in `0000` make the mock provider fail, to demonstrate the `failed` status.', security: secured,
        requestBody: { required: true, content: json('SendNotification', { message: 'Depot closes at 8pm', recipients: 'admins' }) },
        responses: { 201: ok('Sent', { type: 'object', properties: { notifications: { type: 'array', items: { $ref: '#/components/schemas/Notification' } } } }), 400: err('No message/recipients', 'No valid recipients'), ...jwtErrors, 429: gatewayErrors[429], 503: gatewayErrors[503] },
      },
    },
    '/api/notifications/{id}': {
      get: { tags: ['Notifications'], summary: 'Get one notification', security: secured, parameters: [idParam], responses: { 200: ok('Notification', 'Notification', notificationExample), ...jwtErrors, 404: err('Not found', 'Notification not found'), 429: gatewayErrors[429], 503: gatewayErrors[503] } },
    },
  },
};
