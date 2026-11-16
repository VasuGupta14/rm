import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js';

// The existing page supplies BASELINE, series, parseCSV, and numericRow.
const $ = (id) => document.getElementById(id);
const views = {};
let playing = false;
let playTimer = null;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const format = (n) => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(1);

function makeView(key) {
  const oldCanvas = $('canvas' + key);
  const canvas = document.createElement('canvas');
  canvas.id = oldCanvas.id;
  canvas.className = oldCanvas.className;
  canvas.setAttribute('aria-label', oldCanvas.getAttribute('aria-label') || 'Interactive 3D maize field');
  canvas.style.cssText = oldCanvas.style.cssText;
  oldCanvas.replaceWith(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe9e4');
  scene.fog = new THREE.Fog('#e5eee8', 12, 28);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight('#eaf6ff', '#72593d', 2));
  const sun = new THREE.DirectionalLight('#fff3d8', 3);
  sun.position.set(-4, 8, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#d8eadb', 1.1);
  fill.position.set(4, 3, -5);
  scene.add(fill, new THREE.AmbientLight('#ffffff', 0.4));

  const soil = new THREE.Mesh(
    new THREE.BoxGeometry(9, 0.34, 6),
    new THREE.MeshStandardMaterial({ color: '#98734f', roughness: 1 }),
  );
  soil.position.y = -0.22;
  scene.add(soil);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 6),
    new THREE.MeshStandardMaterial({ color: '#89936a', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.045;
  scene.add(ground);
  for (let z = -2; z <= 2; z += 1) {
    const furrow = new THREE.Mesh(
      new THREE.BoxGeometry(8.4, 0.012, 0.025),
      new THREE.MeshStandardMaterial({ color: '#b0a17a', roughness: 1 }),
    );
    furrow.position.set(0, -0.032, z);
    scene.add(furrow);
  }
  const plants = new THREE.Group();
  scene.add(plants);
  const state = { renderer, scene, camera, plants, yaw: 0, pitch: 0.12, distance: 7.3, drag: null };
  views[key] = state;
  canvas.addEventListener('pointerdown', (event) => {
    state.drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.drag) return;
    state.yaw += (event.clientX - state.drag.x) * 0.008;
    state.pitch = clamp(state.pitch + (event.clientY - state.drag.y) * 0.006, -0.08, 0.8);
    state.drag = { x: event.clientX, y: event.clientY };
    updateCamera(state);
    draw(key);
  });
  canvas.addEventListener('pointerup', () => { state.drag = null; });
  canvas.addEventListener('pointercancel', () => { state.drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.distance = clamp(state.distance * (event.deltaY > 0 ? 1.08 : 0.92), 5, 13);
    updateCamera(state);
    draw(key);
  }, { passive: false });
  updateCamera(state);
}

function updateCamera(state) {
  const target = new THREE.Vector3(0, 1.05, 0);
  const horizontal = state.distance * Math.cos(state.pitch);
  state.camera.position.set(
    horizontal * Math.sin(state.yaw),
    target.y + state.distance * Math.sin(state.pitch),
    horizontal * Math.cos(state.yaw),
  );
  state.camera.lookAt(target);
}

function addLeaf(parent, height, angle, rank, scale, color, stress, senescence, addVein) {
  const baseY = height * (0.18 + rank * 0.073);
  const length = (0.78 + 1.02 * Math.sin((rank + 0.8) / 13 * Math.PI)) * scale;
  const droop = stress * 0.5 + senescence * 0.26;
  const segments = 18;
  const widthSegments = 6;
  const vertices = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const radial = length * t;
      const width = (0.018 + length * 0.18 * Math.pow(Math.sin(Math.PI * t), 0.8));
    const lift = 0.15 * Math.sin(Math.PI * t) - droop * t * t * length * 0.46;
    for (let j = 0; j <= widthSegments; j += 1) {
      const sideFactor = j / widthSegments * 2 - 1;
      const side = sideFactor * width;
      vertices.push(
        Math.cos(angle) * radial - Math.sin(angle) * side,
        baseY + lift - Math.max(0, t - 0.82) * length * 0.16 + Math.abs(sideFactor) * 0.025 * Math.sin(Math.PI * t),
        Math.sin(angle) * radial + Math.cos(angle) * side,
      );
    }
  }
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < widthSegments; j += 1) {
      const a = i * (widthSegments + 1) + j;
      const b = a + widthSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  parent.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color,
    side: THREE.DoubleSide,
    roughness: 0.78,
  })));

  if (addVein) {
    const points = [];
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      const radial = length * t;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radial,
        baseY + 0.15 * Math.sin(Math.PI * t) - droop * t * t * length * 0.46,
        Math.sin(angle) * radial,
      ));
    }
    parent.add(new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 18, 0.008, 4, false),
      new THREE.MeshStandardMaterial({ color: '#7c9958', roughness: 0.85 }),
    ));
  }
}

