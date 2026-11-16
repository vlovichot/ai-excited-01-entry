// "The Breach" — an entry for ai-excited-01 (Node 22, standard library only).
//
// A colossal whale made of stars and nebula breaches out of a night ocean,
// arcing over a tiny lighthouse island where one small keeper watches with a
// lantern. The program draws the whole scene procedurally into a pixel
// buffer and writes it as a PNG. It is fully deterministic: a fixed-seed
// PRNG, no clock, no randomness from the environment, so two runs write
// byte-identical files.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- canvas ---
const W = 1024;
const H = 1024;
const buf = new Float32Array(W * H * 3); // linear-ish RGB, values around 0..1+

type RGB = [number, number, number];
const rgb = (hex: number): RGB => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function setPx(x: number, y: number, c: RGB) {
  const i = (y * W + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
function addPx(x: number, y: number, c: RGB, k: number) {
  const i = (y * W + x) * 3;
  buf[i] += c[0] * k; buf[i + 1] += c[1] * k; buf[i + 2] += c[2] * k;
}
function blendPx(x: number, y: number, c: RGB, a: number) {
  const i = (y * W + x) * 3;
  buf[i] = lerp(buf[i], c[0], a);
  buf[i + 1] = lerp(buf[i + 1], c[1], a);
  buf[i + 2] = lerp(buf[i + 2], c[2], a);
}

// ------------------------------------------------------------- randomness ---
// mulberry32: tiny deterministic PRNG with a fixed seed.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xC0FFEE);

// ----------------------------------------------------------------- noise ---
// Deterministic value noise (hash of the integer lattice) + fbm.
function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(x: number, y: number, oct: number): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x * f, y * f);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

// ---------------------------------------------------------------- shapes ---
function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return { d: Math.hypot(px - cx, py - cy), t };
}
// Soft radial glow, added into the buffer.
function glow(cx: number, cy: number, r: number, c: RGB, strength: number) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      const k = Math.pow(1 - d, 2.2) * strength;
      addPx(x, y, c, k);
    }
  }
}
function disc(cx: number, cy: number, r: number, c: RGB, soft = 1.5) {
  const x0 = Math.max(0, Math.floor(cx - r - 2)), x1 = Math.min(W - 1, Math.ceil(cx + r + 2));
  const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(H - 1, Math.ceil(cy + r + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = smooth(r + soft, r - soft, Math.hypot(x - cx, y - cy));
      if (a > 0) blendPx(x, y, c, a);
    }
  }
}
// Ellipse as a rotated disc: centre, radii, angle in radians.
function ellipse(cx: number, cy: number, rx: number, ry: number, ang: number, c: RGB, soft = 2) {
  ellipseA(cx, cy, rx, ry, ang, c, soft, 1);
}
function ellipseA(cx: number, cy: number, rx: number, ry: number, ang: number, c: RGB, soft: number, alpha: number) {
  const R = Math.max(rx, ry) + 3;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
      const q = Math.sqrt(u * u + v * v);
      const a = smooth(1 + soft / Math.min(rx, ry), 1 - soft / Math.min(rx, ry), q);
      if (a > 0) blendPx(x, y, c, a * alpha);
    }
  }
}

