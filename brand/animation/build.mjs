// Builds saoi-to-face.svg: the wordmark rolls itself up into the face.
// Every pose is computed here, then baked into CSS keyframes, so the output is one
// self-contained SVG that plays in an <img>. First frame = saoi-name.svg, last = saoirse-face.svg.
import { writeFileSync } from 'node:fs';

const TEAL = '#00736F';
const W = 480, H = 270;           // stage
const FPS = 60;
const rad = (d) => (d * Math.PI) / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (u) => u * u * (3 - 2 * u);
const outCubic = (u) => 1 - (1 - u) ** 3;
const outBack = (u, s = 2.2) => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2;

const R = 32;                     // outer radius of every ring
const GROUND = 64;
const IX = 247, IPIVOT = [254, 64];
const REST_LEAN = 12.3;           // angle at which the I tips past its pivot

// ---- timeline (seconds) --------------------------------------------------
const t = {
  sBack: 0.5, sGo: 0.75, sIn: 1.3,    // S winds up, then rolls in behind the A
  hit1: 2.0,                          // A's stem strikes the I
  backEnd: 2.55, charge: 2.65,        // rolls back, gathers
  hit2: 2.95,                         // hits it harder
};

// The I and the A fall together: a small simulation of a bar tipping over its corner.
const fall = (() => {
  const dt = 1 / 240, out = [];
  let a = 0, v = 62, time = 0, rest = 0;
  while (rest < 0.08 && time < 3) {
    v += 520 * Math.sin(rad(a - REST_LEAN)) * dt;
    a += v * dt;
    if (a >= 90) { a = 90; v = -v * 0.28; if (Math.abs(v) < 12) { v = 0; } }
    if (a === 90 && v === 0) rest += dt;
    out.push(a); time += dt;
  }
  return { out, dur: time, at: (s) => out[Math.min(out.length - 1, Math.floor(s / dt))] };
})();
t.landed = t.hit2 + fall.dur;

// Three jumps on the flat I, each harder; the last one drives it inside the ring.
const jumps = [];
{
  let s = t.landed + 0.14;
  for (const [h, dur, flip] of [[12, 0.28, 0], [24, 0.36, 0], [42, 0.52, 0]]) {
    jumps.push({ s, e: s + dur, h, flip });
    s += dur + 0.1;
  }
}
const last = jumps[jumps.length - 1];
t.crush = last.e + 0.06;              // I flattened under the landing
t.pop = t.crush + 0.26;               // I is inside the ring
t.settle = t.pop + 0.24;
t.blink = t.settle + 0.5;
const DUR = t.blink + 0.18 + 1.4;

// ---- A -------------------------------------------------------------------
// The A tips over the corner of its stem until the stem lies flat, then slides on it to the I.
// That puts the top of the a against the wall, stem trailing along the floor.
const CORNER = [144, 64], ARM = Math.hypot(32, 32);
const TIP = (ARM * Math.PI) / 2, SLIDE = 32;
const path = (p) => {            // p: 0 at rest, 1 touching the I
  const d = p * (TIP + SLIDE);
  if (d >= TIP) return { x: 176 + d - TIP, y: 32, deg: 90 };
  const deg = (d / TIP) * 90, ang = rad(225 + deg);
  return { x: CORNER[0] + ARM * Math.cos(ang), y: CORNER[1] + ARM * Math.sin(ang), deg };
};
const pivot = (x, y, deg) => {
  const dx = x - IPIVOT[0], dy = y - IPIVOT[1];
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [IPIVOT[0] + dx * c - dy * s, IPIVOT[1] + dx * s + dy * c];
};
const lean = (time) => {
  if (time < t.hit1) return 0;
  if (time < t.hit2) { const d = time - t.hit1; return 5.5 * Math.exp(-5 * d) * Math.abs(Math.sin(9 * d)); }
  return fall.at(time - t.hit2);
};

