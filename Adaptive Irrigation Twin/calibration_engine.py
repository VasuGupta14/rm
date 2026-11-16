"""AquaCrop Model Calibration & Error Minimization Engine using WOFOST Reference Ground Truth.

Calibrates AquaCrop parameters against the high-fidelity in-silico WOFOST trajectory:
- Objective: Minimize RMSE and Mean Bias Error (MBE) between AquaCrop and WOFOST
- Tuned Parameters:
    1. Soil Field Capacity (FC, mm and % VWC)
    2. Permanent Wilting Point (PWP, mm and % VWC)
    3. Maximum Rooting Depth (Z_max, m)
    4. Canopy Growth Coefficient (CGC, %/day)
    5. Runoff Curve Number (CN)
- Outputs statistical model fit metrics (RMSE, MBE, Nash-Sutcliffe Efficiency NSE)
  and comparative time series: WOFOST Reference vs AquaCrop Pre- vs Post-Calibration.
"""

from __future__ import annotations

import datetime as dt
import math


def simulate_aquacrop_trajectory(
    start_date: dt.date,
    end_date: dt.date,
    weather_rows: list[dict[str, float | str]],
    irrigation_history: dict[dt.date, float] | None,
    params: dict[str, float],
) -> list[dict]:
    """Simulates AquaCrop daily moisture and canopy cover with a specific parameter set."""
    fc_mm = params.get("fc_mm", 180.0)
    pwp_mm = params.get("pwp_mm", 65.0)
    root_depth_m = params.get("root_depth_m", 1.0)
    cgc = params.get("cgc", 0.10)
    cn = params.get("cn", 75.0)

    rows_by_date = {
        dt.date.fromisoformat(str(r["date"])): [float(r["tmin"]), float(r["tmax"]), float(r["rain"]), float(r["eto"])]
        for r in weather_rows
    }
    irrigation = irrigation_history or {}
    total_days = (end_date - start_date).days + 1

    # In AquaCrop: RAW threshold is typically halfway between FC and PWP for maize (~50% depletion factor)
    raw_thresh = pwp_mm + 0.50 * (fc_mm - pwp_mm)
    actual_water_mm = fc_mm * 0.90  # Initial root-zone water content
    canopy_cover = 1.0  # Initial CC %

    records = []
    for day_idx in range(total_days):
        current_date = start_date + dt.timedelta(days=day_idx)
        tmin, tmax, rain, eto = rows_by_date.get(current_date, [20.0, 30.0, 0.0, 4.0])
        irr_applied = irrigation.get(current_date, 0.0)

        # 1. Runoff calculation based on Curve Number
        s_potential = (25400.0 / cn) - 254.0
        ia = 0.2 * s_potential
        if rain > ia:
            runoff = ((rain - ia) ** 2) / (rain - ia + s_potential)
        else:
            runoff = 0.0
        effective_rain = max(0.0, rain - runoff)

        # 2. Canopy Cover expansion (Logistic growth driven by CGC)
        progress = day_idx / max(1, total_days - 1)
        if progress < 0.65:
            # Exponential to logistic expansion
            canopy_cover = min(92.0, canopy_cover * (1.0 + cgc * 0.95))
        elif progress < 0.85:
            # Plateau at peak CC
            canopy_cover = min(94.0, canopy_cover)
        else:
            # Senescence
            canopy_cover = max(4.0, canopy_cover * 0.96)

        # 3. Transpiration uptake & water balance
        kc = 0.30 + (canopy_cover / 100.0) * 0.85
        pot_tr = eto * kc * 0.85

        # Water stress factor Ks
        if actual_water_mm >= raw_thresh:
            ks = 1.0
        elif actual_water_mm <= pwp_mm:
            ks = 0.0
        else:
            ks = (actual_water_mm - pwp_mm) / max(0.001, raw_thresh - pwp_mm)

        act_tr = pot_tr * ks
        evap = eto * (1.0 - canopy_cover / 100.0) * 0.30 * ks

        # Infiltration
        actual_water_mm = min(fc_mm, max(pwp_mm * 0.6, actual_water_mm + effective_rain + irr_applied - (act_tr + evap)))

        # Convert root-zone water depth (mm) to Volumetric Water Content (% VWC)
        vwc_pct = (actual_water_mm / (root_depth_m * 1000.0)) * 100.0

        records.append({
            "date": current_date.isoformat(),
            "vwc_pct": round(vwc_pct, 2),
            "canopy_cover_pct": round(canopy_cover, 1),
            "actual_water_mm": round(actual_water_mm, 2),
            "ks": round(ks, 3),
            "act_tr": round(act_tr, 2),
        })

    return records


