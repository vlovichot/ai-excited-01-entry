// The Breach — a colossal whale made of stars and nebula arcs out of a night
// ocean past a full moon, while a tiny lighthouse keeper watches from below.
// Pure Node standard library. Fully deterministic: seeded PRNG only, no
// Date, no Math.random. Renders at 2x supersampling and downscales to
// 1024x1024 for clean edges, then writes entry.png with a hand-rolled
// PNG encoder (zlib + CRC32).

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- PRNG
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- canvas
const SS = 2; // supersampling factor
const OUT = 1024; // final size
const W = OUT * SS;
const buf = new Float32Array(W * W * 3);

type RGB = [number, number, number];

function idx(x: number, y: number): number {
  return (y * W + x) * 3;
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= W || a <= 0) return;
  const i = idx(x, y);
  const ia = 1 - a;
  buf[i] = buf[i] * ia + c[0] * a;
  buf[i + 1] = buf[i + 1] * ia + c[1] * a;
  buf[i + 2] = buf[i + 2] * ia + c[2] * a;
}

function addPx(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= W || a <= 0) return;
  const i = idx(x, y);
  buf[i] += c[0] * a;
  buf[i + 1] += c[1] * a;
  buf[i + 2] += c[2] * a;
}

// Soft radial disc in 1024-space coordinates.
function disc(
  cx: number,
  cy: number,
  r: number,
  c: RGB,
  alpha: number,
  add = false,
): void {
  const R = r * SS;
  const CX = cx * SS;
  const CY = cy * SS;
  const x0 = Math.max(0, Math.floor(CX - R));
  const x1 = Math.min(W - 1, Math.ceil(CX + R));
  const y0 = Math.max(0, Math.floor(CY - R));
  const y1 = Math.min(W - 1, Math.ceil(CY + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - CX;
      const dy = y - CY;
      const d = Math.sqrt(dx * dx + dy * dy) / R;
      if (d >= 1) continue;
      const fall = 1 - d * d * (3 - 2 * d); // smoothstep falloff
      if (add) addPx(x, y, c, alpha * fall);
      else blendPx(x, y, c, alpha * fall);
    }
  }
}

// Hard-edged filled circle (for stars, droplets, moon).
function dot(cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  const R = Math.max(0.6, r * SS);
  const CX = cx * SS;
  const CY = cy * SS;
  const x0 = Math.max(0, Math.floor(CX - R - 1));
  const x1 = Math.min(W - 1, Math.ceil(CX + R + 1));
  const y0 = Math.max(0, Math.floor(CY - R - 1));
  const y1 = Math.min(W - 1, Math.ceil(CY + R + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - CX;
      const dy = y - CY;
      const d = Math.sqrt(dx * dx + dy * dy);
      const cov = Math.min(1, Math.max(0, R + 0.5 - d));
      if (cov > 0) blendPx(x, y, c, alpha * cov);
    }
  }
}

// Filled polygon in 1024-space; returns nothing, paints with blend.
function poly(pts: { x: number; y: number }[], c: RGB, alpha: number): void {
  const sp = pts.map((p) => ({ x: p.x * SS, y: p.y * SS }));
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of sp) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(W - 1, Math.ceil(maxY));
  const n = sp.length;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = sp[i];
      const b = sp[(i + 1) % n];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k]));
      const xb = Math.min(W - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) blendPx(x, y, c, alpha);
    }
  }
  void minX;
  void maxX;
}

// Stroke a polyline with round dots along it.
function stroke(
  pts: { x: number; y: number }[],
  width: number,
  c: RGB,
  alpha: number,
): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / (width * 0.4)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, width / 2, c, alpha);
    }
  }
}

// ---------------------------------------------------------------- helpers
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- scene
const HORIZON = 745;

