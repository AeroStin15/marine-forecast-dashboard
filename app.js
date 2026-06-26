const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MAX_SOURCE_ROWS = 24;
let lastAverageRows = [];

const sources = [
  {
    id: "best_match",
    name: "Open-Meteo Best Match",
    model: "best_match",
    note: "Open-Meteo's preferred marine model blend for the selected location.",
  },
  {
    id: "ecmwf_wam025",
    name: "ECMWF WAM 0.25°",
    model: "ecmwf_wam025",
    note: "Global ECMWF wave model at roughly 25 km resolution.",
  },
  {
    id: "ncep_gfswave025",
    name: "NCEP GFS Wave 0.25°",
    model: "ncep_gfswave025",
    note: "NOAA/NCEP global wave forecast model at roughly 25 km resolution.",
  },
];

const marineFields = [
  "wave_height",
  "wave_period",
  "wind_wave_height",
  "wind_wave_period",
  "swell_wave_height",
  "swell_wave_period",
];

const windFields = [
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
];

const sourceColumns = [
  ["time", "Time"],
  ["wave_height", "Wave ft"],
  ["wave_period", "Period sec"],
  ["wind_speed_10m", "Wind mph"],
  ["wind_gusts_10m", "Gust mph"],
  ["wind_direction_10m", "Wind dir"],
  ["wind_wave_height", "Wind wave ft"],
  ["wind_wave_period", "Wind period"],
  ["swell_wave_height", "Swell ft"],
  ["swell_wave_period", "Swell period"],
];

const averageColumns = [
  ["time", "Time"],
  ["trip_phase", "Trip"],
  ["planning_wave_height", "Planning ft"],
  ["wave_height", "Avg wave ft"],
  ["highest_model_wave", "High model ft"],
  ["planning_period", "Planning sec"],
  ["wave_period", "Avg period"],
  ["wind_wave_period", "Wind period"],
  ["wind_speed_10m", "Wind mph"],
  ["wind_gusts_10m", "Gust mph"],
  ["wind_direction_10m", "Wind dir"],
  ["wind_wave_height", "Wind wave ft"],
  ["swell_wave_height", "Swell ft"],
  ["swell_wave_period", "Swell period"],
  ["sea_type", "Sea type"],
  ["wave_spread", "Model spread ft"],
  ["confidence", "Confidence"],
  ["rating", "Rating"],
];

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundOrNull(value, digits = 2) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

function marineRating(avgWaveFt, planningPeriodSec, spreadFt, windMph, gustMph) {
  if (avgWaveFt === null || avgWaveFt === undefined) return "Unknown";

  const period = planningPeriodSec || 0;
  const spread = spreadFt || 0;
  const windKnown = windMph !== null && windMph !== undefined;
  const gustKnown = gustMph !== null && gustMph !== undefined;
  const windy = (windKnown && windMph >= 15) || (gustKnown && gustMph >= 22);
  const breezy = (windKnown && windMph >= 12) || (gustKnown && gustMph >= 18);

  // Peyton-tuned rules:
  // Under 2 ft is generally Good/Fair unless the period is stacked under 5 sec
  // or the wind is strong enough to make it sloppy. Wind is mph, not knots.
  if (avgWaveFt < 2) {
    if (period < 5 || windy) return "Caution";
    if (period >= 6 && !breezy && spread <= 1.0) return "Good";
    return "Fair";
  }

  if (avgWaveFt <= 2.5) {
    if (period >= 6 && !windy && spread <= 1.0) return "Fair";
    return "Caution";
  }

  if (avgWaveFt <= 3.0) {
    if (period >= 7 && !windy && spread <= 0.75) return "Caution";
    return "No-Go";
  }

  if (spread >= 1.75 || windy) return "No-Go";
  return "No-Go";
}

function planningPeriod(avgWavePeriod, avgWindWavePeriod, avgWindWaveHeight, avgWaveHeight) {
  const candidates = [];
  if (avgWavePeriod !== null && avgWavePeriod !== undefined) candidates.push(avgWavePeriod);

  // Wind chop controls comfort when it is a meaningful portion of total seas.
  // This prevents a long swell period from hiding a short, stacked wind-wave period.
  const windWaveIsMeaningful =
    avgWindWavePeriod !== null && avgWindWavePeriod !== undefined &&
    avgWindWaveHeight !== null && avgWindWaveHeight !== undefined &&
    (avgWindWaveHeight >= 0.5 || (avgWaveHeight && avgWindWaveHeight >= avgWaveHeight * 0.35));

  if (windWaveIsMeaningful) candidates.push(avgWindWavePeriod);
  return candidates.length ? roundOrNull(Math.min(...candidates), 1) : null;
}

