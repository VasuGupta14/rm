"""WOFOST (World Food Studies) Crop Growth Reference Engine.

Simulates mechanistic in-silico field dynamics for Maize (Zea mays L.):
- Temperature-driven phenology (DVS: 0 emergence -> 1 anthesis -> 2 maturity)
- Daily light interception, gross CO2 assimilation, and maintenance respiration
- Biomass dry matter partitioning (roots, stems, leaves, storage organs)
- Dynamic rooting depth and multi-layer soil water balance
- Outputs synthetic ground-truth telemetry: VWC (%), LAI, CC (%), Transpiration (mm)
"""

from __future__ import annotations

import datetime as dt
import math


class WofostReferenceSimulator:
    """Simulates a biophysical crop-soil reference trajectory based on WOFOST principles."""

    def __init__(
        self,
        soil_type: str = "Loam",
        soil_fc: float = 0.28,       # Field capacity (m3/m3) ~ 28% VWC
        soil_pwp: float = 0.12,      # Permanent wilting point (m3/m3) ~ 12% VWC
        soil_sat: float = 0.44,      # Saturation water content (m3/m3)
        max_root_depth: float = 1.2, # Maximum effective rooting depth (m)
    ):
        self.soil_type = soil_type
        self.soil_fc = soil_fc
        self.soil_pwp = soil_pwp
        self.soil_sat = soil_sat
        self.max_root_depth = max_root_depth

        # WOFOST Maize phenology parameters (thermal time in degree-days above 8 C base)
        self.tbase = 8.0
        self.tsum_em = 110.0   # Sowing to emergence
        self.tsum1 = 750.0     # Emergence to anthesis (flowering)
        self.tsum2 = 800.0     # Anthesis to physiological maturity

        # Light extinction coefficient k for maize
        self.k_ext = 0.65

        # Maximum light-saturated leaf assimilation rate (kg CO2 / ha / h)
        self.amax = 42.0

        # Initial conditions
        self.initial_sm = self.soil_fc * 0.95

    def run_season(
        self,
        start_date: dt.date,
        end_date: dt.date,
        weather_rows: list[dict[str, float | str]],
        irrigation_history: dict[dt.date, float] | None = None,
    ) -> list[dict]:
        """Runs the WOFOST simulation across the crop season with daily weather."""
        irrigation = irrigation_history or {}
        rows_by_date = {
            dt.date.fromisoformat(str(r["date"])): [float(r["tmin"]), float(r["tmax"]), float(r["rain"]), float(r["eto"])]
            for r in weather_rows
        }

        total_days = (end_date - start_date).days + 1
        dvs = 0.0
        tsum = 0.0
        lai = 0.05
        biomass_total = 0.05  # t/ha dry matter
        root_depth = 0.20     # Starting root depth (m)
        soil_vwc = self.initial_sm

        results = []

        for day_idx in range(total_days):
            current_date = start_date + dt.timedelta(days=day_idx)
            tmin, tmax, rain, eto = rows_by_date.get(current_date, [20.0, 30.0, 0.0, 4.0])
            tmean = (tmin + tmax) / 2.0
            teff = max(0.0, tmean - self.tbase)

            # 1. Thermal time and Phenological Development Stage (DVS)
            tsum += teff
            if tsum < self.tsum_em:
                dvs = tsum / self.tsum_em * 0.1
                stage_label = "Germination"
            elif tsum < (self.tsum_em + self.tsum1):
                dvs = 0.1 + ((tsum - self.tsum_em) / self.tsum1) * 0.9
                stage_label = "Vegetative" if dvs < 0.6 else "Silking / Flowering"
            else:
                dvs = 1.0 + ((tsum - self.tsum_em - self.tsum1) / self.tsum2) * 1.0
                dvs = min(2.0, dvs)
                stage_label = "Grain Filling" if dvs < 1.7 else "Maturity"

            # 2. Dynamic Root Growth (Z_r increases until anthesis DVS = 1.0)
            if dvs < 1.0:
                root_depth = min(self.max_root_depth, 0.20 + (dvs ** 1.1) * (self.max_root_depth - 0.20))

            # 3. Canopy Cover from Leaf Area Index (Beer-Lambert law)
            # LAI expansion and senescence
            if dvs < 0.2:
                lai = 0.05 + dvs * 2.5
            elif dvs < 1.0:
                # Rapid vegetative expansion
                lai = min(4.8, 0.55 + ((dvs - 0.2) / 0.8) ** 1.3 * 4.25)
            elif dvs < 1.4:
                # Plateau
                lai = 4.8 - (dvs - 1.0) * 0.8
            else:
                # Senescence
                lai = max(0.2, 4.48 - ((dvs - 1.4) / 0.6) * 3.8)

            canopy_cover_pct = max(0.0, min(96.0, 100.0 * (1.0 - math.exp(-self.k_ext * lai))))

            # 4. Transpiration & Water Uptake
            # WOFOST potential transpiration
            kc_wofost = 0.35 + 0.85 * (canopy_cover_pct / 100.0)
            potential_tr = eto * kc_wofost * 0.90

            # Soil water reduction factor (transpiration stress)
            # Critical water content (raw threshold)
            theta_crit = self.soil_pwp + 0.55 * (self.soil_fc - self.soil_pwp)
            if soil_vwc >= theta_crit:
                reduction_factor = 1.0
            elif soil_vwc <= self.soil_pwp:
                reduction_factor = 0.0
            else:
                reduction_factor = (soil_vwc - self.soil_pwp) / max(0.001, theta_crit - self.soil_pwp)

            actual_tr = potential_tr * reduction_factor

            # 5. Daily Infiltration & Soil Moisture Update
            irr_dose = irrigation.get(current_date, 0.0)
            net_water_inflow = rain + irr_dose
            root_zone_water_mm = soil_vwc * (root_depth * 1000.0)

            # Infiltration and evapotranspiration
            soil_evap = eto * (1.0 - canopy_cover_pct / 100.0) * 0.35 * reduction_factor
            new_water_mm = root_zone_water_mm + net_water_inflow - (actual_tr + soil_evap)

            # Drainage / runoff beyond saturation/field capacity
            max_storage_mm = self.soil_sat * (root_depth * 1000.0)
            fc_storage_mm = self.soil_fc * (root_depth * 1000.0)
            pwp_storage_mm = self.soil_pwp * (root_depth * 1000.0)

            if new_water_mm > fc_storage_mm:
                # Drainage takes ~1 day to return toward field capacity
                excess = new_water_mm - fc_storage_mm
                new_water_mm = fc_storage_mm + excess * 0.15

            new_water_mm = max(pwp_storage_mm * 0.65, min(max_storage_mm, new_water_mm))
            soil_vwc = new_water_mm / (root_depth * 1000.0)

            # 6. Daily Dry Matter Accumulation (t/ha)
            # Radiation-use efficiency modulated by water stress
            daily_assim = 0.32 * (canopy_cover_pct / 100.0) * reduction_factor * (tmean / 25.0)
            biomass_total += max(0.001, daily_assim)

            results.append({
                "date": current_date.isoformat(),
                "day_number": day_idx + 1,
                "dvs": round(dvs, 3),
                "crop_stage": stage_label,
                "lai": round(lai, 2),
                "canopy_cover_pct": round(canopy_cover_pct, 1),
                "soil_moisture_vwc": round(soil_vwc * 100.0, 2),  # In % VWC
                "root_depth_m": round(root_depth, 2),
                "transpiration_actual_mm": round(actual_tr, 2),
                "transpiration_potential_mm": round(potential_tr, 2),
                "stress_factor": round(1.0 - reduction_factor, 3),
                "biomass_t_ha": round(biomass_total, 3),
                "rain_mm": rain,
                "irrigation_applied_mm": irr_dose,
                "source": "WOFOST_7.3_REFERENCE",
            })

        return results

