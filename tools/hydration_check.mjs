// Does the hydration model give the numbers the literature gives?  node tools/hydration_check.mjs
// Prints sweat, breathing and total loss for typical situations, the heat index table, and a day's timeline for a hiker who
// does and does not drink, and fails if a number leaves its published range.
import { metabolic, sweatRate, breathRate, relativeHumidity, heatIndexC, heatCategory, Hydration, BODY_KG } from '../src/hydration.js';

const rows = [];
const fail = [];
function scenario(name, { tempC, rh, wind = 1, sunW = 80, elev = 2700, ...move }, range) {
  const a = metabolic(move);
  const s = sweatRate({ ...a, tempC, rh, wind, sunW, speed: move.speed || 0 });
  const b = breathRate({ vo2Lmin: a.vo2Lmin, tempC, rh, elev });
  const total = s.sweat + b + 0.06;
  rows.push({ scenario: name, MET: +(a.M / 110).toFixed(1), 'sweat L/h': +s.sweat.toFixed(2), 'breath L/h': +b.toFixed(2), 'total L/h': +total.toFixed(2), 'HI C': +heatIndexC(tempC, rh).toFixed(0) });
  if (range && (s.sweat < range[0] || s.sweat > range[1])) fail.push(`${name}: sweat ${s.sweat.toFixed(2)} L/h outside ${range}`);
}
const pack = 12;
scenario('sitting at camp, 15 C', { tempC: 15, rh: 0.5, sunW: 0, activity: 'rest' }, [0, 0.05]);
scenario('flat walk 4.8 km/h, 15 C', { tempC: 15, rh: 0.4, speed: 1.33, grade: 0, loadKg: pack }, [0.25, 0.6]);
scenario('climb 12% at 3.2 km/h, 15 C', { tempC: 15, rh: 0.4, speed: 0.9, grade: 0.12, loadKg: pack, sunW: 100 }, [0.5, 1.0]);
scenario('climb 12%, 30 C dry', { tempC: 30, rh: 0.3, speed: 0.9, grade: 0.12, loadKg: pack, sunW: 120 }, [0.8, 1.4]);
scenario('climb 12%, 33 C humid', { tempC: 33, rh: 0.7, speed: 0.9, grade: 0.12, loadKg: pack, sunW: 120 }, [1.1, 1.9]);
scenario('flat walk, -5 C', { tempC: -5, rh: 0.5, speed: 1.33, grade: 0, loadKg: pack, sunW: 0 }, [0.1, 0.5]);
scenario('running 10 km/h, 22 C', { tempC: 22, rh: 0.4, speed: 2.8, grade: 0, loadKg: 0 }, [0.7, 1.5]);
scenario('swimming, 12 C water', { tempC: 12, rh: 0.9, activity: 'swim', sunW: 0 });
scenario('chopping wood, 12 C', { tempC: 12, rh: 0.5, activity: 'work', sunW: 40 });
console.table(rows);

console.log('\nHeat index (NWS): temperature F x humidity');
const hi = [];
for (const f of [75, 80, 85, 90, 95, 100, 105]) {
  const r = { 'T (F)': f };
  for (const h of [0.2, 0.4, 0.6, 0.8]) r[`${h * 100}%`] = Math.round(heatIndexC(((f - 32) * 5) / 9, h) * 9 / 5 + 32);
  hi.push(r);
}
console.table(hi);
const ref = [[80, 0.4, 80], [90, 0.4, 91], [90, 0.7, 105], [96, 0.65, 121]];
for (const [f, h, want] of ref) {
  const got = Math.round(heatIndexC(((f - 32) * 5) / 9, h) * 9 / 5 + 32);
  if (Math.abs(got - want) > 3) fail.push(`heat index ${f} F ${h * 100}% = ${got} F, NWS table says about ${want}`);
}
console.log('humidity model, afternoon:', ['clear summer 22 C', 'monsoon rain 14 C', 'fog 6 C', 'dry autumn 15 C'].map((n, i) => {
  const rh = relativeHumidity([{ tempC: 22, doy: 196 }, { tempC: 14, doy: 196, precip: 0.9, cloud: 1 }, { tempC: 6, doy: 270, fog: 0.8 }, { tempC: 15, doy: 270 }][i]);
  return `${n}: ${(rh * 100).toFixed(0)}%`;
}).join(' | '));

// a hiking morning with and without drinking
function trip(drinkMlPer15) {
  const h = new Hydration();
  h.pace = 1;
  const env = { tempC: 22, rh: 0.35, wind: 1, sunW: 100, elev: 2900, speed: 1.1, grade: 0.07, loadKg: pack };
  const out = [];
  let drank = 0;
  for (let min = 0; min <= 240; min++) {
    h.update(60, env);
    if (drinkMlPer15 && min % 15 === 14) { drank += h.drink(drinkMlPer15 / 1000); }
    if (min % 60 === 0) out.push(`${min / 60}h ${h.pct.toFixed(1)}%`);
  }
  return { out: out.join('  '), end: h.pct, drank: +drank.toFixed(2), capacity: +h.capacity.toFixed(2) };
}
console.log('\n4 h hiking, 22 C, 35% RH, 7% grade, pack 12 kg:');
const none = trip(0), some = trip(240), lots = trip(400);
console.log('  no water        :', none.out, `| capacity ${none.capacity}`);
console.log('  240 mL / 15 min :', some.out, `| drank ${some.drank} L`);
console.log('  400 mL / 15 min :', lots.out, `| drank ${lots.drank} L`);
if (none.end < 3 || none.end > 7) fail.push(`no water for 4 h gave ${none.end.toFixed(1)}%: outside 3 to 7%`);
if (some.end > 2) fail.push(`a cup every 15 min should keep the loss under 2% (got ${some.end.toFixed(1)}%)`);