function paintSky(): void {
  const top: RGB = [3, 8, 30];
  const mid: RGB = [8, 24, 66];
  const low: RGB = [13, 44, 92];
  for (let y = 0; y < W; y++) {
    const v = y / W; // 0..1 in 1024-space
    const c =
      v < 0.55
        ? mix(top, mid, v / 0.55)
        : mix(mid, low, Math.min(1, (v - 0.55) / 0.45));
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }
  // subtle sky nebula washes
  const rnd = mulberry32(777);
  const cols: RGB[] = [
    [64, 32, 140],
    [20, 80, 160],
    [16, 130, 140],
    [90, 40, 150],
  ];
  for (let k = 0; k < 6; k++) {
    disc(
      120 + rnd() * 800,
      60 + rnd() * 430,
      150 + rnd() * 190,
      cols[k % cols.length],
      0.05 + rnd() * 0.04,
      true,
    );
  }
}

function paintStars(): void {
  const rnd = mulberry32(4242);
  for (let k = 0; k < 750; k++) {
    const x = rnd() * 1024;
    const y = Math.pow(rnd(), 1.35) * (HORIZON - 30);
    const b = 0.25 + rnd() * 0.75;
    const r = rnd() < 0.06 ? 1.9 : 0.7 + rnd() * 0.9;
    const tint: RGB =
      rnd() < 0.18 ? [170, 220, 255] : rnd() < 0.1 ? [255, 230, 190] : [235, 242, 255];
    dot(x, y, r, tint, b * (y > 640 ? 0.45 : 1));
    if (r > 1.8) {
      // sparkle cross on the brightest
      disc(x, y, 6, tint, 0.1, true);
    }
  }
}

const MOON = { x: 688, y: 232, r: 94 };

function paintMoon(): void {
  disc(MOON.x, MOON.y, MOON.r * 2.6, [120, 150, 220], 0.1, true);
  disc(MOON.x, MOON.y, MOON.r * 1.45, [170, 195, 245], 0.16, true);
  dot(MOON.x, MOON.y, MOON.r, [232, 238, 250], 1);
  // gentle terminator shading, lower-left
  disc(MOON.x - 34, MOON.y + 40, MOON.r * 0.95, [168, 182, 214], 0.28);
  // craters
  const rnd = mulberry32(99);
  for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * MOON.r * 0.62;
    const cx = MOON.x + Math.cos(a) * d;
    const cy = MOON.y + Math.sin(a) * d;
    disc(cx, cy, 7 + rnd() * 13, [176, 190, 218], 0.2);
  }
  dot(MOON.x, MOON.y, MOON.r, [240, 244, 252], 0.12); // lift centre back up
}

function paintOcean(): void {
  const yTop = Math.floor(HORIZON * SS);
  const cTop: RGB = [11, 42, 84];
  const cBot: RGB = [2, 6, 20];
  for (let y = yTop; y < W; y++) {
    const v = (y - yTop) / (W - yTop);
    const c = mix(cTop, cBot, Math.pow(v, 0.8));
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }
  const rnd = mulberry32(2024);
  // moon glitter column
  for (let k = 0; k < 150; k++) {
    const y = HORIZON + 6 + Math.pow(rnd(), 1.4) * 250;
    const spread = 14 + (y - HORIZON) * 0.16;
    const x = MOON.x + (rnd() + rnd() - 1) * spread;
    const len = 5 + rnd() * 22 * (0.5 + (y - HORIZON) / 260);
    const a = 0.05 + rnd() * 0.16;
    for (let s = 0; s < len; s += 1.5) {
      dot(x + s, y, 0.85, [168, 216, 255], a);
    }
  }
  // general shimmer
  for (let k = 0; k < 80; k++) {
    const x = rnd() * 1024;
    const y = HORIZON + 8 + rnd() * 262;
    const len = 4 + rnd() * 13;
    const a = 0.03 + rnd() * 0.06;
    for (let s = 0; s < len; s += 1.5) dot(x + s, y, 0.8, [140, 200, 250], a);
  }
}

// ------------------------------------------------------------- the whale
const P0 = { x: 196, y: 818 };
const P1 = { x: 285, y: 372 };
const P2 = { x: 622, y: 242 };
const P3 = { x: 830, y: 480 };
const ARC_C = { x: 520, y: 660 }; // inside of the arc (belly side)

