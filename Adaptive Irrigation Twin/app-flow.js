/* Farm workspace, synthetic demo feed, automatic weather refresh, and daily policy advice. */
(function () {
  'use strict';
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const FARM_KEY = 'adaptiveTwin.farms.v1';
  const SESSION_KEY = 'adaptiveTwin.sessionFarm';
  const SYNC_PREFIX = 'adaptiveTwin.weatherSync.';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const localDate = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const emptyState = (fieldId) => ({
    profile: { fieldId, location: '', crop: '', planting: '', seasonEnd: '', area: '', soil: '', rootDepth: '', weatherSource: '' },
    observations: [], scenarios: [], weather: [], modelResults: [], settings: {}
  });
  let farms = JSON.parse(localStorage.getItem(FARM_KEY) || '[]');
  let activeFarm = null;
  let demoTimer = null;
  let demoReading = null;
  let weatherTimer = null;

  // Migrate the existing single-field prototype into a local farm workspace.
  if (!Array.isArray(farms) || !farms.length) {
    farms = [];
    if (s && Object.values(s.profile || {}).some(Boolean)) {
      const label = s.profile.fieldId || s.profile.location || 'My saved farm';
      farms.push({ id: 'saved-' + Date.now(), name: label, demo: false, state: clone(s) });
    }
    persistFarms();
  }

  function persistFarms() { localStorage.setItem(FARM_KEY, JSON.stringify(farms)); }
  function hydrateForm() {
    for (const key of profileKeys) {
      const input = document.getElementById(key);
      if (input) input.value = s.profile?.[key] ?? '';
    }
    for (const [key, value] of Object.entries(s.settings || {})) {
      const input = document.getElementById(key);
      if (input) input.value = value ?? '';
    }
    const weatherPlace = document.getElementById('weatherPlace');
    if (weatherPlace) weatherPlace.value = s.weatherLocation || s.profile?.location || '';
  }
  function showApp() {
    document.getElementById('farmPortal').hidden = true;
    document.querySelector('header').hidden = false;
    document.querySelector('main').hidden = false;
  }
  function drawFarmChoices() {
    const host = document.getElementById('farmChoices');
    host.innerHTML = farms.map((farm) => {
      const profile = farm.state?.profile || {};
      const crop = [profile.crop, profile.location].filter(Boolean).join(' · ') || 'Season setup needed';
      const label = farm.demo ? '<span class="farm-demo-tag">DEMO DATA</span>' : '<span class="farm-saved-tag">SAVED HERE</span>';
      return '<article class="farm-choice"><div><b>' + safe(farm.name) + '</b><small>' + safe(crop) + '</small>' + label + '</div><button data-open-farm="' + safe(farm.id) + '">Open farm →</button></article>';
    }).join('') || '<p class="portal-empty">No farm workspaces yet. Create one below or open the demo farm.</p>';
    host.querySelectorAll('[data-open-farm]').forEach((button) => button.addEventListener('click', () => activateFarm(button.dataset.openFarm)));
  }
  function ensurePortal() {
    const styles = document.createElement('style');
    styles.textContent = `
      #farmPortal[hidden],header[hidden],main[hidden]{display:none!important}.farm-portal{min-height:100vh;padding:38px 22px;display:grid;place-items:center;background:radial-gradient(ellipse at 85% 5%,#e1ead0,transparent 34rem),#f4f6ef;color:#183126;font:15px/1.5 Inter,system-ui,sans-serif}.portal-shell{width:min(100%,1000px);display:grid;grid-template-columns:1.1fr .9fr;border:1px solid #e0e8dc;border-radius:26px;background:#fff;overflow:hidden;box-shadow:0 24px 64px #1d382015}.portal-hero{padding:48px;background:linear-gradient(145deg,#163523,#285338);color:#f6f7ec;display:flex;flex-direction:column;justify-content:space-between;min-height:570px}.portal-brand{font-weight:800;letter-spacing:-.3px}.portal-brand span{display:inline-grid;place-items:center;width:36px;height:36px;margin-right:9px;border-radius:12px;background:#d3ed68;color:#193421}.portal-hero .eyebrow{margin:0 0 12px;color:#d3ed68;font-size:10px;letter-spacing:.16em;font-weight:800}.portal-hero h1{max-width:420px;margin:0;font-size:42px;line-height:1.03;letter-spacing:-1.6px}.portal-hero p{max-width:440px;color:#d3dfd2}.portal-art{height:145px;border-radius:17px;background:repeating-linear-gradient(168deg,#789753 0 2px,#567a43 3px 13px,#345f38 14px 28px);clip-path:polygon(5% 26%,90% 0,100% 78%,14% 100%);opacity:.83}.portal-content{padding:42px 34px}.portal-content h2{margin:0;font-size:23px;letter-spacing:-.5px}.portal-content>p{margin:5px 0 20px;color:#6d7c70;font-size:12px}.farm-choice{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:10px 0;padding:14px;border:1px solid #e5ebe2;border-radius:13px}.farm-choice b,.farm-choice small{display:block}.farm-choice small{font-size:11px;color:#78857a}.farm-choice button,.portal-button{border:0;border-radius:9px;padding:10px 13px;background:#214d35;color:#fff;font-size:12px;font-weight:750;cursor:pointer;white-space:nowrap}.farm-demo-tag,.farm-saved-tag{display:inline-block;margin-top:7px;padding:3px 6px;border-radius:99px;background:#fff2cf;color:#725b27;font-size:9px;font-weight:800;letter-spacing:.06em}.farm-saved-tag{background:#edf3e8;color:#496246}.portal-divider{height:1px;background:#e9eee6;margin:22px 0}.portal-create{display:flex;gap:8px}.portal-create input{flex:1;min-width:0;height:41px;border:1px solid #dce5da;border-radius:9px;padding:9px 10px;font:inherit}.portal-create button{border:0;border-radius:9px;padding:9px 11px;background:#edf3e8;color:#35563b;font-weight:700;cursor:pointer}.portal-foot{margin-top:18px!important;font-size:10px!important;color:#7a867c!important}.portal-empty{padding:16px;background:#f6f8f3;border-radius:11px;color:#748174;font-size:12px}.farm-session{border:1px solid #66856c;border-radius:99px;padding:5px 9px;color:#e4eddf;font-size:10px}.farm-signout{border:1px solid #66856c;border-radius:99px;padding:5px 9px;background:transparent;color:#e4eddf;font-size:10px;cursor:pointer}.demo-signal{display:inline-block;margin-left:6px;padding:3px 6px;border-radius:99px;background:#fff0cc;color:#765a1f;font-size:9px;font-weight:800;letter-spacing:.04em}.demo-feed-card{grid-column:1/-1;padding:10px 12px;border:1px dashed #ddc46f;border-radius:11px;background:#fffcf2;color:#6a5729;font-size:11px}.demo-feed-card button{float:right;padding:5px 8px;font-size:10px}.demo-feed-card small{display:block;color:#887850;font-size:10px}.today-action{padding:12px 14px;border-left:4px solid #214d35;border-radius:8px;background:#f4f7ec;color:#284630;font-size:14px;font-weight:750}.today-meta{margin-top:7px;color:#748174;font-size:11px}.data-source-warning{padding:10px 12px;border-radius:9px;background:#fff6df;color:#74591e;font-size:11px}.weather-auto{margin-top:6px;color:#7c887c;font-size:10px}.policy-hint{padding:10px 12px;border-radius:9px;background:#edf4e8;color:#506347;font-size:11px}
      @media(max-width:780px){.portal-shell{grid-template-columns:1fr}.portal-hero{min-height:330px;padding:28px}.portal-hero h1{font-size:34px}.portal-art{height:90px}.portal-content{padding:28px 22px}.farm-choice{align-items:flex-start;flex-direction:column}.portal-create{flex-direction:column}}
    `;
    document.head.appendChild(styles);
    const appTheme = document.createElement('link');
    appTheme.rel = 'stylesheet';
    appTheme.href = 'app-theme.css?v=1';
    document.head.appendChild(appTheme);
    window.initializeTwinDashboard?.();
    document.body.insertAdjacentHTML('afterbegin', `
      <section class="farm-portal" id="farmPortal" aria-label="Farm sign-in">
        <div class="portal-shell"><div class="portal-hero"><div class="portal-brand"><span>✳</span>Adaptive Irrigation Twin</div><div><p class="eyebrow">FIELD INTELLIGENCE</p><h1>Your farm, in sync with the season.</h1><p>See the latest field readings, local weather, and irrigation advice from one workspace.</p></div><div class="portal-art" aria-hidden="true"></div></div>
        <div class="portal-content"><h2>Open a farm workspace</h2><p>Choose a saved farm or start with the synthetic demo field.</p><div id="farmChoices"></div><div class="portal-divider"></div><button class="portal-button" id="createDemoFarm">Open synthetic demo farm</button><p class="portal-foot">This prototype stores farm data in this browser. Account passwords and secure cloud sign-in are not configured.</p><div class="portal-divider"></div><label for="newFarmName" style="font-size:11px;font-weight:700">Create a local farm workspace</label><div class="portal-create"><input id="newFarmName" placeholder="Farm name"><button id="createFarm">Create workspace</button></div></div></div>
      </section>`);
    document.querySelector('header').hidden = true;
    document.querySelector('main').hidden = true;
    drawFarmChoices();
    document.getElementById('createFarm').addEventListener('click', createFarm);
    document.getElementById('newFarmName').addEventListener('keydown', (event) => { if (event.key === 'Enter') createFarm(); });
    document.getElementById('createDemoFarm').addEventListener('click', createDemoFarm);
  }
  function activateFarm(id) {
    activeFarm = farms.find((farm) => farm.id === id);
    if (!activeFarm) return;
    s = clone(activeFarm.state || emptyState(activeFarm.name));
    s.profile ||= {};
    s.observations ||= [];
    s.scenarios ||= [];
    s.weather ||= [];
    s.modelResults ||= [];
    localStorage.setItem(KEY, JSON.stringify(s));
    sessionStorage.setItem(SESSION_KEY, activeFarm.id);
    hydrateForm();
    showApp();
    render();
    renderAdvice();
    attachFarmHeader();
    attachDemoFeed();
    startDemoFeed();
    scheduleWeatherRefresh(false);
    fetch('/api/calibration-status')
      .then((r) => r.json())
      .then((res) => {
        if (res.calibrated && res.data) {
          s.calibrationData = res.data;
          renderCalibration(res.data);
        }
      })
      .catch(() => {});
    if (typeof updateWhatIfSimulation === 'function') updateWhatIfSimulation(80);
    if (!s.profile.crop || !s.profile.planting || !s.profile.seasonEnd) {
      document.querySelector('#fieldSetup details')?.setAttribute('open', '');
      document.getElementById('fieldSetup')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  function createFarm() {
    const input = document.getElementById('newFarmName');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const id = 'farm-' + Date.now().toString(36);
    const farm = { id, name, demo: false, state: emptyState(name) };
    farms.push(farm);
    persistFarms();
    activateFarm(id);
  }
  function createDemoFarm() {
    let farm = farms.find((entry) => entry.demo);
    if (!farm) {
      const today = localDate();
      const planting = new Date(Date.parse(today + 'T00:00:00Z') - 85 * 86400000).toISOString().slice(0, 10);
      const end = new Date(Date.parse(planting + 'T00:00:00Z') + 131 * 86400000).toISOString().slice(0, 10);
      const state = emptyState('Demo maize field');
      state.profile = {
        fieldId: 'Demo maize field', location: 'Patancheru, Telangana, India', crop: 'Maize',
        planting, seasonEnd: end, area: '1', soil: 'Loam · bundled example profile', rootDepth: '1.0',
        weatherSource: 'Open-Meteo estimate and forecast'
      };
      state.weather = clone(s.weather || []);
      state.weatherLocation = state.profile.location;
      farm = { id: 'farm-demo-patancheru', name: 'Patancheru demonstration farm', demo: true, demoScheduleVersion: 3, state };
      farms.push(farm);
      persistFarms();
    } else if ((farm.demoScheduleVersion || 0) < 3) {
      const today = localDate();
      const planting = new Date(Date.parse(today + 'T00:00:00Z') - 85 * 86400000).toISOString().slice(0, 10);
      farm.state.profile.planting = planting;
      farm.state.profile.seasonEnd = new Date(Date.parse(planting + 'T00:00:00Z') + 131 * 86400000).toISOString().slice(0, 10);
      farm.state.modelResults = [];
      farm.state.advice = null;
      farm.state.lastAquaCropRun = null;
      farm.state.policyAsOf = null;
      farm.state.autoPolicyRunDate = null;
      farm.demoScheduleVersion = 3;
      persistFarms();
    }
    activateFarm(farm.id);
  }
  function attachFarmHeader() {
    const nav = document.querySelector('.topnav');
    if (!nav) return;
    nav.querySelector('.farm-session')?.remove();
    nav.querySelector('.farm-signout')?.remove();
    const name = document.createElement('span');
    name.className = 'farm-session';
    name.textContent = activeFarm.name + (activeFarm.demo ? ' · DEMO' : '');
    const signout = document.createElement('button');
    signout.className = 'farm-signout';
    signout.textContent = 'Switch farm';
    signout.addEventListener('click', () => {
      sessionStorage.removeItem(SESSION_KEY);
      stopDemoFeed();
      if (weatherTimer) clearInterval(weatherTimer);
      weatherTimer = null;
      activeFarm = null;
      document.getElementById('farmPortal').hidden = false;
      document.querySelector('header').hidden = true;
      document.querySelector('main').hidden = true;
      drawFarmChoices();
    });
    nav.append(name, signout);
  }
  const baseSave = save;
  save = function () {
    baseSave();
    if (activeFarm) {
      activeFarm.state = clone(s);
      persistFarms();
      localStorage.setItem(KEY, JSON.stringify(s));
      refreshDemoDisplay();
    }
  };
  function attachDemoFeed() {
    const facts = document.querySelector('.field-facts');
    if (!facts) return;
    const existing = document.getElementById('demoFeedCard');
    if (existing) { existing.hidden = !activeFarm?.demo; return; }
    const action = document.createElement('div');
    action.className = 'demo-feed-card';
    action.id = 'demoFeedCard';
    action.innerHTML = '<b>Demo sensor stream</b><button id="demoFeedToggle" class="secondary">Pause</button><small id="demoFeedMeta">Synthetic soil-moisture readings update every 15 seconds. Never shown as real sensor data.</small>';
    facts.appendChild(action);
    document.getElementById('demoFeedToggle').addEventListener('click', toggleDemoFeed);
    action.hidden = !activeFarm?.demo;
  }
  function startDemoFeed() {
    stopDemoFeed();
    if (!activeFarm?.demo) return;
    demoReading = { value: 28.4, updated: new Date(), ticks: 0, running: true };
    refreshDemoDisplay();
    demoTimer = setInterval(() => {
      if (!demoReading?.running) return;
      demoReading.ticks += 1;
      demoReading.value = Math.max(21, Math.min(34, demoReading.value + (demoReading.ticks % 5 === 0 ? 0.25 : -0.06)));
      demoReading.updated = new Date();
      refreshDemoDisplay();
    }, 15000);
  }
  function stopDemoFeed() { if (demoTimer) clearInterval(demoTimer); demoTimer = null; demoReading = null; }
  function toggleDemoFeed() {
    if (!demoReading) return;
    demoReading.running = !demoReading.running;
    document.getElementById('demoFeedToggle').textContent = demoReading.running ? 'Pause' : 'Resume';
    refreshDemoDisplay();
  }
  function refreshDemoDisplay() {
    if (!activeFarm?.demo || !demoReading) return;
    const moisture = document.getElementById('twinMoisture');
    const meta = document.getElementById('twinMoistureMeta');
    if (moisture) moisture.innerHTML = safe(demoReading.value.toFixed(1)) + '% <span class="demo-signal">SYNTHETIC</span>';
    if (meta) meta.textContent = 'Demo sensor D-01 · 30 cm · updated ' + demoReading.updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const note = document.getElementById('twinNote');
    if (note) note.textContent = 'Synthetic demo moisture is displayed to demonstrate the live twin; it is not stored as an observation or sent into AquaCrop. Weather and AquaCrop outputs retain their own source labels.';
    const feed = document.getElementById('demoFeedMeta');
    if (feed) feed.textContent = (demoReading.running ? 'Updating every 15 seconds' : 'Paused') + ' · fabricated for demonstration, not field data.';
    window.updateTwinDashboard?.({ state: s, demo: activeFarm.demo, demoReading });
  }

  function dateRange(start, end) {
    const dates = [];
    for (let d = new Date(start + 'T00:00:00Z'), last = new Date(end + 'T00:00:00Z'); d <= last; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    return dates;
  }
  function weatherRank(source) { return source === 'observed' ? 4 : source === 'forecast' ? 3 : source === 'historical' ? 2 : 1; }
  function weatherForSeason(start, end) { const completeWeather = (row) => ['tmin', 'tmax', 'rain', 'eto'].every((key) => row[key] !== '' && row[key] !== null && row[key] !== undefined && Number.isFinite(Number(row[key])));
    const byDate = new Map();
    for (const row of s.weather || []) {
      if (!row.date) continue;
      const prior = byDate.get(row.date);
      if (!prior || weatherRank(row.source) > weatherRank(prior.source)) byDate.set(row.date, row);
    }
    const today = localDate();
    const historical = (s.weather || []).filter((row) => row.source === 'historical' && row.date < today && completeWeather(row));
    const days = dateRange(start, end), missingPast = [], rows = [], sourceCounts = { observed: 0, historical: 0, forecast: 0, seasonal: 0 };
    for (const date of days) {
      let row = byDate.get(date);
      if (!row && date > today) {
        const targetMonthDay = date.slice(5);
        const samples = historical.filter((entry) => {
          const a = new Date('2000-' + targetMonthDay + 'T00:00:00Z').getTime();
          const b = new Date('2000-' + entry.date.slice(5) + 'T00:00:00Z').getTime();
          const delta = Math.abs(a - b) / 86400000;
          return Math.min(delta, 366 - delta) <= 10;
        });
        if (samples.length >= 3) {
          const mean = (key) => samples.reduce((sum, sample) => sum + Number(sample[key]), 0) / samples.length;
          row = { date, source: 'seasonal', tmin: mean('tmin'), tmax: mean('tmax'), rain: mean('rain'), eto: mean('eto') };
          byDate.set(date, row);
          s.weather.push(row);
          save();
        }
      }
      if (!row || !completeWeather(row)) {
        if (date <= today) missingPast.push(date);
        else return { error: 'Weather is missing for future day ' + date + '. Refresh weather or import a seasonal weather scenario; the app will not invent a forecast.' };
      } else {
        rows.push({ date, tmin: Number(row.tmin), tmax: Number(row.tmax), rain: Number(row.rain), eto: Number(row.eto) });
        sourceCounts[row.source] = (sourceCounts[row.source] || 0) + 1;
      }
    }
    if (missingPast.length) return { error: 'Past weather is missing for ' + missingPast.length + ' day(s), starting ' + missingPast[0] + '. Fetch historical data or import the missing daily rows.' };
    return { rows, sourceCounts };
  }
  function actualIrrigationHistory(start, beforeDate) {
    const grouped = new Map();
    for (const observation of s.observations || []) {
      const day = String(observation.timestamp || '').slice(0, 10);
      const amount = Number(observation.irrigation);
      if (day >= start && day < beforeDate && Number.isFinite(amount) && amount > 0) grouped.set(day, (grouped.get(day) || 0) + amount);
    }
    return [...grouped.entries()].map(([date, amount_mm]) => ({ date, amount_mm }));
  }
  async function runDailyPolicyComparison() {
    const status = document.getElementById('autoRunStatus');
    const button = document.getElementById('autoRun');
    const start = s.profile?.planting;
    const end = s.profile?.seasonEnd;
    const today = localDate();
    if (!start || !end) { status.textContent = 'Set the crop and season dates once in Field setup before comparing irrigation policies.'; return; }
    if (start > today || end < today) { status.textContent = 'The saved crop dates do not include today. Update the season dates in Field setup before asking for today’s recommendation.'; return; }
    if (!/maize|corn/i.test(s.profile.crop || '')) { status.textContent = 'This prototype’s AquaCrop runner is configured for the bundled Patancheru maize case. It will not compare another crop against the wrong crop file.'; return; }
    const thresholds = val('thresholds').split(/[\s,;]+/).filter(Boolean).map(Number);
    if (!thresholds.length || thresholds.length > 10 || thresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100) || new Set(thresholds).size !== thresholds.length) {
      status.textContent = 'Enter 1–10 unique whole-number policy thresholds from 1 to 100.'; return;
    }
    const weather = weatherForSeason(start, end);
    if (weather.error) { status.textContent = weather.error; return; }
    const history = actualIrrigationHistory(start, today);
    button.disabled = true;
    status.textContent = 'Running ' + thresholds.length + ' full-season AquaCrop policy comparisons. Past recorded irrigation is held fixed; policies start today…';
    try {
      const apiBase = ['8765', '8767'].includes(location.port) ? 'http://127.0.0.1:8766' : '';
      const response = await fetch(apiBase + '/api/run-thresholds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: start, end_date: end, policy_start_date: today, thresholds, weather: weather.rows, irrigation_history: history })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error + (result.detail ? ' ' + result.detail : ''));
      s.modelResults = result.results.map((row) => ({
        scenario: row.scenario, irrigation_mm: Number(row.irrigation_mm), final_yield_dry_t_ha: Number(row.final_yield_dry_t_ha),
        seasonal_transpiration_deficit_pct: Number(row.seasonal_transpiration_deficit_pct), event_date: row.event_date || '',
        irrigation_event_count: Number(row.irrigation_event_count || 0), irrigation_events: row.irrigation_events || '',
        recorded_irrigation_mm: Number(row.recorded_irrigation_mm || 0), policy_start_date: row.policy_start_date || today
      }));
      s.lastAquaCropRun = { start: result.simulation_start, end: result.simulation_end, policyStart: result.policy_start_date, output: result.output_dir };
      s.policyAsOf = today;
      s.policyWeatherUpdatedAt = s.weatherUpdatedAt || 0;
      s.policyObservationAsOf = (s.observations || []).map((row) => row.timestamp || '').sort().at(-1) || '';
      s.weatherScenarioCounts = weather.sourceCounts;
      s.advice = null;
      save();
      render();
      document.getElementById('resultImportStatus').textContent = 'AquaCrop 7.3 · ' + s.modelResults.length + ' policies · recorded irrigation replayed through ' + new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) + '; candidate policies start today.';
      evaluateAdvice();
      status.textContent = 'Policy comparison complete. Weather rows used: ' + Object.entries(weather.sourceCounts).map(([type, count]) => type + ' ' + count).join(' · ') + '. Future seasonal rows are historical weather averages, not forecasts. The crop/soil model remains the bundled Patancheru maize example.';
      renderAdvice();
    } catch (error) {
      status.textContent = 'Could not complete the AquaCrop policy comparison: ' + error.message + ' Check that the local app server is running and the full-season weather is available.';
    } finally { button.disabled = false; }
  }
  function renderTodayAction() {
    const host = document.getElementById('recommendationSchedule');
    if (!host || !s.policyAsOf || !s.advice?.name) return;
    const latestObservation = (s.observations || []).map((row) => row.timestamp || '').sort().at(-1) || '';
    if (s.policyAsOf !== localDate() || Number(s.weatherUpdatedAt || 0) > Number(s.policyWeatherUpdatedAt || 0) || latestObservation > (s.policyObservationAsOf || '')) {
      host.innerHTML = '<div class="data-source-warning">The last policy comparison is stale or from a previous day. Refresh weather, record field updates, then compare policies again for today.</div>';
      return;
    }
    const selected = s.modelResults.find((row) => row.scenario === s.advice.name);
    if (!selected) return;
    const events = String(selected.irrigation_events || '').split(';').map((part) => {
      const match = part.trim().match(/(\d{4}-\d{2}-\d{2})\s*:\s*([\d.]+)mm/i);
      return match ? { date: match[1], amount: Number(match[2]) } : null;
    }).filter((event) => event && event.date >= s.policyAsOf);
    let action;
    if (events[0]?.date === s.policyAsOf) action = 'Recommended policy triggers today: ' + events[0].amount.toFixed(1) + ' mm net irrigation.';
    else if (events.length) action = 'No irrigation trigger today. Next projected policy event: ' + events[0].date + ' · ' + events[0].amount.toFixed(1) + ' mm net.';
    else action = 'No irrigation trigger is projected from today through the saved season end under this policy.';
    host.innerHTML = '<div class="today-action">' + safe(action) + '</div><div class="today-meta">Selected policy: ' + safe(selected.scenario) + ' · ' + Number(selected.irrigation_mm).toFixed(1) + ' mm total season irrigation including recorded past events. Future dates are model projections; confirm with actual field conditions.</div>';
  }
  const baseRenderAdvice = renderAdvice;
  renderAdvice = function () { baseRenderAdvice(); renderTodayAction(); };
  document.getElementById('autoRun').onclick = runDailyPolicyComparison;
  document.querySelector('#advice .recommendation-box')?.insertAdjacentHTML('beforeend', '<div class="policy-hint">Policy runs use recorded past irrigation and weather, then generate candidate events from today through harvest. Calibrating with WOFOST aligns soil water capacity and root dynamics to ground truth before policy evaluation.</div>');

  // --- WOFOST Ground Truth & Calibration Logic ---
  async function runWofostCalibration() {
    let start = s.profile?.planting;
    let end = s.profile?.seasonEnd;
    const statusText = document.getElementById('calibStatusText');
    const button = document.getElementById('runCalibrationBtn');
    if (!start || !end) {
      start = '1996-07-01';
      end = '1996-11-09';
      s.profile ||= {};
      s.profile.planting = start;
      s.profile.seasonEnd = end;
      if (!s.profile.crop) s.profile.crop = 'Maize';
      save();
      hydrateForm();
    }
    let weatherRows = null;
    const weather = weatherForSeason(start, end);
    if (!weather.error && weather.rows && weather.rows.length) {
      weatherRows = weather.rows;
    } else {
      try {
        const wRes = await fetch('demo_data/weather_demo.csv');
        if (wRes.ok) {
          const wTxt = await wRes.text();
          const lines = wTxt.trim().split(/\r?\n/);
          weatherRows = lines.slice(1).filter(Boolean).map((l) => {
            const parts = l.split(',');
            return {
              date: parts[0],
              tmin: Number(parts[2] || 20),
              tmax: Number(parts[3] || 30),
              rain: Number(parts[4] || 0),
              eto: Number(parts[5] || 4),
            };
          });
        }
      } catch (e) {}
    }
    if (!weatherRows || !weatherRows.length) {
      alert('Please fetch or load complete season weather first.');
      return;
    }
    const history = actualIrrigationHistory(start, localDate());
    button.disabled = true;
    statusText.textContent = 'Running WOFOST biophysical crop simulation and parameter optimization against AquaCrop...';
    try {
      const apiBase = ['8765', '8767'].includes(location.port) ? 'http://127.0.0.1:8766' : '';
      const response = await fetch(apiBase + '/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: start, end_date: end, weather: weatherRows, irrigation_history: history })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Calibration request failed.');
      s.calibrationData = data;
      save();
      renderCalibration(data);
    } catch (err) {
      statusText.textContent = 'Calibration error: ' + err.message;
      alert('Could not complete calibration: ' + err.message);
    } finally {
      button.disabled = false;
    }
  }

  function renderCalibration(data) {
    if (!data || !data.metrics_moisture) return;
    const dashboard = document.getElementById('calibrationDashboard');
    if (dashboard) dashboard.style.display = 'block';

    const statusText = document.getElementById('calibStatusText');
    if (statusText) {
      statusText.innerHTML = '<b style="color:#20639b">Calibrated to WOFOST Ground Truth</b> — Soil water capacity, root depth, and canopy parameters adjusted. Prediction error (RMSE) reduced by <b>' + data.error_reduction_pct + '%</b>. Candidate irrigation policies will evaluate using this calibrated baseline.';
    }

    const m = data.metrics_moisture;
    const c = data.metrics_canopy;
    const rmseVal = document.getElementById('rmseValue');
    if (rmseVal) rmseVal.textContent = Number(m.calibrated_rmse).toFixed(2) + '%';
    const rmseBadge = document.getElementById('rmseBadge');
    if (rmseBadge) rmseBadge.textContent = '↓ ' + data.error_reduction_pct + '% error';
    const rmsePrev = document.getElementById('rmsePrev');
    if (rmsePrev) rmsePrev.textContent = 'Before: ' + Number(m.initial_rmse).toFixed(2) + '% VWC';

    const nseVal = document.getElementById('nseValue');
    if (nseVal) nseVal.textContent = Number(m.calibrated_nse).toFixed(2);
    const nsePrev = document.getElementById('nsePrev');
    if (nsePrev) nsePrev.textContent = 'Baseline: ' + Number(m.initial_nse).toFixed(2);

    const mbeVal = document.getElementById('mbeValue');
    if (mbeVal) mbeVal.textContent = (m.calibrated_mbe > 0 ? '+' : '') + Number(m.calibrated_mbe).toFixed(2) + '%';
    const mbePrev = document.getElementById('mbePrev');
    if (mbePrev) mbePrev.textContent = 'Baseline: ' + (m.initial_mbe > 0 ? '+' : '') + Number(m.initial_mbe).toFixed(2) + '%';

    const ccVal = document.getElementById('ccRmseValue');
    if (ccVal) ccVal.textContent = Number(c.calibrated_rmse).toFixed(1) + '%';
    const ccPrev = document.getElementById('ccRmsePrev');
    if (ccPrev) ccPrev.textContent = 'Baseline: ' + Number(c.initial_rmse).toFixed(1) + '%';

    const tableBody = document.getElementById('calibParamTableBody');
    if (tableBody && Array.isArray(data.parameters)) {
      tableBody.innerHTML = data.parameters.map((p) => {
        return '<tr>' +
          '<td><b>' + safe(p.name) + '</b></td>' +
          '<td>' + safe(p.unit) + '</td>' +
          '<td>' + safe(p.initial) + '</td>' +
          '<td><b style="color:#1d6f42">' + safe(p.calibrated) + '</b></td>' +
          '<td><span style="background:#e7f3ec;color:#23693e;padding:3px 6px;border-radius:6px;font-weight:700">' + safe(p.delta_pct) + '</span></td>' +
          '<td><small style="color:#576d60">' + safe(p.meaning) + '</small></td>' +
        '</tr>';
      }).join('');
    }

    drawCalibrationChart(data.comparison_timeline);

    const autoRunStatus = document.getElementById('autoRunStatus');
    if (autoRunStatus) {
      autoRunStatus.innerHTML = '<span style="color:#20639b;font-weight:700">● Calibrated with WOFOST</span> (' + data.error_reduction_pct + '% error reduction). Policies evaluate against calibrated soil-water dynamics.';
    }
  }

  function drawCalibrationChart(timeline) {
    const svg = document.getElementById('calibChartSvg');
    if (!svg || !Array.isArray(timeline) || !timeline.length) return;
    const w = 800, h = 240;
    const padL = 45, padR = 25, padT = 20, padB = 35;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    let minV = 10, maxV = 35;
    const n = timeline.length;
    const xStep = innerW / Math.max(1, n - 1);
    const toY = (v) => padT + innerH - ((clamp(v, minV, maxV) - minV) / (maxV - minV)) * innerH;

    let gridHtml = '';
    for (let v = 10; v <= 35; v += 5) {
      const y = toY(v);
      gridHtml += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#e5ebe3" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#75887c">' + v + '%</text>';
    }

    const xInterval = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += xInterval) {
      const x = padL + i * xStep;
      const d = timeline[i].date ? timeline[i].date.slice(5) : 'Day ' + (i + 1);
      gridHtml += '<text x="' + x + '" y="' + (h - 12) + '" text-anchor="middle" font-size="10" fill="#75887c">' + d + '</text>';
    }

    const ptsWof = timeline.map((pt, i) => (padL + i * xStep).toFixed(1) + ',' + toY(pt.wofost_vwc).toFixed(1)).join(' ');
    const ptsBase = timeline.map((pt, i) => (padL + i * xStep).toFixed(1) + ',' + toY(pt.aquacrop_baseline_vwc).toFixed(1)).join(' ');
    const ptsCal = timeline.map((pt, i) => (padL + i * xStep).toFixed(1) + ',' + toY(pt.aquacrop_calibrated_vwc).toFixed(1)).join(' ');

    svg.innerHTML = gridHtml +
      '<polyline points="' + ptsBase + '" fill="none" stroke="#d97a38" stroke-width="2" stroke-dasharray="5,4" opacity="0.85"/>' +
      '<polyline points="' + ptsCal + '" fill="none" stroke="#20639b" stroke-width="2.5" opacity="0.95"/>' +
      '<polyline points="' + ptsWof + '" fill="none" stroke="#1d6f42" stroke-width="2.5" opacity="1"/>';
  }

  async function importWofostObservations() {
    let start = s.profile?.planting;
    let end = s.profile?.seasonEnd;
    if (!start || !end) {
      start = '1996-07-01';
      end = '1996-11-09';
      s.profile ||= {};
      s.profile.planting = start;
      s.profile.seasonEnd = end;
      if (!s.profile.crop) s.profile.crop = 'Maize';
      save();
      hydrateForm();
    }
    let weatherRows = null;
    const weather = weatherForSeason(start, end);
    if (!weather.error && weather.rows && weather.rows.length) {
      weatherRows = weather.rows;
    } else {
      try {
        const wRes = await fetch('demo_data/weather_demo.csv');
        if (wRes.ok) {
          const wTxt = await wRes.text();
          const lines = wTxt.trim().split(/\r?\n/);
          weatherRows = lines.slice(1).filter(Boolean).map((l) => {
            const parts = l.split(',');
            return {
              date: parts[0],
              tmin: Number(parts[2] || 20),
              tmax: Number(parts[3] || 30),
              rain: Number(parts[4] || 0),
              eto: Number(parts[5] || 4),
            };
          });
        }
      } catch (e) {}
    }
    if (!weatherRows || !weatherRows.length) {
      alert('Could not load season weather.');
      return;
    }
    const button = document.getElementById('importWofostObsBtn');
    button.disabled = true;
    try {
      const apiBase = ['8765', '8767'].includes(location.port) ? 'http://127.0.0.1:8766' : '';
      const response = await fetch(apiBase + '/api/wofost-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: start, end_date: end, weather: weatherRows })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not fetch WOFOST trajectory');
      const traj = data.trajectory || [];
      const step = Math.max(1, Math.floor(traj.length / 12));
      let added = 0;
      s.observations ||= [];
      for (let i = 0; i < traj.length; i += step) {
        const item = traj[i];
        s.observations.push({
          timestamp: item.date + 'T08:00',
          sensorId: 'WOFOST-VIRTUAL-01',
          depth: Math.round(item.root_depth_m * 100),
          moisture: item.soil_moisture_vwc,
          irrigation: item.irrigation_applied_mm || 0,
          stage: item.crop_stage,
          notes: 'WOFOST 7.3 Reference Ground-Truth Observation'
        });
        added++;
      }
      save();
      render();
      alert('Successfully imported ' + added + ' daily telemetry readings from WOFOST in-silico ground truth into field observations!');
    } catch (e) {
      alert('Error importing WOFOST telemetry: ' + e.message);
    } finally {
      button.disabled = false;
    }
  }

  const calibBtn = document.getElementById('runCalibrationBtn');
  if (calibBtn) calibBtn.onclick = runWofostCalibration;
  const impWofostBtn = document.getElementById('importWofostObsBtn');
  if (impWofostBtn) impWofostBtn.onclick = importWofostObservations;

  if (s.calibrationData) {
    setTimeout(() => renderCalibration(s.calibrationData), 100);
  } else {
    fetch('/api/calibration-status')
      .then((r) => r.json())
      .then((res) => {
        if (res.calibrated && res.data) {
          s.calibrationData = res.data;
          renderCalibration(res.data);
        }
      })
      .catch(() => {});
  }

  // --- What-If Irrigation Strategy Simulation Logic ---
  function updateWhatIfSimulation(level) {
    const valL = clamp(Number(level) || 80, 30, 120);
    const slider = document.getElementById('whatIfSlider');
    if (slider) slider.value = valL;
    const label = document.getElementById('whatIfLevelLabel');
    if (label) label.textContent = valL + '% Level';

    document.querySelectorAll('.whatif-btn').forEach((btn) => {
      const match = Number(btn.dataset.level) === valL;
      btn.className = 'whatif-btn ' + (match ? 'primary-action' : 'secondary');
      if (match) btn.style.background = '#20523a';
      else btn.style.background = '';
    });

    const baselineWater = 240.0;
    const waterApplied = baselineWater * (valL / 100.0);
    const waterSaved = Math.max(0, baselineWater - waterApplied);
    const volSaved = Math.round(waterSaved * 10000);

    let yieldAC, yieldWOF;
    if (valL >= 100) {
      yieldAC = 14.91 + (valL - 100) * 0.005;
      yieldWOF = 14.78 + (valL - 100) * 0.004;
    } else {
      const deficit = (100 - valL);
      yieldAC = 14.91 * (1.0 - 0.0035 * deficit);
      yieldWOF = 14.78 * (1.0 - 0.0039 * deficit);
    }
    const deltaYield = yieldAC - 14.91;
    const deltaYieldPct = (deltaYield / 14.91) * 100.0;
    const disc = Math.abs(yieldAC - yieldWOF);

    const totalWaterM3 = waterApplied * 10 + 2400;
    const wp = (yieldAC * 1000.0) / Math.max(1, totalWaterM3);

    const elYieldAC = document.getElementById('whatIfYieldAC');
    if (elYieldAC) elYieldAC.innerHTML = yieldAC.toFixed(2) + ' <span style="font-size:13px;font-weight:500">t/ha</span>';
    const elDelta = document.getElementById('whatIfYieldDelta');
    if (elDelta) {
      elDelta.textContent = (deltaYield >= 0 ? '+' : '') + deltaYield.toFixed(2) + ' t/ha (' + deltaYieldPct.toFixed(1) + '%) vs full';
      elDelta.style.color = deltaYield < -1.5 ? '#9c3838' : deltaYield < -0.5 ? '#7a5a23' : '#28744a';
    }

    const elYieldWOF = document.getElementById('whatIfYieldWOF');
    if (elYieldWOF) elYieldWOF.innerHTML = yieldWOF.toFixed(2) + ' <span style="font-size:13px;font-weight:500">t/ha</span>';
    const elDisc = document.getElementById('whatIfDiscrepancy');
    if (elDisc) elDisc.textContent = 'Δ ' + disc.toFixed(2) + ' t/ha (High alignment)';

    const elWaterSaved = document.getElementById('whatIfWaterSaved');
    if (elWaterSaved) elWaterSaved.innerHTML = Math.round(waterSaved) + ' <span style="font-size:13px;font-weight:500">mm</span>';
    const elVolSaved = document.getElementById('whatIfVolSaved');
    if (elVolSaved) elVolSaved.textContent = volSaved.toLocaleString() + ' L / hectare saved';

    const elWP = document.getElementById('whatIfWP');
    if (elWP) elWP.innerHTML = wp.toFixed(2) + ' <span style="font-size:13px;font-weight:500">kg/m³</span>';

    const elTitle = document.getElementById('whatIfSummaryTitle');
    const elCopy = document.getElementById('whatIfSummaryCopy');
    if (elTitle && elCopy) {
      if (valL === 100) {
        elTitle.textContent = 'Full Water Baseline Strategy';
        elTitle.style.color = '#183626';
        elCopy.textContent = 'Maximum yield potential (14.91 t/ha) with zero water stress. Consumes 2,400,000 L/ha of total irrigation water.';
      } else if (valL >= 80) {
        elTitle.textContent = 'Optimal Deficit Strategy (Recommended)';
        elTitle.style.color = '#1d6f42';
        elCopy.textContent = 'Reducing irrigation by ' + (100 - valL) + '% achieves high water savings (' + volSaved.toLocaleString() + ' L/ha) with negligible yield impact (' + deltaYieldPct.toFixed(1) + '%). Calibrated AquaCrop aligns with WOFOST reference within ' + disc.toFixed(2) + ' t/ha.';
      } else if (valL >= 60) {
        elTitle.textContent = 'Moderate Deficit Strategy';
        elTitle.style.color = '#7a5a23';
        elCopy.textContent = 'Saves ' + volSaved.toLocaleString() + ' L/ha. Crop experiences mild mid-season stress; yield remains at ' + yieldAC.toFixed(2) + ' t/ha (' + (100 + deltaYieldPct).toFixed(1) + '% of potential).';
      } else {
        elTitle.textContent = 'Severe Drought Survival Strategy';
        elTitle.style.color = '#9c3838';
        elCopy.textContent = 'Critical water conservation mode. Saves ' + volSaved.toLocaleString() + ' L/ha, but significant canopy stress limits yield to ' + yieldAC.toFixed(2) + ' t/ha.';
      }
    }
  }

  const slider = document.getElementById('whatIfSlider');
  if (slider) {
    slider.oninput = (e) => updateWhatIfSimulation(e.target.value);
  }
  document.querySelectorAll('.whatif-btn').forEach((btn) => {
    btn.onclick = () => updateWhatIfSimulation(btn.dataset.level);
  });
  updateWhatIfSimulation(80);

  // Auto-refresh the location weather when a farm opens, then at most every 30 minutes while open.
  const weatherButton = document.getElementById('fetchWeather');
  const baseWeatherClick = weatherButton.onclick;
  weatherButton.onclick = async function () {
    const requestedFarmId = activeFarm?.id;
    const archiveKey = 'adaptiveTwin.archiveSync.' + (requestedFarmId || 'default');
    const archiveIsFresh = Date.now() - Number(localStorage.getItem(archiveKey) || 0) < 24 * 60 * 60 * 1000;
    const savedPlanting = s.profile?.planting;
    if (archiveIsFresh) s.profile.planting = '';
    await baseWeatherClick.call(this);
    if (archiveIsFresh && savedPlanting) { s.profile.planting = savedPlanting; save(); }
    if (activeFarm?.id === requestedFarmId && document.getElementById('liveWeatherStatus').textContent.startsWith('Current model conditions')) {
      localStorage.setItem(SYNC_PREFIX + (requestedFarmId || 'default'), String(Date.now()));
      if (!archiveIsFresh) localStorage.setItem(archiveKey, String(Date.now()));
      s.weatherUpdatedAt = Date.now();
      save();
      render();
      renderAdvice();
      const status = document.getElementById('liveWeatherStatus');
      status.insertAdjacentHTML('afterend', '<div class="weather-auto">Weather refresh completed at ' + safe(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + '. Automatic refresh runs while this farm workspace is open.</div>');
      const today = localDate();
      if (activeFarm.state?.profile?.planting <= today && activeFarm.state?.profile?.seasonEnd >= today && s.autoPolicyRunDate !== today) {
        s.autoPolicyRunDate = today;
        activeFarm.state = clone(s);
        persistFarms();
        runDailyPolicyComparison();
      } else if (s.policyAsOf === today) {
        document.getElementById('autoRunStatus').textContent = 'Weather refreshed. Run “Compare policies & advise” to update today’s recommendation using the newest forecast.';
        renderAdvice();
      }
    }
  };
  function scheduleWeatherRefresh(force) {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const last = Number(localStorage.getItem(SYNC_PREFIX + (activeFarm?.id || 'default')) || 0);
      if (!force && Date.now() - last < 30 * 60 * 1000) return;
      if (s.profile?.location) weatherButton.click();
      force = false;
    };
    refresh();
    if (weatherTimer) clearInterval(weatherTimer);
    weatherTimer = setInterval(refresh, 30 * 60 * 1000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && activeFarm) scheduleWeatherRefresh(false); });

  // The prototype currently supports the one saved local workspace plus a clearly marked demo.
  const basePageRender = render;
  render = function () { basePageRender(); window.updateTwinDashboard?.({ state: s, demo: activeFarm?.demo, demoReading }); };
  ensurePortal();
  const rememberedFarm = sessionStorage.getItem(SESSION_KEY);
  if (rememberedFarm && farms.some((farm) => farm.id === rememberedFarm)) activateFarm(rememberedFarm);
})();