function aPose(time) {
  let x = 112, y = 32, deg = 0, sx = 1, sy = 1;
  const BACK = 0.62;   // share of the run given back after the first hit
  if (time >= t.sIn && time < t.hit1) {
    ({ x, y, deg } = path(prog(time, t.sIn, t.hit1) ** 1.7));
  } else if (time >= t.hit1 && time < t.hit2) {
    const out = outCubic(prog(time, t.hit1, t.backEnd));
    const back = prog(time, t.charge, t.hit2) ** 2.4;
    ({ x, y, deg } = path(1 - BACK * (out - back)));
  } else if (time >= t.hit2) {
    const a = lean(time);
    [x, y] = pivot(208, 32, a);
    deg = 90 + a;
    if (time >= t.landed) {
      deg = 180;
      for (const j of jumps) {
        const u = prog(time, j.s, j.e);
        if (time >= j.s && time < j.e) y -= 4 * j.h * u * (1 - u);
        // squash just before leaving the I, and just after landing
        const before = j.s - time, after = time - j.e;
        const hard = j.h / 42;
        if (before > 0 && before < 0.1) { const k = 1 - before / 0.1; sy = 1 - 0.1 * k; sx = 1 + 0.07 * k; }
        if (after >= 0 && after < 0.14) { const k = Math.exp(-after * 16); sy = Math.min(sy, 1 - 0.14 * hard * k); sx = Math.max(sx, 1 + 0.1 * hard * k); }
      }
      // the I is gone from under it: drop the last 14px and settle
      if (time >= t.crush) {
        const u = prog(time, t.crush, t.pop);
        y = u < 0.62 ? 18 + 14 * (u / 0.62) ** 2 : 32 - 4 * Math.sin(Math.PI * (u - 0.62) / 0.38);
        const v = prog(time, t.pop, t.settle);
        if (v > 0) y = 32 - 1.2 * Math.sin(Math.PI * v);
      } else if (time >= last.e) {
        y = 18 + 14 * 0.3 * prog(time, last.e, t.crush);
      }
    }
  }
  return { x, y: y + R * (1 - sy), deg, sx, sy };
}

// ---- S -------------------------------------------------------------------
function sPose(time) {
  const go = prog(time, t.sGo, t.sIn);
  const back = smooth(prog(time, t.sBack, t.sGo));
  const x = 32 - 7 * back + (80 + 7) * go ** 2;
  return { x, y: 32, deg: ((x - 32) / R) * (180 / Math.PI) };
}

// ---- the two pieces of the I ---------------------------------------------
const PIECES = {
  dot:  { lenCentre: 9,    len: 18, eye: [-7, -3], flatEye: [8, -3] },
  body: { lenCentre: 44.5, len: 39, eye: [-7, -3] },
};
const EYE = { dot: [8, -3], body: [-7, -3] };   // relative to the ring centre, from saoirse-face.svg

function piecePose(name, time) {
  const p = PIECES[name];
  const a = lean(time);
  let [x, y] = pivot(IX, p.lenCentre, a);
  let sw = 1, sl = 1;
  // flex under each landing
  for (const j of jumps.slice(0, 2)) {
    const after = time - j.e;
    if (after >= 0 && after < 0.3) { const k = (j.h / 42) * 0.55 * Math.exp(-after * 18); sw *= 1 - k; }
  }
  if (time >= last.e) {
    sw *= 1 - 0.62 * smooth(prog(time, last.e, t.crush));
  }
  y += 7 * (1 - sw);                                   // stays on the floor while it flattens
  if (time >= t.crush) {
    const u = prog(time, t.crush, t.pop), e = outBack(u);
    const ap = aPose(time);
    const ex = ap.x + EYE[name][0], ey = ap.y + EYE[name][1];
    x = lerp(x, ex, e); y = lerp(y, ey, e);
    const wEnd = 6 / 14, lEnd = 6 / p.len;
    sw = lerp(sw, wEnd, e); sl = lerp(1, lEnd, e);
    const b = prog(time, t.blink, t.blink + 0.18);
    if (b > 0 && b < 1) sw = wEnd * (1 - 0.85 * Math.sin(Math.PI * b));
  }
  return { x, y, deg: a, sw, sl };
}

