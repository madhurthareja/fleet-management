// Geolocation Service: geocoding (OpenStreetMap/Google/mock), nearby search, map UI + GeoJSON.
const path = require('path');
const express = require('express');
const { createApp, finalize } = require('../shared/http');
const { authenticate, internalOrRoles } = require('../shared/auth');
const db = require('../shared/db');
const config = require('../config');

/** Great-circle distance in km. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** OpenStreetMap Nominatim geocoder. Returns {lat, lng, displayName} or null. */
async function osmGeocode(address) {
  const url = `${config.nominatimUrl}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'fleet-management-demo/1.0' } });
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), displayName: hit.display_name } : null;
}

async function googleGeocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${config.googleMapsApiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') throw new Error(`Google Geocoding: ${data.status}`);
  const r = data.results[0];
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, displayName: r.formatted_address };
}

const MOCK_PLACES = {
  'new delhi': { lat: 28.6139, lng: 77.209 },
  delhi: { lat: 28.6139, lng: 77.209 },
  gurgaon: { lat: 28.4595, lng: 77.0266 },
  noida: { lat: 28.5355, lng: 77.391 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
};
async function mockGeocode(address) {
  const key = Object.keys(MOCK_PLACES).find((k) => address.toLowerCase().includes(k));
  return key ? { ...MOCK_PLACES[key], displayName: address } : null;
}

const geocoders = { osm: osmGeocode, google: googleGeocode, mock: mockGeocode };

function create({ geocoder } = {}) {
  const geocode = geocoder || geocoders[config.geocoder] || osmGeocode;
  const app = createApp('geolocation-service');

  // Map UI is public (it asks for the API key / JWT in the page and passes them on API calls).
  app.use('/ui', express.static(path.join(__dirname, '..', 'public')));
  app.use('/ui/vendor/leaflet', express.static(path.join(require.resolve('leaflet/package.json'), '..', 'dist')));

  app.get('/geocode', authenticate, async (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address query parameter is required' });
    try {
      const result = await geocode(address);
      if (!result) return res.status(404).json({ error: 'Address could not be geocoded' });
      res.json(result);
    } catch (e) {
      res.status(502).json({ error: 'Geocoding provider failed', detail: e.message });
    }
  });

  // Internal endpoint used by the Vehicle service (service token or JWT).
  app.get('/internal/geocode', internalOrRoles('admin', 'operator'), async (req, res) => {
    try {
      const result = req.query.address ? await geocode(req.query.address) : null;
      if (!result) return res.status(404).json({ error: 'Address could not be geocoded' });
      res.json(result);
    } catch (e) {
      res.status(502).json({ error: 'Geocoding provider failed', detail: e.message });
    }
  });

  app.get('/nearby', authenticate, async (req, res) => {
    let { lat, lng, radius_km: radius, address } = req.query;
    radius = Number(radius ?? 5);
    if (!(radius > 0) || radius > 1000) return res.status(400).json({ error: 'radius_km must be between 0 and 1000' });

    if (address && (lat === undefined || lng === undefined)) {
      try {
        const g = await geocode(address);
        if (!g) return res.status(404).json({ error: 'Address could not be geocoded' });
        lat = g.lat;
        lng = g.lng;
      } catch (e) {
        return res.status(502).json({ error: 'Geocoding provider failed', detail: e.message });
      }
    }
    lat = Number(lat);
    lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: 'Valid lat/lng (or address) is required' });
    }

    const vehicles = db.get().prepare('SELECT * FROM vehicles WHERE lat IS NOT NULL AND lng IS NOT NULL').all();
    const nearby = vehicles
      .map((v) => ({ ...v, distance_km: Number(haversineKm(lat, lng, v.lat, v.lng).toFixed(3)) }))
      .filter((v) => v.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);
    res.json({ center: { lat, lng }, radius_km: radius, count: nearby.length, vehicles: nearby });
  });

  app.get('/vehicles/geojson', authenticate, (req, res) => {
    const vehicles = db.get().prepare('SELECT * FROM vehicles WHERE lat IS NOT NULL AND lng IS NOT NULL').all();
    res.json({
      type: 'FeatureCollection',
      features: vehicles.map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
        properties: { id: v.id, plate: v.plate, model: v.model, status: v.status, last_seen: v.last_seen },
      })),
    });
  });

  return finalize(app);
}

module.exports = { create, haversineKm, geocoders };
