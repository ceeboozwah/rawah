// Hydration, from the physics of the body rather than a countdown. No browser or three.js here, so
// `tools/hydration_check.mjs` runs this same file against what the medical literature says.
//
// WATER BALANCE. The body holds water; what it loses it must drink back. `deficit` is litres below the euhydrated state
// (1 L of water is 1 kg, so deficit / body mass is the % of body mass lost, the quantity the guidance is written in).
// Losses, in litres per hour:
//   sweat       energy balance. The body makes heat H = metabolic power - external work (climbing). It sheds some by
//               convection and radiation (skin 34 C against the air, thinned by clothing, helped by wind) and takes
//               solar load. The rest must be evaporated: E_req. One litre of sweat evaporated takes 2.43 MJ, 674 W for an
//               hour. Humid air can evaporate only so much (E_max, from the skin-to-air vapour pressure gap, after
//               Gagge: 16.5 W/m2/kPa times the convective coefficient, clothing permeability and skin area), and the
//               sweat the air cannot take drips off, so a humid day costs more water for the same cooling. Capped at the
//               ~1.9 L/h of an unacclimatised person (published athletes range 0.5 to 2.5 L/h).
//   breath      ventilation times the water the air gains (saturated at body heat minus what it came in with), so dry,
//               cold, high air and hard work cost more.
//   basal       urine, skin and the gut: about 2.2 L/day with food supplying 0.7 of it; the kidneys conserve as you dry out
//               and shed the surplus when you are over-full.
//   illness     a gut infection (Giardia, Cryptosporidium, bacteria) adds diarrhoea and vomiting.
// The metabolic power comes from the ACSM walking and running equations (VO2 = 0.1 v + 1.8 v G + 3.5, and
// 0.2 v + 0.9 v G + 3.5, v in m/min, G the grade), scaled by body plus pack mass, at 20.9 J per ml of oxygen.
//
// INTAKE. Water drunk sits in the stomach and empties at up to ~1.2 L/h (faster when there is a lot in it), so gulping a
// litre does not hydrate you instantly, and a surplus is passed as urine. Guidance used: ACSM 2007 (keep the loss under 2% of
// body mass; replace what you sweat), NIOSH (about 1 cup, 237 mL, every 15 to 20 minutes working in heat, never over 1.4 L/h:
// more risks hyponatraemia), and the usual dehydration table (1 to 2%: thirst and a small drop in performance; 3 to 4%:
// headache, cramps, rising heat illness risk; 5 to 6%: heat exhaustion; 7 to 10%: delirium and collapse, life threatening).
// The heat index is the NWS Rothfusz regression. Water safety: a filter of 0.2 micron or finer removes protozoa and bacteria
// but not viruses, boiling for a minute kills all three (the Wilderness Medical Society, CDC and NPS guidance).

export const BODY_KG = 75;
export const BSA = 1.9;                // m2 of skin
const J_PER_ML_O2 = 20.9;
const SWEAT_MAX = 1.9;                 // L/h
const STOMACH_MAX = 1.3;               // L it will hold at once
const EVAP_W_PER_LH = 2.426e6 / 3600;  // 674 W per litre per hour

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ the air

/** Saturation vapour pressure, kPa (Tetens). */
export const psat = (tC) => 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));

/** Absolute humidity of saturated air at tC, g/m3. */
const ahSat = (tC) => (216.7 * psat(tC) * 10) / (tC + 273.15);

/**
 * Relative humidity (0..1) from what the weather is doing. There is no humidity in the weather model, so it is built the way the
 * air works: the dew point trails the temperature by a spread that is wide on a dry afternoon and closes in rain and fog.
 */
export function relativeHumidity({ tempC, doy = 200, fog = 0, precip = 0, cloud = 0, snow = 0 }) {
  const monsoon = doy >= 175 && doy < 245;
  const base = monsoon ? 10 : doy >= 120 && doy < 175 ? 13 : doy >= 245 && doy < 300 ? 14 : 9;
  let spread = base + 0.35 * Math.max(0, tempC - 12) - 3 * cloud - 8 * precip - 9 * fog;
  spread = clamp(spread, 0.3, 30);
  const td = tempC - spread;
  return clamp(psat(td) / psat(tempC), 0.08, 1);
}

/** NWS heat index, deg C, from air temperature (deg C) and relative humidity (0..1) (Rothfusz regression with its adjustments). */
export function heatIndexC(tC, rh01) {
  const T = (tC * 9) / 5 + 32, R = rh01 * 100;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + R * 0.094);              // Steadman's simple form, good below 80 F
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R
      + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  }
  return ((hi - 32) * 5) / 9;
}

/** The NWS category for a heat index in deg C. */
export function heatCategory(hiC) {
  const f = (hiC * 9) / 5 + 32;
  return f >= 125 ? 'Extreme danger' : f >= 103 ? 'Danger' : f >= 90 ? 'Extreme caution' : f >= 80 ? 'Caution' : 'Comfortable';
}

