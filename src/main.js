import * as THREE from 'three';
import { World } from './world.js';
import { farTerrain, terrainMaterial, colorTexture, coverTexture, makeNoiseTexture } from './terrain.js';
import { CDLODTerrain } from './cdlod.js';
import { Flora } from './flora.js';
import { buildLakes, buildTrails, buildSigns, buildStreams } from './features.js';
import { Sky, setSun, MOONS, sunDirection } from './sky.js';
import { Calendar, SEASONS } from './calendar.js';
import { Hiker } from './hiker.js';
import { Camp } from './camp.js';
import { Hud, keyCap } from './hud.js';
import { GameMap } from './map.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Character, CHARACTERS } from './characters.js';
import { Companion } from './companion.js';
import { clamp, smoothstep, lerp } from './noise.js';
import { Grass } from './grass.js';
import { updateAtmosphere, atmosphere } from './atmosphere.js';
import { Weather, REGIMES } from './weather.js';
import { Precip } from './precip.js';
import { skyViewTexture } from './skyview.js';
import { gustAt, WIND_DIR } from './wind.js';
import { PRESETS, resolveQuality, isTouch, SCALE } from './quality.js';
import { setRangeK } from './cdlod.js';
import { HorizonMap, CULL } from './culling.js';
import { ATV } from './atv.js';
import { Fishing } from './fishing.js';
import { Roast } from './roast.js';
import { Wood } from './wood.js';
import { Coffee } from './coffee.js';
import { Dump } from './dump.js';
import { Breakfast } from './breakfast.js';

const SAVE_KEY = 'rawah-save-v2';
const $ = (id) => document.getElementById(id);
const DEV = ['localhost', '127.0.0.1', ''].includes(location.hostname);

const settings = loadJSON('rawah-settings', { sens: 1, fov: 72, volume: 0.8, timeScale: 1, quality: 'auto', season: 'autumn', hero: 'blaize', view: 'third' });
if (!CHARACTERS[settings.hero]) settings.hero = 'blaize';
const PARTNER = settings.hero === 'blaize' ? 'grant' : 'blaize';
if (!SEASONS[settings.season]) settings.season = 'autumn';
const calendar = new Calendar(SEASONS[settings.season].doy);
const QUALITY = resolveQuality(settings.quality);
const Q = PRESETS[QUALITY];
settings.shadows ??= Q.shadows;
if (!MOONS[settings.moon]) settings.moon = 'new';
setRangeK(Q.rangeK);

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, logarithmicDepthBuffer: Q.logDepth, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn every other frame; see the loop
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, Q.logDepth ? 0.1 : 0.4, Q.logDepth ? 90000 : 40000);
camera.rotation.order = 'YXZ';
const headlamp = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.55, 1.4);
headlamp.position.set(0.15, 0.05, 0);
headlamp.target.position.set(0, -0.6, -6);
camera.add(headlamp, headlamp.target);
scene.add(camera);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ------------------------------------------------------------------ load
const setLoad = (f, text) => {
  $('load-bar').style.width = `${Math.round(f * 100)}%`;
  if (text) $('load-text').textContent = text;
};
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

setLoad(0.02, 'Downloading the Rawah…');
const world = await World.load('./data', (f) => setLoad(f * 0.6));
setLoad(0.7, 'Raising the Medicine Bow crest…');
await frame();
const noiseTex = makeNoiseTexture();
atmosphere.uCloudTex.value = noiseTex;
setLoad(0.72, 'Measuring the sky from every cirque…');
await frame();
atmosphere.uSkyView.value = skyViewTexture(world);
atmosphere.uSkyExtent.value = world.extent;
const F = world.far;
const farMat = terrainMaterial(colorTexture(F.image), F.N * F.cell, noiseTex);
await frame();

const terrain = new CDLODTerrain(world, { colorMap: colorTexture(world.colorImage), coverMap: coverTexture(world.coverData, world.coverN), noise: noiseTex, detail: QUALITY !== 'low' });
scene.add(terrain.group);
const horizon = new HorizonMap(world);   // the terrain's skyline from the camera, for occlusion culling
terrain.horizon = horizon;
scene.add(farTerrain(world, farMat));
const sky = new Sky(scene, renderer);
sky.moon = MOONS[settings.moon];
sky.sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
const lakes = buildLakes(world);
scene.add(lakes.group);
const trails = buildTrails(world);
scene.add(trails);
scene.add(buildSigns(world));
const streams = buildStreams(world);
scene.add(streams.group);
const flora = new Flora(world, scene, renderer, Q.flora, calendar.leaves);
const weather = new Weather();
weather.override = REGIMES[settings.weather] ? settings.weather : null;
const precip = new Precip(Q.precip);
scene.add(precip.mesh);
const grass = new Grass(terrain, Q.grass, flora.uniforms);
scene.add(grass.mesh);
const camp = new Camp(world, flora, scene);
const hiker = new Hiker(world, flora);
const atv = new ATV(world, flora, scene);
const fishing = new Fishing(world, scene);
const roast = new Roast(scene);
const wood = new Wood(world, flora, scene);
const coffee = new Coffee(world, scene);
const dump = new Dump(scene, world);
const breakfast = new Breakfast(coffee.stand, scene);
let coffeeBoost = 0;     // stamina from a sip, still working its way in
const avatar = new Character(scene, settings.hero);
const partner = new Character(scene, PARTNER);
const rig = new CameraRig(camera, world, hiker, avatar);
const hud = new Hud(world);
const map = new GameMap(world);
const audio = new Audio();
setLoad(0.8, `Waking up ${CHARACTERS[settings.hero].name} and ${CHARACTERS[PARTNER].name}…`);
await Promise.all([avatar.load(), partner.load()]);
if (settings.view === 'third' && rig.mode === 'first') rig.toggle();
avatar.setFirstPerson(rig.mode === 'first');
const companion = new Companion(world, flora, partner, CHARACTERS[PARTNER].name);
setLoad(0.85, 'Drawing the map…');
await frame();
map.build(world.colorImage);

// ------------------------------------------------------------------ state
const lakeList = world.lakes.filter((l) => l.name);
const peaks = world.places.filter((p) => p.kind === 'peak');
const trailhead = world.mainTrailhead || world.places.find((p) => p.kind === 'trailhead');
const state = {
  hour: 7.25, day: 1, km: 0,
  discovered: new Set(),
  paused: true, started: false,
  sleeping: 0, resting: false,
  rescue: null, travel: null,
  seat: -1,                 // the camp stool you're sitting on
  ask: null,                // a yes/no question for you
  cut: null,                // a scripted moment (walking to the tent)
};
let hudState = null; // the last thing the HUD showed; the map reads it too

function spawnAtCar() {
  const { x, z, toward } = world.startSpot || { ...trailhead, toward: [trailhead.x - 1, trailhead.z] };
  // face up the trail toward the mountains
  hiker.place(x, z, Math.atan2(-(toward[0] - x), -(toward[1] - z)));
}

/** Park the four-wheeler by the car, nose toward the trail. */
function parkATV() {
  const sp = world.startSpot;
  if (!sp) { atv.place(hiker.pos.x + 4, hiker.pos.z, hiker.yaw); return; }
  const yaw = Math.atan2(-(sp.toward[0] - sp.x), -(sp.toward[1] - sp.z));
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (const [r, f] of [[3.4, 1], [-3.4, 1], [3.4, -2], [-3.4, -2], [6, 3], [-6, 3]]) {
    const x = sp.x + rx * r + fx * f, z = sp.z + rz * r + fz * f;
    if (!world.lakeAt(x, z) && world.localGrade(x, z) < 0.25 && world.nearestTrail(x, z).d > 2.5) { atv.place(x, z, yaw); return; }
  }
  atv.place(sp.x + rx * 3.4, sp.z + rz * 3.4, yaw);
}