function seaType(avgWavePeriod, avgWindWavePeriod, avgWindWaveHeight, avgSwellHeight, avgWaveHeight) {
  if (avgWindWavePeriod === null || avgWindWavePeriod === undefined) return "Unknown";
  const windWaveIsMeaningful = avgWindWaveHeight !== null && avgWindWaveHeight !== undefined &&
    (avgWindWaveHeight >= 0.5 || (avgWaveHeight && avgWindWaveHeight >= avgWaveHeight * 0.35));
  if (windWaveIsMeaningful && avgWindWavePeriod < 5) return "Short chop";
  if (windWaveIsMeaningful && avgWindWavePeriod < (avgWavePeriod || 99) - 1) return "Mixed chop";
  if (avgSwellHeight !== null && avgSwellHeight !== undefined && avgSwellHeight > avgWindWaveHeight) return "Swell-led";
  return "Moderate";
}

function confidenceFromSpread(spreadFt) {
  if (spreadFt === null || spreadFt === undefined) return "Unknown";
  if (spreadFt <= 0.5) return "High";
  if (spreadFt <= 1.0) return "Medium";
  return "Low";
}

function fmt(value, key = "") {
  if (value === null || value === undefined) return "—";
  if (key === "wind_direction_10m" && typeof value === "number") return `${Math.round(value)}°`;
  if (typeof value === "number") return value.toFixed(value % 1 === 0 ? 0 : 2);
  if (typeof value === "string" && value.includes("T")) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric" });
    }
  }
  return value;
}

function badge(value) {
  if (!value) return "";
  const cls = String(value).toLowerCase().replace(/\s+/g, "-");
  return `<span class="badge ${cls}">${value}</span>`;
}

function makeTable(rows, columns, rowClassFn = null) {
  const head = `<thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map(row => {
    const rowClass = rowClassFn ? rowClassFn(row) : "";
    return `
    <tr class="${rowClass}">${columns.map(([key]) => {
      const value = row[key];
      const shown = key === "rating" ? badge(value) : fmt(value, key);
      return `<td>${shown}</td>`;
    }).join("")}</tr>`;
  }).join("")}</tbody>`;
  return head + body;
}

function buildDemoWind(hours) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const windByTime = new Map();
  for (let i = 0; i < hours; i += 1) {
    const t = new Date(now.getTime() + i * 60 * 60 * 1000);
    const time = toLocalKey(t);
    const base = 8 + (i % 9) * 0.8;
    windByTime.set(time, {
      wind_speed_10m: roundOrNull(base, 1),
      wind_gusts_10m: roundOrNull(base + 5, 1),
      wind_direction_10m: Math.round(90 + (i * 8) % 180),
    });
  }
  return windByTime;
}

function toLocalKey(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

function buildDemoSource(source, hours, offset) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const rows = [];
  for (let i = 0; i < hours; i += 1) {
    const t = new Date(now.getTime() + i * 60 * 60 * 1000);
    const wave = 1.35 + (i % 10) * 0.10 + offset;
    const period = 5.4 + (i % 6) * 0.25 - offset * 0.25;
    rows.push({
      time: toLocalKey(t),
      wave_height: roundOrNull(wave),
      wave_period: roundOrNull(period),
      wind_wave_height: roundOrNull(wave * 0.65),
      wind_wave_period: roundOrNull(period * 0.75),
      swell_wave_height: roundOrNull(wave * 0.45),
      swell_wave_period: roundOrNull(period * 1.2),
    });
  }
  return {
    ...source,
    rows,
    error: "Demo fallback data shown because live API data was unavailable.",
  };
}

function attachWind(rows, windByTime) {
  return rows.map(row => ({
    ...row,
    ...(windByTime.get(row.time) || {}),
  }));
}