// ------------------------------------------------------------------ the body at work

/**
 * Metabolic power (W) and external work (W) walking or running at `speed` m/s on grade `grade` (rise over run, signed) with
 * `loadKg` on the back (ACSM equations; downhill is cheaper but not free).
 */
export function metabolic({ speed = 0, grade = 0, loadKg = 0, activity = 'walk' }) {
  let vo2;                                            // ml/kg/min
  if (activity === 'sleep') vo2 = 2.9;
  else if (activity === 'rest') vo2 = 3.6;
  else if (activity === 'swim') vo2 = 26;
  else if (activity === 'work') vo2 = 21;             // swinging an axe, sawing, carrying firewood
  else {
    const v = speed * 60, G = grade;
    if (v < 4) vo2 = 3.8;
    else if (v <= 134) vo2 = G >= 0 ? 0.1 * v + 1.8 * v * G + 3.5 : 0.1 * v + 3.5 + 0.9 * v * Math.max(G, -0.12) * 0.5;
    else vo2 = 0.2 * v + 0.9 * v * Math.max(G, -0.1) + 3.5;
    vo2 = Math.max(vo2, 3.6);
  }
  const total = BODY_KG + loadKg;
  const M = (vo2 * total * J_PER_ML_O2) / 60;
  const climb = activity === 'walk' ? Math.max(0, speed * grade) : 0;
  return { M, work: total * 9.81 * climb, vo2Lmin: (vo2 * total) / 1000 };
}

/**
 * Sweat secreted, L/h. `sunW`: solar heat absorbed (W). `wind` m/s. Returns { sweat, evaporated, eReq, eMax }.
 */
export function sweatRate({ M, work, tempC, rh, wind = 0, sunW = 0, speed = 0 }) {
  const heat = M - work;                                                // heat made by the body
  const cold = 1 + 0.04 * Math.max(0, 10 - tempC);                      // more layers when it is cold
  const hDry = (4.5 * (1 + 0.1 * wind)) / cold;                          // W/m2/K through clothing
  const dry = hDry * BSA * (34 - tempC);                                 // convection and radiation (negative above skin temp)
  const eReq = heat + sunW - dry;
  if (eReq <= 0) return { sweat: 0, evaporated: 0, eReq: 0, eMax: 0 };
  const va = Math.max(0.3, speed + wind);
  const hc = 8.3 * Math.sqrt(va);
  const pa = rh * psat(tempC);
  const eMax = 16.5 * hc * 0.38 * Math.max(0, 5.6 - pa) * BSA;
  const waste = 1 + 0.55 * Math.max(0, 1 - eMax / eReq);                 // sweat the air cannot take drips off
  const sweat = clamp((eReq / EVAP_W_PER_LH) * waste, 0, SWEAT_MAX);
  return { sweat, evaporated: Math.min(eReq, eMax) / EVAP_W_PER_LH, eReq, eMax };
}

/** Water lost to breathing, L/h. */
export function breathRate({ vo2Lmin, tempC, rh, elev = 0 }) {
  const ve = 25 * vo2Lmin * (1 + 0.08 * Math.max(0, elev - 1500) / 1000);   // L/min of air moved
  const inAH = rh * ahSat(tempC);                                          // g/m3 on the way in
  const outAH = 37;                                                         // g/m3, saturated at body heat on the way out
  return (ve * 60 / 1000) * Math.max(0, outAH - inAH) / 1000;
}

// ------------------------------------------------------------------ the body

export class Hydration {
  constructor() {
    this.pace = 4;                // physiological hours per hour of play (game tuning; the ratios are the real ones)
    this.reset();
  }

  reset() {
    this.deficit = 0;             // L below euhydrated
    this.stomach = 0;             // L drunk, not absorbed yet
    this.rates = { sweat: 0, breath: 0, basal: 0, illness: 0, total: 0, hi: 20, rh: 0.4 };
    this.infected = null;         // { t: s until symptoms }
    this.ill = null;              // { t: s left, sev }
    this.drunk = 0;               // L drunk in total
    this.lost = 0;
    this.worst = 0;               // the worst % of body mass lost so far
  }

  /** % of body mass lost (negative when over-full). */
  get pct() { return (this.deficit / BODY_KG) * 100; }

  /** 0..1: how thirsty you feel (thirst arrives late, about 1 to 2% down). */
  get thirst() { return smooth(0.6, 2.6, this.pct); }

  /**
   * How much of your work capacity you keep, from dehydration (and illness): about 4.5% less per % lost past the first, steeper
   * beyond 3%. 2% lost is a small drop, 4% a fifth, 6% two fifths, 8% two thirds, 10% nearly all.
   */
  get capacity() {
    const p = Math.max(0, this.pct);
    let c = 1 - 0.045 * Math.max(0, p - 1) - 0.03 * Math.max(0, p - 3) ** 1.5;
    if (this.ill) c -= 0.22 * this.ill.sev;
    return clamp(c, 0.04, 1);
  }

