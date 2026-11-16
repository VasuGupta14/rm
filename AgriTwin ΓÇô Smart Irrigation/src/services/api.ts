export interface WeatherDay {
  date: string;
  source: string;
  tmin: string | number;
  tmax: string | number;
  rain: string | number;
  eto: string | number;
}

export interface Observation {
  timestamp: string;
  sensorId?: string;
  depth?: string | number;
  moisture?: string | number;
  irrigation?: string | number;
  stage?: string;
  notes?: string;
}

export interface FieldProfile {
  fieldId: string;
  location: string;
  crop: string;
  planting: string;
  seasonEnd: string;
  area: string;
  soil: string;
  rootDepth: string;
  weatherSource: string;
}

export interface SimulationResult {
  scenario: string;
  irrigation_mm: number;
  final_yield_dry_t_ha: number;
  seasonal_transpiration_deficit_pct: number;
  event_date?: string;
  irrigation_event_count?: number;
  irrigation_events?: string;
  recorded_irrigation_mm?: number;
  policy_start_date?: string;
}

export interface ParameterItem {
  name: string;
  unit: string;
  initial: number;
  calibrated: number;
  delta_pct: string;
  meaning: string;
}

export interface TimelineItem {
  date: string;
  dap: number;
  wofost_vwc: number;
  aquacrop_baseline_vwc: number;
  aquacrop_calibrated_vwc: number;
  wofost_cc: number;
  aquacrop_baseline_cc: number;
  aquacrop_calibrated_cc: number;
}

export interface CalibrationData {
  status: string;
  error_reduction_pct: number;
  metrics_moisture: {
    initial_rmse: number;
    calibrated_rmse: number;
    initial_mbe: number;
    calibrated_mbe: number;
    initial_nse: number;
    calibrated_nse: number;
  };
  metrics_canopy?: {
    initial_rmse?: number;
    calibrated_rmse?: number;
    [key: string]: any;
  };
  parameters: ParameterItem[];
  calibrated_parameter_dict: Record<string, number>;
  comparison_timeline: TimelineItem[];
  [key: string]: any;
}

export interface HealthStatus {
  ready: boolean;
  model: string;
  live_engine: boolean;
  wofost_engine: string;
  calibration_active: boolean;
  error_reduction_pct: number;
}

const API_BASE = '';

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return res.json();
}

export async function fetchCalibrationStatus(): Promise<{ calibrated: boolean; data: CalibrationData | null }> {
  const res = await fetch(`${API_BASE}/api/calibration-status`);
  if (!res.ok) throw new Error(`Failed to load calibration status: HTTP ${res.status}`);
  return res.json();
}

export async function runCalibration(payload: {
  start_date: string;
  end_date: string;
  weather?: WeatherDay[];
  irrigation_history?: Array<{ date: string; amount_mm: number }>;
}): Promise<CalibrationData> {
  const res = await fetch(`${API_BASE}/api/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Calibration failed with status ${res.status}`);
  }
  return res.json();
}

