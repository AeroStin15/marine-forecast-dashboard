const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MAX_SOURCE_ROWS = 24;

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
  ...sourceColumns,
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

function marineRating(avgWaveFt, avgPeriodSec, spreadFt, windMph, gustMph) {
  if (avgWaveFt === null || avgWaveFt === undefined) return "Unknown";

  const period = avgPeriodSec || 0;
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

function makeTable(rows, columns) {
  const head = `<thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map(row => `
    <tr>${columns.map(([key]) => {
      const value = row[key];
      const shown = key === "rating" ? badge(value) : fmt(value, key);
      return `<td>${shown}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
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
    const avgRow = { time };

    for (const field of marineFields) {
      const values = bucket[field] || [];
      avgRow[field] = values.length ? roundOrNull(values.reduce((a, b) => a + b, 0) / values.length) : null;
    }

    const wind = windByTime.get(time) || {};
    avgRow.wind_speed_10m = roundOrNull(wind.wind_speed_10m, 1);
    avgRow.wind_gusts_10m = roundOrNull(wind.wind_gusts_10m, 1);
    avgRow.wind_direction_10m = roundOrNull(wind.wind_direction_10m, 0);

    avgRow.wave_spread = roundOrNull(waveSpread);
    avgRow.confidence = confidenceFromSpread(waveSpread);
    avgRow.rating = marineRating(avgRow.wave_height, avgRow.wave_period, waveSpread, avgRow.wind_speed_10m, avgRow.wind_gusts_10m);
    return avgRow;
  });
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
      <p class="note">Showing first ${Math.min(MAX_SOURCE_ROWS, src.rows.length)} hours here. The combined average below uses the full selected forecast range. Wind is pulled from Open-Meteo Weather and shown in mph.</p>
      <div class="table-wrap"><table>${makeTable(src.rows.slice(0, MAX_SOURCE_ROWS), sourceColumns)}</table></div>
    </article>
  `).join("");

  averageTable.innerHTML = makeTable(buildAverage(results, windByTime), averageColumns);
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
    loadForecast();
  });
});

restoreSavedInputs();
loadForecast();