// ------------------------------------------------------------ sky & sea ---
const HORIZON = 648;
{
  const top = rgb(0x05081f), mid = rgb(0x12224f), low = rgb(0x274a74), teal = rgb(0x1d6f77);
  for (let y = 0; y < H; y++) {
    let c: RGB;
    if (y < HORIZON) {
      const t = y / HORIZON;
      c = t < 0.55 ? mix(top, mid, t / 0.55) : mix(mid, low, (t - 0.55) / 0.45);
      c = mix(c, teal, smooth(0.86, 1.0, t) * 0.45);
    } else {
      const t = (y - HORIZON) / (H - HORIZON);
      c = mix(rgb(0x0d3358), rgb(0x051627), Math.pow(t, 0.7));
    }
    for (let x = 0; x < W; x++) setPx(x, y, c);
  }
}
// Nebula colour wash in the sky (fbm tinted patches).
{
  const magenta = rgb(0xb13a8c), violet = rgb(0x5a3fd4), cyan = rgb(0x2fb9c9);
  for (let y = 0; y < HORIZON + 40; y++) {
    for (let x = 0; x < W; x++) {
      const n1 = fbm(x * 0.0021 + 7.3, y * 0.0021 + 2.9, 4);
      const n2 = fbm(x * 0.0016 + 21.7, y * 0.0016 + 11.2, 4);
      const fade = 1 - y / (HORIZON + 120);
      let k = Math.max(0, n1 - 0.52) * 1.5 * fade;
      if (k > 0) addPx(x, y, x < W * 0.55 ? magenta : violet, k * 0.34);
      k = Math.max(0, n2 - 0.55) * 1.4 * fade;
      if (k > 0) addPx(x, y, cyan, k * 0.22);
    }
  }
}
// Star field.
function star(x: number, y: number, r: number, c: RGB, bright: number) {
  disc(x, y, r, c, 1.2);
  if (bright > 0.55) {
    glow(x, y, r * 5, c, 0.16 * bright);
    // little cross sparkle on the brightest
    if (bright > 0.86) {
      const L = r * 6;
      for (let d = -L; d <= L; d++) {
        const k = (1 - Math.abs(d) / L) * 0.35;
        if (x + d >= 0 && x + d < W) addPx(x + d, y, c, k);
        if (y + d >= 0 && y + d < H) addPx(x, y + d, c, k);
      }
    }
  }
}
{
  const tintA = rgb(0xffffff), tintB = rgb(0xbcd7ff), tintC = rgb(0xffe3b3);
  for (let i = 0; i < 850; i++) {
    const x = rand() * W, y = Math.pow(rand(), 1.35) * (HORIZON - 30);
    const b = Math.pow(rand(), 2.2);
    const c = b > 0.8 ? tintC : b > 0.45 ? tintB : tintA;
    star(x, y, 0.7 + b * 1.5, c, 0.25 + b * 0.75);
  }
  // Milky-way band: a soft diagonal river of faint stars.
  for (let i = 0; i < 520; i++) {
    const t = rand();
    const x = 60 + t * 880 + (rand() + rand() - 1) * 60;
    const y = 470 - t * 400 + (rand() + rand() - 1) * 46;
    if (y < 8 || y > HORIZON - 60) continue;
    star(x, y, 0.6 + rand() * 1.1, tintB, 0.14 + rand() * 0.4);
  }
}
// One shooting star, upper left, driving down-right.
{
  const sx = 148, sy = 128, ex = 300, ey = 208;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = lerp(sx, ex, t), y = lerp(sy, ey, t);
    const fade = Math.pow(t, 2.4);
    disc(x, y, 1.6, rgb(0xeaf6ff), 1.4);
    addPx(Math.round(x), Math.round(y), rgb(0xffffff), fade * 0.4);
  }
  glow(ex, ey, 26, rgb(0xcfe9ff), 0.35);
}

// ------------------------------------------------------------------ moon ---
const MOON = { x: 806, y: 196, r: 92 };
glow(MOON.x, MOON.y, MOON.r * 3.1, rgb(0xffdf9e), 0.20);
glow(MOON.x, MOON.y, MOON.r * 1.7, rgb(0xfff3cf), 0.30);
disc(MOON.x, MOON.y, MOON.r, rgb(0xf7ead0), 2);
disc(MOON.x - 26, MOON.y - 18, 13, rgb(0xe8d5ae), 5); // soft crater shading
disc(MOON.x + 30, MOON.y + 26, 10, rgb(0xe8d5ae), 5);
disc(MOON.x + 8, MOON.y + 48, 7, rgb(0xead9b4), 4);

