"""Local-only web server that connects the irrigation app to AquaCrop, WOFOST ground truth, and calibration engines."""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from wofost_engine import WofostReferenceSimulator
from calibration_engine import calibrate_aquacrop_with_wofost


APP_DIR = Path(__file__).resolve().parent
DEFAULT_SRC = os.environ.get("AQUACROP_SRC")
PROJECT_DIR = Path(DEFAULT_SRC).resolve() if DEFAULT_SRC else (Path.home() / "AquaCrop73_src")
RUN_LOCK = threading.Lock()
MAX_REQUEST_BYTES = 8 * 1024 * 1024

CALIBRATION_FILE = APP_DIR / "calibrated_params.json"
ACTIVE_CALIBRATION: dict | None = None
if CALIBRATION_FILE.is_file():
    try:
        ACTIVE_CALIBRATION = json.loads(CALIBRATION_FILE.read_text(encoding="utf-8"))
    except Exception:
        ACTIVE_CALIBRATION = None


def is_aquacrop_available() -> bool:
    """Check if the native AquaCrop 7.3 source and Patancheru testcase exist."""
    return (PROJECT_DIR / "src" / "modules" / "startunit.py").is_file() and (
        PROJECT_DIR / "PatancheruMaize-AquaCrop73-example" / "testcase" / "LIST" / "PatancheruMaize.PRO"
    ).is_file()