async function fetchSource(lat, lon, source, forecastDays) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: marineFields.join(","),
    forecast_days: forecastDays,
    length_unit: "imperial",
    timezone: "America/Chicago",
    cell_selection: "sea",
    models: source.model,
  });

  const res = await fetch(`${OPEN_METEO_MARINE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo Marine returned HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.error) throw new Error(payload.reason || "Open-Meteo Marine API error");

  const hourly = payload.hourly || {};
  const times = hourly.time || [];
  const rows = times.map((t, i) => {
    const row = { time: t };
    for (const field of marineFields) {
      row[field] = Array.isArray(hourly[field]) ? safeNumber(hourly[field][i]) : null;
    }
    return row;
  });

  return { ...source, rows, error: null };
}

async function fetchWind(lat, lon, forecastDays) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: windFields.join(","),
    forecast_days: forecastDays,
    timezone: "America/Chicago",
    wind_speed_unit: "mph",
  });

  const res = await fetch(`${OPEN_METEO_FORECAST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo Weather returned HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.error) throw new Error(payload.reason || "Open-Meteo Weather API error");

  const hourly = payload.hourly || {};
  const times = hourly.time || [];
  const windByTime = new Map();
  times.forEach((t, i) => {
    windByTime.set(t, {
      wind_speed_10m: Array.isArray(hourly.wind_speed_10m) ? safeNumber(hourly.wind_speed_10m[i]) : null,
      wind_gusts_10m: Array.isArray(hourly.wind_gusts_10m) ? safeNumber(hourly.wind_gusts_10m[i]) : null,
      wind_direction_10m: Array.isArray(hourly.wind_direction_10m) ? safeNumber(hourly.wind_direction_10m[i]) : null,
    });
  });
  return windByTime;
}

function buildAverage(sourceResults, windByTime) {
  const byTime = new Map();

  for (const source of sourceResults) {
    for (const row of source.rows || []) {
      if (!byTime.has(row.time)) {
        byTime.set(row.time, Object.fromEntries(marineFields.map(field => [field, []])));
      }
      const bucket = byTime.get(row.time);
      for (const field of marineFields) {
        const value = safeNumber(row[field]);
        if (value !== null) bucket[field].push(value);
      }
    }
  }

  return [...byTime.keys()].sort().map(time => {
    const bucket = byTime.get(time);
    const waveValues = bucket.wave_height || [];
    const waveSpread = waveValues.length ? Math.max(...waveValues) - Math.min(...waveValues) : null;
    const highestModelWave = waveValues.length ? Math.max(...waveValues) : null;
    const avgRow = { time };

    for (const field of marineFields) {
      const values = bucket[field] || [];
      avgRow[field] = values.length ? roundOrNull(values.reduce((a, b) => a + b, 0) / values.length) : null;
    }

    const wind = windByTime.get(time) || {};
    avgRow.wind_speed_10m = roundOrNull(wind.wind_speed_10m, 1);
    avgRow.wind_gusts_10m = roundOrNull(wind.wind_gusts_10m, 1);
    avgRow.wind_direction_10m = roundOrNull(wind.wind_direction_10m, 0);

    avgRow.highest_model_wave = roundOrNull(highestModelWave);
    avgRow.planning_wave_height = roundOrNull(Math.max(...[avgRow.wave_height, highestModelWave].filter(v => v !== null && v !== undefined)), 2);
    avgRow.planning_period = planningPeriod(avgRow.wave_period, avgRow.wind_wave_period, avgRow.wind_wave_height, avgRow.wave_height);
    avgRow.sea_type = seaType(avgRow.wave_period, avgRow.wind_wave_period, avgRow.wind_wave_height, avgRow.swell_wave_height, avgRow.wave_height);
    avgRow.wave_spread = roundOrNull(waveSpread);
    avgRow.confidence = confidenceFromSpread(waveSpread);
    avgRow.rating = marineRating(avgRow.planning_wave_height, avgRow.planning_period, waveSpread, avgRow.wind_speed_10m, avgRow.wind_gusts_10m);
    return avgRow;
  });
}


function getSelectedSpotName(lat, lon) {
  return localStorage.getItem("marineDashboardSpotName") || `${lat}, ${lon}`;
}