// -------------------------------------------------------------- the whale --
// Spine: a cubic Bezier from the tail stock (in the water) up to the head.
const SP = [
  { x: 268, y: 742 }, { x: 392, y: 372 }, { x: 618, y: 258 }, { x: 792, y: 334 },
];
function spinePoint(t: number) {
  const u = 1 - t;
  return {
    x: u * u * u * SP[0].x + 3 * u * u * t * SP[1].x + 3 * u * t * t * SP[2].x + t * t * t * SP[3].x,
    y: u * u * u * SP[0].y + 3 * u * u * t * SP[1].y + 3 * u * t * t * SP[2].y + t * t * t * SP[3].y,
  };
}
const spine: { x: number; y: number; w: number }[] = [];
const SEG = 46;
for (let i = 0; i <= SEG; i++) {
  const t = i / SEG;
  const p = spinePoint(t);
  // Width profile: slim tail stock, a deep bulge mid-body, then a smooth
  // blend into a thick blunt head (no pinch, no point, no ball).
  const base = 34 + 158 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02 + 0.015)), 0.8);
  const w = lerp(base, 116, smooth(0.82, 1.0, t));
  spine.push({ x: p.x, y: p.y, w });
}
// Body mask + nearest-spine-t, over the body's bounding box.
const BX0 = 60, BY0 = 130, BX1 = 950, BY1 = 880;
const mask = new Float32Array(W * H);
const tmap = new Float32Array(W * H);
const vmap = new Float32Array(W * H); // -1 at the back edge, +1 at the belly edge
{
  for (let y = BY0; y <= BY1; y++) {
    for (let x = BX0; x <= BX1; x++) {
      let best = Infinity, bestT = 0, bestV = 0;
      for (let i = 0; i < SEG; i++) {
        const a = spine[i], b = spine[i + 1];
        const { d, t } = distSeg(x, y, a.x, a.y, b.x, b.y);
        const r = lerp(a.w, b.w, t) / 2;
        const dd = d - r;
        if (dd < best) {
          best = dd; bestT = (i + t) / SEG;
          // belly side: below the local spine line, relative to the tangent
          const tx = b.x - a.x, ty = b.y - a.y;
          const tl = Math.hypot(tx, ty) || 1;
          const nx = -ty / tl, ny = tx / tl; // a spine normal
          const sx = lerp(a.x, b.x, t), sy = lerp(a.y, b.y, t);
          let side = ((x - sx) * nx + (y - sy) * ny) / (r || 1);
          if (ny < 0) side = -side; // keep + as "toward the water"
          bestV = Math.max(-1, Math.min(1, side));
        }
      }
      const idx = y * W + x;
      mask[idx] = smooth(2.2, -2.2, best);
      tmap[idx] = bestT;
      vmap[idx] = bestV;
    }
  }
}
// A soft halo behind the arc, so the dark body lifts off the dark sky.
for (let i = 0; i <= 10; i++) {
  const p = spinePoint(i / 10);
  glow(p.x, p.y, 190, rgb(0x2fb9c9), 0.055);
}
// Fill the body: deep-space gradient, nebula inside, lit from above.
{
  const backC = rgb(0x1a2152), bellyC = rgb(0x51719f), headC = rgb(0x2c3c74);
  for (let y = BY0; y <= BY1; y++) {
    for (let x = BX0; x <= BX1; x++) {
      const idx = y * W + x, m = mask[idx];
      if (m <= 0) continue;
      const t = tmap[idx];
      let c = mix(backC, bellyC, smooth(-0.7, 1.0, vmap[idx]) * 0.85);
      c = mix(c, headC, smooth(0.72, 1.0, t) * 0.55);
      // nebula living inside the body
      const n = fbm(x * 0.006 + 3.1, y * 0.006 + 8.4, 4);
      const n2 = fbm(x * 0.0035 + 15.9, y * 0.0035 + 4.2, 3);
      c = mix(c, rgb(0x8a3fa0), Math.max(0, n - 0.5) * 1.15);
      c = mix(c, rgb(0x2fb9c9), Math.max(0, n2 - 0.54) * 1.0);
      blendPx(x, y, c, m);
    }
  }
  // stars inside the body (clipped by the mask)
  for (let i = 0; i < 420; i++) {
    const x = BX0 + rand() * (BX1 - BX0), y = BY0 + rand() * (BY1 - BY0);
    const xi = Math.round(x), yi = Math.round(y);
    if (mask[yi * W + xi] < 0.75) continue;
    const b = Math.pow(rand(), 2.0);
    star(x, y, 0.7 + b * 1.7, b > 0.7 ? rgb(0xffe3b3) : rgb(0xffffff), 0.3 + b * 0.7);
  }
  // rim light: bright cyan edge where the mask falls off toward the sky
  const rim = rgb(0x9fe8ff);
  for (let y = BY0 + 9; y <= BY1; y++) {
    for (let x = BX0; x <= BX1; x++) {
      const idx = y * W + x, m = mask[idx];
      if (m <= 0.02) continue;
      const above = mask[idx - 9 * W];
      const k = Math.max(0, m - above) * m;
      if (k > 0) addPx(x, y, rim, k * 0.85);
    }
  }
  // the eye: one bright star-like point, set into the head on the belly side
  const si = Math.floor(0.9 * SEG);
  const sa = spine[si], sb = spine[si + 1];
  const tx = sb.x - sa.x, ty = sb.y - sa.y, tl = Math.hypot(tx, ty) || 1;
  const ex = sa.x - (ty / tl) * sa.w * 0.30, ey = sa.y + (tx / tl) * sa.w * 0.30;
  glow(ex, ey, 16, rgb(0xbdf3ff), 0.55);
  disc(ex, ey, 3.6, rgb(0xeafcff), 1.2);
}
// Tail flukes straddling the stock, and a pectoral fin tucked at the belly
// edge — both in the body's deep colour, drawn after the fill so their roots
// meet the silhouette cleanly.
{
  const finC = rgb(0x1c2450);
  ellipse(214, 720, 58, 17, -0.30, finC, 3);   // upper fluke lobe
  ellipse(314, 766, 56, 16, 0.48, finC, 3);    // lower fluke lobe
  const fp = spinePoint(0.52);
  ellipse(fp.x + 2, fp.y + 72, 64, 17, 0.5, rgb(0x2c3a6e), 3); // pectoral fin, tucked in
}

