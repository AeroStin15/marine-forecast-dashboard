const FT_PER_M = 3.28084;
const MS_TO_MPH = 2.23694;
const spots = [
  {name:'South of Ship Island / Open Gulf', lat:29.960, lon:-88.950},
  {name:'Ship Island South Edge', lat:30.130, lon:-88.950},
  {name:'FH13 Area', lat:29.430, lon:-88.430},
  {name:'Biloxi / MS Sound', lat:30.360, lon:-88.880},
  {name:'Chandeleur Approach', lat:29.850, lon:-89.050},
  {name:'Venice / Rigs', lat:29.150, lon:-89.250}
];
const models = [
  {key:'best_match', label:'Open-Meteo Best Match'},
  {key:'ecmwf_wam025', label:'ECMWF WAM 0.25°'},
  {key:'gfswave025', label:'NCEP GFS Wave 0.25°'}
];
const $ = id => document.getElementById(id);
const round = (v,d=1)=> Number.isFinite(v) ? Number(v).toFixed(d) : '—';
const avg = arr => { const a=arr.filter(Number.isFinite); return a.length ? a.reduce((x,y)=>x+y,0)/a.length : NaN; };
const maxv = arr => { const a=arr.filter(Number.isFinite); return a.length ? Math.max(...a) : NaN; };
const minv = arr => { const a=arr.filter(Number.isFinite); return a.length ? Math.min(...a) : NaN; };

function init(){
  spots.forEach((s,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=s.name; $('spotSelect').appendChild(o); });
  const today = new Date(); $('tripDate').value = today.toISOString().slice(0,10);
  $('refreshBtn').addEventListener('click', loadAll);
  loadAll();
}

async function loadAll(){
  const spot = spots[+$('spotSelect').value];
  const days = Math.max(1, Math.min(8, +$('daysInput').value || 4));
  $('updatedText').textContent = 'Loading forecast...';
  try{
    const forecast = await loadForecast(spot, days);
    renderForecast(forecast, spot);
    $('updatedText').textContent = `Updated ${new Date().toLocaleString()} for ${spot.lat.toFixed(3)}, ${spot.lon.toFixed(3)}`;
  }catch(e){
    console.error(e);
    $('updatedText').textContent = 'Forecast load failed. Check console or connection.';
  }
}