function setDefaultTripDate() {
  const dateInput = document.getElementById("trip-date");
  if (!dateInput || dateInput.value) return;
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  dateInput.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function tripDateTime(date, time) {
  if (!date || !time) return null;
  return `${date}T${time.slice(0,2)}:00`;
}

function getTripWindows() {
  const date = document.getElementById("trip-date")?.value;
  const leave = document.getElementById("trip-leave")?.value || "05:00";
  const fish = document.getElementById("trip-fish-start")?.value || "07:00";
  const retStart = document.getElementById("trip-return-start")?.value || "14:00";
  const retEnd = document.getElementById("trip-return-end")?.value || "16:00";
  if (!date) return null;
  return {
    runOutStart: tripDateTime(date, leave),
    runOutEnd: tripDateTime(date, fish),
    fishStart: tripDateTime(date, fish),
    fishEnd: tripDateTime(date, retStart),
    returnStart: tripDateTime(date, retStart),
    returnEnd: tripDateTime(date, retEnd),
  };
}

function phaseForTime(time) {
  const w = getTripWindows();
  if (!w) return "";
  if (time >= w.runOutStart && time < w.runOutEnd) return "Run out";
  if (time >= w.fishStart && time < w.fishEnd) return "Fishing";
  if (time >= w.returnStart && time <= w.returnEnd) return "Return";
  return "";
}

function enrichTripPhases(rows) {
  return rows.map(row => ({ ...row, trip_phase: phaseForTime(row.time) }));
}

function worstRating(rows) {
  const order = { "Good": 1, "Fair": 2, "Caution": 3, "No-Go": 4, "Unknown": 0 };
  return rows.reduce((worst, row) => (order[row.rating] || 0) > (order[worst] || 0) ? row.rating : worst, "Unknown");
}

function summarizeRows(rows) {
  if (!rows.length) return null;
  const nums = (key) => rows.map(r => safeNumber(r[key])).filter(v => v !== null);
  const max = (key) => nums(key).length ? Math.max(...nums(key)) : null;
  const min = (key) => nums(key).length ? Math.min(...nums(key)) : null;
  return {
    count: rows.length,
    wave: roundOrNull(max("planning_wave_height"), 1),
    period: roundOrNull(min("planning_period"), 1),
    wind: roundOrNull(max("wind_speed_10m"), 1),
    gust: roundOrNull(max("wind_gusts_10m"), 1),
    rating: worstRating(rows),
  };
}

function renderTripSummary(rows) {
  const el = document.getElementById("trip-summary");
  if (!el) return;
  const groups = ["Run out", "Fishing", "Return"].map(phase => [phase, rows.filter(r => r.trip_phase === phase)]);
  if (!groups.some(([, r]) => r.length)) {
    el.innerHTML = `<p class="note">Pick a trip date/time and press Apply Trip. Matching hours will be highlighted in the combined table.</p>`;
    return;
  }
  el.innerHTML = `<div class="trip-grid">${groups.map(([phase, phaseRows]) => {
    const s = summarizeRows(phaseRows);
    if (!s) return `<div><strong>${phase}</strong><span>No matching forecast hours</span></div>`;
    return `<div><strong>${phase}</strong><span>${badge(s.rating)}</span><span>Worst/planning: ${fmt(s.wave)} ft @ ${fmt(s.period)} sec</span><span>Wind: ${fmt(s.wind)} mph / gust ${fmt(s.gust)} mph</span></div>`;
  }).join("")}</div>`;
}

function renderHero(rows, lat, lon) {
  const name = getSelectedSpotName(lat, lon);
  const heroSpot = document.getElementById("hero-spot");
  const heroRating = document.getElementById("hero-rating");
  const heroDetails = document.getElementById("hero-details");
  const heroMetrics = document.getElementById("hero-metrics");
  if (!heroSpot || !heroRating || !heroDetails || !heroMetrics) return;
  const nowKey = toLocalKey(new Date());
  const row = rows.find(r => r.time >= nowKey) || rows[0];
  heroSpot.textContent = name;
  if (!row) {
    heroRating.innerHTML = badge("Unknown");
    heroDetails.textContent = "No forecast rows available yet.";
    heroMetrics.innerHTML = "";
    return;
  }
  heroRating.innerHTML = badge(row.rating);
  heroDetails.textContent = `${fmt(row.time)} · ${row.sea_type || "Sea state"} · Confidence: ${row.confidence || "Unknown"}`;
  heroMetrics.innerHTML = `
    <div><strong>${fmt(row.planning_wave_height)}</strong><span>Planning ft</span></div>
    <div><strong>${fmt(row.planning_period)}</strong><span>Planning sec</span></div>
    <div><strong>${fmt(row.wind_speed_10m)}</strong><span>Wind mph</span></div>
    <div><strong>${fmt(row.wind_gusts_10m)}</strong><span>Gust mph</span></div>`;
}

function renderAverageTable(rows) {
  const averageTable = document.getElementById("average-table");
  if (!averageTable) return;
  averageTable.innerHTML = makeTable(rows, averageColumns, row => row.trip_phase ? `trip-row ${row.trip_phase.toLowerCase().replace(/\s+/g, "-")}` : "");
}

function applyTripPlanner() {
  const rows = enrichTripPhases(lastAverageRows);
  renderAverageTable(rows);
  renderTripSummary(rows);
}

async function loadForecast() {
  const status = document.getElementById("status");
  const sourcesDiv = document.getElementById("sources");
  const averageTable = document.getElementById("average-table");

  const lat = document.getElementById("lat").value;
  const lon = document.getElementById("lon").value;
  const forecastDays = Math.max(1, Math.min(Number(document.getElementById("days").value || 4), 8));
  const demo = document.getElementById("demo").checked;
  const hoursForDemo = forecastDays * 24;

  localStorage.setItem("marineDashboardLat", lat);
  localStorage.setItem("marineDashboardLon", lon);
  localStorage.setItem("marineDashboardDays", String(forecastDays));

  status.textContent = "Loading wave and wind forecast data...";
  sourcesDiv.innerHTML = "";
  averageTable.innerHTML = "";

  let windByTime = new Map();
  let windStatus = "Wind: live mph forecast";
  if (demo) {
    windByTime = buildDemoWind(hoursForDemo);
    windStatus = "Wind: demo mph forecast";
  } else {
    try {
      windByTime = await fetchWind(lat, lon, forecastDays);
    } catch (err) {
      windByTime = new Map();
      windStatus = `Wind unavailable: ${err.message}`;
    }
  }

  const results = [];
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    if (demo) {
      const src = buildDemoSource(source, hoursForDemo, (i - 1) * 0.25);
      src.rows = attachWind(src.rows, windByTime);
      results.push(src);
      continue;
    }
    try {
      const src = await fetchSource(lat, lon, source, forecastDays);
      src.rows = attachWind(src.rows, windByTime);
      results.push(src);
    } catch (err) {
      const fallback = buildDemoSource(source, hoursForDemo, (i - 1) * 0.25);
      fallback.rows = attachWind(fallback.rows, windByTime);
      fallback.error = `Live wave fetch failed: ${err.message}. Showing demo wave data for this source.`;
      results.push(fallback);
    }
  }

  status.textContent = `Location: ${lat}, ${lon} · Forecast days: ${forecastDays} · Timezone: America/Chicago · ${windStatus} · Last refreshed: ${new Date().toLocaleTimeString()}`;

  sourcesDiv.innerHTML = results.map(src => `
    <article class="card source-card">
      <h3>${src.name}</h3>
      <p class="note">${src.note}</p>
      ${src.error ? `<div class="error">${src.error}</div>` : ""}
      <p class="note">Showing first ${Math.min(MAX_SOURCE_ROWS, src.rows.length)} hours here. The combined table below uses the full selected forecast range. Wind is pulled from Open-Meteo Weather and shown in mph. The bottom table now uses a planning period that prioritizes short wind chop when it is meaningful.</p>
      <div class="table-wrap"><table>${makeTable(src.rows.slice(0, MAX_SOURCE_ROWS), sourceColumns)}</table></div>
    </article>
  `).join("");

  lastAverageRows = buildAverage(results, windByTime);
  const tripRows = enrichTripPhases(lastAverageRows);
  renderHero(tripRows, lat, lon);
  renderAverageTable(tripRows);
  renderTripSummary(tripRows);
}