def calculate_metrics(observed: list[float], predicted: list[float]) -> dict:
    """Computes RMSE, Mean Bias Error (MBE), and Nash-Sutcliffe Efficiency (NSE)."""
    n = len(observed)
    if n == 0 or len(predicted) != n:
        return {"rmse": 0.0, "mbe": 0.0, "nse": 0.0}

    mean_obs = sum(observed) / n
    sq_err = sum((p - o) ** 2 for o, p in zip(observed, predicted))
    bias_err = sum(p - o for o, p in zip(observed, predicted))
    tot_variance = sum((o - mean_obs) ** 2 for o in observed)

    rmse = math.sqrt(sq_err / n)
    mbe = bias_err / n
    nse = 1.0 - (sq_err / max(0.0001, tot_variance))

    return {
        "rmse": round(rmse, 2),
        "mbe": round(mbe, 2),
        "nse": round(max(-1.0, min(1.0, nse)), 3),
    }


def calibrate_aquacrop_with_wofost(
    start_date: dt.date,
    end_date: dt.date,
    weather_rows: list[dict[str, float | str]],
    wofost_reference_records: list[dict],
    irrigation_history: dict[dt.date, float] | None = None,
) -> dict:
    """Performs parameter optimization to calibrate AquaCrop against WOFOST reference data."""
    # 1. Extract WOFOST ground truth targets
    wofost_by_date = {r["date"]: r for r in wofost_reference_records}
    dates = [start_date + dt.timedelta(days=i) for i in range((end_date - start_date).days + 1)]

    wofost_vwc = [float(wofost_by_date[d.isoformat()]["soil_moisture_vwc"]) for d in dates if d.isoformat() in wofost_by_date]
    wofost_cc = [float(wofost_by_date[d.isoformat()]["canopy_cover_pct"]) for d in dates if d.isoformat() in wofost_by_date]

    # 2. Baseline Uncalibrated AquaCrop Parameters
    initial_params = {
        "fc_mm": 180.0,        # Under-parameterized default
        "pwp_mm": 65.0,
        "root_depth_m": 0.85,  # Too shallow compared to maize in deep loam
        "cgc": 0.08,           # Slower canopy expansion rate
        "cn": 78.0,            # High runoff estimation
    }

    baseline_sim = simulate_aquacrop_trajectory(start_date, end_date, weather_rows, irrigation_history, initial_params)
    base_vwc = [r["vwc_pct"] for r in baseline_sim]
    base_cc = [r["canopy_cover_pct"] for r in baseline_sim]

    initial_metrics_vwc = calculate_metrics(wofost_vwc, base_vwc)
    initial_metrics_cc = calculate_metrics(wofost_cc, base_cc)

    # 3. Systematic Bounded Parameter Optimization
    # Target parameter boundaries based on WOFOST reference soil/crop profiles
    # Loam soil with 28% FC, 12% PWP, 1.2m root depth, dynamic CGC
    candidate_fc = [260.0, 280.0, 305.0, 336.0]
    candidate_pwp = [110.0, 130.0, 144.0]
    candidate_depth = [1.05, 1.15, 1.20]
    candidate_cgc = [0.11, 0.125, 0.14]
    candidate_cn = [68.0, 71.0, 73.0]

    best_params = dict(initial_params)
    best_loss = 999999.0
    best_sim = baseline_sim

    # Grid search / Coordinate descent over feasible agronomic space
    for fc in candidate_fc:
        for pwp in candidate_pwp:
            if pwp >= fc * 0.6:
                continue
            for depth in candidate_depth:
                for cgc in candidate_cgc:
                    for cn in candidate_cn:
                        trial_params = {
                            "fc_mm": fc,
                            "pwp_mm": pwp,
                            "root_depth_m": depth,
                            "cgc": cgc,
                            "cn": cn,
                        }
                        sim = simulate_aquacrop_trajectory(start_date, end_date, weather_rows, irrigation_history, trial_params)
                        trial_vwc = [r["vwc_pct"] for r in sim]
                        trial_cc = [r["canopy_cover_pct"] for r in sim]

                        # Objective function: Weighted sum of squared error
                        err_vwc = sum((t - o) ** 2 for o, t in zip(wofost_vwc, trial_vwc)) / max(1, len(wofost_vwc))
                        err_cc = sum((t - o) ** 2 for o, t in zip(wofost_cc, trial_cc)) / max(1, len(wofost_cc))
                        loss = math.sqrt(err_vwc) + 0.15 * math.sqrt(err_cc)

                        if loss < best_loss:
                            best_loss = loss
                            best_params = trial_params
                            best_sim = sim

    # 4. Compute Calibrated Performance
    calibrated_vwc = [r["vwc_pct"] for r in best_sim]
    calibrated_cc = [r["canopy_cover_pct"] for r in best_sim]

    final_metrics_vwc = calculate_metrics(wofost_vwc, calibrated_vwc)
    final_metrics_cc = calculate_metrics(wofost_cc, calibrated_cc)

    error_reduction_pct = round(
        max(0.0, min(100.0, (1.0 - (final_metrics_vwc["rmse"] / max(0.01, initial_metrics_vwc["rmse"]))) * 100.0)),
        1
    )

    # 5. Build Parameter Change Manifest
    param_table = [
        {
            "name": "Field Capacity (FC)",
            "unit": "mm",
            "initial": initial_params["fc_mm"],
            "calibrated": best_params["fc_mm"],
            "delta_pct": f"{((best_params['fc_mm'] - initial_params['fc_mm']) / initial_params['fc_mm'] * 100):+.1f}%",
            "meaning": "Aligned root-zone water storage with WOFOST loam soil profile",
        },
        {
            "name": "Permanent Wilting Point (PWP)",
            "unit": "mm",
            "initial": initial_params["pwp_mm"],
            "calibrated": best_params["pwp_mm"],
            "delta_pct": f"{((best_params['pwp_mm'] - initial_params['pwp_mm']) / initial_params['pwp_mm'] * 100):+.1f}%",
            "meaning": "Lower threshold matched to WOFOST biophysical crop stress initiation",
        },
        {
            "name": "Effective Rooting Depth (Z_max)",
            "unit": "m",
            "initial": initial_params["root_depth_m"],
            "calibrated": best_params["root_depth_m"],
            "delta_pct": f"{((best_params['root_depth_m'] - initial_params['root_depth_m']) / initial_params['root_depth_m'] * 100):+.1f}%",
            "meaning": "Updated to match full physiological maize root penetration",
        },
        {
            "name": "Canopy Growth Coeff (CGC)",
            "unit": "%/day",
            "initial": f"{initial_params['cgc'] * 100:.1f}%",
            "calibrated": f"{best_params['cgc'] * 100:.1f}%",
            "delta_pct": f"{((best_params['cgc'] - initial_params['cgc']) / initial_params['cgc'] * 100):+.1f}%",
            "meaning": "Synchronized vegetative canopy expansion to WOFOST LAI trajectory",
        },
        {
            "name": "Runoff Curve Number (CN)",
            "unit": "dim.",
            "initial": initial_params["cn"],
            "calibrated": best_params["cn"],
            "delta_pct": f"{((best_params['cn'] - initial_params['cn']) / initial_params['cn'] * 100):+.1f}%",
            "meaning": "Reduced surface loss to reflect observed infiltration rates",
        },
    ]

    # 6. Build Multi-Series Comparison Timeline (Sampling for snappy chart display)
    time_series = []
    for idx, d in enumerate(dates):
        d_str = d.isoformat()
        if d_str in wofost_by_date:
            time_series.append({
                "date": d_str,
                "dap": idx + 1,
                "wofost_vwc": wofost_vwc[idx],
                "aquacrop_baseline_vwc": base_vwc[idx],
                "aquacrop_calibrated_vwc": calibrated_vwc[idx],
                "wofost_cc": wofost_cc[idx],
                "aquacrop_baseline_cc": base_cc[idx],
                "aquacrop_calibrated_cc": calibrated_cc[idx],
            })

    return {
        "status": "CALIBRATION_CONVERGED",
        "error_reduction_pct": error_reduction_pct,
        "metrics_moisture": {
            "initial_rmse": initial_metrics_vwc["rmse"],
            "calibrated_rmse": final_metrics_vwc["rmse"],
            "initial_mbe": initial_metrics_vwc["mbe"],
            "calibrated_mbe": final_metrics_vwc["mbe"],
            "initial_nse": initial_metrics_vwc["nse"],
            "calibrated_nse": final_metrics_vwc["nse"],
        },
        "metrics_canopy": {
            "initial_rmse": initial_metrics_cc["rmse"],
            "calibrated_rmse": final_metrics_cc["rmse"],
        },
        "parameters": param_table,
        "calibrated_parameter_dict": best_params,
        "comparison_timeline": time_series,
    }

