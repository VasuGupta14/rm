import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  FieldProfile,
  Observation,
  WeatherDay,
  SimulationResult,
  CalibrationData,
  fetchCalibrationStatus,
  runCalibration,
  runThresholds,
  fetchLiveWeather,
} from './api';
import profilesData from './profilesData.json';

export interface FieldProfileEntry {
  id: string;
  name: string;
  description: string;
  profile: FieldProfile;
  weatherLocation: string;
  weather: WeatherDay[];
  observations: Observation[];
  thresholds: number[];
  waterLimit: number;
  stressLimit: number;
  yieldTarget: number;
  currentDayNumber: number;
  totalDays: number;
  stageName: string;
  healthScore: number;
  calibration: CalibrationData | null;
}

export interface AppState {
  currentProfileId: string;
  profiles: Record<string, FieldProfileEntry>;
  isBackendConnected: boolean;
  isLoading: boolean;
  statusMessage: string;
  modelResults: SimulationResult[];
  lastRunInfo: {
    simulation_start: string;
    simulation_end: string;
    output_dir: string;
    mode: string;
  } | null;
}

const STORAGE_KEY = 'agritwin.unified.v2_profiles';

interface AppContextType {
  state: AppState;
  activeProfile: FieldProfileEntry;
  switchProfile: (profileId: string) => void;
  setCurrentDayNumber: (day: number) => void;
  updateProfileDetails: (p: Partial<FieldProfile>) => void;
  addObservation: (obs: Observation) => void;
  importObservations: (rows: Observation[]) => void;
  clearObservations: () => void;
  addWeatherRow: (row: WeatherDay) => void;
  importWeather: (rows: WeatherDay[]) => void;
  fetchWeatherForecast: (place: string) => Promise<void>;
  triggerCalibration: () => Promise<void>;
  importWofostTelemetryToReadings: () => void;
  triggerSimulation: (thresholds?: number[]) => Promise<void>;
  updateSettings: (settings: { waterLimit?: number; stressLimit?: number; yieldTarget?: number }) => void;
  resetAll: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          isBackendConnected: false,
          isLoading: false,
          statusMessage: 'Ready',
        };
      } catch {}
    }

    return {
      currentProfileId: 'north_maize',
      profiles: profilesData as unknown as Record<string, FieldProfileEntry>,
      isBackendConnected: false,
      isLoading: false,
      statusMessage: 'Ready',
      modelResults: [],
      lastRunInfo: null,
    };
  });

  const activeProfile = state.profiles[state.currentProfileId] || state.profiles['north_maize'] || Object.values(state.profiles)[0];

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        currentProfileId: state.currentProfileId,
        profiles: state.profiles,
        modelResults: state.modelResults,
        lastRunInfo: state.lastRunInfo,
      })
    );
  }, [state.currentProfileId, state.profiles, state.modelResults, state.lastRunInfo]);

  // Initial check of backend health & calibration
  useEffect(() => {
    fetchCalibrationStatus()
      .then((res) => {
        setState((prev) => ({
          ...prev,
          isBackendConnected: true,
        }));
      })
      .catch(() => {
        setState((prev) => ({
          ...prev,
          isBackendConnected: false,
        }));
      });
  }, []);

  const switchProfile = (profileId: string) => {
    if (state.profiles[profileId]) {
      setState((prev) => ({
        ...prev,
        currentProfileId: profileId,
        modelResults: [],
        lastRunInfo: null,
        statusMessage: `Switched active field to ${prev.profiles[profileId].name}`,
      }));
    }
  };

  const setCurrentDayNumber = (day: number) => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const totalDays = Math.max(1, cur.totalDays || 132);
      const currentDayNumber = Math.min(totalDays, Math.max(1, Math.round(day)));
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [prev.currentProfileId]: { ...cur, currentDayNumber },
        },
      };
    });
  };

  const updateProfileDetails = (p: Partial<FieldProfile>) => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const updated: FieldProfileEntry = {
        ...cur,
        profile: { ...cur.profile, ...p },
        name: p.fieldId ? p.fieldId : cur.name,
      };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
      };
    });
  };

  const addObservation = (obs: Observation) => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const updated: FieldProfileEntry = {
        ...cur,
        observations: [...cur.observations, obs],
      };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
      };
    });
  };

  const importObservations = (rows: Observation[]) => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const updated: FieldProfileEntry = {
        ...cur,
        observations: [...cur.observations, ...rows],
      };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
      };
    });
  };

  const clearObservations = () => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const updated: FieldProfileEntry = {
        ...cur,
        observations: [],
      };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
      };
    });
  };

  const addWeatherRow = (row: WeatherDay) => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const idx = cur.weather.findIndex((w) => w.date === row.date);
      const next = [...cur.weather];
      if (idx >= 0) next[idx] = row;
      else next.push(row);
      const updated: FieldProfileEntry = { ...cur, weather: next };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
      };
    });
  };

  const importWeather = (rows: WeatherDay[]) => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const map = new Map(cur.weather.map((w) => [w.date, w]));
      rows.forEach((r) => map.set(r.date, r));
      const sorted = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
      const updated: FieldProfileEntry = { ...cur, weather: sorted };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
      };
    });
  };

  const fetchWeatherForecast = async (place: string) => {
    setState((prev) => ({ ...prev, isLoading: true, statusMessage: `Fetching weather for ${place}...` }));
    try {
      const res = await fetchLiveWeather(place, activeProfile.profile.planting);
      importWeather(res.rows);
      setState((prev) => {
        const cur = prev.profiles[prev.currentProfileId];
        const updated: FieldProfileEntry = {
          ...cur,
          weatherLocation: res.placeName || place,
        };
        return {
          ...prev,
          profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
          isLoading: false,
          statusMessage: `Loaded ${res.rows.length} weather days for ${res.placeName}`,
        };
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        statusMessage: `Weather fetch error: ${err.message}`,
      }));
      throw err;
    }
  };

  const triggerCalibration = async () => {
    setState((prev) => ({ ...prev, isLoading: true, statusMessage: 'Running WOFOST biophysical recalibration...' }));
    try {
      const res = await runCalibration({
        start_date: activeProfile.profile.planting,
        end_date: activeProfile.profile.seasonEnd,
        weather: activeProfile.weather,
      });
      setState((prev) => {
        const cur = prev.profiles[prev.currentProfileId];
        const updated: FieldProfileEntry = { ...cur, calibration: res };
        return {
          ...prev,
          profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
          isLoading: false,
          statusMessage: `Calibration complete: Error reduced by ${res.error_reduction_pct.toFixed(1)}% (NSE: ${res.calibrated_metrics.nse_vwc.toFixed(2)})`,
        };
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        statusMessage: `Calibration error: ${err.message}`,
      }));
      throw err;
    }
  };

  const importWofostTelemetryToReadings = () => {
    if (!activeProfile.calibration?.comparison_timeline) return;
    const timeline = activeProfile.calibration.comparison_timeline;
    const plantingDate = new Date(`${activeProfile.profile.planting}T00:00:00Z`);

    const newObs: Observation[] = timeline.map((item, index) => {
      const d = new Date(plantingDate);
      d.setDate(d.getDate() + index);
      const isoDate = d.toISOString().slice(0, 10);
      return {
        timestamp: `${isoDate}T08:00:00`,
        sensorId: 'WOFOST-IN-SILICO',
        depth: 30,
        moisture: item.wofost_vwc.toFixed(1),
        irrigation: 0,
        stage: activeProfile.stageName,
        notes: 'Imported from WOFOST ground truth simulation',
      };
    });

    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      const updated: FieldProfileEntry = {
        ...cur,
        observations: newObs,
      };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
        statusMessage: `Imported ${newObs.length} WOFOST telemetry points into field readings.`,
      };
    });
  };

  const triggerSimulation = async (thresholds?: number[]) => {
    const list = thresholds || activeProfile.thresholds;
    setState((prev) => ({ ...prev, isLoading: true, statusMessage: `Simulating ${list.length} irrigation policies...` }));
    try {
      const history = activeProfile.observations
        .filter((o) => Number(o.irrigation) > 0)
        .map((o) => ({
          date: String(o.timestamp).slice(0, 10),
          amount_mm: Number(o.irrigation),
        }));

      const res = await runThresholds({
        start_date: activeProfile.profile.planting,
        end_date: activeProfile.profile.seasonEnd,
        thresholds: list,
        weather: activeProfile.weather,
        irrigation_history: history,
      });

      setState((prev) => ({
        ...prev,
        modelResults: res.results,
        lastRunInfo: {
          simulation_start: res.simulation_start,
          simulation_end: res.simulation_end,
          output_dir: res.output_dir,
          mode: res.mode,
        },
        isLoading: false,
        statusMessage: `Comparison finished for ${res.results.length} scenarios.`,
      }));
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        statusMessage: `Simulation error: ${err.message}`,
      }));
      throw err;
    }
  };

  const updateSettings = (settings: { waterLimit?: number; stressLimit?: number; yieldTarget?: number }) => {
    setState((prev) => {
      const cur = prev.profiles[prev.currentProfileId];
      if (!cur) return prev;
      const updated: FieldProfileEntry = {
        ...cur,
        ...settings,
      };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.currentProfileId]: updated },
      };
    });
  };

  const resetAll = () => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      currentProfileId: 'north_maize',
      profiles: profilesData as unknown as Record<string, FieldProfileEntry>,
      isBackendConnected: false,
      isLoading: false,
      statusMessage: 'Reset to initial field profiles',
      modelResults: [],
      lastRunInfo: null,
    });
  };

  return (
    <AppContext.Provider
      value={{
    state,
    activeProfile,
    switchProfile,
    setCurrentDayNumber,
        updateProfileDetails,
        addObservation,
        importObservations,
        clearObservations,
        addWeatherRow,
        importWeather,
        fetchWeatherForecast,
        triggerCalibration,
        importWofostTelemetryToReadings,
        triggerSimulation,
        updateSettings,
        resetAll,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