function restoreSavedInputs() {
  const savedLat = localStorage.getItem("marineDashboardLat");
  const savedLon = localStorage.getItem("marineDashboardLon");
  const savedDays = localStorage.getItem("marineDashboardDays");
  if (savedLat) document.getElementById("lat").value = savedLat;
  if (savedLon) document.getElementById("lon").value = savedLon;
  if (savedDays) document.getElementById("days").value = savedDays;
}

document.getElementById("refresh").addEventListener("click", loadForecast);
document.querySelectorAll("button[data-lat]").forEach(button => {
  button.addEventListener("click", () => {
    document.getElementById("lat").value = button.dataset.lat;
    document.getElementById("lon").value = button.dataset.lon;
    localStorage.setItem("marineDashboardSpotName", button.dataset.name || button.textContent.trim());
    loadForecast();
  });
});

setDefaultTripDate();
document.getElementById("apply-trip")?.addEventListener("click", applyTripPlanner);
restoreSavedInputs();
loadForecast();

// -----------------------------
// NOAA / NDBC real-time buoy data
// -----------------------------
const NDBC_STATION_ID = "42357";
const NDBC_REALTIME_URL = `https://www.ndbc.noaa.gov/data/realtime2/${NDBC_STATION_ID}.txt`;
const LOCAL_NDBC_CACHE_URL = `data/buoy-${NDBC_STATION_ID}.txt`;
const NDBC_STATION_PAGE = `https://www.ndbc.noaa.gov/station_page.php?station=${NDBC_STATION_ID}`;