function save() {
  const data = {
    x: hiker.pos.x, z: hiker.pos.z, yaw: hiker.yaw, hour: state.hour, day: state.day, km: state.km,
    atv: { x: atv.pos.x, z: atv.pos.z, yaw: atv.yaw }, fish: fishing.save(), roast: { eaten: roast.eaten, perfect: roast.perfect }, wood: wood.save(), coffee: coffee.save(), breakfast: breakfast.save(),
    discovered: [...state.discovered], camp: camp.save(), companion: companion.save(),
    stamina: hiker.stamina, warmth: hiker.warmth, weather: weather.save(),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

function restore() {
  const s = loadJSON(SAVE_KEY, null);
  if (!s) return false;
  hiker.place(s.x, s.z, s.yaw);
  Object.assign(state, { hour: s.hour, day: s.day, km: s.km || 0 });
  state.discovered = new Set(s.discovered || []);
  hiker.stamina = s.stamina ?? 100; hiker.warmth = s.warmth ?? 100;
  if (s.atv) atv.place(s.atv.x, s.atv.z, s.atv.yaw);
  fishing.load(s.fish);
  roast.eaten = s.roast?.eaten || 0; roast.perfect = s.roast?.perfect || 0;
  wood.load(s.wood);
  coffee.load(s.coffee);
  breakfast.load(s.breakfast);
  camp.load(s.camp);
  wood.setCamp(camp.tent);
  companion.load(s.companion, hiker.pos);
  weather.load(s.weather);
  return true;
}

const hasSave = !!loadJSON(SAVE_KEY, null);
spawnAtCar();
parkATV();
$('btn-continue').classList.toggle('hidden', !hasSave);

// ------------------------------------------------------------------ input
const input = new Input(renderer.domElement);
const { keys, pressed } = input;
if (isTouch) input.enableTouch(document.body);
document.addEventListener('visibilitychange', () => { if (document.hidden && state.started && !state.paused) pause(true); });
input.onPress = (code) => {
  if (!state.started || state.travel) return;
  if (state.ask) { if (code === 'KeyY') answerAsk(true); else if (code === 'KeyN' || code === 'Escape') answerAsk(false); return; }
  if (code === 'Escape' && map.open) { toggleMap(); return; }
  if ((code === 'KeyM' || code === 'Tab') && !state.paused) toggleMap();
  if (code === 'KeyG' && !state.paused && !map.open) toggleTogether();
  if (state.together && code.startsWith('Digit')) { const b = $('together').querySelectorAll('button')[Number(code.slice(5)) - 1]; b?.click(); }
  if (state.together && code === 'Escape') { toggleTogether(false); return; }
  if (code === 'KeyV' && !state.paused && !map.open) {
    settings.view = rig.toggle();
    storeJSON('rawah-settings', settings);
    $('set-view').value = settings.view;
    hud.toast(settings.view === 'first' ? 'First person · [V] third person' : 'Third person · scroll to zoom · [V] first person');
  }
  if (code === 'Escape' && input.mode !== 'kbm') pause(!state.paused); // keyboard Escape releases pointer lock instead
};
input.onPad = (name, stickOnly) => {
  if (state.ask) { if (name === 'A') answerAsk(true); else if (name === 'B') answerAsk(false); return; }
  if (map.open) {
    if (name === 'B') toggleMap();
    else map.pad(name, stickOnly);
    return;
  }
  if (state.together) {
    if (name === 'B') toggleTogether(false);
    else menuPad($('together'), name);
    return;
  }
  // D-pad up while hiking: do something together
  if (name === 'Up' && !stickOnly && state.started && !state.paused) { toggleTogether(); return; }
  if (name === 'Down' && !stickOnly && state.started && !state.paused) { pressed.add('KeyT'); return; }
  if (name === 'Left' && !stickOnly && state.started && !state.paused) { pressed.add('KeyQ'); return; }
  if (name === 'Right' && !stickOnly && state.started && !state.paused) { keys.add('KeyX'); setTimeout(() => keys.delete('KeyX'), 700); return; }
  const sheet = !$('controls-sheet').classList.contains('hidden') ? $('controls-sheet') : null;
  const screen = sheet || (!state.started ? $('title') : state.paused ? $('pause') : null);
  if (sheet && (name === 'B' || name === 'Start')) { closeControls(); return; }
  if (screen === $('pause') && (name === 'LB' || name === 'RB')) { cycleTab(name === 'RB' ? 1 : -1); return; }
  if (screen) menuPad(screen, name);
};
renderer.domElement.addEventListener('click', () => { if (state.started && !state.paused) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && state.started && !map.open && !state.sleeping && !state.travel && !state.together && !state.ask) pause(true);
});

/** Gamepad focus for menus: D-pad or stick moves, A presses, left/right adjusts sliders, B backs out. */
function menuPad(screen, name) {
  const items = [...screen.querySelectorAll('button, input, select')].filter((el) => el.offsetParent && !el.disabled);
  if (!items.length) return;
  let i = items.indexOf(document.activeElement);
  const focus = (j) => {
    for (const el of items) el.classList.remove('pad-focus');
    const el = items[(j + items.length) % items.length];
    el.focus({ preventScroll: false });
    el.classList.add('pad-focus');
    el.scrollIntoView({ block: 'nearest' });
  };
  if (i < 0) { focus(0); if (name !== 'A') return; i = 0; }
  const el = items[i];
  const adjust = (dir) => {
    if (el.type === 'range') {
      el.value = Number(el.value) + dir * Number(el.step || 1);
      el.dispatchEvent(new Event('input'));
      return true;
    }
    if (el.tagName === 'SELECT') {
      el.selectedIndex = clamp(el.selectedIndex + dir, 0, el.options.length - 1);
      el.dispatchEvent(new Event('change'));
      return true;
    }
    return false;
  };
  if (name === 'Down') focus(i + 1);
  else if (name === 'Up') focus(i - 1);
  else if (name === 'Left') { if (!adjust(-1)) focus(i - 1); }
  else if (name === 'Right') { if (!adjust(1)) focus(i + 1); }
  else if (name === 'A') {
    if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
    else if (el.tagName === 'BUTTON') el.click();
  } else if ((name === 'B' || name === 'Start') && state.paused && state.started) pause(false);
  else if (name === 'Start' && !state.started) (hasSave ? $('btn-continue') : $('btn-start')).click();
}

function lockPointer() {
  if (isTouch) return;
  try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch { /* headless */ }
}

function toggleMap() {
  if (map.open) {
    map.hide();
    document.body.classList.remove('map-open');
    lockPointer();
    return;
  }
  if (!hudState) return;
  map.show(hudState);
  document.body.classList.add('map-open');
  const pad = (b, cls = '') => `<span class="key pad ${cls}">${b}</span>`;
  $('map-close').innerHTML = input.mode === 'pad'
    ? `<span>${pad('LS')} cursor</span><span>${pad('LT')}${pad('RT')} zoom</span><span>${pad('A', 'a')} travel</span><span>${pad('Y', 'y')} find me</span><span>${pad('B', 'b')} close</span>`
    : input.mode === 'touch' ? '<span>Tap a place · pinch to zoom</span><span class="key">Close</span>'
      : `<span>Click to pick · double-click to travel · scroll to zoom</span><span>${keyCap('M', 'kbm')} close</span>`;
  if (document.pointerLockElement) document.exitPointerLock();
}
map.onClose = () => { if (map.open) toggleMap(); };

// ------------------------------------------------------------------ together
// Close to your partner, [G] (D-pad up, or the Pal button) opens a small menu.
function raceGoal() {
  const p = hiker.pos, fx = -Math.sin(hiker.yaw), fz = -Math.cos(hiker.yaw);
  let best = null, bs = Infinity;
  for (const q of world.places) {
    if (q.kind === 'trailhead') continue;
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d < 150 || d > 2200) continue;
    const s = d * (1.6 - (dx * fx + dz * fz) / d);   // nearby, and roughly ahead
    if (s < bs) { bs = s; best = q; }
  }
  return best;
}
function toggleTogether(on = !state.together) {
  if (on && Math.hypot(companion.pos.x - hiker.pos.x, companion.pos.z - hiker.pos.z) > 8) { hud.toast(`${companion.name} is too far away to hear you.`); return; }
  state.together = on;
  const el = $('together');
  el.classList.toggle('hidden', !on);
  if (!on) { lockPointer(); return; }
  const goal = raceGoal();
  const opts = [
    ['together', 'Hike together', 'Stay close and keep pace'],
    ['free', 'Explore on your own', 'Wander, find views, catch up later'],
    ['rest', 'Take a break', 'Sit down right here'],
    ...(goal ? [['race', `Race to ${goal.name}`, `${(Math.hypot(goal.x - hiker.pos.x, goal.z - hiker.pos.z) / 1000).toFixed(1)} km · first one there wins`]] : []),
  ];
  el.querySelector('.tg-name').textContent = companion.name;
  el.querySelector('.tg-mood').textContent = companion.energy < 40 ? 'Tired' : companion.curiosity > 70 ? 'Restless, wants to explore' : 'Happy to be out here';
  const list = el.querySelector('.tg-list');
  list.innerHTML = '';
  opts.forEach(([cmd, title, sub], i) => {
    const b = document.createElement('button');
    b.className = `tg-opt${companion.stance === cmd ? ' on' : ''}`;
    b.innerHTML = `<span class="key">${i + 1}</span><span><b></b><small></small></span>`;
    b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub;
    b.onclick = () => { companion.command(cmd, { goal }); toggleTogether(false); };
    list.appendChild(b);
  });
  if (document.pointerLockElement) document.exitPointerLock();
}
$('together-close').onclick = () => toggleTogether(false);
map.onTravel = (d) => startTravel(d);
$('btn-map').onclick = () => { pause(false); toggleMap(); };

function pause(on) {
  state.paused = on;
  document.body.classList.toggle('playing', state.started && !on);
  $('pause').classList.toggle('hidden', !on);
  if (on) { renderJournal(); keys.clear(); showTab('journal'); nightLabel(); }
  else { lockPointer(); restartArmed = 0; $('btn-restart').textContent = 'Start over'; }
}

// pause-sheet tabs (LB / RB on a pad)
const TABS = ['journal', 'settings', 'controls'];
let tab = 'journal';
function showTab(name) {
  tab = name;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === name);
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('hidden', p.dataset.panel !== name);
  if (name === 'controls') renderControls($('controls-pause'));
}
function cycleTab(dir) { showTab(TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length]); }
for (const b of document.querySelectorAll('.tab')) b.onclick = () => showTab(b.dataset.tab);

/** The controls reference, in three columns: keyboard and mouse, Xbox controller, touch. */
function renderControls(el) {
  const k = (c) => keyCap(c, 'kbm'), p = (b, cls = '') => `<span class="key pad ${cls}">${b}</span>`, t = (x) => `<span class="key">${x}</span>`;
  const col = (title, rows) => `<div><h4>${title}</h4><dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></div>`;
  el.innerHTML = [
    col('Keyboard &amp; mouse', [[k('W') + k('A') + k('S') + k('D'), 'Walk'], ['Mouse', 'Look'], [k('Shift'), 'Hike fast'], [k('Space'), 'Hop'],
      [k('E'), 'Grab rock / let go'], [k('C'), 'Pitch / pack tent'], [k('F'), 'Campfire'], [k('Z'), 'Sleep at tent · hold to rest'],
      [k('L'), 'Headlamp'], [k('G'), 'Do something together'], [k('R'), 'Ride the ATV / get off'], [k('T'), 'Cast a line / reel in'], [k('X'), 'Chop a tree / saw a log (hold)'], [k('B'), 'Drop your firewood'], [k('K'), 'Camp cooking: coffee, then bacon and eggs'], [k('H'), 'Sip your coffee'], [k('R'), 'Sit on a stool · take or stack firewood'], [k('Q'), 'Roast a marshmallow / eat it'], [k('V'), 'First / third person'], [k('M'), 'Map &amp; quick travel'], [k('Esc'), 'Pause']]),
    col('Xbox controller', [[p('LS'), 'Walk'], [p('RS'), 'Look'], [p('RT'), 'Hike fast'], [p('A', 'a'), 'Hop'], [p('B', 'b'), 'Grab rock / let go'],
      [p('X', 'x'), 'Pitch / pack tent'], [p('RB'), 'Campfire'], [p('LT'), 'Rest / sleep'], [p('LB'), 'Headlamp'], [p('↑'), 'Do something together'], [p('↓'), 'Cast a line / reel in'], [p('←'), 'Roast a marshmallow / eat it, or sip coffee away from the fire'], [p('→'), 'Chop / saw (hold)'], [p('L3'), 'Drop your firewood'], [p('Y', 'y'), 'Ride / get off the ATV'], [p('R3'), 'Camera'],
      [p('View'), 'Map &amp; quick travel'], [p('Menu'), 'Pause · menus: D-pad, ' + p('A', 'a') + ' ' + p('B', 'b')]]),
    col('Touch', [['Left thumb', 'Walk (floating stick)'], ['Right thumb', 'Look'], [t('Hop') + t('Grab'), 'Hop, grab rock'], [t('Fast'), 'Toggle hiking fast'],
      [t('Ride'), 'Climb on the ATV, get off'], [t('Camp') + t('Fire'), 'Tent, campfire'], [t('Rest'), 'Hold to rest or sleep'], [t('Pal'), 'Do something together'], [t('Fish'), 'Cast a line, reel in'], [t('Roast'), 'Marshmallow'], [t('Chop'), 'Axe (hold)'], [t('Drop'), 'Drop firewood'], [t('Map'), 'Map &amp; quick travel']]),
  ].join('');
}
function openControls() { renderControls($('controls-title')); $('controls-sheet').classList.remove('hidden'); }
function closeControls() { $('controls-sheet').classList.add('hidden'); }
$('btn-controls').onclick = openControls;
$('controls-close').onclick = closeControls;