// ---------------------------------------------------------- sea & splash ---
// Wave streaks on the water.
{
  for (let i = 0; i < 240; i++) {
    const y = HORIZON + 8 + Math.pow(rand(), 1.4) * (H - HORIZON - 30);
    const x = rand() * W;
    const len = 8 + rand() * 46 * (0.4 + (y - HORIZON) / (H - HORIZON));
    const c = rand() > 0.82 ? rgb(0xffdf9e) : rgb(0x9fd8e8);
    const a = 0.05 + rand() * 0.16;
    for (let d = 0; d < len; d++) {
      const xx = Math.round(x + d), yy = Math.round(y);
      if (xx < W) addPx(xx, yy, c, a * Math.sin(Math.PI * d / len));
    }
  }
}
// The breach splash: foam crown, arcs of droplets, rising spray.
{
  const cx = 292, cy = 656;
  glow(cx, cy, 130, rgb(0x9fe8ff), 0.22);
  // layered foam: many small mounds at varied heights and strengths, so the
  // foam reads as churned water and never as one flat bar
  const foamC = rgb(0xdff7ff), foamD = rgb(0x9fd8e8);
  ellipseA(cx - 30, cy + 8, 46, 12, 0, foamC, 8, 0.6);
  ellipseA(cx + 34, cy + 13, 42, 10, 0, foamD, 8, 0.5);
  ellipseA(cx, cy + 2, 34, 11, 0, rgb(0xffffff), 7, 0.65);
  ellipseA(cx - 74, cy + 15, 30, 8, 0, foamD, 7, 0.4);
  ellipseA(cx + 82, cy + 16, 32, 8, 0, foamD, 7, 0.4);
  ellipseA(cx - 12, cy + 19, 52, 7, 0, foamD, 6, 0.35);
  ellipseA(cx + 6, cy - 3, 22, 8, 0, rgb(0xffffff), 6, 0.5);
  // crown spikes
  for (let i = 0; i < 26; i++) {
    const ang = Math.PI + (i / 25) * Math.PI; // upper half
    const len = 34 + rand() * 74;
    const bx = cx + Math.cos(ang) * 26, by = cy + Math.sin(ang) * 8;
    const ex = cx + Math.cos(ang) * (26 + len), ey = cy + Math.sin(ang) * len * 0.92;
    const steps = 14;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = lerp(bx, ex, t), y = lerp(by, ey, t) - Math.sin(t * Math.PI) * 6;
      disc(x, y, lerp(3.4, 1.1, t), rgb(0xeafcff), 1.4);
    }
    disc(ex, ey, 2.4 + rand() * 2.2, rgb(0xffffff), 1.2);
  }
  // a light spray of droplets shaken off the rising body
  for (let i = 0; i < 100; i++) {
    const t = rand();
    const x = cx - 40 + t * 400 + (rand() - 0.5) * 44;
    const y = cy - Math.sin(t * Math.PI) * (120 + rand() * 110) + rand() * 30;
    if (mask[Math.round(y) * W + Math.round(x)] > 0.4) continue; // not inside the whale
    disc(x, y, 0.7 + rand() * 1.5, rgb(0xdff7ff), 1.1);
  }
  // foam flecks around the waterline
  for (let i = 0; i < 160; i++) {
    const x = cx + (rand() + rand() - 1) * 210;
    const y = cy + rand() * 46 - 6;
    disc(x, y, 0.7 + rand() * 1.8, rgb(0xcdf2ff), 1.0);
  }
}