function spine(t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
    y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y,
  };
}
function tangent(t: number): { x: number; y: number } {
  const u = 1 - t;
  const x =
    3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x);
  const y =
    3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y);
  const l = Math.hypot(x, y);
  return { x: x / l, y: y / l };
}
function halfW(t: number): number {
  let h = 9 + 72 * smoothstep(0, 0.45, t);
  h *= 1 - 0.25 * smoothstep(0.8, 1, t); // gentle taper; the round cap keeps the head blunt
  return h;
}

function whaleOutline(): {
  all: { x: number; y: number }[];
  sideA: { x: number; y: number }[];
  sideB: { x: number; y: number }[];
} {
  const N = 60;
  const sideA: { x: number; y: number }[] = [];
  const sideB: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const s = spine(t);
    const tg = tangent(t);
    const nx = -tg.y;
    const ny = tg.x;
    const h = halfW(t);
    sideA.push({ x: s.x + nx * h, y: s.y + ny * h });
    sideB.push({ x: s.x - nx * h, y: s.y - ny * h });
  }
  // blunt round cap around the head
  const c = spine(1);
  const tg = tangent(1);
  const nx = -tg.y;
  const ny = tg.x;
  const h = halfW(1);
  const cap: { x: number; y: number }[] = [];
  for (let i = 1; i < 10; i++) {
    const th = -Math.PI / 2 + (i / 10) * Math.PI;
    cap.push({
      x: c.x + tg.x * Math.sin(th) * h + nx * Math.cos(th) * h,
      y: c.y + tg.y * Math.sin(th) * h + ny * Math.cos(th) * h,
    });
  }
  const all = [...sideA, ...cap, ...sideB.reverse()];
  return { all, sideA, sideB: [...sideB].reverse() };
}