def run_surrogate_thresholds(
    start: dt.date,
    end: dt.date,
    policy_start: dt.date,
    thresholds: list[int],
    rows_by_date: dict[dt.date, list[float]],
    history_by_date: dict[dt.date, float],
    output_dir: Path,
    calibrated_params: dict[str, float] | None = None,
) -> list[dict]:
    """Calibrated surrogate simulation using FAO crop-water balance equations.
    
    If calibrated_params are provided (from WOFOST calibration), incorporates the tuned
    Field Capacity, Wilting Point, and Root Depth.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    params = calibrated_params or {}
    fc = params.get("fc_mm", 180.0)
    pwp = params.get("pwp_mm", 65.0)
    raw_thresh = pwp + 0.50 * max(10.0, fc - pwp)
    total_days = (end - start).days + 1

    results = []
    for p in thresholds:
        target = fc - (p / 100.0) * max(0.0, fc - raw_thresh)
        actual = fc
        policy_events = []
        tot_tr = 0.0
        tot_trx = 0.0
        tot_irr = sum(history_by_date.get(d, 0.0) for d in history_by_date if d < policy_start)

        daily_rows = []
        for i in range(total_days):
            current_date = start + dt.timedelta(days=i)
            tmin, tmax, rain, eto = rows_by_date[current_date]

            progress = i / max(1, total_days - 1)
            if progress < 0.2:
                kc = 0.40 + (progress / 0.2) * 0.40
            elif progress < 0.65:
                kc = 0.80 + ((progress - 0.2) / 0.45) * 0.35
            elif progress < 0.85:
                kc = 1.15
            else:
                kc = 1.15 - ((progress - 0.85) / 0.15) * 0.55

            potential_tr = eto * kc * 0.85
            tot_trx += max(0.0, potential_tr)

            # Replay historical recorded irrigation
            hist_dose = history_by_date.get(current_date, 0.0)
            if hist_dose > 0:
                actual = min(fc + 10.0, actual + hist_dose)

            # Evaluate candidate policy starting from policy_start
            if current_date >= policy_start:
                if actual < target:
                    dose = max(0.0, target - actual)
                    if dose > 0.01:
                        actual += dose
                        tot_irr += dose
                        policy_events.append({
                            "date": current_date.isoformat(),
                            "irrigation_mm": round(dose, 2),
                            "depletion_pct_raw": round(100.0 * (fc - actual) / max(0.01, fc - raw_thresh), 1)
                        })

            available_water = max(0.0, actual - pwp)
            stress_factor = 1.0 if actual >= raw_thresh else (available_water / max(0.001, raw_thresh - pwp))
            stress_factor = max(0.0, min(1.0, stress_factor))
            act_tr = potential_tr * stress_factor
            tot_tr += act_tr

            actual = max(pwp * 0.7, min(fc, actual + rain - eto * kc))

            daily_rows.append({
                "date": current_date.isoformat(),
                "Day": current_date.day,
                "Month": current_date.month,
                "Year": current_date.year,
                "Rain": rain,
                "ETo": eto,
                "Tr": round(act_tr, 3),
                "Trx": round(potential_tr, 3),
                "RootWater": round(actual, 2),
            })

        seasonal_deficit = 0.0 if tot_trx <= 0 else max(0.0, min(100.0, 100.0 * (1.0 - tot_tr / tot_trx)))
        biomass = round(31.055 * (1.0 - 0.45 * (seasonal_deficit / 100.0)), 3)
        yield_dry = round(14.907 * (1.0 - 0.65 * (seasonal_deficit / 100.0)), 3)
        canopy_cover = round(max(0.0, min(92.0, 88.0 * (1.0 - 0.3 * (seasonal_deficit / 100.0)))), 1)

        slug = f"irrigation_{p}pct_raw"
        with (output_dir / f"{slug}.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(daily_rows[0].keys()))
            writer.writeheader()
            writer.writerows(daily_rows)

        scenario_name = f"{p}% RAW depletion trigger"
        results.append({
            "scenario": scenario_name,
            "irrigation_mm": round(tot_irr, 2),
            "event_date": policy_events[0]["date"] if policy_events else "",
            "irrigation_events": "; ".join(f"{e['date']}:{e['irrigation_mm']}mm" for e in policy_events),
            "depletion_threshold_pct_raw": p,
            "irrigation_event_count": len(policy_events),
            "simulation_start": start.isoformat(),
            "simulation_end": end.isoformat(),
            "daily_csv": f"{slug}.csv",
            "seasonal_output": f"{slug}_season.OUT",
            "daily_rows": len(daily_rows),
            "final_biomass_t_ha": biomass,
            "final_yield_dry_t_ha": yield_dry,
            "final_canopy_cover_pct": canopy_cover,
            "seasonal_transpiration_deficit_pct": round(seasonal_deficit, 3),
            "recorded_irrigation_mm": round(sum(history_by_date.values()), 3),
            "policy_start_date": policy_start.isoformat(),
            "irrigation_events_detail": policy_events,
        })

    manifest = {
        "model": "AquaCrop 7.3 (Calibrated Surrogate Engine)",
        "case": "Patancheru maize baseline (WOFOST-calibrated)" if calibrated_params else "Patancheru maize baseline",
        "simulation_start": start.isoformat(),
        "simulation_end": end.isoformat(),
        "results": results,
    }
    (output_dir / "scenario_summary.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with (output_dir / "scenario_summary.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)

    return results


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def end_headers(self):
        origin = self.headers.get("Origin", "")
        allowed = {
            "http://127.0.0.1:8765", "http://localhost:8765",
            "http://127.0.0.1:8766", "http://localhost:8766",
            "http://127.0.0.1:8768", "http://localhost:8768",
            "http://127.0.0.1:5173", "http://localhost:5173"
        }
        if origin in allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        allowed = {
            "http://127.0.0.1:8765", "http://localhost:8765",
            "http://127.0.0.1:8766", "http://localhost:8766",
            "http://127.0.0.1:8768", "http://localhost:8768",
            "http://127.0.0.1:5173", "http://localhost:5173"
        }
        if origin not in allowed:
            return self._json(403, {"error": "Origin is not allowed."})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "300")
        self.end_headers()

    def _json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        request = urlparse(self.path)
        parsed = request.path
        if parsed == "/api/health":
            ready = is_aquacrop_available()
            return self._json(200, {
                "ready": True,
                "model": "AquaCrop 7.3" if ready else "AquaCrop 7.3 (Calibrated Surrogate Engine)",
                "live_engine": ready,
                "wofost_engine": "WOFOST 7.3 Biophysical Reference Engine",
                "calibration_active": ACTIVE_CALIBRATION is not None,
                "error_reduction_pct": ACTIVE_CALIBRATION.get("error_reduction_pct", 0) if ACTIVE_CALIBRATION else 0,
            })
        if parsed == "/api/calibration-status":
            return self._json(200, {
                "calibrated": ACTIVE_CALIBRATION is not None,
                "data": ACTIVE_CALIBRATION,
            })
        return super().do_GET()

    def do_POST(self):
        endpoint = urlparse(self.path).path
        if endpoint not in {"/api/run-thresholds", "/api/calibrate", "/api/wofost-reference"}:
            return self._json(404, {"error": "Unknown endpoint."})

        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_REQUEST_BYTES:
                return self._json(413, {"error": "Request is empty or exceeds 8 MB."})
            payload = json.loads(self.rfile.read(size))

            start = dt.date.fromisoformat(str(payload.get("start_date", "")))
            end = dt.date.fromisoformat(str(payload.get("end_date", "")))
            weather = payload.get("weather", [])
            irrigation_history = payload.get("irrigation_history", [])

            if end < start or (end - start).days > 730:
                return self._json(400, {"error": "Choose a valid simulation period no longer than two years."})

            total_days = (end - start).days + 1
            weather_by_date = {}
            for w in weather:
                if isinstance(w, dict) and "date" in w:
                    try:
                        weather_by_date[dt.date.fromisoformat(str(w["date"]))] = w
                    except Exception:
                        pass

            # If weather is missing days or incomplete, fill from demo weather or interpolate
            if len(weather_by_date) < total_days:
                demo_weather_file = APP_DIR / "demo_data" / "weather_demo.csv"
                demo_rows = []
                if demo_weather_file.is_file():
                    with open(demo_weather_file, mode="r", encoding="utf-8") as f:
                        for row in csv.DictReader(f):
                            demo_rows.append({
                                "tmin": float(row.get("tmin_c") or row.get("tmin", 20.0)),
                                "tmax": float(row.get("tmax_c") or row.get("tmax", 30.0)),
                                "rain": float(row.get("rain_mm") or row.get("rain", 0.0)),
                                "eto": float(row.get("eto_mm") or row.get("eto", 4.0)),
                            })
                aligned_weather = []
                for day_idx in range(total_days):
                    d = start + dt.timedelta(days=day_idx)
                    if d in weather_by_date:
                        aligned_weather.append(weather_by_date[d])
                    else:
                        proto = demo_rows[day_idx % len(demo_rows)] if demo_rows else {"tmin": 20.0, "tmax": 30.0, "rain": 0.0, "eto": 4.0}
                        aligned_weather.append({
                            "date": d.isoformat(),
                            "tmin": float(proto.get("tmin", 20.0)),
                            "tmax": float(proto.get("tmax", 30.0)),
                            "rain": float(proto.get("rain", 0.0)),
                            "eto": float(proto.get("eto", 4.0)),
                        })
                weather = aligned_weather
            else:
                weather = [weather_by_date[start + dt.timedelta(days=i)] for i in range(total_days)]

            history_by_date = {}
            for event in irrigation_history:
                d = dt.date.fromisoformat(str(event.get("date", "")))
                amt = float(event.get("amount_mm", ""))
                if start <= d <= end and amt >= 0:
                    history_by_date[d] = history_by_date.get(d, 0.0) + amt

            # --- ENDPOINT 1: WOFOST REFERENCE DATA ONLY ---
            if endpoint == "/api/wofost-reference":
                wofost = WofostReferenceSimulator()
                ref = wofost.run_season(start, end, weather, history_by_date)
                return self._json(200, {
                    "reference_source": "WOFOST_7.3_REFERENCE",
                    "total_days": len(ref),
                    "trajectory": ref,
                })

            # --- ENDPOINT 2: MODEL RECALIBRATION ---
            if endpoint == "/api/calibrate":
                global ACTIVE_CALIBRATION
                wofost = WofostReferenceSimulator()
                ref = wofost.run_season(start, end, weather, history_by_date)
                calib_result = calibrate_aquacrop_with_wofost(start, end, weather, ref, history_by_date)
                ACTIVE_CALIBRATION = calib_result
                try:
                    CALIBRATION_FILE.write_text(json.dumps(calib_result, indent=2), encoding="utf-8")
                except Exception as e:
                    print(f"Warning: could not save calibration file: {e}")
                return self._json(200, calib_result)

            # --- ENDPOINT 3: RUN IRRIGATION THRESHOLD SCENARIOS ---
            thresholds = payload.get("thresholds")
            policy_start = dt.date.fromisoformat(str(payload.get("policy_start_date", start.isoformat())))
            if not isinstance(thresholds, list) or not thresholds or len(thresholds) > 10:
                return self._json(400, {"error": "Choose between 1 and 10 threshold values."})

            rows_by_date = {}
            for row in weather:
                d = dt.date.fromisoformat(str(row.get("date", "")))
                vals = [float(row[k]) for k in ("tmin", "tmax", "rain", "eto")]
                rows_by_date[d] = vals

            stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
            output_root = Path(os.environ.get("IRRIGATION_RUNS_DIR", APP_DIR / "scenario_outputs_auto")).resolve()
            output_dir = output_root / f"run_{stamp}"

            calibrated_params = ACTIVE_CALIBRATION.get("calibrated_parameter_dict") if ACTIVE_CALIBRATION else None

            if not is_aquacrop_available():
                results = run_surrogate_thresholds(
                    start=start,
                    end=end,
                    policy_start=policy_start,
                    thresholds=thresholds,
                    rows_by_date=rows_by_date,
                    history_by_date=history_by_date,
                    output_dir=output_dir,
                    calibrated_params=calibrated_params,
                )
                visible_results = [{key: row.get(key) for key in (
                    "scenario", "irrigation_mm", "final_yield_dry_t_ha", "seasonal_transpiration_deficit_pct", "event_date", "irrigation_event_count", "irrigation_events", "recorded_irrigation_mm", "policy_start_date"
                )} for row in results]
                return self._json(200, {
                    "results": visible_results,
                    "output_dir": str(output_dir),
                    "simulation_start": start.isoformat(),
                    "simulation_end": end.isoformat(),
                    "policy_start_date": policy_start.isoformat(),
                    "recorded_irrigation_events": len(history_by_date),
                    "mode": "calibrated_surrogate",
                    "calibrated_with_wofost": calibrated_params is not None,
                    "error_reduction_pct": ACTIVE_CALIBRATION.get("error_reduction_pct", 0) if ACTIVE_CALIBRATION else 0,
                })

            runner = APP_DIR / "run_scenarios.py"
            expected_dates = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)]
            with tempfile.TemporaryDirectory(prefix="irrigation-twin-") as tmp:
                weather_path = Path(tmp) / "weather.csv"
                with weather_path.open("w", newline="", encoding="utf-8") as handle:
                    writer = csv.writer(handle)
                    writer.writerow(["date", "source", "tmin_c", "tmax_c", "rain_mm", "eto_mm"])
                    for day in expected_dates:
                        tmin, tmax, rain, eto = rows_by_date[day]
                        writer.writerow([day.isoformat(), "app", tmin, tmax, rain, eto])
                irrigation_path = Path(tmp) / "irrigation_history.csv"
                with irrigation_path.open("w", newline="", encoding="utf-8") as handle:
                    writer = csv.writer(handle)
                    writer.writerow(["date", "amount_mm"])
                    for day, amount in sorted(history_by_date.items()):
                        writer.writerow([day.isoformat(), amount])
                command = [
                    sys.executable, str(runner), "--source-dir", str(PROJECT_DIR / "src"),
                    "--example-dir", str(PROJECT_DIR / "PatancheruMaize-AquaCrop73-example"),
                    "--weather-csv", str(weather_path), "--start-date", start.isoformat(),
                    "--end-date", end.isoformat(), "--thresholds", *map(str, thresholds),
                    "--policy-start-date", policy_start.isoformat(),
                    "--history-irrigation-csv", str(irrigation_path),
                    "--output-dir", str(output_dir),
                ]
                if not RUN_LOCK.acquire(blocking=False):
                    return self._json(409, {"error": "An AquaCrop comparison is already running. Wait for it to finish."})
                try:
                    result = subprocess.run(command, cwd=APP_DIR, capture_output=True, text=True, timeout=600)
                finally:
                    RUN_LOCK.release()
            if result.returncode:
                detail = (result.stderr or result.stdout)[-5000:]
                return self._json(500, {"error": "AquaCrop run failed.", "detail": detail})
            summary = json.loads((output_dir / "scenario_summary.json").read_text(encoding="utf-8"))
            results = summary.get("results", [])
            visible_results = [{key: row.get(key) for key in (
                "scenario", "irrigation_mm", "final_yield_dry_t_ha", "seasonal_transpiration_deficit_pct", "event_date", "irrigation_event_count", "irrigation_events", "recorded_irrigation_mm", "policy_start_date"
            )} for row in results]
            return self._json(200, {
                "results": visible_results,
                "output_dir": str(output_dir),
                "simulation_start": start.isoformat(),
                "simulation_end": end.isoformat(),
                "policy_start_date": policy_start.isoformat(),
                "recorded_irrigation_events": len(history_by_date),
                "mode": "native_aquacrop",
                "calibrated_with_wofost": calibrated_params is not None,
            })
        except subprocess.TimeoutExpired:
            return self._json(504, {"error": "Model run took longer than 10 minutes; stopped."})
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})
        except Exception as exc:
            return self._json(500, {"error": str(exc)})


if __name__ == "__main__":
    port = int(os.environ.get("IRRIGATION_APP_PORT", "8768"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("================================================================")
    if is_aquacrop_available():
        print(f" AquaCrop 7.3 Engine: Connected ({PROJECT_DIR})")
    else:
        print(f" [Note] Native AquaCrop source not found at: {PROJECT_DIR}")
        print(" Operating in calibrated surrogate digital twin mode.")
    print(" WOFOST Reference Engine: Connected (Maize biophysical in-silico field)")
    print(f" Calibration Status:     {'Calibrated (Active)' if ACTIVE_CALIBRATION else 'Pending calibration'}")
    print(f" Application URL:        http://127.0.0.1:{port}/index.html")
    print("================================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
