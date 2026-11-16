/* Data-bound dashboard graphics: small SVG/CSS scenes rather than decorative screenshots. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayISO = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
  const rank = (source) => ({ observed: 4, forecast: 3, historical: 2, seasonal: 1 })[source] || 0;
  const complete = (row) => row && ['tmin', 'tmax', 'rain', 'eto'].every((k) => row[k] !== '' && Number.isFinite(Number(row[k])));
  const fmt = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';

  function icon(kind) {
    if (kind === 'rain') return '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 19h16a5 5 0 0 0 0-10 8 8 0 0 0-15-1A5.5 5.5 0 0 0 8 19Z" fill="#fff" stroke="#77a8b4" stroke-width="1.5"/><path d="m11 22-2 4m9-4-2 4m9-4-2 4" stroke="#4c9daf" stroke-width="2" stroke-linecap="round"/></svg>';
    if (kind === 'cloud') return '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 21h16a5.5 5.5 0 0 0 0-11 8 8 0 0 0-15-1A6 6 0 0 0 8 21Z" fill="#fff" stroke="#a6c0c3" stroke-width="1.5"/></svg>';
    return '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6" fill="#f4c35e"/><path d="M16 3v4m0 18v4M3 16h4m18 0h4M6.8 6.8l2.8 2.8m12.8 12.8 2.8 2.8m0-18.4-2.8 2.8M9.6 22.4l-2.8 2.8" stroke="#eab64e" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  function weatherKind(row) { if (!row) return 'cloud'; if (Number(row.rain) >= 0.5) return 'rain'; if (Number(row.tmax) >= 35) return 'heat'; return Number(row.tmax) < 24 ? 'cloud' : 'sun'; }

  function initialize() {
    if (document.body.dataset.dashboardBuilt) return;
    const main = document.querySelector('main');
    const grid = main?.querySelector('.grid');
    const intro = $('overview');
    const field = $('currentField');
    const weather = $('weather');
    if (!main || !grid || !intro || !field || !weather) return;
    document.body.dataset.dashboardBuilt = 'true';
    weather.classList.add('weather-panel');
    intro.className = 'decision-heading';
    intro.innerHTML = '<div><p class="eyebrow">FIELD INTELLIGENCE · TODAY</p><h2 id="dashboardGreeting">Your field, in view.</h2><p id="dashboardSub">A live workspace for the crop, today\'s weather, and irrigation planning.</p></div><a href="#advice" class="decision-jump">View irrigation plan <span aria-hidden="true">↘</span></a>';

    const dashboard = document.createElement('div');
    dashboard.className = 'twin-live-grid';
    dashboard.setAttribute('aria-label', 'Current field and weather dashboard');
    dashboard.append(field, weather);
    main.insertBefore(dashboard, grid);

    const weatherDescription = weather.querySelector(':scope > .sub');
    if (weatherDescription) weatherDescription.insertAdjacentHTML('afterend', `
      <div class="weather-visual" id="weatherVisual" data-weather="cloud" aria-live="polite">
        <div class="weather-atmosphere" aria-hidden="true"><span class="weather-sun"></span><span class="weather-cloud"></span><span class="weather-cloud two"></span><div class="weather-rain"><i></i><i></i><i></i><i></i></div></div>
        <div class="weather-copy"><span id="weatherSceneSource">LOCAL WEATHER · LOADING</span><strong><span id="weatherSceneTemp">—</span><sup>°</sup></strong><small id="weatherSceneRange">Daily temperature range</small><div class="weather-tags"><b id="weatherSceneRain">Rain —</b><b id="weatherSceneEto">ETo —</b></div></div>
      </div>
      <div class="weather-mini-title">Next days <span id="weatherUpdatedLabel">Updating from weather feed</span></div>
      <div class="forecast-strip" id="weatherForecast" aria-label="Short weather forecast"></div>
      <div class="weather-mini-title" style="margin-top:14px">Recent rainfall <span>daily totals · mm</span></div>
      <svg class="weather-chart" id="rainChart" viewBox="0 0 360 76" role="img" aria-label="Recent daily rainfall chart"></svg>`);
    const fieldVisual = $('fieldVisual');
    if (fieldVisual) fieldVisual.insertAdjacentHTML('beforeend', '<div class="soil-wave" aria-hidden="true"></div><div class="field-signal"><span>Soil signal</span><b id="fieldSignalValue">—</b><small id="fieldSignalLabel">Waiting for a field reading</small></div>');
  }

  function renderWeather(state) {
    const scene = $('weatherVisual');
    if (!scene) return;
    const today = todayISO();
    const rows = (state?.weather || []).filter(complete).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || rank(a.source) - rank(b.source));
    const byDate = new Map();
    rows.forEach((row) => { if (!byDate.has(row.date) || rank(row.source) > rank(byDate.get(row.date).source)) byDate.set(row.date, row); });
    const row = byDate.get(today);
    if (!row) {
      scene.dataset.weather = 'cloud';
      $('weatherSceneTemp').textContent = '—'; $('weatherSceneRange').textContent = 'No weather row for today';
      $('weatherSceneSource').textContent = 'WEATHER FEED NOT LOADED'; $('weatherSceneRain').textContent = 'Rain —'; $('weatherSceneEto').textContent = 'ETo —';
      $('weatherForecast').innerHTML = '<div class="empty" style="grid-column:1/-1">Fetch weather to see today and the next days.</div>';
    } else {
      const kind = weatherKind(row);
      scene.dataset.weather = kind;
      $('weatherSceneTemp').textContent = fmt((Number(row.tmin) + Number(row.tmax)) / 2, 0);
      $('weatherSceneRange').textContent = fmt(row.tmin, 0) + '° – ' + fmt(row.tmax, 0) + '°C today';
      $('weatherSceneSource').textContent = String(row.source || 'weather').toUpperCase() + ' · ' + today;
      $('weatherSceneRain').textContent = 'Rain ' + fmt(row.rain) + ' mm';
      $('weatherSceneEto').textContent = 'ETo ' + fmt(row.eto) + ' mm';
      const days = [...byDate.values()].filter((entry) => entry.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
      $('weatherForecast').innerHTML = days.map((entry) => {
        const d = new Date(entry.date + 'T12:00:00');
        const label = entry.date === today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' });
        const type = weatherKind(entry);
        return '<div class="forecast-day"><b>' + esc(label) + '</b><span class="forecast-glyph">' + icon(type) + '</span><span>' + fmt(entry.tmin, 0) + '° / ' + fmt(entry.tmax, 0) + '°</span><span>' + fmt(entry.rain) + ' mm rain</span></div>';
      }).join('') || '<div class="empty" style="grid-column:1/-1">No forecast days are available.</div>';
    }
    const chartRows = [...byDate.values()].filter((entry) => entry.date <= today).sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
    if (chartRows.length) {
      const max = Math.max(1, ...chartRows.map((entry) => Number(entry.rain) || 0));
      const bars = chartRows.map((entry, index) => {
        const x = 18 + index * 47, height = Math.max(3, (Number(entry.rain) || 0) / max * 43), y = 54 - height;
        const label = new Date(entry.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
        return '<rect class="rain-bar" x="' + x + '" y="' + y.toFixed(1) + '" width="23" height="' + height.toFixed(1) + '" rx="6" style="animation-delay:' + (index * .05).toFixed(2) + 's"><title>' + esc(entry.date) + ': ' + fmt(entry.rain) + ' mm</title></rect><text x="' + (x + 11) + '" y="70" text-anchor="middle">' + esc(label) + '</text>';
      }).join('');
      $('rainChart').innerHTML = '<path class="grid-line" d="M8 54H352M8 31H352M8 8H352"/>' + bars;
    } else $('rainChart').innerHTML = '<path class="grid-line" d="M8 54H352M8 31H352M8 8H352"/><text x="180" y="43" text-anchor="middle">Add weather to draw rainfall</text>';
    const stamp = state?.weatherUpdatedAt ? 'Updated ' + new Date(state.weatherUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Forecast source · Open-Meteo';
    $('weatherUpdatedLabel').textContent = stamp;
  }

  function renderField(state, demo, demoReading) {
    const moisture = $('fieldSignalValue'), label = $('fieldSignalLabel'), visual = $('fieldVisual');
    if (!moisture || !visual) return;
    const observations = (state?.observations || []).filter((o) => o.moisture !== '' && Number.isFinite(Number(o.moisture))).slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    let value = observations.length ? Number(observations[0].moisture) : null;
    let source = observations.length ? (observations[0].sensorId || 'Recorded reading') : '';
    if (demo && demoReading) { value = Number(demoReading.value); source = 'Synthetic demo'; }
    if (Number.isFinite(value)) {
      moisture.textContent = value.toFixed(1) + '%';
      label.textContent = source + (demo && demoReading ? ' · DEMO' : '');
      visual.style.setProperty('--soil-opacity', String(Math.max(.15, Math.min(.9, value / 50))));
      visual.dataset.moisture = value < 20 ? 'low' : value > 40 ? 'high' : 'mid';
    } else {
      moisture.textContent = '—'; label.textContent = 'Waiting for a field reading'; visual.style.setProperty('--soil-opacity', '.18'); visual.dataset.moisture = 'unknown';
    }
    const profile = state?.profile || {};
    const title = $('dashboardGreeting'), sub = $('dashboardSub');
    const fieldName = profile.fieldId || profile.location || 'your field';
    if (title) title.textContent = fieldName + ' today';
    if (sub) sub.textContent = [profile.crop, profile.location, profile.planting && profile.seasonEnd ? profile.planting + ' – ' + profile.seasonEnd : 'Season setup needed'].filter(Boolean).join(' · ');
  }

  window.initializeTwinDashboard = initialize;
  window.updateTwinDashboard = (payload = {}) => { renderField(payload.state, payload.demo, payload.demoReading); renderWeather(payload.state); };
})();
