# AgriTwin – Smart Irrigation Platform (Unified Application)

A complete agricultural Digital Twin and Decision Support System integrating **AquaCrop 7.3** water balance modeling with **WOFOST 7.3** biophysical reference ground-truth assimilation, adaptive recalibration, and a modern React 19 UI.

---

## 🤖 Instructions for AI Agents & Automated Evaluators

If you are an AI coding assistant (Claude Code, Cursor, Copilot, Codex, Gemini CLI, etc.) or automated CI/CD runner executing this project, follow this section:

### 1. Prerequisites Check
- **Python 3.8+** (Uses standard library only: `http.server`, `urllib`, `json`, `csv`, `math`, `threading`; **no `pip install` required**).
- **Node.js 18+** & **npm** (or `pnpm` / `yarn`).

### 2. Service Architecture & Port Bindings
The application consists of two connected processes:
1. **Simulation & Recalibration Engine (Python Backend):**
   - Directory: `./Adaptive Irrigation Twin`
   - Port: **`8768`**
   - Command: `python3 local_server.py` (or `python local_server.py` on Windows)
   - Health Check: `GET http://127.0.0.1:8768/api/health`
2. **Dashboard & Visualizer (React + Vite Frontend):**
   - Directory: `./AgriTwin – Smart Irrigation`
   - Port: **`8443`** (Vite proxies all `/api/*` and `/visualization*` calls to `http://127.0.0.1:8768`)
   - Install command: `npm install`
   - Dev start command: `npm run dev`
   - Application URL: **`http://localhost:8443`**

### 3. Automated Single-Command Startup
- **Linux / macOS:**
  ```bash
  chmod +x start_unified_app.sh && ./start_unified_app.sh
  ```
- **Windows (Command Prompt / Batch):**
  ```cmd
  start_unified_app.bat
  ```
- **Windows (PowerShell):**
  ```powershell
  .\start_unified_app.ps1
  ```

### 4. Headless Verification / Health Checks
To programmatically verify both services are running and healthy:
```bash
# Verify backend through Vite proxy
curl -s http://localhost:8443/api/health
# Expected JSON output: {"ready": true, "model": "...", "calibration_active": true, ...}

# Verify frontend
curl -s http://localhost:8443/ | grep -i "AgriTwin"
```

---

## 🚀 Quick Start for Humans (Any Operating System)

### On Linux (Ubuntu / Debian / Fedora / Arch / Mint):
1. Open Terminal in this directory:
   ```bash
   cd main_rm
   ```
2. Run the launcher:
   ```bash
   chmod +x start_unified_app.sh
   ./start_unified_app.sh
   ```
3. Open your browser: **[http://localhost:8443](http://localhost:8443)**

---

### On Windows (10 / 11 / Server):
1. Open the `main_rm` folder in Windows File Explorer.
2. **Double-click `start_unified_app.bat`** (or right-click `start_unified_app.ps1` and select *Run with PowerShell*).
3. The launcher will automatically start both services and open **[http://localhost:8443](http://localhost:8443)** in your default browser.

---

### On macOS:
1. Open Terminal in `main_rm`:
   ```bash
   chmod +x start_unified_app.sh
   ./start_unified_app.sh
   ```
2. Open your browser: **[http://localhost:8443](http://localhost:8443)**

---

## 🌾 Core Features & Demonstrator Capabilities

1. **Active Field Profiles Dropdown:**
   - **North Field · Maize** (Optimal baseline Kharif season, Vertisol soil, Day 108 maturing).
   - **South Basin · Wheat** (Winter / Rabi season, Sandy Loam, Day 33 tillering).
   - **West Sector · Soybean** (Severe dry stress research scenario, Clay Loam, Day 120 pod fill).
   - *Switching profiles immediately updates crop dates, daily weather, sensor readings, and 3D canopy models.*

2. **Adaptive Model Recalibration:**
   - Uses WOFOST 7.3 biophysical reference engine as ground truth to eliminate AquaCrop prediction error.
   - Reduces RMSE error by **73.9%** ($5.36\% \rightarrow 1.40\%$, NSE fit $0.88$).
   - Click **`Run WOFOST Calibration`** to trigger live optimization.
   - Click **`Import WOFOST Telemetry`** to assimilate 132 days of in-silico sensor data into field readings.

3. **What-If Deficit Irrigation Simulator:**
   - Interactive continuous slider with presets (100%, 80%, 60%, 40%).
   - Demonstrates that a $-20\%$ deficit saves **480,000 Liters/ha** with only a 3.3% yield impact, with AquaCrop and WOFOST agreeing within 0.18 t/ha.

4. **3D WebGL Crop Growth Viewer:**
   - Three.js/Canvas 3D field viewer comparing pre-calibration vs. calibrated crop canopy growth across the entire season timeline (DAP 1 to 132).
   - Accessible within the **Digital Twin** tab or directly at: `http://localhost:8443/visualization.html`.

5. **Field Monitoring & Live Weather Sync:**
   - Real manual and logger reading tables.
   - Live **Open-Meteo API** integration: type any global city name into Weather Sync to fetch live forecasts and historical gridded reanalysis.

6. **Decision Support & Irrigation Recommendations:**
   - Ranks policies against water limits, stress caps, and yield floors to advise the best schedule.

---

## 📁 Repository Structure
```text
main_rm/
├── start_unified_app.sh        # Universal launcher for Linux & macOS
├── start_unified_app.bat       # Universal launcher for Windows (Batch)
├── start_unified_app.ps1       # Universal launcher for Windows (PowerShell)
├── README_HOW_TO_RUN.md        # This setup and AI agent run guide
├── Adaptive Irrigation Twin/   # Python Biophysical Engine (Port 8768)
│   ├── local_server.py         # REST API server (Standard library only)
│   ├── wofost_engine.py        # WOFOST 7.3 biophysical simulator
│   ├── calibration_engine.py   # Parameter optimization engine
│   ├── calibrated_params.json  # Tuned parameter manifest
│   ├── demo_data/              # Patancheru weather, observations, and scenarios
│   ├── visualization.html      # 3D WebGL crop viewer page
│   └── visualization-3d.js     # 3D Three.js rendering engine
└── AgriTwin – Smart Irrigation/ # Modern React UI (Port 8443)
    ├── package.json            # React 19, TypeScript, Tailwind CSS, Vite
    ├── vite.config.ts          # Reverse proxy routing /api -> :8768
    ├── index.html              # Main HTML entrypoint
    └── src/
        ├── App.tsx             # Complete unified dashboard & tabs
        ├── main.tsx            # Application bootstrapping
        └── services/           # API client, AppContext, & profile definitions
```

---

## ⚙️ Manual Step-by-Step (If Running Services Independently)

If you prefer starting backend and frontend in separate terminal windows:

**Terminal 1 (Backend):**
```bash
cd "Adaptive Irrigation Twin"
python3 local_server.py
```

**Terminal 2 (Frontend):**
```bash
cd "AgriTwin – Smart Irrigation"
npm install
npm run dev
```

Then visit **`http://localhost:8443`**.
