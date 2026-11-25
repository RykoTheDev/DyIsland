// Weather for the island: Open-Meteo (no API key), a city picker, and "Use my location" (the Windows location service).
// register() adds the IPC handlers; it is called from main.js after the IPC hardening patch, so only the island's own windows can call them.
const { net } = require('electron');

function register({ ipcMain, run, unpacked }) {
  // Open-Meteo (no API key). Only the place you type (or, if you press "Use my location", your coordinates) is sent.
  const WMO_URL = 'https://api.open-meteo.com/v1/forecast';
  const weatherCache = new Map();                                   // place key -> { at, data }: several islands ask for the same thing
  const geoCache = new Map();                                       // typed text -> candidate places (a place does not move: never ask twice)
  const cleanPlace = (p) => ({ name: String(p.name || '').slice(0, 60), admin1: String(p.admin1 || '').slice(0, 60), cc: String(p.country_code || '').slice(0, 3), lat: Number(p.latitude), lon: Number(p.longitude) });
  async function geocode(q, count, signal) {
    const key = q.toLowerCase() + '|' + count;
    if (geoCache.has(key)) return geoCache.get(key);
    const gr = await net.fetch('https://geocoding-api.open-meteo.com/v1/search?count=' + count + '&language=en&name=' + encodeURIComponent(q), { signal });
    if (!gr.ok) throw new Error('offline');
    const g = await gr.json();
    const list = (g.results || []).map(cleanPlace).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    geoCache.set(key, list); if (geoCache.size > 60) geoCache.delete(geoCache.keys().next().value);
    return list;
  }
  // Candidate places for what is being typed (the city picker under the weather page's city box)
  ipcMain.handle('weather:search', async (_e, text) => {
    try {
      const q = String(text || '').trim().slice(0, 80);
      if (q.length < 2) return [];
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
      try { return await geocode(q, 5, ctl.signal); } finally { clearTimeout(tm); }
    } catch { return []; }
  });
  // "Use my location": the Windows location service, asked once (see locate.ps1). Returns { lat, lon } or { error }.
  ipcMain.handle('weather:locate', async () => {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked('locate.ps1')], 20000);
    const m = /^(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\s*$/.exec(r.out.trim());
    if (!m || Math.abs(Number(m[1])) > 90 || Math.abs(Number(m[2])) > 180) return { error: 'unavailable' };
    return { lat: Number(m[1]), lon: Number(m[2]) };
  });
  // where: a place name (first match wins) or { name, lat, lon } from the picker / location button
  ipcMain.handle('weather:get', async (_e, where) => {
    try {
      let place = null;
      if (where && typeof where === 'object') {
        const lat = Number(where.lat), lon = Number(where.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'no-city' };
        place = { name: String(where.name || 'Here').slice(0, 60), lat, lon };
      }
      const q = place ? '' : String(where || '').trim();
      if (!place && !q) return { error: 'no-city' };
      const key = place ? place.lat.toFixed(2) + ',' + place.lon.toFixed(2) : q.toLowerCase();
      const hit = weatherCache.get(key);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
      try {
        if (!place) {
          const list = await geocode(q, 5, ctl.signal);
          if (!list.length) return { error: 'not-found' };
          place = list[0];
        }
        const url = `${WMO_URL}?latitude=${place.lat}&longitude=${place.lon}` +
          '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
          '&hourly=temperature_2m,weather_code,is_day,precipitation_probability' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=5&timezone=auto';
        const wr = await net.fetch(url, { signal: ctl.signal });
        if (!wr.ok) return { error: 'offline' };
        const w = await wr.json();
        if (!w.current || !w.hourly) return { error: 'offline' };   // API error bodies (rate limit etc.)
        const data = { place: place.name, country: place.cc, current: w.current, hourly: w.hourly, daily: w.daily || null };
        weatherCache.set(key, { at: Date.now(), data }); if (weatherCache.size > 20) weatherCache.delete(weatherCache.keys().next().value);
        return data;
      } finally { clearTimeout(tm); }
    } catch {
      return { error: 'offline' };
    }
  });

}

module.exports = { register };
