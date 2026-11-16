"""Run single-event or adaptive-threshold irrigation scenarios with AquaCrop 7.3.

This runner copies the example case and AquaCrop source into temporary folders,
injects irrigation into AquaCrop's daily water balance, then
exports each scenario's real daily model output. The original case/source are
never modified.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile


def export_daily(day_file: Path, csv_file: Path) -> list[dict[str, str]]:
    lines = day_file.read_text(encoding="cp1252").splitlines()
    header_idx = next((i for i, line in enumerate(lines) if re.match(r"\s*Day\s+Month\s+Year", line)), None)
    if header_idx is None:
        raise RuntimeError(f"Could not find daily output header in {day_file}")
    header = re.split(r"\s+", lines[header_idx].strip())
    rows: list[dict[str, str]] = []
    for line in lines[header_idx + 2:]:
        cells = re.split(r"\s+", line.strip())
        if len(cells) != len(header) or not all(cells[i].isdigit() for i in range(3)):
            continue
        d, m, y = map(int, cells[:3])
        rows.append({"date": f"{y:04d}-{m:02d}-{d:02d}", **dict(zip(header, cells))})
    if not rows:
        raise RuntimeError(f"No daily data rows in {day_file}")
    with csv_file.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["date", *header])
        writer.writeheader()
        writer.writerows(rows)
    return rows


def read_weather_csv(path: Path, start_date: dt.date, end_date: dt.date) -> list[dict[str, float | str]]:
    """Load a complete daily weather series exported by the app."""
    aliases = {
        "date": ("date", "day"), "tmin": ("tmin_c", "tmin", "minimum_temperature"),
        "tmax": ("tmax_c", "tmax", "maximum_temperature"),
        "rain": ("rain_mm", "rainfall_mm", "rain"), "eto": ("eto_mm", "eto", "reference_et"),
    }
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = {name.lower().strip(): name for name in reader.fieldnames or []}
        columns = {key: next((headers[a] for a in opts if a in headers), None) for key, opts in aliases.items()}
        missing_headers = [key for key, column in columns.items() if column is None]
        if missing_headers:
            raise ValueError(f"Weather CSV is missing required columns: {', '.join(missing_headers)}")
        by_date: dict[dt.date, dict[str, float | str]] = {}
        for line_number, raw in enumerate(reader, start=2):
            try:
                date = dt.date.fromisoformat((raw[columns["date"]] or "").strip())
                values = {key: float(raw[columns[key]]) for key in ("tmin", "tmax", "rain", "eto")}
            except (ValueError, TypeError, KeyError) as exc:
                raise ValueError(f"Invalid weather date or value on CSV line {line_number}") from exc
            if date in by_date:
                raise ValueError(f"Duplicate weather date {date.isoformat()} in CSV")
            if not all(math.isfinite(value) for value in values.values()):
                raise ValueError(f"Non-finite weather value on CSV line {line_number}")
            if values["tmin"] > values["tmax"] or values["rain"] < 0 or values["eto"] < 0:
                raise ValueError(f"Invalid temperature, rainfall, or ETo on CSV line {line_number}")
            by_date[date] = values

    expected = (end_date - start_date).days + 1
    dates = [start_date + dt.timedelta(days=i) for i in range(expected)]
    absent = [date.isoformat() for date in dates if date not in by_date]
    if absent:
        preview = ", ".join(absent[:8])
        suffix = " …" if len(absent) > 8 else ""
        raise ValueError(f"Weather coverage is incomplete: {len(absent)} day(s) missing ({preview}{suffix})")
    return [{"date": date.isoformat(), **by_date[date]} for date in dates]


def install_weather(case: Path, rows: list[dict[str, float | str]], start_date: dt.date, end_date: dt.date) -> None:
    """Write app-exported daily weather into the temporary AquaCrop case."""
    data_dir = case / "DATA"
    first_date = start_date
    def write_series(filename: str, values: list[float]) -> None:
        target = data_dir / filename
        lines = target.read_text(encoding="cp1252").splitlines()
        if len(lines) < 8 or not lines[1].strip().startswith("1"):
            raise RuntimeError(f"Unsupported AquaCrop daily climate file format: {target}")
        lines[0] = f"Patancheru, daily weather from app export, {first_date.isoformat()} to {end_date.isoformat()}"
        lines[2] = f"    {first_date.day:02d}  : First day of record (1, 11 or 21 for 10-day or 1 for months)"
        lines[3] = f"    {first_date.month}  : First month of record"
        lines[4] = f"  {first_date.year}  : First year of record (1901 if not linked to a specific year)"
        lines = lines[:8] + [f"{value:.2f}" for value in values]
        target.write_text("\n".join(lines) + "\n", encoding="cp1252")

    temp_path = data_dir / "Patancheru.Tnx"
    temp_lines = temp_path.read_text(encoding="cp1252").splitlines()
    if len(temp_lines) < 8 or not temp_lines[1].strip().startswith("1"):
        raise RuntimeError(f"Unsupported AquaCrop daily climate file format: {temp_path}")
    temp_lines[0] = f"Patancheru, daily weather from app export, {first_date.isoformat()} to {end_date.isoformat()}"
    temp_lines[2] = f"    {first_date.day:02d}  : First day of record (1, 11 or 21 for 10-day or 1 for months)"
    temp_lines[3] = f"    {first_date.month}  : First month of record"
    temp_lines[4] = f"  {first_date.year}  : First year of record (1901 if not linked to a specific year)"
    temp_lines = temp_lines[:8] + [f"{float(r['tmin']):.2f}\t{float(r['tmax']):.2f}" for r in rows]
    temp_path.write_text("\n".join(temp_lines) + "\n", encoding="cp1252")
    write_series("Patancheru.PLU", [float(r["rain"]) for r in rows])
    write_series("Patancheru.ETo", [float(r["eto"]) for r in rows])

    pro_path = case / "LIST" / "PatancheruMaize.PRO"
    pro_lines = pro_path.read_text(encoding="cp1252").splitlines()
    # AquaCrop day numbers are counted from 1 January 1901 as day 1.
    day_number = lambda date: (date - dt.date(1901, 1, 1)).days + 1
    if len(pro_lines) < 7:
        raise RuntimeError(f"Unexpected AquaCrop project file: {pro_path}")
    pro_lines[3:7] = [str(day_number(start_date)), str(day_number(end_date)), str(day_number(start_date)), str(day_number(end_date))]
    pro_path.write_text("\n".join(pro_lines) + "\n", encoding="cp1252")


def run_one(source: Path, example: Path, out: Path, event_date: dt.date, start_date: dt.date, end_date: dt.date, amount: float, weather_rows: list[dict[str, float | str]] | None = None, depletion_pct: int | None = None, policy_start_date: dt.date | None = None, historical_irrigations: list[dict[str, str | float]] | None = None) -> dict:
    # AquaCrop's file wrappers may keep an output handle open until process exit on Windows.
    with tempfile.TemporaryDirectory(prefix="aquacrop-scenario-", ignore_cleanup_errors=True) as td:
        temp = Path(td)
        case = temp / "case"
        shutil.copytree(example / "testcase", case)
        if weather_rows is not None:
            install_weather(case, weather_rows, start_date, end_date)
        overlay = temp / "source"
        shutil.copytree(source / "modules", overlay / "modules")
        compat = example / "src" / "modules" / "simul.py"
        if compat.is_file():
            shutil.copy2(compat, overlay / "modules" / "simul.py")

        sim = overlay / "modules" / "simul.py"
        text = sim.read_text(encoding="utf-8")
        marker = "    # 5. Infiltration (Rain and Irrigation)"
        if marker not in text:
            raise RuntimeError("AquaCrop simulator changed: cannot locate daily infiltration step")
        # The example's PRO file defines the simulation's first internal day number.
        pro_lines = (case / "LIST" / "PatancheruMaize.PRO").read_text(encoding="cp1252").splitlines()
        first_day_number = int(pro_lines[3].strip())
        event_day = first_day_number + (event_date - start_date).days
        if depletion_pct is None:
            injection = (
                f"    # Scenario runner: one-day irrigation, applied before water balance.\n"
                f"    if dayi == {event_day}:\n"
                f"        SetIrrigation(GetIrrigation() + {amount:.6f})\n"
                f"        InfiltratedIrrigation = {amount:.6f}\n"
            )
        else:
            text = text.replace("import sys\n", "import sys\n\nIRRIGATION_POLICY_EVENTS = []\n", 1)
            policy_start = policy_start_date or start_date
            historical_by_day = {
                first_day_number + (dt.date.fromisoformat(str(item["date"])) - start_date).days: float(item["amount_mm"])
                for item in (historical_irrigations or [])
            }
            history_literal = repr(historical_by_day)
            injection = (
                f"    # Replay actual recorded irrigation before the advice date; compare policies only from that date onward.\n"
                f"    _recorded_irrigation = {history_literal}.get(dayi, 0.0)\n"
                f"    if _recorded_irrigation > 0:\n"
                f"        SetIrrigation(GetIrrigation() + _recorded_irrigation)\n"
                f"        InfiltratedIrrigation = _recorded_irrigation\n"
                f"    # Adaptive schedule: trigger at depletion_pct of AquaCrop's RAW threshold.\n"
                f"    _fc = GetRootZoneWC_FC()\n"
                f"    _stress = GetRootZoneWC_Thresh()\n"
                f"    _target = _fc - ({depletion_pct} / 100.0) * max(0.0, _fc - _stress)\n"
                f"    _actual = GetRootZoneWC_Actual()\n"
                f"    if (dayi >= {first_day_number + (policy_start - start_date).days}) and (GetCrop_Day1() <= dayi <= GetCrop_DayN()) and (_fc > _stress) and (_actual < _target):\n"
                f"        _dose = max(0.0, _target - _actual)\n"
                f"        if _dose > 0.01:\n"
                f"            SetIrrigation(GetIrrigation() + _dose)\n"
                f"            InfiltratedIrrigation = _dose\n"
                f"            IRRIGATION_POLICY_EVENTS.append((dayi, _dose, 100.0 * (_fc - _actual) / (_fc - _stress)))\n"
            )
        init_marker = "    InfiltratedIrrigation = 0\n"
        if init_marker not in text:
            raise RuntimeError("AquaCrop simulator changed: cannot locate daily irrigation initialization")
        sim.write_text(text.replace(init_marker, init_marker + injection, 1), encoding="utf-8")

        sys.path.insert(0, str(overlay))
        policy_events: list[dict[str, float | str]] = []
        try:
            from modules import _global
            _global.complete_path_dir = str(case) + os.sep
            from modules.startunit import StartTheProgram
            StartTheProgram()
            if depletion_pct is not None:
                sim_module = sys.modules.get("modules.simul")
                for day_number, dose, depletion in getattr(sim_module, "IRRIGATION_POLICY_EVENTS", []):
                    event_date_actual = start_date + dt.timedelta(days=int(day_number) - first_day_number)
                    policy_events.append({"date": event_date_actual.isoformat(), "irrigation_mm": round(float(dose), 3), "depletion_of_raw_pct": round(float(depletion), 2)})
        finally:
            sys.path.remove(str(overlay))
            for name in list(sys.modules):
                if name == "modules" or name.startswith("modules."):
                    del sys.modules[name]

        status_file = case / "OUTP" / "ListProjectsLoaded.OUT"
        status = status_file.read_text(encoding="utf-8", errors="replace") if status_file.exists() else ""
        if "Project loaded" not in status:
            raise RuntimeError(f"AquaCrop did not load the case. {status}")
        day_file = case / "OUTP" / "PatancheruMaizePROday.OUT"
        season_file = case / "OUTP" / "PatancheruMaizePROseason.OUT"
        if not day_file.is_file() or not season_file.is_file():
            raise RuntimeError("AquaCrop did not produce expected daily and seasonal outputs")
        out.mkdir(parents=True, exist_ok=True)
        scenario_name = f"{depletion_pct}% RAW depletion trigger" if depletion_pct is not None else f"{amount:g} mm on {event_date.isoformat()}"
        slug = f"irrigation_{depletion_pct}pct_raw" if depletion_pct is not None else f"irrigation_{amount:g}mm_{event_date.isoformat()}"
        daily_path = out / f"{slug}.csv"
        rows = export_daily(day_file, daily_path)
        season_text = season_file.read_text(encoding="cp1252", errors="replace")
        (out / f"{slug}_season.OUT").write_text(season_text, encoding="utf-8")
        season_rows = [line for line in season_text.splitlines() if re.match(r"\s*Tot\(1\)", line)]
        if not season_rows:
            raise RuntimeError("Could not verify seasonal irrigation total")
        season_cells = re.split(r"\s+", season_rows[0].strip())
        reported_irrigation = float(season_cells[8])
        if depletion_pct is None and abs(reported_irrigation - amount) > 0.11:
            raise RuntimeError(f"Expected {amount:g} mm irrigation, AquaCrop reported {reported_irrigation:g} mm")
        # Keep compact, directly comparable indicators from the actual model output.
        last = rows[-1]
        actual_tr = sum(float(r["Tr"]) for r in rows if float(r.get("Trx", 0)) >= 0)
        potential_tr = sum(float(r["Trx"]) for r in rows if float(r.get("Trx", 0)) >= 0)
        seasonal_deficit = 0.0 if potential_tr <= 0 else max(0.0, min(100.0, 100.0 * (1.0 - actual_tr / potential_tr)))
        result = {
            "scenario": scenario_name,
            "irrigation_mm": reported_irrigation if depletion_pct is not None else amount,
            "event_date": policy_events[0]["date"] if policy_events else ("" if depletion_pct is not None else event_date.isoformat()),
            "irrigation_events": "; ".join(f"{event['date']}:{event['irrigation_mm']}mm" for event in policy_events),
            "depletion_threshold_pct_raw": depletion_pct if depletion_pct is not None else "",
            "irrigation_event_count": len(policy_events) if depletion_pct is not None else int(amount > 0),
            "simulation_start": start_date.isoformat(),
            "simulation_end": end_date.isoformat(),
            "daily_csv": daily_path.name,
            "seasonal_output": f"{slug}_season.OUT",
            "daily_rows": len(rows),
            "final_biomass_t_ha": float(last.get("Biomass", "nan")),
            "final_yield_dry_t_ha": float(last.get("Y(dry)", "nan")),
            "final_canopy_cover_pct": float(last.get("CC", "nan")),
            "seasonal_transpiration_deficit_pct": round(seasonal_deficit, 3),
            "recorded_irrigation_mm": round(sum(float(item["amount_mm"]) for item in (historical_irrigations or [])), 3) if depletion_pct is not None else 0.0,
            "policy_start_date": (policy_start_date or start_date).isoformat() if depletion_pct is not None else "",
        }
        if depletion_pct is not None:
            result["irrigation_events_detail"] = policy_events
        return result


def main() -> int:
    here = Path(__file__).resolve().parent
    project = Path(r"C:\Users\vasug\Documents\rm\python source code\AquaCrop73_src")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=project / "src", help="AquaCrop73_src/src")
    parser.add_argument("--example-dir", type=Path, default=project / "PatancheruMaize-AquaCrop73-example")
    parser.add_argument("--date", help="One irrigation event date (YYYY-MM-DD); defaults to the bundled example date or the simulation start")
    parser.add_argument("--start-date", default="1996-07-01", help="First simulated day in the example case")
    parser.add_argument("--end-date", default="1996-11-09", help="Last simulated day in the example case")
    parser.add_argument("--weather-csv", type=Path, help="Complete daily weather CSV exported from the app; must cover start-date through end-date")
    parser.add_argument("--amounts", nargs="+", type=float, default=[0, 5, 10, 15, 20], help="Single-event irrigation depths in mm")
    parser.add_argument("--thresholds", nargs="+", type=int, help="Adaptive policies: irrigate when depletion reaches these percentages of AquaCrop's crop stress threshold (e.g. 30 50 70)")
    parser.add_argument("--policy-start-date", help="For adaptive policies, replay logged irrigation before this date and generate policy events from this date onward")
    parser.add_argument("--history-irrigation-csv", type=Path, help="CSV with date,amount_mm for actual irrigation already applied in the current season")
    parser.add_argument("--output-dir", type=Path, default=here / "scenario_outputs_oct15")
    args = parser.parse_args()
    source, example, out = args.source_dir.resolve(), args.example_dir.resolve(), args.output_dir.resolve()
    if not (source / "modules" / "startunit.py").is_file():
        parser.error(f"AquaCrop source modules not found under {source}")
    if not (example / "testcase" / "LIST" / "PatancheruMaize.PRO").is_file():
        parser.error(f"Example case not found under {example}")
    start_date = dt.date.fromisoformat(args.start_date)
    end_date = dt.date.fromisoformat(args.end_date)
    policy_start_date = dt.date.fromisoformat(args.policy_start_date) if args.policy_start_date else start_date
    event_date = dt.date.fromisoformat(args.date) if args.date else dt.date(1996, 10, 15)
    if end_date < start_date:
        parser.error("--end-date must be on or after --start-date")
    if not start_date <= policy_start_date <= end_date:
        parser.error("--policy-start-date must fall within the simulation period")
    if not start_date <= event_date <= end_date:
        if args.date:
            parser.error("--date irrigation event must fall within the simulation dates")
        event_date = start_date
    if args.thresholds and any(value < 1 or value > 100 for value in args.thresholds):
        parser.error("--thresholds values must be integers from 1 to 100")
    weather_rows = None
    if args.weather_csv:
        weather_path = args.weather_csv.resolve()
        if not weather_path.is_file():
            parser.error(f"Weather CSV not found: {weather_path}")
        try:
            weather_rows = read_weather_csv(weather_path, start_date, end_date)
        except ValueError as exc:
            parser.error(str(exc))
    historical_irrigations: list[dict[str, str | float]] = []
    if args.history_irrigation_csv:
        with args.history_irrigation_csv.open(newline="", encoding="utf-8-sig") as handle:
            for line_number, row in enumerate(csv.DictReader(handle), start=2):
                try:
                    date = dt.date.fromisoformat((row.get("date") or "").strip())
                    amount_mm = float(row.get("amount_mm", ""))
                except (ValueError, TypeError) as exc:
                    parser.error(f"Invalid irrigation history on CSV line {line_number}")
                if not start_date <= date < policy_start_date or not math.isfinite(amount_mm) or amount_mm < 0:
                    parser.error(f"Irrigation history line {line_number} must be nonnegative and earlier than policy start")
                historical_irrigations.append({"date": date.isoformat(), "amount_mm": amount_mm})
    if args.thresholds:
        outputs = [run_one(source, example, out, event_date, start_date, end_date, 0.0, weather_rows, threshold, policy_start_date, historical_irrigations) for threshold in args.thresholds]
        event_timing = "recorded past irrigations replayed; future policy events generated from policy start date when AquaCrop root-zone depletion trigger is reached"
    else:
        outputs = [run_one(source, example, out, event_date, start_date, end_date, amount, weather_rows) for amount in args.amounts]
        event_timing = "single net irrigation event applied before infiltration"
    manifest = {"model": "AquaCrop 7.3", "case": "Patancheru maize illustrative baseline" + (" with app-exported weather" if weather_rows is not None else ", 1996"), "simulation_start": start_date.isoformat(), "simulation_end": end_date.isoformat(), "weather_csv": str(args.weather_csv.resolve()) if args.weather_csv else "bundled example climate", "event_date": event_date.isoformat() if not args.thresholds else "adaptive", "event_timing": event_timing, "results": outputs}
    (out / "scenario_summary.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with (out / "scenario_summary.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(outputs[0]))
        writer.writeheader()
        writer.writerows(outputs)
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
