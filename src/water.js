// What the water you drink can carry and what each treatment leaves of it: pure, so tools/hydration_check.mjs can run it in node.
// Per-litre hazard is split into four kinds of bug (Giardia g, Cryptosporidium c, bacteria b, viruses v).

export const SOURCE = { lake: 0.055, stream: 0.03 };                     // chance of infection per litre of untreated water at an average spot
export const SHARE = { g: 0.45, c: 0.15, b: 0.3, v: 0.1 };              // Giardia, Cryptosporidium, bacteria, viruses
export const NONE = { g: 0, c: 0, b: 0, v: 0 };
export const SURV = {                                                    // what is left after each treatment
  pump: { g: 1e-3, c: 1e-3, b: 1e-3, v: 1 },                      // 0.2 micron ceramic: 3 log of protozoa and bacteria, no viruses
  straw: { g: 1e-3, c: 1e-3, b: 1e-6, v: 1 },                     // LifeStraw: 99.9% protozoa, 99.9999% bacteria, no viruses
  boil: { g: 1e-6, c: 1e-6, b: 1e-6, v: 1e-6 },
};
export const mulH = (h, s) => ({ g: h.g * s.g, c: h.c * s.c, b: h.b * s.b, v: h.v * s.v });
export const sumH = (h) => h.g + h.c + h.b + h.v;
/** Iodine: bacteria in one contact time, viruses nearly, Giardia in three, Cryptosporidium essentially never. */
export const iodineSurv = (t, req) => { const k = Math.min(1, t / req); return { g: 10 ** (-3 * Math.min(1, t / (req * 3))), c: 10 ** (-0.15 * k), b: 10 ** (-4 * k), v: 10 ** (-3 * k) }; };
/** The infection hazard per litre of untreated water at a place: the source, times how fouled this bit of country is (animals, camps). */
export function sourceHaz(kind, x, z) {
  const q = Math.sin(Math.floor(x / 70) * 127.1 + Math.floor(z / 70) * 311.7) * 43758.5453;
  const f = 0.55 + 1.7 * (q - Math.floor(q)), base = (SOURCE[kind] || SOURCE.stream) * f;
  return { g: base * SHARE.g, c: base * SHARE.c, b: base * SHARE.b, v: base * SHARE.v };
}
/** What the water in a container carries per litre right now. */
export const effective = (c) => (c.iod ? mulH(c.haz, iodineSurv(c.iod.t, c.iod.req)) : c.haz);
/** empty | raw | waiting (iodine working) | treated */
export const kindOf = (c) => (c.water < 0.02 ? 'empty' : c.iod && c.iod.t < c.iod.req ? 'waiting' : c.treated ? 'treated' : 'raw');