function begin(fresh) {
  if (fresh) {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    camp.strike();
    Object.assign(state, { hour: 7.25, day: 1, km: 0 });
    state.discovered = new Set();
    hiker.stamina = hiker.warmth = 100;
    weather.load({ seed: (Math.random() * 1e9) | 0 });
    dismountATV();
    fishing.cancel();
    fishing.load(null);
    fishing.log = { caught: 0, best: null, species: {} };
    roast.eaten = roast.perfect = 0;
    wood.carried = 0; wood.campCount = 0; wood.cutTotal = 0; wood.setCamp(null);
    standUp(); roast.drop();
    spawnAtCar();
    parkATV();
    companion.load(null, hiker.pos);
    companion.stance = 'together';
  } else restore();
  updateCalendar();
  weather.settle(state.day, state.hour);
  state.started = true;
  if (isTouch) {
    try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* not allowed */ }
    try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* not supported */ }
  }
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  audio.start();
  audio.setVolume(settings.volume);
  pause(false);
  if (fresh) {
    const hello = `${trailhead.name} · ${ft(hiker.pos.y)} ft. Twin Crater Lakes are up the West Branch and Rawah trails.`;
    setTimeout(() => hud.toast(hello), 600);
    setTimeout(() => hud.toast('[M] map · [C] camp · [F] fire · [Z] sleep · [E] climb'), 5200);
    setTimeout(() => companion.event('hello'), 2500);
    setTimeout(() => hud.toast(`${companion.name} is hiking with you. [G] near them to do things together.`), 9800);
  }
}

$('btn-start').onclick = () => begin(true);
$('btn-continue').onclick = () => begin(false);
$('btn-resume').onclick = () => pause(false);
// starting over takes two presses, so it can't happen by accident
let restartArmed = 0;
$('btn-restart').onclick = () => {
  if (performance.now() - restartArmed < 4000) { begin(true); return; }
  restartArmed = performance.now();
  $('btn-restart').textContent = 'Press again to clear your journal';
  setTimeout(() => { if (performance.now() - restartArmed >= 3900) $('btn-restart').textContent = 'Start over'; }, 4000);
};

// season: the title-screen chips and the settings select both reload into the new season
function setSeason(name) {
  if (name === settings.season) return;
  settings.season = name;
  storeJSON('rawah-settings', settings);
  if (state.started) save();
  $('loading').classList.remove('hidden');
  $('load-text').textContent = `Turning the year to ${SEASONS[name].label.split(' · ')[1] || name}…`;
  location.reload();
}
for (const [key, sz] of Object.entries(SEASONS)) {
  const chip = document.createElement('button');
  chip.className = `chip${key === settings.season ? ' on' : ''}`;
  chip.textContent = sz.label.split(' · ')[0];
  chip.title = sz.label;
  chip.onclick = () => setSeason(key);
  $('season-chips').appendChild(chip);
  const opt = document.createElement('option');
  opt.value = key; opt.textContent = sz.label;
  $('set-season').appendChild(opt);
}
// who you are; your partner is the other one (reloads, since both are built at boot)
for (const [key, c] of Object.entries(CHARACTERS)) {
  const chip = document.createElement('button');
  chip.className = `chip${key === settings.hero ? ' on' : ''}`;
  chip.textContent = c.name;
  chip.onclick = () => { if (key === settings.hero) return; settings.hero = key; storeJSON('rawah-settings', settings); location.reload(); };
  $('hero-chips').appendChild(chip);
}
$('hero-note').textContent = `${CHARACTERS[PARTNER].name} hikes with you`;
$('season-note').textContent = SEASONS[settings.season].label.split(' · ')[1];
$('set-season').value = settings.season;
$('set-season').onchange = () => setSeason($('set-season').value);

// settings controls
const bindRange = (id, key, apply) => {
  const el = $(id);
  el.value = settings[key];
  el.oninput = () => { settings[key] = Number(el.value); apply?.(); storeJSON('rawah-settings', settings); };
};
bindRange('set-sens', 'sens');
bindRange('set-fov', 'fov', () => rig.setFov(settings.fov));
bindRange('set-volume', 'volume', () => audio.setVolume(settings.volume));
bindRange('set-time', 'timeScale');
$('set-quality').value = settings.quality || 'auto';
$('set-quality').onchange = () => {
  settings.quality = $('set-quality').value;
  storeJSON('rawah-settings', settings);
  if (state.started) save();
  location.reload();
};
$('set-weather').value = weather.override || 'live';
$('set-weather').onchange = () => {
  settings.weather = $('set-weather').value;
  weather.override = REGIMES[settings.weather] ? settings.weather : null;
  weather.settle(state.day, state.hour);
  storeJSON('rawah-settings', settings);
};
$('set-moon').value = settings.moon;
$('set-moon').onchange = () => { settings.moon = $('set-moon').value; sky.moon = MOONS[settings.moon]; storeJSON('rawah-settings', settings); };
// one button between night and day: night goes to 10:15 pm, and back returns to the hour you left
let dayHour = 12.9;
const _sunTmp = new THREE.Vector3();
const isNight = () => sunDirection(state.hour, _sunTmp).y < -0.05;
const nightLabel = () => { $('set-night').textContent = isNight() ? 'Switch to day' : 'Switch to night'; };
$('set-night').onclick = () => {
  if (isNight()) state.hour = dayHour;
  else { dayHour = state.hour; state.hour = 22.25; }
  weather.settle(state.day, state.hour);
  nightLabel();
  hud.toast(isNight() ? 'Night falls.' : 'Daylight.');
};
$('set-hour').onchange = () => {
  const raw = $('set-hour').value;
  $('set-hour').value = '';
  if (!raw) return;
  const h = Number(raw);
  state.hour = h;
  weather.settle(state.day, state.hour);
  nightLabel();
  hud.toast('The hours slip by…');
};
$('set-view').value = settings.view;
$('set-view').onchange = () => {
  if ($('set-view').value !== rig.mode) rig.toggle();
  settings.view = rig.mode;
  storeJSON('rawah-settings', settings);
};
$('set-shadows').checked = settings.shadows;
$('set-shadows').onchange = () => {
  settings.shadows = $('set-shadows').checked;
  renderer.shadowMap.enabled = settings.shadows;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  storeJSON('rawah-settings', settings);
};

function renderJournal() {
  const list = $('journal-list');
  list.innerHTML = '';
  const found = lakeList.filter((l) => state.discovered.has(l.label)).length;
  const bagged = peaks.filter((q) => state.discovered.has(`peak:${q.name}`)).length;
  $('pause-date').textContent = `Day ${state.day} · ${calendar.dateLabel} · ${clock(state.hour)}`;
  $('journal-forecast').textContent = weather.forecast;
  const stat = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  $('journal-stats').innerHTML = stat(`${found}/${lakeList.length}`, 'Lakes') + stat(`${bagged}/${peaks.length}`, 'Summits')
    + stat(state.km.toFixed(1), 'Km hiked') + stat(state.day, state.day === 1 ? 'Day' : 'Days') + stat(fishing.log.caught, 'Fish') + stat(roast.eaten, 'Marshmallows') + stat(wood.cutTotal, 'Logs');
  const add = (text, sub, done, cls = '') => {
    const li = document.createElement('li');
    li.className = `${done ? 'done' : ''} ${cls}`;
    li.innerHTML = '<span></span><small></small>';
    li.firstChild.textContent = text; li.lastChild.textContent = sub;
    list.appendChild(li);
  };
  add('Summits', '', false, 'head');
  [...peaks].sort((a, b) => b.elev - a.elev).forEach((q) => add(q.name, `${ft(q.elev)} ft`, state.discovered.has(`peak:${q.name}`)));
  if (fishing.log.caught) {
    add('Fishing', '', false, 'head');
    if (fishing.log.best) add(`Best: ${fishing.log.best.name}`, `${fishing.log.best.cm} cm · ${fishing.log.best.kg} kg`, true);
    for (const [k, n] of Object.entries(fishing.log.species)) add(k === 'cutthroat' ? 'Colorado River cutthroat' : `${k[0].toUpperCase()}${k.slice(1)} trout`, `${n} caught`, true);
  }
  add('Lakes', '', false, 'head');
  [...lakeList].sort((a, b) => b.level - a.level).forEach((l) => add(l.label, `${ft(l.level)} ft`, state.discovered.has(l.label)));
}

// ------------------------------------------------------------------ actions
function act() {
  const p = hiker.pos;
  const fx = -Math.sin(hiker.yaw), fz = -Math.cos(hiker.yaw);
  if (pressed.has('KeyC')) {
    if (camp.near(p, 'tent', 4)) {
      camp.strike(); const kept = wood.packUpCamp(); audio.zip(); hud.toast(kept ? `Camp packed up. ${kept} logs into your pack.` : 'Camp packed up.');
    } else if (hiker.mode !== 'walk' || !hiker.grounded) {
      hud.toast('Find solid ground first.');
    } else {
      const x = p.x + fx * 3, z = p.z + fz * 3;
      const why = camp.campProblem(x, z);
      if (why) hud.toast(why, 'warn');
      else {
        if (camp.tent) hud.toast('You packed up your old camp and moved it here.');
        camp.strike();
        camp.pitch(x, z, Math.atan2(-fx, -fz));
        wood.setCamp(camp.tent);
        companion.event('camp');
        audio.zip();
        hud.toast('Tent pitched. [Z] near the tent to sleep.');
        save();
      }
    }
  }
  if (pressed.has('KeyF')) {
    if (camp.fire && camp.near(p, 'fire', 5)) {
      // a log on the fire, if you have one; otherwise put it out
      if (wood.available(p) > 0) {
        if (camp.addFuel(60)) { wood.consume(p, 1); audio.strike(); hud.toast('You lay a log on the fire.'); }
        else hud.toast('The fire is roaring already.');
      } else { camp.douse(); hud.toast('Fire drowned and stirred cold. Nice.'); }
    } else {
      const x = p.x + fx * 2, z = p.z + fz * 2;
      const why = camp.fireProblem(x, z) || (wood.available(p) < 3 ? 'You need firewood: three logs. Chop a tree ([X]) and saw it up.' : null);
      if (why) hud.toast(why, 'warn');
      else { wood.consume(p, 3); camp.light(x, z); audio.strike(); hud.toast('Fire lit — two stools are set out. [R] to sit, [Q] for a marshmallow.'); companion.event('fire'); }
    }
  }
  if (pressed.has('KeyZ') && camp.near(p, 'tent', 4.5) && !state.sleeping) startSleep();
  if (pressed.has('KeyL')) { state.lamp = !state.lamp; audio.step('rock', 0); }
  state.resting = keys.has('KeyZ') && !camp.near(p, 'tent', 4.5) && hiker.mode === 'walk' && hiker.grounded && hiker.moving < 0.2;
}