// ---- camera --------------------------------------------------------------
function camera(time) {
  const pan = smooth(prog(time, t.hit2 + 0.1, last.s + 0.2));
  const zoom = smooth(prog(time, last.s + 0.36, t.settle));
  return { cx: lerp(127, 286, pan), s: lerp(1, 2, zoom) };
}

// ---- bake ----------------------------------------------------------------
// the O stays behind the A from the moment their rings line up
let tO = t.sIn;
while (aPose(tO).x < 192) tO += 1 / 240;
const f = (n, d = 2) => +n.toFixed(d);
const tracks = {
  cam:  (x) => { const c = camera(x); return { v: [W / 2 - c.cx * c.s, H / 2 - 32 * c.s, c.s], css: ([a, b, s]) => `translate(${f(a)}px,${f(b)}px) scale(${f(s, 4)})` }; },
  disc: (x) => { const a = aPose(x); return { v: [a.x, a.y], css: ([a2, b]) => `translate(${f(a2)}px,${f(b)}px)` }; },
  s:    (x) => { const a = sPose(x); return { v: [a.x, a.y, a.deg, x < t.sIn ? 1 : 0], css: ([a2, b, d]) => `translate(${f(a2)}px,${f(b)}px) rotate(${f(d)}deg)`, op: true }; },
  o:    (x) => ({ v: [x < tO ? 1 : 0], css: () => null, op: true }),
  a:    (x) => { const a = aPose(x); return { v: [a.x, a.y, a.sx, a.sy, a.deg, x < t.settle + 0.05 ? 1 : 0], css: ([a2, b, c, d, e]) => `translate(${f(a2)}px,${f(b)}px) scale(${f(c, 4)},${f(d, 4)}) rotate(${f(e)}deg)`, op: true }; },
  face: (x) => { const a = aPose(x); return { v: [a.x, a.y, a.sx, a.sy, a.deg, x < t.settle ? 0 : 1], css: ([a2, b, c, d, e]) => `translate(${f(a2)}px,${f(b)}px) scale(${f(c, 4)},${f(d, 4)}) rotate(${f(e)}deg)`, op: true }; },
  dot:  (x) => { const p = piecePose('dot', x); return { v: [p.x, p.y, p.deg, p.sw, p.sl], css: ([a, b, d, w, l]) => `translate(${f(a)}px,${f(b)}px) rotate(${f(d)}deg) scale(${f(w, 4)},${f(l, 4)})` }; },
  body: (x) => { const p = piecePose('body', x); return { v: [p.x, p.y, p.deg, p.sw, p.sl], css: ([a, b, d, w, l]) => `translate(${f(a)}px,${f(b)}px) rotate(${f(d)}deg) scale(${f(w, 4)},${f(l, 4)})` }; },
};

// drop keyframes that straight-line interpolation already reproduces
function simplify(pts, tol) {
  const keep = new Set([0, pts.length - 1]);
  const walk = (a, b) => {
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const u = (pts[i].x - pts[a].x) / (pts[b].x - pts[a].x);
      const e = Math.max(...pts[i].v.map((n, k) => Math.abs(n - lerp(pts[a].v[k], pts[b].v[k], u))));
      if (e > worst) { worst = e; at = i; }
    }
    if (worst > tol) { keep.add(at); walk(a, at); walk(at, b); }
  };
  walk(0, pts.length - 1);
  return [...keep].sort((a, b) => a - b).map((i) => pts[i]);
}