  /** The stage, for words: where the guidance table puts this much loss. */
  get stage() {
    const p = this.pct;
    if (p < 0.7) return { id: 0, name: 'Hydrated' };
    if (p < 2) return { id: 1, name: 'A little thirsty' };
    if (p < 3.5) return { id: 2, name: 'Dehydrated' };
    if (p < 5) return { id: 3, name: 'Badly dehydrated' };
    if (p < 7) return { id: 4, name: 'Heat exhaustion risk' };
    return { id: 5, name: 'Critical' };
  }

  /** Is it time to collapse? */
  get collapsed() { return this.pct >= 9.5; }

  /** What to drink now, mL every 15 minutes, from what is being lost (NIOSH: one cup every 15 to 20 minutes in heat, never over 1.4 L/h). */
  get advice() {
    const loss = clamp(this.rates.sweat + this.rates.breath + 0.03, 0, 1.4);
    return { lossLH: loss, mlPer15: Math.round((clamp(loss, 0.1, 1.4) / 4) * 1000 / 10) * 10 };
  }

  /**
   * Advance by `dt` seconds of play. env: { speed, grade, loadKg, activity, tempC, rh, wind, sunW, elev }.
   * Returns the rates (L per physiological hour).
   */
  update(dt, env) {
    const hours = (dt / 3600) * this.pace;
    const act = metabolic(env);
    const sw = sweatRate({ ...act, tempC: env.tempC, rh: env.rh, wind: env.wind || 0, sunW: env.sunW || 0, speed: env.speed || 0 });
    const breath = breathRate({ vo2Lmin: act.vo2Lmin, tempC: env.tempC, rh: env.rh, elev: env.elev || 0 });
    const p = this.pct;
    let basal = 0.06 * (1 - 0.55 * smooth(0.5, 3, p)) * (env.activity === 'sleep' ? 0.8 : 1);
    if (p < 0) basal += clamp(-this.deficit * 1.4, 0, 1.2);               // the kidneys shed a surplus
    let gi = 0;
    if (this.ill) gi = 0.32 * this.ill.sev;
    // what the stomach hands over this step
    const empty = clamp(0.4 + 0.8 * Math.min(1, this.stomach / 0.5), 0, 1.2) * hours;
    const take = Math.min(this.stomach, empty);
    this.stomach -= take;
    const loss = (sw.sweat + breath + basal + gi) * hours;
    this.deficit = clamp(this.deficit + loss - take, -2, 12);
    this.lost += loss; this.worst = Math.max(this.worst, this.pct);
    this.rates = { sweat: sw.sweat, breath, basal, illness: gi, total: sw.sweat + breath + basal + gi, hi: heatIndexC(env.tempC, env.rh), rh: env.rh, eReq: sw.eReq, eMax: sw.eMax, M: act.M };
    // a gut infection: a few minutes of play after the drink, then it hits, then it passes (real time, not paced)
    if (this.infected && (this.infected.t -= dt) <= 0) { this.ill = { t: 480 + Math.random() * 240, sev: 0.55 + Math.random() * 0.4, start: true }; this.infected = null; }
    if (this.ill && (this.ill.t -= dt) <= 0) this.ill = null;
    return this.rates;
  }

  /** Overnight (or any long wait): `hours` of real physiological time at rest. */
  sleep(hours, env) {
    const saved = this.pace;
    this.pace = 1;
    const step = 0.25;
    for (let h = 0; h < hours; h += step) this.update(step * 3600, { ...env, speed: 0, grade: 0, activity: 'sleep' });
    this.pace = saved;
  }

  /** Swallow `liters`; returns what went down (the stomach holds only so much). */
  drink(liters) {
    const room = Math.max(0, STOMACH_MAX - this.stomach);
    const v = Math.min(liters, room);
    this.stomach += v; this.drunk += v;
    return v;
  }

  /** Raw water went down: `risk` is the chance of infection per litre. Returns true if it took. */
  swallowRaw(liters, risk) {
    if (this.infected || this.ill) return false;
    if (Math.random() < 1 - Math.exp(-risk * liters)) { this.infected = { t: 360 + Math.random() * 540 }; return true; }
    return false;
  }

  save() { return { d: +this.deficit.toFixed(4), s: +this.stomach.toFixed(3), i: this.infected ? Math.round(this.infected.t) : null, l: this.ill ? { t: Math.round(this.ill.t), sev: +this.ill.sev.toFixed(2) } : null, dr: +this.drunk.toFixed(2) }; }

  load(s) {
    this.reset();
    if (!s) return;
    this.deficit = s.d || 0; this.stomach = s.s || 0; this.drunk = s.dr || 0;
    this.infected = s.i != null ? { t: s.i } : null;
    this.ill = s.l ? { t: s.l.t, sev: s.l.sev } : null;
  }
}