function buildPlant(parent, row, rows, x, z, index) {
  const canopy = clamp(Number(row.CC) || 0, 0, 100);
  if (canopy < 0.2) return;
  const maxBiomass = Math.max(...rows.map((item) => Number(item.Biomass) || 0), 0.01);
  const biomassProgress = clamp((Number(row.Biomass) || 0) / maxBiomass, 0, 1);
  const peakCanopy = Math.max(...rows.map((item) => Number(item.CC) || 0), 1);
  const cover = clamp(canopy / peakCanopy, 0.02, 1);
  const transpiration = clamp(row['Tr/Trx'] == null ? 100 : Number(row['Tr/Trx']), 0, 100);
  const stress = 1 - transpiration / 100;
  const senescence = clamp((peakCanopy - canopy) / peakCanopy, 0, 1);
  const height = 0.35 + 2.05 * Math.sqrt(biomassProgress);
  const leafCount = clamp(Math.round(4 + 9 * Math.sqrt(biomassProgress)), 4, 13);
  const stressMix = clamp(stress * 0.68 + senescence * 0.78, 0, 0.92);
  const leafColor = new THREE.Color('#448b4a').lerp(new THREE.Color('#b59b50'), stressMix);
  const plant = new THREE.Group();
  plant.position.set(x, 0, z);
  plant.rotation.y = (index % 3) * 0.17;
  parent.add(plant);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025 * cover, 0.05 * cover, height, 10),
    new THREE.MeshStandardMaterial({ color: '#557947', roughness: 0.86 }),
  );
  stem.position.y = height / 2;
  plant.add(stem);
  for (let k = 0; k < leafCount; k += 1) {
    const rank = k / (leafCount - 1 || 1);
    const angle = k * 2.399 + index * 0.83 + Math.PI / 4;
    const bladeScale = (0.4 + 0.6 * cover) * (0.84 + 0.16 * Math.sin(k * 4.1 + index));
    addLeaf(plant, height, angle, rank, bladeScale, leafColor, stress, senescence, index === 4);
  }
  if (Number(row.Stage) >= 3 && biomassProgress > 0.55) {
    const tassel = new THREE.Mesh(
      new THREE.ConeGeometry(0.07 * cover, 0.23, 8),
      new THREE.MeshStandardMaterial({ color: '#b4a05c', roughness: 0.9 }),
    );
    tassel.position.y = height + 0.08;
    plant.add(tassel);
  }
}

function setCrop(key, row, rows) {
  const group = views[key].plants;
  for (const object of [...group.children]) {
    group.remove(object);
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
        else child.material.dispose();
      }
    });
  }
  let index = 0;
  for (let z = -1; z <= 1; z += 1) {
    for (let x = -1; x <= 1; x += 1) buildPlant(group, row, rows, x * 1.05, z, index++);
  }
  draw(key);
}

function draw(key) {
  const view = views[key];
  const canvas = view.renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  view.renderer.setSize(width, height, false);
  view.camera.aspect = width / height;
  view.camera.updateProjectionMatrix();
  view.renderer.render(view.scene, view.camera);
}

function renderView(key, name, row, rows) {
  const title = $('title' + key);
  const meta = $('meta' + key);
  const metrics = $('metrics' + key);
  title.textContent = name || 'No comparison selected';
  if (!name || !row) return;
  meta.textContent = `${row.date} · DAP ${format(row.DAP)} · AquaCrop stage ${format(row.Stage)}`;
  setCrop(key, row, rows);
  const values = [
    ['Canopy cover', `${format(row.CC)}%`],
    ['Transpiration ratio', `${format(row['Tr/Trx'])}%`],
    ['Biomass', `${format(row.Biomass)} t/ha`],
    ['Root-zone water', `${format(row.Wr)} mm`],
    ['Dry yield', `${format(row['Y(dry)'])} t/ha`],
    ['Rain today', `${format(row.Rain)} mm`],
  ];
  metrics.innerHTML = values.map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('');
}

function render3d() {
  const nameA = $('scenarioA').value;
  const nameB = $('scenarioB').value;
  const rowsA = series.get(nameA) || [];
  const rowsB = series.get(nameB) || [];
  if (!rowsA.length) return;
  const index = clamp(Number($('day').value) || 0, 0, rowsA.length - 1);
  const rowA = rowsA[index];
  $('day').max = Math.max(0, rowsA.length - 1);
  $('dayLabel').textContent = `DAP ${format(rowA.DAP)} · ${rowA.date}`;
  renderView('A', nameA, rowA, rowsA);
  const showB = Boolean(nameB && rowsB.length);
  $('emptyB').style.display = showB ? 'none' : 'grid';
  $('canvasB').style.display = showB ? 'block' : 'none';
  $('metaB').style.display = showB ? 'block' : 'none';
  if (showB) {
    const rowB = rowsB.find((item) => item.date === rowA.date) || rowsB[Math.min(index, rowsB.length - 1)];
    renderView('B', nameB, rowB, rowsB);
  }
}