let css = '';
const frames = Math.round(DUR * FPS);
for (const [name, fn] of Object.entries(tracks)) {
  const pts = [];
  for (let i = 0; i <= frames; i++) { const x = (i / frames) * DUR; pts.push({ x, ...fn(x) }); }
  const op = pts[0].op, kept = simplify(pts, 0.04);
  css += `@keyframes ${name}{`;
  for (const k of kept) {
    const pct = f((k.x / DUR) * 100, 3);
    const tr = k.css(k.v), o = op ? `opacity:${k.v[k.v.length - 1]}` : '';
    css += `${pct}%{${[tr ? `transform:${tr}` : '', o].filter(Boolean).join(';')}}`;
  }
  css += `}\n`;
}
const cls = Object.keys(tracks);
css += cls.map((c) => `.${c}{animation:${c} ${f(DUR, 3)}s linear both}`).join('\n');
css += `\n@media (prefers-reduced-motion:reduce){*{animation:none!important}.cam{transform:translate(${W / 2 - 127}px,${H / 2 - 32}px)}.face{opacity:0}.disc{transform:translate(112px,32px)}.s{transform:translate(32px,32px)}.a{transform:translate(112px,32px)}.dot{transform:translate(247px,9px)}.body{transform:translate(247px,44.5px)}}`;

// geometry is the masters', recentred so each piece turns about its own middle
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none" role="img" aria-label="Saoi">
<style>
${css}
</style>
<defs>
<mask id="behind" maskUnits="userSpaceOnUse" x="-400" y="-400" width="1400" height="1000">
<rect x="-400" y="-400" width="1400" height="1000" fill="#fff"/>
<circle class="disc" r="${R}" fill="#000"/>
</mask>
<mask id="sCut" maskUnits="userSpaceOnUse" x="-40" y="-40" width="80" height="80">
<rect x="-40" y="-40" width="80" height="80" fill="#fff"/>
<path d="M11 -10.5L40 -10.5" stroke="#000" stroke-width="7"/>
<path d="M-11 10.5L-40 10.5" stroke="#000" stroke-width="7"/>
</mask>
</defs>
<g class="cam" stroke="${TEAL}" stroke-width="14">
<g mask="url(#behind)">
<g class="o"><path transform="translate(192 32)" d="M-25 0C-25 -14.3594 -14.359 -25 0 -25C14.359 -25 25 -14.3594 25 0C25 14.3594 14.359 25 0 25C-14.359 25 -25 14.3594 -25 0Z"/></g>
<g class="s"><g mask="url(#sCut)"><path d="M-25 0C-25 -14.3594 -14.3594 -25 0 -25C14.3594 -25 25 -14.3594 25 0M-25 0C-25 14.3594 -14.3594 25 0 25C14.3594 25 25 14.3594 25 0M-25 0H25"/></g></g>
</g>
<g class="a"><path d="M25 0C25 -14.3594 14.3594 -25 0 -25C-14.3594 -25 -25 -14.3594 -25 0C-25 14.3594 -14.3594 25 0 25C14.3594 25 25 14.3594 25 0ZM25 0V32"/></g>
<g class="face"><path d="M25 0C25 -13.8071 13.8071 -25 0 -25C-13.8071 -25 -25 -13.8071 -25 0C-25 13.8071 -13.8071 25 0 25C13.8071 25 25 13.8071 25 0ZM25 0V32"/></g>
<g stroke="none" fill="${TEAL}">
<g class="dot"><rect x="-7" y="-9" width="14" height="18"/></g>
<g class="body"><rect x="-7" y="-19.5" width="14" height="39"/></g>
</g>
</g>
</svg>
`;
writeFileSync(new URL('./saoi-to-face.svg', import.meta.url), svg);
writeFileSync(new URL('./timeline.json', import.meta.url), JSON.stringify({ ...t, DUR, jumps }, null, 1));
console.log('duration', DUR.toFixed(2), 's, size', (svg.length / 1024).toFixed(1), 'KB', t);