function paintWhale(): void {
  const { all, sideA, sideB } = whaleOutline();
  // decide which side is the back (farther from the arc centre)
  const midA = sideA[Math.floor(sideA.length / 2)];
  const midB = sideB[Math.floor(sideB.length / 2)];
  const dA = Math.hypot(midA.x - ARC_C.x, midA.y - ARC_C.y);
  const dB = Math.hypot(midB.x - ARC_C.x, midB.y - ARC_C.y);
  const back = dA > dB ? sideA : sideB;
  const bellySign = dA > dB ? -1 : 1; // normal sign pointing to belly side

  // halo glow behind the body
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const s = spine(t);
    disc(s.x, s.y, halfW(t) + 52, [46, 96, 178], 0.055, true);
  }

  // tail fluke, drawn behind the body
  const tail = spine(0.015);
  const tg0 = tangent(0.015);
  const nx0 = -tg0.y;
  const ny0 = tg0.x;
  const fluke: { x: number; y: number }[] = [
    { x: tail.x + nx0 * 8, y: tail.y + ny0 * 8 },
    { x: tail.x - tg0.x * 62 + nx0 * 52, y: tail.y - tg0.y * 62 + ny0 * 52 },
    { x: tail.x - tg0.x * 30 + nx0 * 14, y: tail.y - tg0.y * 30 + ny0 * 14 },
    { x: tail.x - tg0.x * 66 - nx0 * 54, y: tail.y - tg0.y * 66 - ny0 * 54 },
    { x: tail.x - nx0 * 8, y: tail.y - ny0 * 8 },
  ];
  poly(fluke, [16, 26, 66], 1);

  // body base
  poly(all, [23, 30, 78], 1);

  // ---- interior effects, clipped by re-testing the silhouette via a mask
  // Build a device-space mask of the whale for clipping.
  const mask = new Uint8Array(W * W);
  {
    const sp = all.map((p) => ({ x: p.x * SS, y: p.y * SS }));
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of sp) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(W - 1, Math.ceil(maxY));
    const n = sp.length;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = sp[i];
        const b = sp[(i + 1) % n];
        if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
          xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.floor(xs[k]));
        const xb = Math.min(W - 1, Math.ceil(xs[k + 1]));
        for (let x = xa; x <= xb; x++) mask[y * W + x] = 1;
      }
    }
  }
  const inWhale = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < 1024 && y < 1024 && mask[(y * SS) * W + x * SS] === 1;

  // nebula clouds inside
  const rnd = mulberry32(31337);
  const nebCols: RGB[] = [
    [116, 44, 220],
    [200, 52, 190],
    [40, 110, 235],
    [30, 200, 205],
    [90, 70, 230],
  ];
  for (let k = 0; k < 16; k++) {
    const t = 0.06 + rnd() * 0.9;
    const s = spine(t);
    const tg = tangent(t);
    const nx = -tg.y;
    const ny = tg.x;
    const off = (rnd() * 2 - 1) * halfW(t) * 0.45;
    const cx = s.x + nx * off;
    const cy = s.y + ny * off;
    const r = 34 + rnd() * 95;
    const col = nebCols[k % nebCols.length];
    const R = r * SS;
    const CX = cx * SS;
    const CY = cy * SS;
    const x0 = Math.max(0, Math.floor(CX - R));
    const x1 = Math.min(W - 1, Math.ceil(CX + R));
    const y0 = Math.max(0, Math.floor(CY - R));
    const y1 = Math.min(W - 1, Math.ceil(CY + R));
    const a0 = 0.14 + rnd() * 0.16;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!mask[y * W + x]) continue;
        const dx = x - CX;
        const dy = y - CY;
        const d = Math.sqrt(dx * dx + dy * dy) / R;
        if (d >= 1) continue;
        const fall = 1 - d * d * (3 - 2 * d);
        addPx(x, y, col, a0 * fall);
      }
    }
  }
  // stars inside the whale
  for (let k = 0; k < 340; k++) {
    const t = rnd();
    const s = spine(t);
    const tg = tangent(t);
    const nx = -tg.y;
    const ny = tg.x;
    const off = (rnd() * 2 - 1) * halfW(t) * 0.88;
    const x = s.x + nx * off;
    const y = s.y + ny * off;
    if (!inWhale(Math.round(x), Math.round(y))) continue;
    const b = 0.35 + rnd() * 0.65;
    const tint: RGB = rnd() < 0.22 ? [160, 230, 255] : [240, 244, 255];
    dot(x, y, rnd() < 0.08 ? 2 : 0.8 + rnd(), tint, b);
  }
  // soft top-light / bottom shade inside the silhouette
  {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of all) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const y0 = Math.max(0, Math.floor(minY * SS));
    const y1 = Math.min(W - 1, Math.ceil(maxY * SS));
    for (let y = y0; y <= y1; y++) {
      const v = (y / SS - minY) / (maxY - minY);
      for (let x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        if (v < 0.4) addPx(x, y, [70, 120, 200], 0.1 * (1 - v / 0.4));
        else blendPx(x, y, [2, 4, 16], 0.22 * ((v - 0.4) / 0.6));
      }
    }
  }

  // pectoral fin on the belly side
  {
    const t1 = 0.47;
    const t2 = 0.6;
    const s1 = spine(t1);
    const s2 = spine(t2);
    const g1 = tangent(t1);
    const g2 = tangent(t2);
    const b1 = { x: s1.x + (-g1.y) * bellySign * halfW(t1) * 0.92, y: s1.y + g1.x * bellySign * halfW(t1) * 0.92 };
    const b2 = { x: s2.x + (-g2.y) * bellySign * halfW(t2) * 0.92, y: s2.y + g2.x * bellySign * halfW(t2) * 0.92 };
    const sm = spine(0.54);
    const gm = tangent(0.54);
    const tip = {
      x: sm.x + (-gm.y) * bellySign * (halfW(0.54) + 108) - gm.x * 34,
      y: sm.y + gm.x * bellySign * (halfW(0.54) + 108) - gm.y * 34,
    };
    poly([b1, tip, b2], [18, 24, 64], 1);
    poly([b1, tip, b2], [90, 60, 180], 0.18);
  }

  // cyan rim light along the back
  stroke(back, 13, [64, 190, 235], 0.16);
  stroke(back, 5.5, [130, 232, 255], 0.75);
  stroke(back, 2.2, [215, 250, 255], 0.9);

  // eye: one bright bead near the head, belly side
  {
    const t = 0.93;
    const s = spine(t);
    const tg = tangent(t);
    const ex = s.x + (-tg.y) * bellySign * halfW(t) * 0.42 + tg.x * 14;
    const ey = s.y + tg.x * bellySign * halfW(t) * 0.42 + tg.y * 14;
    disc(ex, ey, 9, [150, 235, 255], 0.35, true);
    dot(ex, ey, 3.1, [235, 252, 255], 1);
  }
}