const buoyColumns = [
  ["time", "Time"],
  ["wvht_ft", "Wave ft"],
  ["dpd_sec", "Dominant sec"],
  ["apd_sec", "Avg sec"],
  ["mwd_deg", "Wave dir"],
  ["wspd_mph", "Wind mph"],
  ["gst_mph", "Gust mph"],
  ["wdir_deg", "Wind dir"],
  ["wtmp_f", "Water °F"],
  ["reality", "Reality"],
];

function metersToFeet(value) {
  return value === null || value === undefined ? null : value * 3.28084;
}

function msToMph(value) {
  return value === null || value === undefined ? null : value * 2.23694;
}

function cToF(value) {
  return value === null || value === undefined ? null : (value * 9 / 5) + 32;
}

function parseNdbcNumber(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  if (!cleaned || cleaned === "MM" || cleaned === "999" || cleaned === "99" || cleaned === "9999") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function fetchTextMaybeProxied(url) {
  const errors = [];

  // Best option for GitHub Pages: read a same-origin cached copy generated by
  // the included GitHub Action. This avoids browser CORS blocks from NDBC.
  try {
    const local = await fetch(`${LOCAL_NDBC_CACHE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (local.ok) {
      const text = await local.text();
      if (text.includes("#YY") || text.includes("#yr")) return text;
    } else {
      errors.push(`local cache HTTP ${local.status}`);
    }
  } catch (err) {
    errors.push(`local cache: ${err.message}`);
  }

  // This may work in some environments, but many static sites/phone browsers
  // are blocked by CORS because NDBC's text feed is not served for browser apps.
  try {
    const direct = await fetch(url, { cache: "no-store" });
    if (direct.ok) return await direct.text();
    errors.push(`direct NOAA HTTP ${direct.status}`);
  } catch (err) {
    errors.push(`direct NOAA/CORS: ${err.message}`);
  }

  // Last-resort public proxy. Useful for testing, but not something to rely on
  // for a boating dashboard. The GitHub Action cache is the durable fix.
  try {
    const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const proxied = await fetch(proxiedUrl, { cache: "no-store" });
    if (proxied.ok) return await proxied.text();
    errors.push(`proxy HTTP ${proxied.status}`);
  } catch (err) {
    errors.push(`proxy: ${err.message}`);
  }

  throw new Error(errors.join("; "));
}

function parseNdbcRealtime(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 3) return [];

  const headerLine = lines.find(line => line.startsWith("#YY")) || lines[0];
  const headers = headerLine.replace(/^#/, "").split(/\s+/);
  const dataLines = lines.filter(line => !line.startsWith("#"));

  return dataLines.map(line => {
    const parts = line.split(/\s+/);
    const rec = {};
    headers.forEach((header, i) => { rec[header] = parts[i]; });

    const yy = parseNdbcNumber(rec.YY);
    const mm = parseNdbcNumber(rec.MM);
    const dd = parseNdbcNumber(rec.DD);
    const hh = parseNdbcNumber(rec.hh);
    const min = parseNdbcNumber(rec.mm);
    const utcDate = yy && mm && dd && hh !== null && min !== null
      ? new Date(Date.UTC(yy, mm - 1, dd, hh, min))
      : null;

    const wvhtM = parseNdbcNumber(rec.WVHT);
    const dpd = parseNdbcNumber(rec.DPD);
    const apd = parseNdbcNumber(rec.APD);
    const wspdMs = parseNdbcNumber(rec.WSPD);
    const gstMs = parseNdbcNumber(rec.GST);
    const wtmpC = parseNdbcNumber(rec.WTMP);

    const waveFt = roundOrNull(metersToFeet(wvhtM), 1);
    const dominantSec = roundOrNull(dpd, 1);
    const avgSec = roundOrNull(apd, 1);
    const windMph = roundOrNull(msToMph(wspdMs), 1);
    const gustMph = roundOrNull(msToMph(gstMs), 1);

    return {
      time: utcDate ? utcDate.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—",
      utc: utcDate,
      wdir_deg: roundOrNull(parseNdbcNumber(rec.WDIR), 0),
      wspd_mph: windMph,
      gst_mph: gustMph,
      wvht_ft: waveFt,
      dpd_sec: dominantSec,
      apd_sec: avgSec,
      mwd_deg: roundOrNull(parseNdbcNumber(rec.MWD), 0),
      wtmp_f: roundOrNull(cToF(wtmpC), 1),
      reality: marineRating(waveFt, dominantSec || avgSec, 0, windMph, gustMph),
    };
  }).filter(row => row.utc instanceof Date && !Number.isNaN(row.utc.getTime()));
}

function makeBuoyTable(rows) {
  const head = `<thead><tr>${buoyColumns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map(row => `
    <tr>${buoyColumns.map(([key]) => {
      const value = row[key];
      let shown = key === "reality" ? badge(value) : fmt(value, key);
      if (["mwd_deg", "wdir_deg"].includes(key) && typeof value === "number") shown = `${Math.round(value)}°`;
      return `<td>${shown}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
  return head + body;
}

function buoySummaryCard(row) {
  if (!row) return "";
  const ageMinutes = row.utc ? Math.round((Date.now() - row.utc.getTime()) / 60000) : null;
  const ageText = ageMinutes === null ? "unknown age" : ageMinutes < 60 ? `${ageMinutes} min old` : `${Math.round(ageMinutes / 60)} hr old`;
  return `
    <div class="buoy-grid">
      <div><strong>${fmt(row.wvht_ft)}</strong><span>Wave ft</span></div>
      <div><strong>${fmt(row.dpd_sec)}</strong><span>Dominant sec</span></div>
      <div><strong>${fmt(row.apd_sec)}</strong><span>Average sec</span></div>
      <div><strong>${fmt(row.wspd_mph)}</strong><span>Wind mph</span></div>
      <div><strong>${fmt(row.gst_mph)}</strong><span>Gust mph</span></div>
      <div><strong>${badge(row.reality)}</strong><span>Reality check</span></div>
    </div>
    <p class="note">Latest observation: ${row.time} · ${ageText} · <a href="${NDBC_STATION_PAGE}" target="_blank" rel="noopener">Open NDBC station page</a></p>
  `;
}

async function loadBuoy() {
  const status = document.getElementById("buoy-status");
  const current = document.getElementById("buoy-current");
  const table = document.getElementById("buoy-table");
  if (!status || !current || !table) return;

  status.textContent = `Loading NOAA/NDBC station ${NDBC_STATION_ID} real-time observations...`;
  current.innerHTML = "";
  table.innerHTML = "";

  try {
    const text = await fetchTextMaybeProxied(NDBC_REALTIME_URL);
    const rows = parseNdbcRealtime(text).slice(0, 48);
    if (!rows.length) throw new Error("No usable buoy rows were returned.");
    current.innerHTML = buoySummaryCard(rows[0]);
    table.innerHTML = makeBuoyTable(rows);
    status.textContent = `Station ${NDBC_STATION_ID} loaded. Data source: NOAA/NDBC real-time feed or GitHub Pages cache.`;
  } catch (err) {
    status.textContent = `Buoy data unavailable: ${err.message}`;
    current.innerHTML = `<p class="error">Could not load the buoy feed. On GitHub Pages, enable the included GitHub Action so the app can read a same-site cached copy instead of trying to fetch NOAA/NDBC directly from the browser.</p>`;
  }
}

document.getElementById("refresh-buoy")?.addEventListener("click", loadBuoy);
loadBuoy();