const sleepy = new Hydration();
sleepy.sleep(8, { tempC: 5, rh: 0.5, elev: 2900 });
console.log(`8 h asleep, no drinking: ${sleepy.pct.toFixed(2)}% (${(sleepy.deficit).toFixed(2)} L)`);
if (sleepy.pct < 0.3 || sleepy.pct > 1.4) fail.push('a night asleep without water should cost 0.3 to 1.4%');

// gulping: a litre in one go cannot be absorbed at once; the stomach holds only so much; a surplus is passed
{
  const h = new Hydration(); h.pace = 1;
  h.deficit = 1.5;
  const took = h.drink(2.0);
  h.update(1800, { tempC: 18, rh: 0.4, activity: 'rest' });
  console.log(`gulping 2 L at once: the stomach took ${took.toFixed(2)} L; after 30 min ${h.stomach.toFixed(2)} L still waiting, loss ${(h.deficit / BODY_KG * 100).toFixed(2)}%`);
  if (took > 1.31) fail.push('the stomach took more than it holds');
  if (h.stomach < 0.3) fail.push('a litre gulped should not all be absorbed in 30 minutes');
  const o = new Hydration(); o.pace = 1; o.deficit = -1.0;
  o.update(3600, { tempC: 18, rh: 0.4, activity: 'rest' });
  console.log(`over-full by 1 L, an hour at rest: ${(o.deficit).toFixed(2)} L (the kidneys shed the surplus)`);
  if (o.deficit < -0.5) fail.push('a surplus should be passed within the hour');
}
// untreated water and what each treatment leaves (src/gear.js)
{
  const { sourceHaz, sumH } = await import('../src/water.js');
  const avg = (kind) => { let t = 0, n = 0; for (let x = 0; x < 3000; x += 70) for (let z = 0; z < 3000; z += 70) { t += sumH(sourceHaz(kind, x, z)); n++; } return t / n; };
  const stream = avg('stream'), lake = avg('lake');
  const per = (h, litres) => 1 - Math.exp(-h * litres);
  console.log(`untreated, average spot: stream ${(stream * 100).toFixed(1)}%/L, lake ${(lake * 100).toFixed(1)}%/L; a hiker drinking 2 L a day for 5 days: stream ${(per(stream, 10) * 100).toFixed(0)}%, lake ${(per(lake, 10) * 100).toFixed(0)}%`);
  if (stream < 0.025 || stream > 0.07) fail.push('stream hazard off');
  if (per(stream, 10) < 0.2 || per(stream, 10) > 0.6) fail.push('5 days of untreated stream water should make a third of hikers ill, give or take');
  const h = sourceHaz('stream', 100, 100), tot = sumH(h);
  const left = { pump: (h.g + h.c + h.b) * 1e-3 + h.v, straw: (h.g + h.c) * 1e-3 + h.b * 1e-6 + h.v, boil: tot * 1e-6 };
  console.log('what is left per litre of a stream (untreated 100%):', Object.entries(left).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(2)}%`).join(' | '));
  if (left.pump / tot > 0.15 || left.pump / tot < 0.05) fail.push('a ceramic pump should leave about the virus share');
  if (left.boil / tot > 1e-5) fail.push('boiling should leave nothing');
  // iodine: the table at 10 C clear water (60 min)
  const req = 60, I = (t) => ({ g: 10 ** (-3 * Math.min(1, t / (req * 3))), c: 10 ** (-0.15 * Math.min(1, t / req)), b: 10 ** (-4 * Math.min(1, t / req)), v: 10 ** (-3 * Math.min(1, t / req)) });
  for (const t of [15, 30, 60, 180]) { const f = I(t); console.log(`iodine ${t} min: giardia ${(f.g * 100).toPrecision(2)}% crypto ${(f.c * 100).toFixed(0)}% bacteria ${(f.b * 100).toPrecision(2)}% virus ${(f.v * 100).toPrecision(2)}%`); }
  const after = I(60); const rem = h.g * after.g + h.c * after.c + h.b * after.b + h.v * after.v;
  console.log(`iodine after its hour leaves ${(rem / tot * 100).toFixed(0)}% of the risk (Giardia and Cryptosporidium are the rest)`);
  if (rem / tot < 0.1 || rem / tot > 0.5) fail.push('an hour of iodine should leave the protozoa share');
  let raw = 0, filt = 0;
  for (let i = 0; i < 4000; i++) { const a = new Hydration(), b = new Hydration(); if (a.swallowRaw(1, stream)) raw++; if (b.swallowRaw(1, left.pump)) filt++; }
  console.log(`one litre drunk: raw stream made ${(raw / 40).toFixed(1)}% ill, pumped ${(filt / 40).toFixed(2)}%`);
  const sick = new Hydration(); sick.pace = 4; sick.infected = { t: 1 };
  sick.update(2, { tempC: 18, rh: 0.4, activity: 'rest' });
  const at = sick.ill ? sick.ill.sev : 0;
  const before = sick.deficit;
  sick.update(600, { tempC: 18, rh: 0.4, activity: 'rest' });
  console.log(`a gut infection: severity ${at.toFixed(2)}, ten minutes costs ${(sick.deficit - before).toFixed(2)} L extra at pace 4, work capacity ${sick.capacity.toFixed(2)}`);
  if (!at) fail.push('the infection never started');
  if (sick.deficit - before < 0.08) fail.push('a gut infection should cost water');
}
if (fail.length) { console.error('\nFAIL\n - ' + fail.join('\n - ')); process.exit(1); }
console.log(`\nok: every number is inside its published range (body ${BODY_KG} kg).`);