// ------------------------------------------------------------- splash
function paintSplash(): void {
  const rnd = mulberry32(555);
  const cx = 218;
  const cy = 756;
  // foam bed: broken overlapping ellipses, never a solid bar
  for (let k = 0; k < 26; k++) {
    const x = cx + (rnd() * 2 - 1) * 78;
    const y = cy + (rnd() * 2 - 1) * 7;
    const r = 6 + rnd() * 17;
    disc(x, y, r, [205, 238, 252], 0.1 + rnd() * 0.16);
    dot(x, y - 1, r * 0.4, [240, 252, 255], 0.25);
  }
  // droplet crown: a fan of separate drops arcing up
  for (let k = 0; k < 150; k++) {
    const ang = Math.PI * (0.08 + rnd() * 0.84); // upward fan
    const dist = 14 + Math.pow(rnd(), 1.6) * 118;
    const x = cx + Math.cos(ang) * dist * 1.25 + (rnd() * 2 - 1) * 5;
    const y = cy - Math.sin(ang) * dist + dist * dist * 0.0011; // gravity sag
    const r = Math.max(0.8, 4.6 * (1 - dist / 150) + rnd() * 1.4);
    const col: RGB = rnd() < 0.3 ? [160, 228, 255] : [228, 246, 255];
    dot(x, y, r, col, 0.55 + rnd() * 0.45);
  }
  // a few arcing streaks made of dotted runs
  for (let sIdx = 0; sIdx < 4; sIdx++) {
    const x0 = cx - 30 + sIdx * 20;
    const peak = 60 + rnd() * 55;
    for (let s = 0; s <= 14; s++) {
      const t = s / 14;
      const x = x0 + t * (46 + sIdx * 9);
      const y = cy - Math.sin(t * Math.PI) * peak + t * 16;
      dot(x, y, 1.7 * (1 - t * 0.5), [215, 242, 255], 0.65);
    }
  }
  // droplets shedding off the belly and fluke
  for (let k = 0; k < 46; k++) {
    const t = 0.04 + rnd() * 0.5;
    const s = spine(t);
    const tg = tangent(t);
    const bx = s.x + (-tg.y) * 1 * halfW(t); // one belly side is enough visually
    const by = s.y + tg.x * 1 * halfW(t);
    const x = bx + (rnd() * 2 - 1) * 7;
    const y = by + 8 + rnd() * 60;
    dot(x, y, 0.8 + rnd() * 1.5, [190, 232, 255], 0.5 + rnd() * 0.4);
  }
}