export async function runWofostReference(payload: {
  start_date: string;
  end_date: string;
  weather?: WeatherDay[];
  irrigation_history?: Array<{ date: string; amount_mm: number }>;
}): Promise<{ reference_source: string; total_days: number; trajectory: any[] }> {
  const res = await fetch(`${API_BASE}/api/wofost-reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `WOFOST simulation failed: status ${res.status}`);
  }
  return res.json();
}

export async function runThresholds(payload: {
  start_date: string;
  end_date: string;
  thresholds: number[];
  weather?: WeatherDay[];
  irrigation_history?: Array<{ date: string; amount_mm: number }>;
  policy_start_date?: string;
}): Promise<{
  results: SimulationResult[];
  output_dir: string;
  simulation_start: string;
  simulation_end: string;
  policy_start_date: string;
  recorded_irrigation_events: number;
  mode: string;
  calibrated_with_wofost: boolean;
  error_reduction_pct?: number;
}> {
  const res = await fetch(`${API_BASE}/api/run-thresholds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Simulation run failed: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchLiveWeather(place: string, plantingDate?: string): Promise<{
  placeName: string;
  current: {
    temp: number;
    humidity: number;
    precipitation: number;
    time: string;
    timezone: string;
  };
  rows: WeatherDay[];
}> {
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) throw new Error(`Location lookup failed (HTTP ${geoRes.status})`);
  const geo = await geoRes.json();
  const loc = geo.results?.[0];
  if (!loc) throw new Error('No matching location found. Please enter a valid place name.');

  const queryBase = {
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    daily: 'temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration',
    timezone: 'auto',
  };

  const queryParams = new URLSearchParams({
    ...queryBase,
    current: 'temperature_2m,relative_humidity_2m,precipitation',
    forecast_days: '16',
  });

  const forecastRes = await fetch(`https://api.open-meteo.com/v1/forecast?${queryParams}`);
  if (!forecastRes.ok) throw new Error(`Forecast request failed (HTTP ${forecastRes.status})`);
  const forecast = await forecastRes.json();
  if (forecast.error || !forecast.daily || !forecast.current) {
    throw new Error(forecast.reason || 'Weather provider returned incomplete forecast data.');
  }

  const rows: WeatherDay[] = [];
  const forecastStart = forecast.daily.time[0];
  const startMs = plantingDate ? Date.parse(`${plantingDate}T00:00:00Z`) : NaN;
  const endMs = Date.parse(`${forecastStart}T00:00:00Z`);
  const days = Number.isFinite(startMs) ? Math.floor((endMs - startMs) / 86400000) : 0;

  if (plantingDate && days > 0 && days <= 730) {
    try {
      const climatologyStart = new Date(endMs - 730 * 86400000).toISOString().slice(0, 10);
      const histParams = new URLSearchParams({
        ...queryBase,
        start_date: climatologyStart,
        end_date: new Date(endMs - 86400000).toISOString().slice(0, 10),
      });
      const histRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?${histParams}`);
      if (histRes.ok) {
        const hist = await histRes.json();
        if (hist.daily?.time) {
          for (let i = 0; i < hist.daily.time.length; i++) {
            const tmin = hist.daily.temperature_2m_min?.[i];
            const tmax = hist.daily.temperature_2m_max?.[i];
            const rain = hist.daily.precipitation_sum?.[i];
            const eto = hist.daily.et0_fao_evapotranspiration?.[i];
            if ([tmin, tmax, rain, eto].every(x => Number.isFinite(Number(x)))) {
              rows.push({
                date: hist.daily.time[i],
                source: 'historical',
                tmin: Number(tmin).toFixed(1),
                tmax: Number(tmax).toFixed(1),
                rain: Number(rain).toFixed(1),
                eto: Number(eto).toFixed(2),
              });
            }
          }
        }
      }
    } catch {
      // Historical optional
    }
  }

  for (let i = 0; i < forecast.daily.time.length; i++) {
    const tmin = forecast.daily.temperature_2m_min?.[i];
    const tmax = forecast.daily.temperature_2m_max?.[i];
    const rain = forecast.daily.precipitation_sum?.[i];
    const eto = forecast.daily.et0_fao_evapotranspiration?.[i];
    if ([tmin, tmax, rain, eto].every(x => Number.isFinite(Number(x)))) {
      rows.push({
        date: forecast.daily.time[i],
        source: 'forecast',
        tmin: Number(tmin).toFixed(1),
        tmax: Number(tmax).toFixed(1),
        rain: Number(rain).toFixed(1),
        eto: Number(eto).toFixed(2),
      });
    }
  }

  const where = [loc.name, loc.admin1, loc.country].filter(Boolean).join(', ');
  return {
    placeName: where,
    current: {
      temp: forecast.current.temperature_2m,
      humidity: forecast.current.relative_humidity_2m,
      precipitation: forecast.current.precipitation,
      time: forecast.current.time,
      timezone: forecast.timezone_abbreviation || forecast.timezone,
    },
    rows,
  };
}
