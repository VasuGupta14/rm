# Repository Guidelines

## Project Structure

This repository combines two applications. `Adaptive Irrigation Twin/` contains the Python standard-library backend, simulation/calibration engines, demo data, and standalone 3D viewer. `AgriTwin ΓÇô Smart Irrigation/` contains the React 19, TypeScript, and Vite frontend (`src/`), static assets (`public/`), and its Vite proxy configuration. Root-level `Data/`, `IMPORT/`, `OBS/`, `OUTP/`, and `SIMUL/` hold AquaCrop inputs, imported data, observations, outputs, and simulation settings; treat these as model data, not source code. Startup scripts at the root launch the unified app.

## Development and Build

Run the backend from its own directory with `python local_server.py` (Python 3.8+; no pip dependencies are required). In a second terminal, run the frontend from its directory:

```sh
npm install
npm run dev
```

The Vite server listens on port 8443 and proxies API and visualization requests to the backend on port 8768. For a production bundle, run `npm run build`; use `npm run preview` to serve that bundle locally. Root launchers (`start_unified_app.bat`, `.ps1`, and `.sh`) start both services.

## Style and Naming

Follow the existing TypeScript/React style: two-space indentation, PascalCase component names, camelCase variables and functions, and descriptive filenames. Keep frontend changes within the frontend project and backend logic in `Adaptive Irrigation Twin/`. Python modules use lowercase snake_case. Avoid adding dependencies when the standard library or existing frontend packages suffice.

## Tests and Verification

No automated test framework or test script is currently defined. After frontend changes, run `npm run build`. For backend changes, start the server and check `GET /api/health`; verify affected endpoints or simulation workflows with representative data. Do not treat demo observations or generated scenarios as measured field data.

## Commits and Pull Requests

Git history currently contains only `Initial project snapshot`, so no established commit format is evident. Use short, imperative subjects (for example, `Fix simulation date mapping`). Pull requests should explain the user-visible change, list verification performed, link related issues when available, and include screenshots for UI changes. Note any changes to model inputs, generated outputs, or configuration.

## Configuration and Data Safety

Keep machine-specific paths and credentials out of committed files. Preserve supplied AquaCrop datasets; distinguish source inputs from generated outputs when changing run workflows. Do not describe synthetic/demo values as field measurements.
