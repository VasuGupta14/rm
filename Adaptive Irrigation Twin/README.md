# Adaptive Irrigation Twin

## Start the app

1. Double-click `start_app.bat`.
2. Keep the terminal window open while using the app.
3. Open [http://127.0.0.1:8768/index.html](http://127.0.0.1:8768/index.html).
4. Choose **Open synthetic demo farm** to explore the example, or create a local farm workspace and enter its crop and soil details.

The launcher connects to the AquaCrop 7.3 source configured in `local_server.py` on this computer. It writes new simulation outputs into `scenario_outputs_auto/` when you run comparisons. That output folder is created automatically.

## What's in this folder

- `index.html`, `app-flow.js`, `dashboard-ui.js`, `app-theme.css` — farm workspace, animated field/weather dashboard, and irrigation advice.
- `local_server.py`, `run_scenarios.py` — local app service and AquaCrop policy runner.
- `visualization.html`, `visualization-3d.js` — 3D crop viewer.
- `demo_data/`, `irrigation_digital_twin_demo_pack.zip` — example CSV data and AquaCrop outputs.
- `start_app.bat` — launcher.

## Important limits

The farm chooser saves workspaces in this browser; it is not secure account login. The demo sensor reading is fabricated and labeled. It is displayed to illustrate the live field view but is not used to change AquaCrop's soil-water state. Weather uses Open-Meteo grid estimates and forecasts, with labeled seasonal averages beyond the forecast window. The app currently uses the bundled Patancheru maize example profile. Treat recommendations as model demonstrations until the crop, soil, measured field moisture, irrigation history, and weather are matched to the real field.

Farm data is stored in this browser profile and localhost port. The older app address on port 8766 has separate browser storage from this app on port 8768.
