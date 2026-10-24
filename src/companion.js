import * as THREE from 'three';
import { clamp, smoothstep } from './noise.js';

// Your hiking partner. Not a follower on a leash: they have needs of their
// own (energy, curiosity, warmth, wanting company) and pick what to do from
// them, Sims-style, every couple of seconds. They hike alongside you at your
// pace, drift ahead on the trail, wander off to a lakeshore or a viewpoint
// when you dawdle, sit down when tired, gather at camp in the evening, catch
// up when left behind, and say something now and then about where you are,
// the weather, or how you look. Near them, [G] opens "together": hike
// together, explore on your own, take a break, or race to somewhere.
//
// Movement is the hiker's own ground rules, simplified: walk the lidar
// surface, steer around lakes and cliffs, get pushed out of tree trunks.

const WALK = 2.3, RUN = 4.3, SWIM_DEPTH = 1.3;

const LINES = {
  hello: ['Alright, Rawah. Let\'s see what you\'ve got.', 'Smell that? Pine and cold air. Perfect.', 'Car\'s locked. Let\'s go.'],
  lake: ['Oh wow. {place}.', 'There it is: {place}. Worth every step.', '{place}! Water\'s so clear I can see the rocks.', 'I could sit by {place} all day.'],
  summit: ['We\'re on top of {place}! Look at that.', '{place}. You can see all the way into Wyoming.', 'Summit! Nothing higher around here but the clouds.'],
  storm: ['Hear that rumble? We should get off the high ground.', 'Thunder. Treeline. Now.', 'Those clouds are building fast. Let\'s not be the tallest thing up here.'],
  rain: ['And there\'s the rain. Glad I packed the shell.', 'Rain\'s here. Smells amazing though.'],
  snow: ['It\'s snowing! Like actually snowing.', 'Snow! Okay, this is the coolest thing.'],
  fog: ['Can\'t see a thing. Stay close.', 'This fog is unreal. Let\'s stick to the trail.'],
  cold: ['You\'re shivering. Fire or tent, your pick.', 'Hey, you\'re freezing. Let\'s warm up.'],
  dusk: ['Light\'s going. Find a flat spot for camp?', 'Sun\'s about to dip. We should think about camp.'],
  tired: ['Breather? I won\'t tell anyone.', 'You\'re gassed. Five minutes.'],
  night: ['Look up. That\'s the whole Milky Way.', 'So quiet out here at night.'],
  camp: ['Good spot. I\'ll grab some water.', 'Home for the night.'],
  fire: ['Now we\'re talking.', 'Fire\'s perfect. Don\'t you dare put it out yet.'],
  forest: ['Love how quiet it gets in the trees.', 'Spruce-fir. Smells like Christmas in here.'],
  burn: ['Crazy how much burned here. Look, fireweed coming back.', 'The 2020 fire came through here. Still eerie.'],
  meadow: ['Elk country, right here.', 'This meadow would be unreal in July.'],
  alpine: ['Above the trees now. Thin air, big views.', 'Tundra. Every step up here counts.'],
  wander: ['Gonna check out that ridge, back in a bit.', 'I\'m gonna look around. Holler if you need me.', 'Be right back, want to see the view from there.'],
  back: ['Back! You would\'ve loved it.', 'Miss me?'],
  rest: ['Sitting down. Take your time.', 'I\'ll wait here.'],
  together: ['Right behind you.', 'Lead the way.'],
  race: ['Race you to {place}! Go!', 'Last one to {place} cooks dinner!'],
  win: ['Ha! Beat you to {place}!', 'Too slow! {place} is mine.'],
  lose: ['Okay, okay. You win. {place} is yours.', 'Fine, you\'re faster. I\'m cooking.'],
  catchup: ['Wait up!', 'Hold on, coming!'],
  travel: ['Made it.', 'Whoa, okay, we\'re here.'],
  hop: ['Wait for me!', 'Room for one more?', 'Hold on, I\'m coming!'],
  ride: ['Okay, I\'m on. Go easy!', 'Let\'s ride!', 'Holding on!'],
  fast: ['Faster!', 'Woooo!', 'Watch the trees!', 'I can\'t feel my face!'],
  fish: ['Nice one!', 'Look at the size of that!', 'Beautiful fish. Now I\'m jealous.', 'Dinner!'],
  smore: ['That is the perfect marshmallow. Don\'t look at mine.', 'Okay, golden brown. I am a professional.', 'Best thing I\'ve ever tasted, honestly.', 'Mine is on fire. Mine is definitely on fire.'],
  sit: ['Good spot. Look at those stars.', 'Fire\'s perfect. Stay a while.', 'I could sit here all night.'],
  off: ['Whew. That was fun.', 'My legs are still shaking.', 'Again later?'],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Companion {
  constructor(world, flora, character, name) {
    this.world = world;
    this.flora = flora;
    this.char = character;
    this.name = name;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.phase = 0; this.moving = 0;
    this.mode = 'walk';
    this.sitting = false; this.waving = false;
    this.wallUp = new THREE.Vector2(0, -1);
    this.lastGrade = 0;
    // needs, 0..100
    this.energy = 100; this.curiosity = 30; this.social = 50;
    // what you've asked of them, and what they're doing about it
    this.stance = 'together';    // together | free | rest | race
    this.activity = 'follow';    // follow | wander | sit | camp | race | catchup
    this.target = null;           // { x, z, kind, name }
    this.think = 0;
    this.idleFor = 0;             // how long you've been standing still
    this.stuck = { t: 0, x: 0, z: 0 };
    this.saidAt = -999; this.nextAmbient = 40;
    this.lead = false; this.side = 1; this.nextMood = 20;   // walk ahead or behind, left or right; changes now and then
    this.hangout = null;
    this.face = null;   // which way to look when standing
    this.cooldowns = {};
    this.biz = null;       // a call of nature: { phase: walk | squat | done, ... }
    this.urge = 100 + Math.random() * 70;   // seconds until the next one
    this.squat = false;
    this.go = null;   // { x, z }: walk here and nowhere else (a scripted moment)
    this.boarding = false; this.boardT = 0; this.ride = false;   // hopping on the ATV / seated on it
    this.bubble = document.getElementById('bubble');
    this._v = new THREE.Vector3();
  }

  place(x, z) {
    this.pos.set(x, this.world.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.sitting = false;
  }

  /** Somewhere near (x, z) to stand: dry, walkable, not inside anything. */
  spotNear(x, z, r0 = 2.5) {
    const w = this.world;
    for (let r = r0; r < r0 + 30; r += 1.5) {
      for (let k = 0; k < 10; k++) {
        const a = k * 0.628 + r;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!w.lakeAt(px, pz) && w.localGrade(px, pz) < 0.6) return [px, pz];
      }
    }
    return [x + r0, z];
  }

  // ---------------------------------------------------------------- talking
  say(kind, vars = {}, { force = false, cool = 60 } = {}) {
    const now = performance.now() / 1000;
    if (!force && (now - this.saidAt < 7 || (this.cooldowns[kind] || 0) > now)) return false;
    const pool = LINES[kind];
    if (!pool) return false;
    this.saidAt = now;
    this.cooldowns[kind] = now + cool;
    this.line = pick(pool).replace('{place}', vars.place || 'there');
    this.lineUntil = now + 3.2 + this.line.length * 0.05;
    return true;
  }

  /** Say exactly this, now. */
  speak(text, cool = 0) {
    const now = performance.now() / 1000;
    this.saidAt = now;
    this.line = text;
    this.lineUntil = now + 3.4 + text.length * 0.05 + cool;
  }

  /** Things that happen to both of you (main.js reports them). */
  event(kind, vars) {
    const say = { lake: 'lake', summit: 'summit', Thunderstorm: 'storm', Rain: 'rain', Snow: 'snow', Fog: 'fog',
      camp: 'camp', fire: 'fire', travel: 'travel', hello: 'hello', fish: 'fish', smore: 'smore', sit: 'sit' }[kind];
    if (say) this.say(say, vars, { force: kind === 'lake' || kind === 'summit' || kind === 'hello', cool: 90 });
    if (kind === 'travel') this.#arriveWith(vars.player);
    if (kind === 'lake' || kind === 'summit') this.curiosity = Math.max(0, this.curiosity - 40);
  }

  #arriveWith(p) {
    const [x, z] = this.spotNear(p.x + 3, p.z + 2, 3);
    this.place(x, z);
    if (this.stance !== 'rest') this.activity = 'follow';
  }

  // ---------------------------------------------------------------- the ATV
  /** You climbed on: if they're close, they jog over and take the back seat. Returns whether they're coming. */
  boardATV(atv) {
    const d = Math.hypot(atv.pos.x - this.pos.x, atv.pos.z - this.pos.z);
    if (d > 25 || this.stance === 'race' || this.mode === 'swim') return false;
    this.boarding = true; this.boardT = 0; this.sitting = false;
    this.say('hop', {}, { force: true, cool: 30 });
    return true;
  }

  /** You got off (or were moved): they hop down on the other side. */
  leaveATV(atv) {
    const was = this.ride;
    this.boarding = false; this.ride = false; this.sitting = false;
    if (!was) return;
    const rx = Math.cos(atv.yaw), rz = -Math.sin(atv.yaw);
    const [x, z] = this.spotNear(atv.pos.x + rx * 1.5, atv.pos.z + rz * 1.5, 0.5);
    this.place(x, z);
    this.activity = 'follow';
    this.say('off', {}, { force: true, cool: 20 });
  }

  /** Seated on the back: carried with the quad, holding on. */
  #onATV(dt, ctx) {
    const a = ctx.atv, p = this.pos;
    a.seat(p, 1);
    this.vel.set(0, 0, 0);
    this.moving = 0; this.mode = 'walk'; this.sitting = true; this.lastGrade = 0;
    this.hangout = null; this.idleFor = 0; this.activity = 'follow';
    if (Math.abs(a.speed) > 10) this.say('fast', {}, { cool: 25 });
    const now = performance.now() / 1000;
    this.talking = this.line && now < this.lineUntil ? 'nod' : null;
    this.face = a.yaw;
    this.char.heading = a.yaw;
    if (this.char.avatar) this.char.avatar.heading = a.yaw;
    this.char.update(dt, this);
  }

  // ---------------------------------------------------------------- together
  command(what, ctx) {
    this.sitting = false;
    if (what === 'together') { this.stance = 'together'; this.activity = 'follow'; this.say('together', {}, { force: true }); }
    else if (what === 'free') { this.stance = 'free'; this.curiosity = 100; this.say('wander', {}, { force: true }); }
    else if (what === 'rest') { this.stance = 'rest'; this.activity = 'sit'; this.say('rest', {}, { force: true }); }
    else if (what === 'race' && ctx.goal) {
      this.stance = 'race'; this.activity = 'race';
      this.target = { x: ctx.goal.x, z: ctx.goal.z, name: ctx.goal.name, kind: 'race' };
      this.say('race', { place: ctx.goal.name }, { force: true });
    }
  }

  // ---------------------------------------------------------------- brain
  /** Pick an activity from needs and circumstances (runs every ~2 s). */
  #decide(ctx) {
    const { player, playerSpeed, tent, fire, hour, weather } = ctx;
    const d = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
    if (this.activity === 'race' || this.boarding || this.go || this.biz) return;
    if (d > 260) { this.activity = 'catchup'; return; }
    // a fire with stools set out and you nearby: take the stool you aren't on
    if (ctx.fire && ctx.stools && Math.hypot(ctx.fire.x - player.x, ctx.fire.z - player.z) < 16 && this.stance !== 'free') {
      let mine = ctx.seat;
      if (mine < 0) {
        let bd = Infinity;
        ctx.stools.forEach((st, i) => { const q = Math.hypot(st.x - player.x, st.z - player.z); if (q < bd) { bd = q; mine = i; } });
      }
      const st = ctx.stools[mine === 0 ? 1 : 0];
      if (this.activity !== 'camp' || !this.target?.stool) this.say('sit', {}, { cool: 300 });
      this.activity = 'camp';
      this.target = { x: st.x, z: st.z, yaw: st.yaw, kind: 'camp', stool: true };
      return;
    }
    const evening = hour > 19 || hour < 6;
    if (tent && evening && Math.hypot(tent.x - player.x, tent.z - player.z) < 25) {
      this.activity = 'camp';
      const c = fire || tent;
      const [x, z] = this.spotNear(c.x + 2.2, c.z - 1.5, 1.5);
      this.target = { x, z, kind: 'camp' };
      return;
    }
    if (this.stance === 'rest') { this.activity = 'sit'; return; }
    const stormy = weather.storm > 0.4 || weather.precip > 0.4;
    // explore when curious and either told to, or you're dawdling and it's nice out
    const wantsToWander = this.curiosity > 65 && !stormy && this.energy > 35 && (this.stance === 'free' || this.idleFor > 8 || Math.random() < 0.15);
    if (this.activity === 'wander' && this.target) {
      const tdist = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      const leash = this.stance === 'free' ? 320 : 140;
      if (tdist < 4 || d > leash) {
        this.curiosity = Math.max(0, this.curiosity - 50);
        this.activity = 'follow';
        if (tdist < 4) this.say('back', {}, { cool: 120 });
      }
      return;
    }
    if (wantsToWander) {
      this.scoutDir = Math.atan2(-Math.cos(ctx.playerYaw), -Math.sin(ctx.playerYaw));
      const t = this.#interesting(player);
      if (t) { this.activity = 'wander'; this.target = t; this.say('wander', {}, { cool: 150 }); return; }
    }
    // tired and you're stopped: sit down beside you
    if ((this.energy < 45 || this.idleFor > 20) && playerSpeed < 0.3 && d < 12) { this.activity = 'sit'; return; }
    this.activity = 'follow';
  }

  /** A tree to duck behind: out of your line of sight, a walk from you and from camp, with room to squat. */
  #coverSpot(ctx) {
    const { player, fire, tent } = ctx, p = this.pos, w = this.world;
    let best = null, bs = Infinity;
    for (const t of this.flora.treesAround(p.x, p.z, 30)) {
      let ux = t.x - player.x, uz = t.z - player.z;
      const ud = Math.hypot(ux, uz);
      if (ud < 5) continue;
      ux /= ud; uz /= ud;
      const x = t.x + ux * (t.rad + 0.9), z = t.z + uz * (t.rad + 0.9);
      if (Math.hypot(x - player.x, z - player.z) < 7 || w.lakeAt(x, z) || w.localGrade(x, z) > 0.45) continue;
      if (fire && Math.hypot(x - fire.x, z - fire.z) < 7) continue;
      if (tent && Math.hypot(x - tent.x, z - tent.z) < 6) continue;
      if (this.flora.collide({ x, z }, 0.4, Infinity) > -Infinity) continue;
      const s = Math.hypot(x - p.x, z - p.z) + (ud < 12 ? 10 : 0) + Math.random() * 3;
      if (s < bs) { bs = s; best = { x, z, yaw: Math.atan2(uz, -ux), fx: -uz, fz: ux }; }
    }
    return best;
  }

  /** A call of nature: walk behind a tree, squat there for a while (dropping what falls), and go back. */
  #business(dt, ctx, d) {
    const p = this.pos;
    if (!this.biz) {
      this.squat = false;
      this.urge -= dt;
      if (this.urge > 0) return;
      const free = this.activity !== 'race' && !this.boarding && !this.go && !this.ride && this.mode === 'walk' && !ctx.atv.riding && d < 70;
      if (!free) { this.urge = 15; return; }
      const spot = this.#coverSpot(ctx);
      if (!spot) { this.urge = 40; return; }
      this.biz = { phase: 'walk', t: 0, ...spot };
      this.speak(pick(['Nature calls. Back in a minute.', 'Need a tree. Do not follow me.', 'Be right back. Do not look.']));
      return;
    }
    const b = this.biz;
    b.t += dt;
    if (this.activity === 'race' || this.boarding || this.go || this.ride || d > 120) { this.biz = null; this.squat = false; this.urge = 60; return; }
    if (b.phase === 'walk') {
      if (Math.hypot(b.x - p.x, b.z - p.z) < 0.45) {
        b.phase = 'squat'; b.t = 0; b.n = 0;
        b.drops = [3 + Math.random(), 5 + Math.random(), 7 + Math.random()].slice(0, 2 + (Math.random() < 0.6 ? 1 : 0));
      } else if (b.t > 45) { this.biz = null; this.urge = 40; }
    } else if (b.phase === 'squat') {
      this.squat = true;
      if (b.n < b.drops.length && b.t > b.drops[b.n]) {
        b.n++;
        ctx.events.push({ type: 'drop', x: p.x - b.fx * 0.2, y: p.y + 0.42, z: p.z - b.fz * 0.2 });
      }
      if (b.t > b.drops[b.drops.length - 1] + 2.2) {
        b.phase = 'done'; b.t = 0; this.squat = false;
        this.speak(pick(['Ahh. Much better.', 'Do not go over there.', 'I feel ten pounds lighter.']));
      }
    } else if (b.t > 1.8) {
      this.biz = null;
      this.urge = 300 + Math.random() * 240;
      this.activity = 'follow';
    }
  }

  /** A nearby place worth a look: higher ground with a view, or a lakeshore. */
  #interesting(player) {
    const w = this.world;
    let best = null, score = -Infinity;
    const ahead = this.idleFor > 3 ? null : this.scoutDir;
    for (let k = 0; k < 24; k++) {
      // while you're hiking they scout ahead of you; when you've stopped, anywhere around
      const a = ahead === null ? Math.random() * Math.PI * 2 : ahead + (Math.random() - 0.5) * 1.6;
      const r = 30 + Math.random() * 110;
      const x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
      if (!w.inBounds(x, z, 60) || w.lakeAt(x, z) || w.localGrade(x, z) > 0.7) continue;
      const rise = w.height(x, z) - player.y;
      const water = w.nearWater(x, z, 25) ? 25 : 0;
      const s = rise * 0.6 + water + Math.random() * 8;
      if (s > score) { score = s; best = { x, z, kind: 'view' }; }
    }
    return best;
  }

  /** Where to be right now. */
  #goal(ctx) {
    const { player, playerYaw, playerSpeed } = ctx;
    if (this.go) return { x: this.go.x, z: this.go.z, near: 0.3 };
    if (this.biz) return this.biz.phase === 'walk' ? { x: this.biz.x, z: this.biz.z, near: 0.3 } : null;
    if (this.boarding) {
      const a = ctx.atv, s = Math.sin(a.yaw), c = Math.cos(a.yaw);
      return { x: a.pos.x + s * 1.7, z: a.pos.z + c * 1.7, near: 0.4 };
    }
    switch (this.activity) {
      case 'follow':
      case 'catchup': {
        const d = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
        if (playerSpeed < 0.4 && this.activity === 'follow') {
          // you've stopped: they pick their own spot nearby to hang out, and stay put
          if (!this.hangout || Math.hypot(this.hangout.ax - player.x, this.hangout.az - player.z) > 8) {
            const a = Math.atan2(this.pos.z - player.z, this.pos.x - player.x) + (Math.random() - 0.5) * 1.6;
            const r = 5 + Math.random() * 4;
            const [x, z] = this.spotNear(player.x + Math.cos(a) * r, player.z + Math.sin(a) * r, 0);
            this.hangout = { x, z, ax: player.x, az: player.z, face: Math.random() * Math.PI * 2 };
          }
          return { x: this.hangout.x, z: this.hangout.z, near: 1.5 };
        }
        this.hangout = null;
        // hiking: off your shoulder at a comfortable distance, sometimes out ahead on their own line
        const fx = -Math.sin(playerYaw), fz = -Math.cos(playerYaw), rx = Math.cos(playerYaw), rz = -Math.sin(playerYaw);
        const along = this.lead ? 6 : -3.5, side = this.side * 4;
        // no need to chase the exact slot: within a loose bubble, just keep walking alongside
        return { x: player.x + fx * along + rx * side, z: player.z + fz * along + rz * side, near: d < 8 ? 2.5 : 1.5 };
      }
      case 'wander': case 'camp': case 'race': return { ...this.target, near: this.target?.stool ? 0.3 : 1.2 };
      default: return null;
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    const { player, playerSpeed, tempC, sun, events } = ctx;
    const w = this.world, p = this.pos;
    if (this.ride) { this.#onATV(dt, ctx); return; }
    const d = Math.hypot(player.x - p.x, player.z - p.z);
    this.idleFor = playerSpeed < 0.3 ? this.idleFor + dt : 0;

    // needs drift
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.4;
    this.energy = clamp(this.energy + (moving ? -0.09 : this.sitting ? 0.8 : 0.25) * dt * (1 + Math.max(0, this.lastGrade) * 2), 0, 100);
    this.curiosity = clamp(this.curiosity + dt * (this.stance === 'free' ? 2 : 0.7), 0, 100);
    this.nextMood -= dt;
    if (this.nextMood < 0) { this.nextMood = 25 + Math.random() * 40; this.lead = Math.random() < 0.4; if (Math.random() < 0.3) this.side *= -1; }

    // far behind (quick travel, a fall back to camp): reappear just out of sight
    if (d > 400 || (this.activity === 'catchup' && d > 260)) {
      const [x, z] = this.spotNear(player.x + 6, player.z + 6, 4);
      this.place(x, z);
      this.activity = 'follow';
      this.say('catchup', {}, { cool: 60 });
    }

    this.#business(dt, ctx, d);

    this.think -= dt;
    if (this.think <= 0) { this.think = 1.5 + Math.random(); this.#decide(ctx); }

    // move
    const goal = this.#goal(ctx);
    if (goal && this.activity !== 'race' && !this.boarding && !this.go) {
      // personal space: whatever they're heading for, they don't walk into you
      const gx = goal.x - player.x, gz = goal.z - player.z, gd = Math.hypot(gx, gz);
      if (gd < 3) { goal.x = player.x + (gx / (gd || 1)) * 3; goal.z = player.z + (gz / (gd || 1)) * 3; }
    }
    let wx = 0, wz = 0, speed = 0;
    if (goal) {
      const gx = goal.x - p.x, gz = goal.z - p.z, gd = Math.hypot(gx, gz);
      if (gd > goal.near) {
        wx = gx / gd; wz = gz / gd;
        if (this.go) speed = WALK * 1.1;
        else if (this.boarding) speed = RUN;
        else if (this.activity === 'race') speed = RUN * 0.92;
        else if (this.activity === 'follow' || this.activity === 'catchup') speed = clamp(Math.max(playerSpeed, WALK * 0.6) + (gd - 3) * 0.45, 0, gd > 25 ? RUN : Math.max(WALK, playerSpeed + 0.4));
        else speed = this.energy < 30 ? WALK * 0.75 : WALK;
        speed *= smoothstep(0, 1.2, gd - goal.near + 0.3);
        // steer around water and cliffs: try the straight line, then fan out
        const ok = (dx, dz) => {
          const x = p.x + dx * 2.5, z = p.z + dz * 2.5;
          const lake = w.lakeAt(x, z);
          const deep = lake && lake.level < w.iceLine && lake.level - w.height(x, z) > 0.6;
          return !deep && w.localGrade(x, z) < 1.0;
        };
        if (!ok(wx, wz)) {
          for (const a of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2]) {
            const c = Math.cos(a), s = Math.sin(a), nx = wx * c - wz * s, nz = wx * s + wz * c;
            if (ok(nx, nz)) { wx = nx; wz = nz; break; }
          }
        }
      }
    }
    if (this.boarding) {
      this.boardT += dt;
      const a = ctx.atv, s = Math.sin(a.yaw), c = Math.cos(a.yaw);
      if (Math.hypot(a.pos.x + s * 1.7 - p.x, a.pos.z + c * 1.7 - p.z) < 1.1) {
        this.boarding = false; this.ride = true;
        this.say('ride', {}, { force: true, cool: 30 });
      } else if (this.boardT > 7 || !a.riding) { this.boarding = false; this.say('catchup', {}, { cool: 30 }); }
    }
    if (this.activity === 'camp' && this.target?.stool && Math.hypot(this.target.x - p.x, this.target.z - p.z) < 0.7 && speed === 0) {
      p.x = this.target.x; p.z = this.target.z;   // settle onto the stool
    }
    this.sitting = !this.biz && (!goal && this.activity === 'sit') || (this.activity === 'camp' && speed === 0);
    if (this.activity === 'race' && goal && Math.hypot(goal.x - p.x, goal.z - p.z) < 8) {
      // they got there first
      this.say('win', { place: this.target.name }, { force: true });
      events.push({ type: 'race', won: false, place: this.target.name });
      this.stance = 'together'; this.activity = 'follow';
    }
    // uphill is slower for them too
    const ahead = w.height(p.x + wx, p.z + wz) - w.height(p.x, p.z);
    this.lastGrade = speed > 0 ? ahead : 0;
    if (ahead > 0) speed /= 1 + 1.4 * ahead;
    const k = 1 - Math.exp(-8 * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    const lim = w.half - 40;
    p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
    const lift = this.flora.collide(p, 0.3, p.y);
    const lake = w.lakeAt(p.x, p.z);
    const ground = Math.max(w.height(p.x, p.z), lift, lake && lake.level >= w.iceLine ? lake.level : -Infinity);
    const depth = lake && lake.level < w.iceLine ? lake.level - ground : 0;
    this.mode = depth > SWIM_DEPTH ? 'swim' : 'walk';
    p.y = this.mode === 'swim' ? lake.level - SWIM_DEPTH : ground;
    const v = Math.hypot(this.vel.x, this.vel.z);
    this.moving = clamp(v / 1.2, 0, 1);
    this.phase += (v / 1.4) * Math.PI * dt;

    // stuck against something for a while: hop around it
    this.stuck.t += dt;
    if (this.stuck.t > 3) {
      if (speed > 0.5 && Math.hypot(p.x - this.stuck.x, p.z - this.stuck.z) < 0.6) {
        const [x, z] = this.spotNear(p.x + wx * 4, p.z + wz * 4, 1.5);
        this.place(x, z);
      }
      this.stuck = { t: 0, x: p.x, z: p.z };
    }

    // things they notice
    if (ctx.warmth < 35) this.say('cold', {}, { cool: 120 });
    else if (ctx.stamina < 15) this.say('tired', {}, { cool: 120 });
    else if (sun < 0.3 && sun > 0.08 && !ctx.tent) this.say('dusk', {}, { cool: 400 });
    if (ctx.fireLit) this.say('fire', {}, { cool: 600 });
    this.nextAmbient -= dt;
    if (this.nextAmbient < 0 && d < 20) {
      this.nextAmbient = 70 + Math.random() * 90;
      const cv = ctx.cover;
      const kind = sun < 0.1 ? 'night' : cv.snag > 0.35 ? 'burn' : cv.alpine > 0.5 ? 'alpine' : cv.forest > 0.5 ? 'forest' : 'meadow';
      this.say(kind, {}, { cool: 200 });
    }
    // standing: look at you while talking, otherwise at the view
    const now = performance.now() / 1000;
    this.talking = this.line && now < this.lineUntil && d < 25 && !this.biz ? 'nod' : null;
    this.face = this.biz?.phase === 'squat' ? this.biz.yaw : this.talking ? Math.atan2(-(player.x - p.x), -(player.z - p.z)) : this.hangout ? this.hangout.face : (this.activity === 'camp' && this.target?.stool ? this.target.yaw : null);
    this.char.update(dt, this);
  }

  /** Speech bubble over their head, in screen space. */
  drawBubble(camera, now) {
    const el = this.bubble;
    const show = this.line && now < this.lineUntil;
    if (!show) { el.classList.add('hidden'); return; }
    this._v.set(this.pos.x, this.pos.y + (this.sitting ? 1.3 : 2.15), this.pos.z).project(camera);
    const behind = this._v.z > 1;
    const dist = camera.position.distanceTo(this.pos);
    el.classList.remove('hidden');
    if (behind || Math.abs(this._v.x) > 1.05 || Math.abs(this._v.y) > 1.05 || dist > 45) {
      // off screen or far: pin to the bottom edge like a radio call
      el.classList.add('edge');
      el.style.left = '50%'; el.style.top = '';
    } else {
      el.classList.remove('edge');
      el.style.left = `${(this._v.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-this._v.y * 0.5 + 0.5) * innerHeight}px`;
    }
    if (el.dataset.line !== this.line) {
      el.dataset.line = this.line;
      el.innerHTML = '<b></b><span></span>';
      el.firstChild.textContent = this.name;
      el.lastChild.textContent = this.line;
    }
  }

  save() { return { x: this.pos.x, z: this.pos.z, stance: this.stance, energy: this.energy }; }
  load(s, player) {
    if (s && Number.isFinite(s.x)) { this.place(s.x, s.z); this.stance = s.stance === 'race' ? 'together' : s.stance || 'together'; this.energy = s.energy ?? 100; }
    else this.#arriveWith(player);
  }
}