// ------------------------------------------------------------------ the camp: stools and marshmallows
const _sp = new THREE.Vector3(), _zero = new THREE.Vector3();

/** The nearest stool within reach that Grant isn't on. */
function freeStool(p) {
  let best = -1, bd = 2.4;
  camp.stools.forEach((st, i) => {
    if (!st.obj.visible) return;
    if (companion.sitting && Math.hypot(companion.pos.x - st.x, companion.pos.z - st.z) < 0.8) return;
    const d = Math.hypot(st.x - p.x, st.z - p.z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function sitDown(i) {
  const st = camp.stools[i];
  hiker.place(st.x, st.z, st.yaw);
  hiker.sitting = true; hiker.face = st.yaw;
  state.seat = i;
  avatar.heading = st.yaw; if (avatar.avatar) avatar.avatar.heading = st.yaw;
  rig.eyeY = null;
  hud.toast(camp.fire ? '[R] stand up  ·  [Q] roast a marshmallow' : '[R] stand up');
}

function standUp() {
  if (state.seat < 0) return;
  const st = camp.stools[state.seat];
  hiker.sitting = false;
  state.seat = -1;
  // step back off the stool, away from the fire
  const fx = camp.fire ? camp.fire.x : st.x - Math.sin(st.yaw), fz = camp.fire ? camp.fire.z : st.z - Math.cos(st.yaw);
  const ax = st.x - fx, az = st.z - fz, al = Math.hypot(ax, az) || 1;
  hiker.place(st.x + (ax / al) * 0.7, st.z + (az / al) * 0.7, st.yaw);
  rig.eyeY = null;
}

/** One frame sitting: you look around, the stool holds you. */
function seatedStep(dt, env) {
  const st = camp.stools[state.seat];
  hiker.yaw -= ctl.lookX;
  hiker.pitch = clamp(hiker.pitch - ctl.lookY, -1.5, 1.5);
  hiker.face = st.yaw;
  _sp.set(st.x, world.height(st.x, st.z), st.z);
  const ev = hiker.carried(dt, _sp, _zero, env);
  hiker.sitting = true;
  return ev;
}

/** [Q]: a marshmallow on a stick, or eat the one you have. */
function marshmallow() {
  if (roast.active) {
    if (roast.extend > 0.35) { hud.toast('Pull it back from the flames first (let go of [Space]).'); return; }
    const r = roast.eat();
    audio.step('grass', 0.3);
    hud.discovery(r.label, r.perfect ? 'The perfect marshmallow' : `Marshmallow ${roast.eaten}`, 'You ate it');
    if (r.perfect) hiker.warmth = Math.min(100, hiker.warmth + 3);
    companion.event('smore');
    save();
    return;
  }
  const nearFire = camp.fire && Math.hypot(camp.fire.x - hiker.pos.x, camp.fire.z - hiker.pos.z) <= 4.8;
  if (!nearFire && coffee.sips > 0 && hiker.mode === 'walk') { coffee.sip(); return; }   // (the gamepad's only sip button)
  if (!camp.fire) { hud.toast('Light a campfire first: [F].'); return; }
  if (!nearFire) { hud.toast('Get closer to the fire.'); return; }
  roast.start();
  hud.toast('Hold [Space] to put it over the flames.');
}

// ------------------------------------------------------------------ "want to smash?"
const smash = { t: 0, wait: 16, cool: 0 };
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
const showChar = (c, on) => { if (c.model) c.model.visible = on; else if (c.avatar?.root) c.avatar.root.visible = on; };

/** While you toast marshmallows by the fire, Grant sometimes has an idea. */
function smashClock(dt) {
  smash.cool = Math.max(0, smash.cool - dt);
  const near = Math.hypot(companion.pos.x - hiker.pos.x, companion.pos.z - hiker.pos.z) < 8;
  const ok = roast.active && camp.tent && camp.fire && near && !state.ask && !state.cut && !atv.riding && !fishing.busy
    && Math.hypot(camp.tent.x - hiker.pos.x, camp.tent.z - hiker.pos.z) < 16 && smash.cool <= 0;
  if (!ok) { smash.t = Math.max(0, smash.t - dt * 0.5); return; }
  smash.t += dt;
  if (smash.t > smash.wait) askSmash();
}

function askSmash() {
  const hero = CHARACTERS[settings.hero].name;
  companion.speak(`${hero}, want to smash?`, 22);
  state.ask = { t: 0 };
  $('ask').querySelector('.ak-q').textContent = `${companion.name}: “${hero}, want to smash?”`;
  $('ask').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  smash.cool = 150; smash.t = 0; smash.wait = 14 + Math.random() * 10;
}

function answerAsk(yes) {
  if (!state.ask) return;
  state.ask = null;
  $('ask').classList.add('hidden');
  lockPointer();
  if (yes && camp.tent) startScene();
  else companion.speak(pickOne(['Your loss. More marshmallows for me.', 'Suit yourself. Pass the marshmallows.', 'Fair enough. Eyes on your stick, it\'s burning.']));
}
$('ask-yes').onclick = () => answerAsk(true);
$('ask-no').onclick = () => answerAsk(false);

/** You both get up, walk to the tent door and go in; the tent shakes for ten seconds; you come out. */
function startScene() {
  const t = camp.tent;
  standUp(); roast.drop(); fishing.cancel();
  const dx = Math.sin(t.yaw), dz = Math.cos(t.yaw), sx = Math.cos(t.yaw), sz = -Math.sin(t.yaw);   // out of the door, and across it
  const door = (side) => ({ x: t.x + dx * 1.45 + sx * side * 0.3, z: t.z + dz * 1.45 + sz * side * 0.3 });
  state.cut = { phase: 'walk', t: 0, a: door(1), b: door(-1), view: rig.mode };
  companion.go = state.cut.b;
  companion.sitting = false;
  if (rig.mode === 'first') { rig.toggle(); avatar.setFirstPerson(false); }
  rig.dist = Math.max(rig.dist, 5);
  keys.clear();
}

function endScene() {
  const C = state.cut;
  if (!C) return;
  showChar(avatar, true); showChar(partner, true);
  companion.go = null;
  if (C.view === 'first' && rig.mode === 'third') { rig.toggle(); avatar.setFirstPerson(true); }
  state.cut = null;
}

/** One frame of the scripted walk, the wait inside, and the way out. */
function cutStep(dt, env) {
  const C = state.cut, t = camp.tent, hp = hiker.pos;
  C.t += dt;
  const turn = (to, k) => { let d = to - hiker.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); hiker.yaw += d * Math.min(1, dt * k); };
  if (C.phase === 'walk') {
    const dx = C.a.x - hp.x, dz = C.a.z - hp.z, d = Math.hypot(dx, dz);
    const sp = d > 0.3 ? 2.1 : 0;
    _v.set(sp ? (dx / d) * sp : 0, 0, sp ? (dz / d) * sp : 0);
    _sp.set(hp.x + _v.x * dt, 0, hp.z + _v.z * dt); _sp.y = world.height(_sp.x, _sp.z);
    if (sp) turn(Math.atan2(-dx, -dz), 8);
    hiker.carried(dt, _sp, _v, env);
    hiker.moving = sp ? 1 : 0;
    hiker.phase += sp * dt * (Math.PI / 1.4);
    const cd = Math.hypot(companion.pos.x - C.b.x, companion.pos.z - C.b.z);
    if ((d < 0.35 && cd < 0.5) || C.t > 14) {
      // in through the flap
      C.phase = 'shake'; C.t = 0;
      audio.zip();
      showChar(avatar, false); showChar(partner, false);
      camp.shake(10);
    }
  } else if (C.phase === 'shake') {
    turn(t.yaw, 3);
    hiker.pitch += (-0.1 - hiker.pitch) * Math.min(1, dt * 2);
    _sp.set(hp.x, hp.y, hp.z);
    hiker.carried(dt, _sp, _zero, env);
    if (C.t > 10.4) {
      audio.zip();
      endScene();
      companion.speak('Ahhh… like old times.', 2);
      hud.toast('…and out they come.');
    }
  }
  return hiker.events;
}

// ------------------------------------------------------------------ the four-wheeler
const _seat = new THREE.Vector3();
const rider = { pos: _seat, vel: new THREE.Vector3(), phase: 0, moving: 0, mode: 'walk', sitting: true, lastGrade: 0, face: 0 };
let lookIdle = 0, rideCam = null, rideTold = true;

function mountATV() {
  fishing.cancel();
  standUp(); roast.drop();
  atv.mount();
  hiker.yaw = atv.yaw; hiker.pitch = -0.2;
  rideCam = rig.mode;
  if (rig.mode === 'first') { rig.toggle(); avatar.setFirstPerson(false); }
  rig.dist = Math.max(rig.dist, 5.2);
  rig.eyeY = null;
  const company = companion.boardATV(atv);
  atv.hold = company;
  rideTold = !company;
  hud.toast(company ? `${companion.name} is hopping on the back…` : '[W/S] throttle · [A/D] steer · [Shift] boost · [R] get off');
}

function dismountATV() {
  if (!atv.riding) return;
  const spot = atv.dismount();
  atv.hold = false;
  companion.leaveATV(atv);
  hiker.place(spot.x, spot.z, spot.yaw);
  hiker.sitting = false;
  if (rideCam === 'first' && rig.mode === 'third') { rig.toggle(); avatar.setFirstPerson(true); }
  rideCam = null;
  rig.eyeY = null;
}

/** One frame of riding; returns the hiker's events. */
function rideStep(dt, env) {
  atv.hold = companion.boarding;
  if (!rideTold && companion.ride) { rideTold = true; hud.toast('[W/S] throttle · [A/D] steer · [Shift] boost · [R] get off'); }
  hiker.yaw -= ctl.lookX;
  hiker.pitch = clamp(hiker.pitch - ctl.lookY, -1.5, 1.5);
  for (const e of atv.update(dt, ctl)) {
    if (e.type === 'bump') audio.thud(e.hard);
    else if (e.type === 'splash') { audio.splash(); hud.toast('Too deep for the ATV.', 'warn'); }
  }
  // the chase camera swings round behind the quad unless you're looking about
  lookIdle = Math.abs(ctl.lookX) + Math.abs(ctl.lookY) > 0.002 ? 0 : lookIdle + dt;
  if (lookIdle > 0.5 && atv.speed > 1) {
    let d = atv.yaw - hiker.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    hiker.yaw += d * Math.min(1, dt * 2.4);
    hiker.pitch += (-0.2 - hiker.pitch) * Math.min(1, dt * 1.5);
  }
  const fx = -Math.sin(atv.yaw), fz = -Math.cos(atv.yaw);
  const vel = _v.set(fx * atv.speed, 0, fz * atv.speed);
  return hiker.carried(dt, atv.pos, vel, env);
}
const _v = new THREE.Vector3();

function startSleep() {
  dismountATV();
  fishing.cancel();
  standUp(); roast.drop();
  const h = state.hour;
  const night = h >= 19 || h < 5;
  const target = night ? 7 : h + 2;
  state.sleeping = { from: h, to: target, t: 0, night };
  $('fade').classList.add('on');
  $('fade-text').textContent = night ? 'You crawl into your bag…' : 'A quick nap in the tent…';
  audio.zip();
}

function finishSleep() {
  const s = state.sleeping;
  let mins = (s.to - s.from) * 60;
  if (mins < 0) mins += 24 * 60;
  advanceClock(mins);
  weather.settle(state.day, state.hour);
  hiker.stamina = 100;
  if (camp.tent) companion.event('travel', { player: hiker.pos }); hiker.warmth = Math.max(hiker.warmth, 85); hiker.injured = 0; hiker.wet = 0;
  camp.douse();
  state.sleeping = 0;
  $('fade').classList.remove('on');
  hud.toast(s.night ? `Morning, day ${state.day}. ${weather.forecast}` : 'Rested.');
  save();
}

function advanceClock(mins) {
  state.hour += mins / 60;
  while (state.hour >= 24) { state.hour -= 24; state.day++; updateCalendar(); }
}

/** The date drives the sun, the season's weather mix, lake ice and snowpack. */
function updateCalendar() {
  calendar.setDay(state.day);
  setSun({ ...calendar.sun, doy: calendar.doy });
  weather.climate = calendar.climate;
  world.iceLine = calendar.iceLine;
  lakes.uniforms.uIceLine.value = world.iceLine;
}

function rescue(why) {
  dismountATV();
  fishing.cancel();
  standUp(); roast.drop();
  state.rescue = { t: 0 };
  $('fade').classList.add('on');
  $('fade-text').textContent = `${why} You limp back to ${camp.tent ? 'camp' : 'the car'}.`;
  audio.thud(true);
}

function finishRescue() {
  if (camp.tent) {
    const t = camp.tent;
    hiker.place(t.x + Math.sin(t.yaw) * 2.5, t.z + Math.cos(t.yaw) * 2.5, t.yaw);
  } else spawnAtCar();
  advanceClock(120);
  hiker.injured = 60; hiker.stamina = 40;
  companion.event('travel', { player: hiker.pos });
  state.rescue = null;
  $('fade').classList.remove('on');
}

// ------------------------------------------------------------------ quick travel
// Pick a place on the map and the camera lifts off, glides over the real
// terrain toward it, and settles back into your eyes on the ground there.

/** Where to actually stand for a destination: dry, walkable ground, facing something worth seeing. */
function landing(d) {
  const w = world, from = hiker.pos;
  const heading = Math.atan2(-(d.x - from.x), -(d.z - from.z));
  const ok = (x, z) => w.inBounds(x, z, 40) && !w.lakeAt(x, z) && w.localGrade(x, z) < 0.5 && (() => {
    const s = w.nearestStream(x, z);
    return !s.stream || s.d > s.stream.width / 2 + 1.5;
  })();
  const spiral = (x0, z0, r0, r1, step = 3) => {
    if (r0 === 0 && ok(x0, z0)) return [x0, z0];
    for (let r = Math.max(step, r0); r <= r1; r += step) {
      // prefer the side of the ring facing where you came from
      const a0 = Math.atan2(from.z - z0, from.x - x0);
      const n = Math.max(8, Math.round((r * 2 * Math.PI) / step));
      for (let k = 0; k < n; k++) {
        const a = a0 + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2 * Math.PI) / n;
        const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
        if (ok(x, z)) return [x, z];
      }
    }
    return [x0, z0];
  };
  if (d.kind === 'car' && w.startSpot) {
    const { x, z, toward } = w.startSpot;
    return { x, z, yaw: Math.atan2(-(toward[0] - x), -(toward[1] - z)) };
  }
  if (d.kind === 'tent') {
    const t = camp.tent;
    return { x: t.x + Math.sin(t.yaw) * 2.5, z: t.z + Math.cos(t.yaw) * 2.5, yaw: t.yaw };
  }
  if (d.kind === 'peak') {
    let bx = d.x, bz = d.z, bh = -Infinity;
    for (let dz = -24; dz <= 24; dz += 2) for (let dx = -24; dx <= 24; dx += 2) {
      const h = w.height(d.x + dx, d.z + dz);
      if (h > bh) { bh = h; bx = d.x + dx; bz = d.z + dz; }
    }
    return { x: bx, z: bz, yaw: heading };
  }
  const lake = d.lake || w.lakeAt(d.x, d.z);
  if (lake) {
    const r0 = Math.sqrt(lake.area / Math.PI) * 0.6;
    const [x, z] = spiral(lake.x, lake.z, r0, r0 + 600, 3);
    return { x, z, yaw: Math.atan2(-(lake.x - x), -(lake.z - z)) };
  }
  const [x, z] = spiral(d.x, d.z, 0, 120, 2);
  return { x, z, yaw: heading };
}

function startTravel(d) {
  dismountATV();
  fishing.cancel();
  standUp(); roast.drop(); endScene();
  document.body.classList.remove('map-open');
  const to = landing(d);
  const from = camera.position.clone();
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const groundY = world.height(to.x, to.z);
  // cruise above the highest ground on the way
  let top = -Infinity;
  for (let i = 0; i <= 48; i++) {
    const f = i / 48;
    top = Math.max(top, world.height(lerp(from.x, to.x, f), lerp(from.z, to.z, f)));
  }
  const cruise = Math.max(top + 90 + dist * 0.045, from.y + 40, groundY + 60);
  state.travel = {
    t: 0, dur: clamp(2.6 + dist / 2600, 2.6, 7), dist,
    from, q0: camera.quaternion.clone(),
    to: new THREE.Vector3(to.x, groundY + 1.68, to.z), yaw: to.yaw,
    cruise, name: d.kind === 'point' ? null : d.name,
  };
  hiker.place(to.x, to.z, to.yaw);
  keys.clear();
  lockPointer(); // still inside the click that chose the destination
  audio.whoosh?.(state.travel.dur);
}

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _look = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** Fly the camera; returns the point on the ground under it (for streaming trees and shadows). */
function flyStep(dt, focus) {
  const T = state.travel;
  T.t += dt;
  const u = clamp(T.t / T.dur, 0, 1);
  const s = u * u * u * (u * (u * 6 - 15) + 10); // smootherstep for the glide
  const x = lerp(T.from.x, T.to.x, s), z = lerp(T.from.z, T.to.z, s);
  const rise = ease(u / 0.42), fall = ease((u - 0.5) / 0.5);
  let y = lerp(lerp(T.from.y, T.cruise, rise), T.to.y, fall);
  if (u < 0.97) y = Math.max(y, world.height(x, z) + lerp(25, 1.6, fall));
  camera.position.set(x, y, z);
  // look ahead along the flight toward the destination, then settle level at the end
  const ahead = Math.min(1, s + 0.2);
  _look.set(lerp(T.from.x, T.to.x, ahead), 0, lerp(T.from.z, T.to.z, ahead));
  _look.lerp(T.to, 0.35 + 0.65 * fall);
  _look.y = world.height(_look.x, _look.z);
  if (_look.distanceTo(camera.position) < 1) _look.set(x - Math.sin(T.yaw), y, z - Math.cos(T.yaw));
  _m.lookAt(camera.position, _look, camera.up);
  _q.setFromRotationMatrix(_m);
  camera.quaternion.copy(T.q0).slerp(_q, ease(u / 0.3));
  camera.quaternion.slerp(_q.setFromEuler(_e.set(0, T.yaw, 0)), ease((u - 0.7) / 0.3));
  focus.set(x, world.height(x, z), z);
  if (u >= 1) {
    state.travel = null;
    camera.rotation.order = 'YXZ';
    rig.eyeY = null;
    while (flora.update(hiker.pos, 8) > 0) { /* finish the trees around you */ }
    if (T.name) hud.toast(`${T.name} · ${ft(hiker.pos.y)} ft`);
    companion.event('travel', { player: hiker.pos });
    save();
  }
  return u;
}

// ------------------------------------------------------------------ world queries
/** Air temperature: a late-September diurnal swing in the valley, the lapse rate with height, and the weather. */
function tempC(hour, elev) {
  const { mean, swing } = calendar.valley;
  const valley = mean + swing * Math.cos(((hour - 15) / 24) * Math.PI * 2) * (1 - weather.cloud * 0.45);
  return valley + weather.temp - ((elev - 2700) / 1000) * 6.5;
}

/** Elevation where the air is at freezing right now. */
function freezingLevel(hour) {
  return 2700 + (tempC(hour, 2700) - 0.5) / 6.5 * 1000;
}

function locate(p, cv) {
  const zone = cv.snag > 0.35 ? 'Cameron Peak Fire burn (2020)' : 'Rawah Wilderness';
  const lake = world.nearWater(p.x, p.z, 40);
  if (lake) return [lake.label, 'Lakeshore'];
  const t = world.nearestTrail(p.x, p.z);
  if (t.trail && t.d < 8) return [t.trail.name, t.trail.kind === 'trail' ? zone : 'Roosevelt National Forest'];
  const brook = world.nearestStream(p.x, p.z);
  if (brook.stream && brook.stream.name && brook.d < 15) return [brook.stream.name, zone];
  const { place, d } = world.nearestPlace(p.x, p.z, (q) => q.kind !== 'lake');
  if (place && d < 500) return [place.kind === 'peak' && d < 60 ? `${place.name} summit` : `Near ${place.name}`, zone];
  const e = p.y, tl = world.treeline(p.x, p.z);
  const where = cv.snag > 0.35 ? 'Burned forest' : e > tl + 60 ? 'Alpine tundra' : e > tl - 80 ? 'Treeline' : cv.aspen > 0.3 ? 'Aspen grove' : cv.forest > 0.3 ? 'Spruce-fir forest' : 'Subalpine meadow';
  return [where, `${zone} · off trail`];
}

const ft = (m) => Math.round(m * 3.28084).toLocaleString();

function latLon(p) {
  const nw = world.meta.nw;
  const lat = nw.lat - (p.z + world.half) / 111320;
  const lon = nw.lon + (p.x + world.half) / (111320 * Math.cos((nw.lat * Math.PI) / 180));
  return `${lat.toFixed(4)}° N, ${Math.abs(lon).toFixed(4)}° W`;
}

function clock(h) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

let lastDiscoveryCheck = 0;
function checkDiscoveries() {
  const p = hiker.pos;
  for (const l of lakeList) {
    if (state.discovered.has(l.label)) continue;
    const r = Math.sqrt(l.area / Math.PI) + 45;
    if (Math.hypot(l.x - p.x, l.z - p.z) < r) {
      state.discovered.add(l.label);
      const n = lakeList.filter((q) => state.discovered.has(q.label)).length;
      hud.discovery(l.label, `${ft(l.level)} ft · lake ${n} of ${lakeList.length}`);
      companion.event('lake', { place: l.label });
      save();
    }
  }
  for (const q of peaks) {
    const key = `peak:${q.name}`;
    if (state.discovered.has(key) || Math.hypot(q.x - p.x, q.z - p.z) > 35 || p.y < q.elev - 12) continue;
    state.discovered.add(key);
    const n = peaks.filter((o) => state.discovered.has(`peak:${o.name}`)).length;
    companion.event('summit', { place: q.name });
    hud.discovery(q.name, `${ft(q.elev)} ft · summit ${n} of ${peaks.length}${q.elev === Math.max(...peaks.map((o) => o.elev)) ? ' · the roof of the Rawah' : ''}`);
    save();
  }
}

// ------------------------------------------------------------------ loop
const eye = new THREE.Vector3(), flyFocus = new THREE.Vector3(), precipLight = new THREE.Color(), _snowBounce = new THREE.Color();
const ctl = { move: new THREE.Vector2(), sprint: false, jump: false, grab: false, lookX: 0, lookY: 0 };
let last = performance.now(), saveTimer = 0, floraTimer = 0, t = 0;

while (flora.update(hiker.pos, 8) > 0) { /* fill the first ring of trees */ }
setLoad(1, 'Ready');
$('loading').classList.add('hidden');
$('title').classList.remove('hidden');

/** Bring the culling data up to date for this frame's camera: the terrain skyline, the light's direction, the chunked meshes. */
const _toLight = new THREE.Vector3(), _eye2 = new THREE.Vector3(), _rf = new THREE.Vector3(), _rr = new THREE.Vector3(), _rh = new THREE.Vector3();
function cullView() {
  camera.updateMatrixWorld();
  horizon.update(camera.position, !state.travel);   // flying over the crest sees everything
  const lit = renderer.shadowMap.enabled && sky.sun.intensity > 0.02;
  _toLight.subVectors(sky.sun.position, sky.sun.target.position).normalize();
  flora.setView(camera, horizon, lit ? _toLight : null);
  trails.chunks.cull(horizon);
  streams.chunks.cull(horizon);
}

const _v2 = new THREE.Vector2();
/** Pixels per metre at one metre, for the fire's point sprites. */
function flameScale() {
  renderer.getDrawingBufferSize(_v2);
  return _v2.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

function tick(dt, draw = true) {
  t += dt;
  let gameMin = 0;
  const live = state.started && !state.paused && !state.sleeping && !state.rescue && !state.travel && !map.open;
  if (state.sleeping) {
    state.sleeping.t += dt;
    if (state.sleeping.t > 2.2) finishSleep();
  } else if (state.rescue) {
    state.rescue.t += dt;
    if (state.rescue.t > 2.6) finishRescue();
  }

  input.poll();
  const [lx, ly] = input.look(dt, settings.sens);
  ctl.lookX = live ? lx : 0;
  ctl.lookY = live ? ly : 0;
  input.move(ctl.move);
  if (map.open) map.analog(dt, input.padMove, input.padLook, input.trigger(6), input.trigger(7));
  if (!live) ctl.move.set(0, 0);
  ctl.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  ctl.jump = live && pressed.has('Space');
  ctl.grab = live && pressed.has('KeyE');
  // fishing: the lean (A/D or a mouse swing), the reel (held Space) and the hook (Space pressed); while a fish is on you stand and fight it
  const fishInp = { x: clamp(ctl.move.x + (ctl.lookX / Math.max(dt, 0.001)) / 3, -1, 1), reel: live && keys.has('Space'), hook: live && pressed.has('Space') };
  if (live && pressed.has('KeyT') && !atv.riding && !state.together) {
    fishing.toggle({ pos: hiker.pos, yaw: hiker.yaw, mode: hiker.mode, grounded: hiker.grounded });
  }
  if (fishing.locked) { ctl.move.set(0, 0); ctl.jump = false; ctl.lookX = 0; ctl.lookY = 0; }
  if (roast.active || state.seat >= 0) ctl.jump = false;   // Space reaches the stick, not a hop
  if (wood.working) { ctl.move.set(0, 0); ctl.jump = false; }   // planted on your feet while the axe swings
  if (state.seat >= 0 || state.cut) ctl.move.set(0, 0);
  if (state.cut) { ctl.jump = false; ctl.lookX = 0; ctl.lookY = 0; }

  const p = hiker.pos;
  const env = {
    tempC: tempC(state.hour, p.y) - (p.y > world.treeline(p.x, p.z) ? 3 : 0) - Math.max(0, weather.wind) * 3 - (atv.riding ? Math.abs(atv.speed) * 0.3 : 0),
    nearFire: !!camp.fire && camp.near(p, 'fire', 6),
    inTent: !!state.sleeping,
    resting: state.resting,
  };
  if (live) {
    const before = hiker.pos.clone();
    const events = state.cut ? cutStep(dt, env) : state.seat >= 0 ? seatedStep(dt, env) : atv.riding ? rideStep(dt, env) : hiker.update(dt, ctl, env);
    state.km += Math.hypot(p.x - before.x, p.z - before.z) / 1000;
    for (const e of events) {
      if (e.type === 'step') audio.step(e.surface, e.speed);
      else if (e.type === 'land') { audio.thud(e.hard); rig.land(e.fall); }
      else if (e.type === 'splash') { audio.splash(); hud.toast('Brrr — snowmelt water.', 'warn'); }
      else if (e.type === 'grab') audio.step('rock', 2);
      else if (e.type === 'toast') hud.toast(e.text, e.warn ? 'warn' : '');
      else if (e.type === 'fall') {
        if (e.severe) rescue(e.why);
        else { audio.thud(true); rig.land(8); hud.toast(e.why, 'warn'); }
      }
    }
    // [R]: get off the ATV or stand up; or climb on whichever of the ATV and a free stool is closer
    if (state.cut) { /* a moment is playing out */ }
    else if (state.seat >= 0 && (pressed.has('KeyR') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => pressed.has(k)))) standUp();
    else if (pressed.has('KeyR')) {
      const si = freeStool(p);
      const dStool = si >= 0 ? Math.hypot(camp.stools[si].x - p.x, camp.stools[si].z - p.z) : Infinity;
      const dAtv = atv.near(p) ? Math.hypot(atv.pos.x - p.x, atv.pos.z - p.z) : Infinity;
      const dWood = Math.min(wood.stackDist(p), wood.carried > 0 || wood.campCount > 0 ? wood.pileDist(p) : Infinity);
      const dCof = coffee.reach(p, hiker.yaw), dBrk = breakfast.reach(p, hiker.yaw);
      if (atv.riding) dismountATV();
      else if (dBrk < dCof && !fishing.busy && hiker.mode === 'walk') { if (breakfast.interact()) save(); }
      else if (dCof < Infinity && !fishing.busy && hiker.mode === 'walk') { if (coffee.interact(p)) save(); }
      else if (dWood < 3.2 && dWood < dStool && dWood < dAtv && !fishing.busy) { const r = wood.interact(p); if (r) save(); }
      else if (!fishing.busy && hiker.mode === 'walk' && hiker.grounded && dStool < dAtv && dStool < Infinity) sitDown(si);
      else if (dAtv < Infinity && hiker.mode === 'walk' && hiker.grounded) mountATV();
    }
    if (pressed.has('KeyQ') && !atv.riding && !fishing.busy && !state.cut) marshmallow();
    if (pressed.has('KeyK') && !atv.riding && !fishing.busy && !state.cut && state.seat < 0 && hiker.mode === 'walk' && (coffee.rigged ? breakfast.start(true, camp.fire, hiker.pos) : coffee.rig(camp.fire, hiker.pos))) save();
    if (pressed.has('KeyH') && !atv.riding && !fishing.busy && !state.cut && hiker.mode === 'walk' && !state.sleeping) coffee.sip();
    if (pressed.has('KeyB') && !atv.riding && state.seat < 0 && !fishing.busy && !state.cut && wood.drop({ pos: hiker.pos, yaw: hiker.yaw }, rig.mode === 'first' ? hiker.yaw : avatar.heading)) save();
    if (state.cut || fishing.locked) { /* hands full */ } else if (atv.riding || state.seat >= 0) { if (pressed.has('KeyL')) { state.lamp = !state.lamp; audio.step('rock', 0); } state.resting = false; } else act();
    // caught out in it: rain soaks you (less under thick forest), wet snow too
    const soak = weather.precip * (1 - weather.snowK * 0.6) * (1 - world.coverAt(p.x, p.z, 0) * 0.5);
    if (soak > 0.2 && hiker.mode !== 'swim') hiker.wet = Math.max(hiker.wet, 30 * soak);
    const scale = (state.resting ? 8 : 1) * settings.timeScale;
    gameMin = dt * scale;
    advanceClock(gameMin);
    camp.update(dt, dt * scale, t, flameScale());
    smashClock(dt);
    if (state.ask) { state.ask.t += dt; if (state.ask.t > 25) answerAsk(false); }
    if (t - lastDiscoveryCheck > 0.5) { lastDiscoveryCheck = t; checkDiscoveries(); }
    saveTimer += dt;
    if (saveTimer > 10) { saveTimer = 0; save(); }
  } else {
    camp.update(dt, 0, t, flameScale());
  }
  input.endFrame();

  if (atv.riding) {
    atv.seat(_seat);
    rider.face = atv.yaw;
    avatar.heading = atv.yaw; if (avatar.avatar) avatar.avatar.heading = atv.yaw;
    avatar.update(dt, rider);
  } else avatar.update(dt, hiker);
  if (fishing.locked && state.started && !state.paused) {
    // the view follows the fish: turn and tip down to keep it in sight as it comes in
    const eyeP = hiker.eye(_eye2), dx = fishing.focus.x - eyeP.x, dz = fishing.focus.z - eyeP.z, dy = fishing.focus.y - eyeP.y;
    const k = Math.min(1, dt * 2.5), horiz = Math.hypot(dx, dz);
    let dyaw = Math.atan2(-dx, -dz) - hiker.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    if (horiz > 1.2) hiker.yaw += dyaw * k * 0.8;
    hiker.pitch += (clamp(Math.atan2(dy, Math.max(horiz, 0.5)) + 0.12, -1.1, 0.2) - hiker.pitch) * k;
  }
  if (state.started && !state.paused && !state.travel && !state.sleeping) {
    const free = live && !atv.riding && state.seat < 0 && !state.cut && !fishing.busy && !roast.active && hiker.mode === 'walk' && hiker.grounded;
    for (const e of wood.update(dt, { pos: hiker.pos, yaw: hiker.yaw }, { chop: keys.has('KeyX'), free, carryVisible: state.seat < 0 && !atv.riding && !state.cut, heading: avatar.heading, first: rig.mode === 'first' })) {
      if (e.type === 'toast') hud.toast(e.text, e.warn ? 'warn' : '');
      else if (e.type === 'sound') audio[e.name]?.();
      else if (e.type === 'shake') { if (Math.hypot(e.x - hiker.pos.x, e.z - hiker.pos.z) < 70) rig.land(5 * e.amount); }
    }
  }
  if (state.started) {
    coffee.update(state.paused ? 0 : dt, {
      fire: camp.fire, tent: camp.tent, p: hiker.pos, yaw: hiker.yaw, heading: state.seat >= 0 ? camp.stools[state.seat].yaw : (rig.mode === 'first' ? hiker.yaw : avatar.heading),
      first: rig.mode === 'first', camera, seated: state.seat >= 0, minutes: state.paused ? 0 : gameMin,
    });
    camp.fireObj.setTeepee(!coffee.rigged);
    breakfast.update(state.paused ? 0 : dt, { on: coffee.rigged && !!camp.fire, fire: camp.fire, p: hiker.pos, yaw: hiker.yaw, seated: state.seat >= 0, coffeeReach: coffee.reach(hiker.pos, hiker.yaw) });
    for (const e of breakfast.events) {
      if (e.type === 'toast') hud.toast(e.text, e.warn ? 'warn' : '');
      else if (e.type === 'sound') audio[e.name]?.();
      else if (e.type === 'ready') {
        audio.ready();
        hud.discovery('Breakfast is ready', 'Bacon and eggs, hot off the grate', 'Cooked');
        if (Math.hypot(companion.pos.x - hiker.pos.x, companion.pos.z - hiker.pos.z) < 12) companion.speak('That smells amazing. Save me some!', 30);
      } else if (e.type === 'eat') {
        audio.sip();
        coffeeBoost += 45 * e.q; hiker.warmth = Math.min(100, hiker.warmth + 12 * e.q);
        hud.discovery(e.label, `Breakfast ${breakfast.eaten}`, 'You ate');
        companion.event('smore');
        save();
      }
    }
    for (const e of coffee.events) {
      if (e.type === 'toast') hud.toast(e.text, e.warn ? 'warn' : '');
      else if (e.type === 'sound') audio[e.name]?.();
      else if (e.type === 'ready') {
        audio.ready();
        hud.discovery('Coffee is ready', 'The percolator has finished perking', 'Brewed');
        if (Math.hypot(companion.pos.x - hiker.pos.x, companion.pos.z - hiker.pos.z) < 12) companion.speak('Coffee smells ready!', 30);
      } else if (e.type === 'sip') {
        audio.sip();
        coffeeBoost += 24 * e.q; hiker.warmth = Math.min(100, hiker.warmth + 3 * e.q);
        hud.toast(e.left > 0 ? `${e.q > 0.75 ? 'Hot' : e.q > 0.55 ? 'Warm' : 'Lukewarm'} coffee · ${e.left} sip${e.left > 1 ? 's' : ''} left` : 'That was the last sip. Brew more at the fire.');
        save();
      }
    }
    if (coffeeBoost > 0 && !state.paused) { const d = Math.min(coffeeBoost, 14 * dt); hiker.stamina = Math.min(100, hiker.stamina + d); coffeeBoost -= d; }
  }
  if (roast.active) {
    const sy = Math.sin(hiker.yaw), cy = Math.cos(hiker.yaw);
    const f = camp.fire;
    _rf.set(-sy, 0, -cy); _rr.set(cy, 0, -sy);
    _rh.set(hiker.pos.x + _rr.x * 0.26 + _rf.x * 0.3, hiker.pos.y + (state.seat >= 0 ? 0.8 : 1.08), hiker.pos.z + _rr.z * 0.26 + _rf.z * 0.3);
    roast.update(state.paused ? 0 : dt, {
      hand: _rh, fwd: _rf, right: _rr, t,
      fire: f ? { x: f.x, z: f.z, y: camp.flameBase, fuel: Math.min(1, f.life / 25) } : null,
      hold: live && keys.has('Space'),
    });
  }
  if (state.started && !state.paused && !state.travel && !state.sleeping) {
    for (const e of fishing.update(dt, { pos: hiker.pos, yaw: hiker.yaw, pitch: hiker.pitch, mode: hiker.mode }, fishInp)) {
      if (e.type === 'toast') hud.toast(e.text, e.warn ? 'warn' : '');
      else if (e.type === 'sound') { if (e.name === 'splash') audio.splash(); else if (e.name === 'reel') audio.reel(); else audio.whoosh?.(0.35); }
      else if (e.type === 'catch') {
        const f = e.fish;
        hud.discovery(f.name, `${f.cm} cm · ${f.kg} kg · fish ${f.n}${f.record ? ' · your biggest yet' : ''}`, 'Caught');
        companion.event('fish');
        save();
      }
    }
  }
  const zoom = input.takeWheel();
  let focus = p;
  if (state.travel) {
    // stream trees under the flight first, then around where you'll land
    const u = flyStep(dt, flyFocus);
    focus = flyFocus;
    cullView();
    flora.update(u < 0.55 ? flyFocus : p, 2, dt);
  } else {
    rig.update(dt, { zoom: map.open ? 0 : zoom, sprinting: atv.riding ? ctl.sprint && atv.speed > 6 : ctl.sprint && hiker.moving > 0.5 && hiker.stamina > 2, strafe: ctl.move.x });
    floraTimer += dt;
    cullView();
    flora.update(p, floraTimer > 0.12 ? 1 : 0, dt);
    if (floraTimer > 0.12) floraTimer = 0;
  }
  eye.copy(camera.position);

  camera.updateMatrixWorld();
  terrain.update(camera);
  // weather: eases toward the day's schedule; lightning, rain on you, warnings
  weather.update(state.paused ? 0 : dt, gameMin, state.day, state.hour, tempC(state.hour, p.y) - weather.temp, smoothstep(-0.05, 0.3, sky.sunDir.y), freezingLevel(state.hour));
  for (const e of weather.events) if (e.type === 'bolt') { audio.thunder?.(e.dist); if (e.dist < 1500) input.rumble(0.6 * (1 - e.dist / 1500), 0.3, 400); }
  atmosphere.uWet.value = weather.wet;
  // fresh snow from the weather on top of the season's snowpack
  const packLine = calendar.snowLine, fresh = weather.snowCover > 0.02;
  atmosphere.uSnow.value = Math.max(weather.snowCover, packLine < 4500 ? 1 : 0);
  atmosphere.uSnowLine.value = Math.min(fresh ? weather.snowLine : 5000, packLine);
  atmosphere.uGreen.value = clamp((0.78 - calendar.cure) / 0.7, 0, 1);
  sky.pixelRatio = renderer.getPixelRatio();
  sky.update(state.hour, eye, focus, t, weather);
  // snow underfoot bounces light back up into the shadows
  const onSnow = atmosphere.uSnow.value * smoothstep(atmosphere.uSnowLine.value - 60, atmosphere.uSnowLine.value + 60, p.y);
  sky.hemi.groundColor.lerp(_snowBounce.setScalar(0.55 * sky.light + 0.04), onSnow * 0.7);
  // eye adaptation: open up in flat grey light and at dusk, settle back in full sun
  const lum = sky.sun.intensity * Math.max(0, sky.sunDir.y) * (1 - sky.sunBlock * 0.8) + sky.hemi.intensity * 0.8 + onSnow * sky.light * 0.8;
  const targetExp = clamp(1.08 * Math.pow(3.4 / (lum + 0.3), 0.32), 0.85, 1.6);
  renderer.toneMappingExposure += (targetExp - renderer.toneMappingExposure) * Math.min(1, dt * 0.8);
  updateAtmosphere(sky, camera);
  // the day's breeze: still at dawn, gusty through the afternoon, settling at dusk
  const h = state.hour;
  flora.uniforms.uCalm.value = clamp(0.3 + 0.55 * smoothstep(9, 14, h) * (1 - smoothstep(18.5, 21.5, h)) + 0.15 * smoothstep(3200, 3700, p.y) + weather.wind * 0.6, 0.05, 1.35);
  const wspd = 2 + Math.max(0, weather.wind) * 9;
  precip.update(state.paused ? 0 : dt, camera, weather, [WIND_DIR[0] * wspd, WIND_DIR[1] * wspd], precipLight.copy(sky.hemi.color).multiplyScalar(0.2 + sky.light * 0.75 + weather.flash));
  const tC = tempC(h, p.y);
  grass.clear(camp.fire && [camp.fire.x, camp.fire.z, 1.9], camp.tent && [camp.tent.x, camp.tent.z, 3.0], ...wood.clearings(hiker.pos), ...dump.clearings(hiker.pos));
  grass.update(camera, hiker, clamp((1.5 - tC) / 4, 0, 1) * (1 - smoothstep(8.5, 10.5, h)) * (h > 3 ? 1 : 0), calendar.cure);
  headlamp.intensity = state.lamp ? 60 : 0;
  lakes.uniforms.uSky.value.copy(sky.uniforms.uHorizon.value).lerp(sky.uniforms.uZenith.value, 0.3);
  lakes.update(t);
  streams.update(t);

  // ambience
  const cv = world.cover(p.x, p.z, p.y);
  if (state.started && !state.paused && !state.travel) {
    const cEvents = [];
    companion.update(state.sleeping ? 0 : dt, {
      player: p, playerYaw: hiker.yaw, playerSpeed: Math.hypot(hiker.vel.x, hiker.vel.z),
      atv, stools: camp.fire ? camp.stools : null, seat: state.seat, tent: camp.tent, fire: camp.fire, hour: state.hour, weather, sun: sky.light, cover: cv,
      warmth: hiker.warmth, stamina: hiker.stamina, events: cEvents,
    });
    // you beat them there
    if (companion.stance === 'race' && Math.hypot(companion.target.x - p.x, companion.target.z - p.z) < 18) {
      hud.toast(`You beat ${companion.name} to ${companion.target.name}!`);
      companion.say('lose', { place: companion.target.name }, { force: true });
      companion.stance = 'together'; companion.activity = 'follow';
    }
    for (const e of cEvents) {
      if (e.type === 'race') hud.toast(`${companion.name} beat you to ${e.place}.`, 'warn');
      else if (e.type === 'drop') dump.drop(e.x, e.y, e.z);
    }
    dump.update(state.paused ? 0 : dt, p);
    for (const e of dump.events) audio[e.name]?.(e.v);
  }
  companion.drawBubble(camera, performance.now() / 1000);
  const brook = world.nearestStream(p.x, p.z);
  const creek = brook.stream ? Math.max(0, 1 - brook.d / (22 + brook.stream.width * 3)) * Math.min(1, 0.45 + brook.stream.width / 6) : 0;
  if (state.started && cv.snag > 0.45 && !state.inBurn) {
    state.inBurn = true;
    hud.toast('Burn scar — the Cameron Peak Fire swept through here in 2020.');
  } else if (cv.snag < 0.1) state.inBurn = false;
  const gust = gustAt(p.x, p.z, flora.uniforms.uTime.value, flora.uniforms.uCalm.value); // the gust you see in the grass
  const exposure = smoothstep(cv.treeline - 120, cv.treeline + 200, p.y);
  audio.engine(atv.riding && !state.paused, Math.min(1, Math.abs(atv.speed) / 14), atv.riding ? Math.max(0, ctl.move.y) : 0);
  audio.update(dt, {
    exposure, gust, forest: cv.forest, daylight: sky.light,
    dusk: (state.hour > 17.8 && state.hour < 20.5) || (state.hour > 5.8 && state.hour < 7.5),
    elevation: p.y, creek,
    rain: weather.precip * (1 - weather.snowK) * (state.sleeping ? 0.6 : 1), storm: weather.storm,
    fireDist: camp.fire ? Math.hypot(camp.fire.x - p.x, camp.fire.z - p.z) : 999,
  });

  if (state.started) {
    const [place, sub] = locate(p, cv);
    const found = lakeList.filter((l) => state.discovered.has(l.label)).length;
    const status = [hiker.mode === 'climb' ? 'Climbing' : hiker.mode === 'swim' ? 'Swimming' : hiker.sliding ? 'Sliding' : '',
      hiker.injured > 0 ? 'Sore ankle' : '', hiker.wet > 0 ? 'Wet' : '', hiker.cold ? 'Cold' : '', state.resting ? 'Resting' : '', state.seat >= 0 ? 'By the fire' : '', wood.carried > 0 ? `Firewood ×${wood.carried}` : '', coffee.cup.sips > 0 ? `Coffee ×${coffee.cup.sips}` : '', atv.riding ? `ATV · ${Math.round(Math.abs(atv.speed) * 3.6)} km/h` : '']
      .filter(Boolean).join(' · ');
    let hint = hiker.hint;
    if (state.cut) hint = '';
    else if (fishing.hint) hint = fishing.hint;
    else if (roast.active) hint = roast.hint;
    else if (wood.hint) hint = wood.hint;
    else if (breakfast.hint) hint = breakfast.hint;
    else if (coffee.hint || breakfast.tip) hint = [coffee.hint, breakfast.tip].filter(Boolean).join('  ·  ');
    else if (state.seat >= 0) hint = (camp.fire ? '[R] stand up  ·  [Q] roast a marshmallow' : '[R] stand up') + (coffee.cup.sips > 0 ? '  ·  [H] sip coffee' : '');
    else if (!hint && !atv.riding && freeStool(p) >= 0) hint = '[R] sit on the stool';
    else if (!hint && camp.fire && Math.hypot(camp.fire.x - p.x, camp.fire.z - p.z) < 3.8 && !fishing.busy) hint = '[Q] roast a marshmallow';
    else if (!hint && !atv.riding && !fishing.busy && fishing.spotAhead({ pos: hiker.pos, yaw: hiker.yaw, mode: hiker.mode })) hint = '[T] cast a line';
    if (atv.riding) hint = '[R] get off the ATV';
    else if (!hint && atv.near(p) && hiker.mode === 'walk') hint = '[R] ride the ATV';
    if (!hint && camp.near(p, 'tent', 4.5)) hint = state.hour >= 19 || state.hour < 5 ? '[Z] sleep until morning · [F] fire · [C] pack up' : '[Z] nap · [F] fire · [C] pack up';
    if (!hint && sky.light < 0.35 && !camp.tent && hiker.mode === 'walk') hint = 'Getting dark — find flat ground away from water and [C] make camp';
    if (!hint && sky.light < 0.2 && !state.lamp) hint = '[L] headlamp';
    if (!hint && Math.hypot(companion.pos.x - p.x, companion.pos.z - p.z) < 5) hint = `[G] ${companion.name}`;
    if (weather.storm > 0.4 && p.y > cv.treeline - 40) hint = 'Lightning on the crest. Get below treeline.';
    const wxLabel = weather.label;
    if (wxLabel !== state.wxLabel) {
      const say = { Thunderstorm: 'Thunder rolls off the crest. Storm coming.', Rain: 'Rain moving in.', Snow: 'It\'s snowing.', Sleet: 'Sleet stinging your face.', Fog: 'Fog settling in.', Clear: state.wxLabel ? 'The sky is clearing.' : '' }[wxLabel];
      if (say && state.wxLabel) hud.toast(say, wxLabel === 'Thunderstorm' ? 'warn' : '');
      if (state.wxLabel) companion.event(wxLabel);
      state.wxLabel = wxLabel;
    }
    hud.mode = input.mode;
    hud.update(hudState = {
      yaw: hiker.yaw, place, sub, elev: p.y, night: sky.sunDir.y < -0.03, coords: latLon(p),
      clock: `${calendar.dateLabel} · ${clock(state.hour)}`, tempC: env.tempC, wx: weather.label,
      stamina: hiker.stamina, warmth: hiker.warmth, grip: hiker.grip, climbing: hiker.mode === 'climb',
      hint, injured: hiker.injured > 0, status,
      discovered: state.discovered, tent: camp.tent, x: p.x, z: p.z,
      lakesFound: found, lakesTotal: lakeList.length, km: state.km,
      peaksFound: peaks.filter((q) => state.discovered.has(`peak:${q.name}`)).length, peaksTotal: peaks.length,
    });
  }
  if (map.open && hudState) map.draw(hudState);
  // the sun's shadows only change slowly: redraw them every other frame (always while flying)
  perf.frame++;
  renderer.shadowMap.needsUpdate = settings.shadows && (perf.frame % 2 === 0 || !!state.travel);
  if (draw) renderer.render(scene, camera);
}

// Adaptive resolution: hold the frame rate by trading pixels, measured over
// ~1.5 s windows so it settles instead of hunting. The HUD stays crisp; only
// the 3-D view scales.
const basePR = Math.min(devicePixelRatio, Q.dpr);
const perf = { scale: 1, acc: 0, n: 0, frame: 0 };
function adapt(rawDt) {
  if (rawDt > 0.25 || document.hidden) return;   // ignore stalls and background tabs
  perf.acc += rawDt; perf.n++;
  if (perf.acc < 1.5) return;
  const avg = perf.acc / perf.n;
  perf.acc = 0; perf.n = 0;
  let s = perf.scale;
  if (avg > 1 / 45) s *= 0.85;
  else if (avg > 1 / 54) s *= 0.94;
  else if (avg < 1 / 58) s *= 1.06;
  s = clamp(s, SCALE.min, SCALE.max);
  if (Math.abs(s - perf.scale) > 0.01) {
    perf.scale = s;
    renderer.setPixelRatio(basePR * s);
    renderer.setSize(innerWidth, innerHeight);
  }
}

function loop(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  adapt(raw);
  tick(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------ dev hooks (local only)
if (DEV) {
  window.__rawah = {
    world, hiker, camp, state, flora, terrain, renderer, scene, camera,
    begin, tick, save, rig, avatar, input,
    cam() { return rig.toggle(); },
    teleport(x, z, yaw = hiker.yaw) { hiker.place(x, z, yaw); while (flora.update(hiker.pos, 8) > 0); },
    goto(name) { const pl = world.places.find((q) => q.name === name); if (pl) this.teleport(pl.x, pl.z); return pl; },
    setHour(h) { state.hour = h; weather.settle(state.day, h); },
    weather(name) { weather.override = name || null; weather.settle(state.day, state.hour); return weather; },
    wx: weather,
    look(yaw, pitch = 0) { hiker.yaw = yaw; hiker.pitch = pitch; },
    press(code) { pressed.add(code); },
    map() { toggleMap(); },
    gmap: map, companion, coffee, dump, breakfast, grass, horizon, CULL, atv, fishing, sky, roast, camp, wood, sitDown, standUp, smash, askSmash, answerAsk, startScene, mountATV, dismountATV,
    travel(name) { if (!map.open) toggleMap(); const i = map.list.findIndex((d) => d.name === name); if (i >= 0) { map.pick(i); map.travel(); } return i; },
    hold(code, on = true) { if (on) keys.add(code); else keys.delete(code); },
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt, i === n - 1); },
  };
}

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? { ...(fallback || {}), ...JSON.parse(v) } : fallback; } catch { return fallback; }
}

function storeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