// ------------------------------------------------- the lighthouse island ---
{
  // rock: a craggy wedge of stacked ellipses, dark but clearly off the sea
  const rock = rgb(0x141f3a);
  ellipse(196, 990, 136, 58, 0, rock, 4);
  ellipse(150, 946, 84, 44, -0.2, rock, 4);
  ellipse(226, 936, 76, 46, 0.15, rock, 4);
  ellipse(188, 898, 56, 36, 0.05, rock, 4);
  ellipse(200, 868, 38, 24, 0, rock, 4);
  // moonlit shoulder on the rock's right side, warm spill under the lamp
  ellipseA(240, 922, 38, 50, 0.2, rgb(0x33477a), 12, 0.45);
  glow(191, 812, 96, rgb(0xffb347), 0.16);
  // foam flecks where the rock meets the water, to seat it in the sea
  for (let i = 0; i < 46; i++) {
    const x = 84 + rand() * 236, y = 972 + (rand() + rand() - 1) * 9;
    disc(x, y, 0.7 + rand() * 1.6, rgb(0x9fd8e8), 1.0);
  }
  // tower: tapered white column with two red bands
  const towerC = rgb(0xe8e4da), bandC = rgb(0xc33b4e);
  for (let y = 772; y <= 864; y++) {
    const t = (y - 772) / 92;
    const half = lerp(10, 15, t);
    const c = (y > 800 && y < 818) || (y > 838 && y < 852) ? bandC : towerC;
    for (let x = Math.round(191 - half); x <= Math.round(191 + half); x++) blendPx(x, y, c, 0.96);
  }
  // lamp room: glass, then a roof cap above it, then the lamp's glow and core
  for (let y = 748; y <= 766; y++) for (let x = 183; x <= 199; x++) blendPx(x, y, rgb(0x2a3350), 0.95);
  for (let y = 738; y <= 748; y++) { // roof: a shallow trapezoid
    const half = lerp(3, 11, (y - 738) / 10);
    for (let x = Math.round(191 - half); x <= Math.round(191 + half); x++) blendPx(x, y, rgb(0x141c30), 0.97);
  }
  glow(191, 757, 96, rgb(0xffb347), 0.55);
  glow(191, 757, 36, rgb(0xffcf7a), 0.85);
  disc(191, 757, 6.5, rgb(0xfff3c4), 1.2);
  // the keeper: a tiny silhouette with a lantern, watching the whale
  const kx = 244, ky = 884;
  disc(kx, ky - 24, 3.8, rgb(0x05070f), 1);            // head
  for (let y = ky - 19; y <= ky + 10; y++) {           // body
    const half = y < ky - 8 ? 2.6 : 3.8;
    for (let x = Math.round(kx - half); x <= Math.round(kx + half); x++) blendPx(x, y, rgb(0x05070f), 0.97);
  }
  glow(kx + 13, ky - 4, 22, rgb(0xffb347), 0.5);      // lantern glow
  disc(kx + 13, ky - 4, 2.4, rgb(0xffe9b0), 0.8);     // lantern
  // the lamp's reflection: a shimmering column of short dashes on the water
  for (let i = 0; i < 90; i++) {
    const y = 906 + Math.pow(rand(), 1.3) * 108;
    const xc = 191 + (rand() + rand() - 1) * (10 + (y - 906) * 0.22);
    const len = 3 + rand() * 9, a = 0.10 + rand() * 0.22;
    for (let d = 0; d < len; d++) {
      const xx = Math.round(xc + d), yy = Math.round(y);
      if (xx >= 0 && xx < W && yy < H) addPx(xx, yy, rgb(0xffb347), a);
    }
  }
}

// ------------------------------------------------------------- finishing ---
// A few rising sparkles between sea and whale, then a gentle vignette.
{
  for (let i = 0; i < 90; i++) {
    const x = 180 + rand() * 620, y = 420 + rand() * 380;
    if (mask[Math.round(y) * W + Math.round(x)] > 0.3) continue;
    star(x, y, 0.6 + rand() * 1.1, rgb(0xbdf3ff), 0.2 + rand() * 0.4);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - W / 2, y - H / 2) / (W * 0.72);
      const k = 1 - Math.max(0, d - 0.55) * 0.34;
      const idx = (y * W + x) * 3;
      buf[idx] *= k; buf[idx + 1] *= k; buf[idx + 2] *= k;
    }
  }
}

// ------------------------------------------------------------ PNG output ---
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(): Buffer {
  // tone map: soft shoulder so glows bloom without hard clipping
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3, o = row + 1 + x * 3;
      for (let ch = 0; ch < 3; ch++) {
        const v = buf[i + ch];
        raw[o + ch] = Math.round(255 * (v / (1 + v * 0.32)));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), encodePNG());