// ------------------------------------------------------------- island
function paintIsland(): void {
  const mound = [
    { x: 690, y: 814 },
    { x: 712, y: 790 },
    { x: 762, y: 779 },
    { x: 838, y: 778 },
    { x: 884, y: 789 },
    { x: 906, y: 814 },
  ];
  poly(mound, [7, 13, 28], 1);
  stroke(mound.slice(0, 5), 2.4, [120, 190, 235], 0.35); // moonlit crest

  const lx = 796; // lighthouse centre
  const baseY = 783;
  const topY = 716;
  // tower: trapezoid, white with two red bands
  const tower = [
    { x: lx - 9, y: baseY },
    { x: lx - 6, y: topY },
    { x: lx + 6, y: topY },
    { x: lx + 9, y: baseY },
  ];
  poly(tower, [226, 232, 240], 1);
  const band = (y0: number, y1: number): void => {
    const wAt = (y: number): number => 9 - ((baseY - y) / (baseY - topY)) * 3;
    poly(
      [
        { x: lx - wAt(y1), y: y1 },
        { x: lx - wAt(y0), y: y0 },
        { x: lx + wAt(y0), y: y0 },
        { x: lx + wAt(y1), y: y1 },
      ],
      [196, 48, 40],
      1,
    );
  };
  band(742, 758);
  band(718, 730);
  // lamp room + cap
  poly(
    [
      { x: lx - 7, y: 716 },
      { x: lx - 7, y: 702 },
      { x: lx + 7, y: 702 },
      { x: lx + 7, y: 716 },
    ],
    [14, 17, 28],
    1,
  );
  poly(
    [
      { x: lx - 9, y: 702 },
      { x: lx, y: 692 },
      { x: lx + 9, y: 702 },
    ],
    [10, 12, 22],
    1,
  );
  // the warm lamp: the only warm light in the scene besides its glow
  disc(lx, 709, 30, [255, 166, 58], 0.4, true);
  disc(lx, 709, 13, [255, 186, 84], 0.55, true);
  dot(lx, 709, 4.4, [255, 208, 122], 1);
  dot(lx, 709, 2, [255, 244, 214], 1);

  // the keeper: a tiny silhouette with a lantern
  const kx = 852;
  const ky = 788;
  poly(
    [
      { x: kx - 3, y: ky },
      { x: kx - 2.4, y: ky - 11 },
      { x: kx + 2.4, y: ky - 11 },
      { x: kx + 3, y: ky },
    ],
    [4, 6, 12],
    1,
  );
  dot(kx, ky - 14, 2.9, [4, 6, 12], 1);
  disc(kx + 8, ky - 7, 8.5, [255, 176, 70], 0.5, true);
  dot(kx + 8, ky - 7, 1.9, [255, 206, 120], 1);
  // warm pool at the keeper's feet
  disc(kx + 3, ky + 2, 15, [255, 160, 60], 0.1, true);
}

// ------------------------------------------------------------- finish
function paintVignette(): void {
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x / SS - 512;
      const dy = y / SS - 470;
      const d = Math.hypot(dx, dy) / 620;
      const f = 1 - 0.3 * smoothstep(0.55, 1.05, d);
      const i = idx(x, y);
      buf[i] *= f;
      buf[i + 1] *= f;
      buf[i + 2] *= f;
    }
  }
}

function downscale(factor: number): { data: Uint8Array; size: number } {
  const size = OUT / factor;
  const data = new Uint8Array(size * size * 3);
  const block = SS * factor;
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const i = idx(ox * block + dx, oy * block + dy);
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          n++;
        }
      }
      const o = (oy * size + ox) * 3;
      data[o] = Math.max(0, Math.min(255, Math.round(r / n)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(g / n)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b / n)));
    }
  }
  return { data, size };
}

// ---------------------------------------------------------------- PNG
const crcTable = ((): Int32Array => {
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
  for (let i = 0; i < data.length; i++) {
    c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgb: Uint8Array, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  // per-row filter choice among None/Sub/Up/Paeth by min sum of |signed byte|
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < size; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestScore = Infinity;
    let bestRow: Uint8Array = row;
    for (let type = 0; type <= 4; type++) {
      if (y === 0 && (type === 2 || type === 4)) continue;
      const cand = new Uint8Array(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3] : 0;
        const b = prev[i];
        const c = i >= 3 ? prev[i - 3] : 0;
        let pred = 0;
        if (type === 1) pred = a;
        else if (type === 2) pred = b;
        else if (type === 3) pred = (a + b) >> 1;
        else if (type === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i] - pred) & 0xff;
        cand[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        bestRow = cand;
      }
    }
    const off = y * (stride + 1);
    raw[off] = bestType;
    raw.set(bestRow, off + 1);
    prev.set(row);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- main
function main(): void {
  paintSky();
  paintStars();
  paintMoon();
  paintOcean();
  paintWhale();
  paintSplash();
  paintIsland();
  paintVignette();

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const full = downscale(1);
  const png = encodePNG(full.data, full.size);
  writeFileSync(join(outDir, "entry.png"), png);

  const previewDir = process.env.MAKEFUN_PREVIEW_DIR;
  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    const prev = downscale(4);
    writeFileSync(
      join(previewDir, "entry-preview.png"),
      encodePNG(prev.data, prev.size),
    );
  }
}

main();