async function loadForecast(spot, days){
  const marineHourly = 'wave_height,wave_period,wind_wave_height,wind_wave_period,swell_wave_height,swell_wave_period';
  const weatherHourly = 'wind_speed_10m,wind_gusts_10m,wind_direction_10m';
  const marineCalls = models.map(async m=>{
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${spot.lat}&longitude=${spot.lon}&hourly=${marineHourly}&forecast_days=${days}&models=${m.key}&timezone=auto`;
    const r = await fetch(url); if(!r.ok) throw new Error('Marine fetch failed '+m.key);
    const j = await r.json(); return normalizeMarine(j, m);
  });
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}&hourly=${weatherHourly}&forecast_days=${days}&wind_speed_unit=mph&timezone=auto`;
  const weatherPromise = fetch(weatherUrl).then(r=>{if(!r.ok)throw new Error('Weather fetch failed');return r.json();}).then(normalizeWeather);
  const [marineData, weather] = await Promise.all([Promise.allSettled(marineCalls), weatherPromise]);
  const sources = marineData.map((r,i)=> r.status==='fulfilled' ? r.value : {label:models[i].label, rows:[], error:true});
  return combineSources(sources, weather);
}

function normalizeMarine(j, model){
  const h=j.hourly||{};
  const rows=(h.time||[]).map((t,i)=>({
    time:t,
    waveFt: h.wave_height?.[i] != null ? h.wave_height[i]*FT_PER_M : NaN,
    waveSec: h.wave_period?.[i] ?? NaN,
    windWaveFt: h.wind_wave_height?.[i] != null ? h.wind_wave_height[i]*FT_PER_M : NaN,
    windWaveSec: h.wind_wave_period?.[i] ?? NaN,
    swellFt: h.swell_wave_height?.[i] != null ? h.swell_wave_height[i]*FT_PER_M : NaN,
    swellSec: h.swell_wave_period?.[i] ?? NaN
  }));
  return {label:model.label, key:model.key, rows};
}
function normalizeWeather(j){
  const h=j.hourly||{}; const out={};
  (h.time||[]).forEach((t,i)=> out[t]={
    windMph:h.wind_speed_10m?.[i] ?? NaN,
    gustMph:h.wind_gusts_10m?.[i] ?? NaN,
    windDir:h.wind_direction_10m?.[i] ?? NaN
  });
  return out;
}

function combineSources(sources, weather){
  const times = [...new Set(sources.flatMap(s=>s.rows.map(r=>r.time)))].sort();
  const bySource = sources.map(s=>({ ...s, map:Object.fromEntries(s.rows.map(r=>[r.time,r])) }));
  const rows = times.map(t=>{
    const vals = bySource.map(s=>s.map[t]).filter(Boolean);
    const waveVals = vals.map(v=>v.waveFt);
    const windWaveVals = vals.map(v=>v.windWaveFt);
    const windWaveSecs = vals.map(v=>v.windWaveSec).filter(v=>Number.isFinite(v) && v>0);
    const waveSecs = vals.map(v=>v.waveSec).filter(v=>Number.isFinite(v) && v>0);
    const avgWave = avg(waveVals);
    const highWave = maxv(waveVals);
    const avgWindWave = avg(windWaveVals);
    const wwSec = avg(windWaveSecs);
    const baseSec = avg(waveSecs);
    const planningFt = Math.max(avgWave || 0, highWave || 0, avgWindWave || 0);
    // Key fix: if wind-wave height is meaningful, use the shorter chop period for planning.
    const planningSec = (Number.isFinite(avgWindWave) && avgWindWave >= 0.7 && Number.isFinite(wwSec)) ? Math.min(baseSec || wwSec, wwSec) : baseSec;
    const spread = Number.isFinite(highWave) && Number.isFinite(minv(waveVals)) ? highWave - minv(waveVals) : NaN;
    const w = weather[t] || {};
    const ratingObj = rateSea(planningFt, planningSec, w.windMph, w.gustMph);
    const confidence = confidenceScore(spread, vals.length);
    return {time:t, vals, avgWave, avgPeriod:baseSec, planningFt, planningSec, spread, windMph:w.windMph, gustMph:w.gustMph, windDir:w.windDir, seaType:seaType(planningFt, planningSec, avgWindWave), ...ratingObj, confidence};
  });
  return {sources, rows};
}

function rateSea(ft, sec, wind, gust){
  let level = 0; // 0 good, 1 fair, 2 caution, 3 no-go
  // New hierarchy: wave height dominates.
  if(ft < 1.0) level = 0;
  else if(ft < 2.0) level = 1;
  else if(ft < 3.0) level = 2;
  else level = 3;
  // Wind can downgrade, but small seas are not automatically caution unless wind is strong.
  if(wind >= 25 || gust >= 32) level += 2;
  else if(wind >= 18 || gust >= 25) level += 1;
  // Short period only downgrades when enough wave exists to matter.
  if(ft >= 1.5 && sec > 0 && sec < 5) level += 1;
  if(ft >= 2.25 && sec > 0 && sec < 4) level += 1;
  level = Math.min(level,3);
  const labels=['Good','Fair','Caution','No-Go'];
  const classes=['good','fair','caution','no-go'];
  return {rating:labels[level], ratingClass:classes[level]};
}
function confidenceScore(spread, count){
  let score=85;
  if(count<3) score-=20;
  if(Number.isFinite(spread)){
    if(spread>1.5) score-=35; else if(spread>1.0) score-=25; else if(spread>0.6) score-=15; else if(spread>0.3) score-=7;
  }
  return Math.max(25, Math.min(95, Math.round(score)));
}
function seaType(ft, sec, windWaveFt){
  if(ft < 0.8) return 'Nearly flat';
  if(sec && sec < 4.5 && ft >= 1.5) return 'Short chop';
  if(sec && sec < 5.5 && ft >= 1.0) return 'Light chop';
  if(windWaveFt >= 0.8) return 'Mixed chop';
  if(sec >= 7) return 'Longer swell';
  return 'Moderate seas';
}

function renderForecast(forecast){
  const nowIso = nearestFutureRow(forecast.rows)?.time || forecast.rows[0]?.time;
  const current = forecast.rows.find(r=>r.time===nowIso) || forecast.rows[0];
  if(current){
    $('mainRating').textContent=current.rating;
    $('confidence').textContent=`${current.confidence}% confidence`;
    $('ratingCard').className=`status-card ${current.ratingClass}`;
    $('planningSeas').textContent=`${round(current.planningFt)} ft`;
    $('planningPeriod').textContent=`${round(current.planningSec)} sec`;
    $('planningWind').textContent=`${round(current.windMph,0)} mph / gust ${round(current.gustMph,0)}`;
    $('seaType').textContent=current.seaType;
  }
  renderModels(forecast.sources);
  renderCombined(forecast.rows);
  renderTrip(forecast.rows);
}
function nearestFutureRow(rows){ const n=Date.now(); return rows.find(r=>new Date(r.time).getTime()>=n); }
function renderModels(sources){
  $('modelPanels').innerHTML=sources.map(s=>{
    const r=nearestFutureRow(s.rows)||s.rows[0];
    return `<div class="model-card"><h3>${s.label}</h3>${s.error?'<p class="muted">Failed to load.</p>':`
      <div class="metric-row"><span>Wave</span><strong>${round(r?.waveFt)} ft</strong></div>
      <div class="metric-row"><span>Period</span><strong>${round(r?.waveSec)} sec</strong></div>
      <div class="metric-row"><span>Wind wave</span><strong>${round(r?.windWaveFt)} ft @ ${round(r?.windWaveSec)} sec</strong></div>
      <div class="metric-row"><span>Swell</span><strong>${round(r?.swellFt)} ft @ ${round(r?.swellSec)} sec</strong></div>`}</div>`;
  }).join('');
}
function renderCombined(rows){
  const head = `<thead><tr><th>Time</th><th>Planning ft</th><th>Planning sec</th><th>Avg ft</th><th>Avg sec</th><th>Wind</th><th>Gust</th><th>Spread</th><th>Sea type</th><th>Rating</th><th>Confidence</th></tr></thead>`;
  const body = rows.map(r=>`<tr><td>${fmtTime(r.time)}</td><td>${round(r.planningFt)}</td><td>${round(r.planningSec)}</td><td>${round(r.avgWave)}</td><td>${round(r.avgPeriod)}</td><td>${round(r.windMph,0)}</td><td>${round(r.gustMph,0)}</td><td>${round(r.spread)}</td><td>${r.seaType}</td><td class="rating-${r.ratingClass}">${r.rating}</td><td>${r.confidence}%</td></tr>`).join('');
  $('combinedTable').innerHTML=head+`<tbody>${body}</tbody>`;
}
function renderTrip(rows){
  const date=$('tripDate').value, leave=$('leaveTime').value, ret=$('returnTime').value;
  const start=new Date(`${date}T${leave}`), end=new Date(`${date}T${ret}`);
  const tripRows=rows.filter(r=>{const d=new Date(r.time); return d>=start && d<=end;});
  if(!tripRows.length){$('tripSummary').textContent='No forecast rows found for that trip window.'; $('tripTable').innerHTML=''; return;}
  const worstLevel = Math.max(...tripRows.map(r=>['Good','Fair','Caution','No-Go'].indexOf(r.rating)));
  const labels=['Good','Fair','Caution','No-Go'];
  const maxFt=maxv(tripRows.map(r=>r.planningFt)); const minSec=minv(tripRows.map(r=>r.planningSec)); const maxWind=maxv(tripRows.map(r=>r.windMph));
  $('tripSummary').innerHTML=`Trip window: <strong class="rating-${labels[worstLevel].toLowerCase().replace(' ','-')}">${labels[worstLevel]}</strong>. Max planning seas ${round(maxFt)} ft, shortest planning period ${round(minSec)} sec, max wind ${round(maxWind,0)} mph.`;
  $('tripTable').innerHTML=`<thead><tr><th>Time</th><th>ft</th><th>sec</th><th>wind</th><th>rating</th></tr></thead><tbody>`+tripRows.map(r=>`<tr><td>${fmtTime(r.time)}</td><td>${round(r.planningFt)}</td><td>${round(r.planningSec)}</td><td>${round(r.windMph,0)}</td><td class="rating-${r.ratingClass}">${r.rating}</td></tr>`).join('')+'</tbody>';
}
function fmtTime(t){return new Date(t).toLocaleString([], {weekday:'short', month:'numeric', day:'numeric', hour:'numeric'});}

init();
