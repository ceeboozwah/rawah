// A frame-time overlay for developers (local host only, F4): how long the frame took, a graph of the last four seconds,
// where the CPU time went (the marks in `tick`), the render scale the adaptive resolution has settled on, and a log of the
// slowest frames with the section that ate them. A frame that takes much longer than its marked sections add up to is
// waiting on the GPU; one where a mark is big is that part of the game's own code (a tile of trees being made, say).

const N = 240;

export class PerfHud {
  constructor(renderer) {
    this.renderer = renderer;
    this.on = false;
    this.times = new Float32Array(N); this.i = 0;
    this.cur = {}; this.last = performance.now();
    this.sections = {};            // name -> { sum, max, n } over the current window
    this.spikes = [];
    this.win = { t: 0, n: 0, max: 0 };
    this.shown = null;
    const el = document.createElement('div');
    el.id = 'perfhud';
    el.style.cssText = 'position:fixed;right:10px;top:70px;z-index:90;width:300px;padding:8px 10px;border-radius:10px;background:rgba(8,12,18,.82);color:#dfe6ee;font:500 12px/1.35 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none;display:none';
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = 50; cv.style.cssText = 'width:280px;height:50px;display:block;margin-bottom:4px';
    this.text = document.createElement('div');
    el.append(cv, this.text);
    document.body.appendChild(el);
    this.el = el; this.cv = cv; this.ctx = cv.getContext('2d');
  }

  toggle() { this.on = !this.on; this.el.style.display = this.on ? 'block' : 'none'; }

  /** The start of a frame: the real time since the last one. */
  frame(rawDt) {
    if (!this.on) return;
    const ms = rawDt * 1000;
    this.times[this.i++ % N] = ms;
    this.win.t += ms; this.win.n++; this.win.max = Math.max(this.win.max, ms);
    if (ms > 45) {
      const parts = Object.entries(this.cur).sort((a, b) => b[1] - a[1]);
      this.spikes.unshift(`${ms.toFixed(0)} ms  ${parts[0] ? `${parts[0][0]} ${parts[0][1].toFixed(0)}` : ''}`);
      this.spikes.length = Math.min(this.spikes.length, 5);
    }
    this.cur = {}; this.last = performance.now();
    if (this.win.t > 1000) this.#draw();
  }

  /** Time since the previous mark goes to `name`. */
  mark(name) {
    if (!this.on) return;
    const now = performance.now();
    this.cur[name] = (this.cur[name] || 0) + (now - this.last);
    const s = this.sections[name] || (this.sections[name] = { sum: 0, max: 0, n: 0 });
    this.last = now;
    s.pend = (s.pend || 0) + 0;
  }

  /** Called once a frame after the marks: folds this frame's marks into the window. */
  fold() {
    if (!this.on) return;
    for (const [k, v] of Object.entries(this.cur)) {
      const s = this.sections[k];
      s.sum += v; s.n++; s.max = Math.max(s.max, v);
    }
  }

  #draw() {
    const w = this.win, avg = w.t / w.n;
    const c = this.ctx;
    c.clearRect(0, 0, N, 50);
    for (let k = 0; k < N; k++) {
      const ms = this.times[(this.i + k) % N];
      c.fillStyle = ms > 33 ? '#ff6a55' : ms > 20 ? '#f6d3bd' : '#7fb2e5';
      c.fillRect(k, 50 - Math.min(50, ms), 1, Math.min(50, ms));
    }
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, 50 - 16.7, N, 1); c.fillRect(0, 50 - 33.3, N, 1);
    const rows = Object.entries(this.sections).filter(([, s]) => s.n).map(([k, s]) => [k, s.sum / w.n, s.max]).sort((a, b) => b[1] - a[1]);
    const marked = rows.reduce((a, r) => a + r[1], 0);
    const pr = this.renderer.getPixelRatio();
    this.text.textContent = [
      `${(1000 / avg).toFixed(0)} fps   ${avg.toFixed(1)} ms   worst ${w.max.toFixed(0)} ms`,
      `scale ${pr.toFixed(2)}  ${Math.round(innerWidth * pr)}x${Math.round(innerHeight * pr)}`,
      `code ${marked.toFixed(1)} ms of ${avg.toFixed(1)}  (the rest is the GPU)`,
      ...rows.map(([k, a, m]) => `${k.padEnd(9)} ${a.toFixed(1).padStart(5)}  max ${m.toFixed(0)}`),
      this.spikes.length ? 'slow frames' : '', ...this.spikes,
    ].join('\n');
    this.sections = {};
    this.win = { t: 0, n: 0, max: 0 };
  }
}