function populate3d() {
  for (const id of ['scenarioA', 'scenarioB']) {
    const select = $(id);
    const previous = select.value;
    select.innerHTML = '';
    if (id === 'scenarioB') {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'No comparison';
      select.append(none);
    }
    for (const name of series.keys()) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    else if (id === 'scenarioA') select.selectedIndex = 0;
  }
}

function loadFiles(files) {
  let added = 0;
  const errors = [];
  for (const file of files) {
    try {
      const rows = parseCSV(file.textContent || '').map(numericRow).filter((row) => row.date && row.CC != null && row.DAP != null);
      if (!rows.length) throw new Error('No AquaCrop daily rows with date, DAP, and CC found.');
      let name = file.name.replace(/\.csv$/i, '');
      if (series.has(name)) name += ` · ${series.size + 1}`;
      series.set(name, rows);
      added += 1;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  populate3d();
  $('message').textContent = errors.join(' | ') || (added ? `Loaded ${added} scenario${added === 1 ? '' : 's'}.` : '');
  render3d();
}

async function handleUpload(event) {
  const files = [];
  for (const file of event.target.files) files.push({ name: file.name, textContent: await file.text() });
  loadFiles(files);
  event.target.value = '';
}

async function initPreloadedScenarios() {
  const presets = [
    { name: 'AquaCrop (Uncalibrated Pre-State)', url: 'demo_data/scenario_outputs/aquacrop_uncalibrated.csv' },
    { name: 'AquaCrop (Recalibrated Model)', url: 'demo_data/scenario_outputs/aquacrop_calibrated.csv' },
    { name: 'WOFOST Reference (Ground Truth)', url: 'demo_data/scenario_outputs/wofost_reference.csv' },
    { name: '100% Full Irrigation (20 mm)', url: 'demo_data/scenario_outputs/irrigation_20mm_1996-10-15.csv' },
    { name: '80% Deficit Irrigation (10 mm)', url: 'demo_data/scenario_outputs/irrigation_10mm_1996-10-15.csv' },
    { name: 'Rainfed Baseline (0 mm)', url: 'demo_data/scenario_outputs/irrigation_0mm_1996-10-15.csv' },
  ];
  for (const item of presets) {
    try {
      const res = await fetch(item.url);
      if (res.ok) {
        const text = await res.text();
        const rows = parseCSV(text).map(numericRow).filter((r) => r.date && r.CC != null && r.DAP != null);
        if (rows.length) {
          series.set(item.name, rows);
        }
      }
    } catch (e) {
      console.warn('Could not load preset', item.name, e);
    }
  }
  populate3d();
  if (series.has('AquaCrop (Uncalibrated Pre-State)')) {
    $('scenarioA').value = 'AquaCrop (Uncalibrated Pre-State)';
  } else if (series.has('Rainfed Baseline (0 mm)')) {
    $('scenarioA').value = 'Rainfed Baseline (0 mm)';
  }
  if (series.has('AquaCrop (Recalibrated Model)')) {
    $('scenarioB').value = 'AquaCrop (Recalibrated Model)';
  } else if (series.has('100% Full Irrigation (20 mm)')) {
    $('scenarioB').value = '100% Full Irrigation (20 mm)';
  }
  const rows = series.get($('scenarioA').value) || [];
  $('day').max = Math.max(0, rows.length - 1);
  $('day').value = Math.min(75, Math.max(0, rows.length - 1));
  render3d();
}

try {
  makeView('A');
  makeView('B');
  // Replace handlers from the old canvas renderer.
  if (typeof window.render === 'function') window.removeEventListener('resize', window.render);
  $('scenarioA').onchange = () => {
    const rows = series.get($('scenarioA').value) || [];
    $('day').max = Math.max(0, rows.length - 1);
    render3d();
  };
  $('scenarioB').onchange = render3d;
  $('day').oninput = render3d;
  $('upload').onchange = handleUpload;
  window.addEventListener('resize', () => { draw('A'); draw('B'); });
  const playButton = $('play');
  if (playButton) playButton.onclick = () => {
    if (playing) {
      clearInterval(playTimer);
      playing = false;
      playButton.textContent = 'Play season';
      return;
    }
    playing = true;
    playButton.textContent = 'Pause season';
    playTimer = setInterval(() => {
      const input = $('day');
      input.value = Number(input.value) >= Number(input.max) ? 0 : Number(input.value) + 1;
      render3d();
    }, 180);
  };
  populate3d();
  const initialRows = series.get($('scenarioA').value) || [];
  $('day').value = Math.round(Math.max(0, initialRows.length - 1) * 0.6);
  render3d();
  initPreloadedScenarios();
} catch (error) {
  $('message').textContent = `3D rendering could not start: ${error.message}`;
}
