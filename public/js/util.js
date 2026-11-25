// Hilfsfunktionen: Zufall mit Seed, Rauschen, Hex-Gitter, Prioritätswarteschlange

// ------------------------------------------------------------ Zufall (deterministisch)
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) { this.next = mulberry32(typeof seed === 'number' ? seed : hashString(String(seed))); }
  float() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
}

// ------------------------------------------------------------ Value-Noise mit fBm
export class Noise2D {
  constructor(seed) {
    const r = new Rng(seed);
    this.perm = new Uint16Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    r.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grad = new Float32Array(256 * 2);
    for (let i = 0; i < 256; i++) { const a = r.float() * Math.PI * 2; this.grad[i * 2] = Math.cos(a); this.grad[i * 2 + 1] = Math.sin(a); }
  }
  // Gradient-Rauschen (Perlin-artig), Wertebereich ca. -1..1
  noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const g = (ix, iy, dx, dy) => { const h = this.perm[(this.perm[ix & 255] + iy) & 511] & 255; return this.grad[h * 2] * dx + this.grad[h * 2 + 1] * dy; };
    const n00 = g(xi, yi, xf, yf), n10 = g(xi + 1, yi, xf - 1, yf);
    const n01 = g(xi, yi + 1, xf, yf - 1), n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
    return 1.41 * ((n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v);
  }
  fbm(x, y, oct = 5, lac = 2, gain = 0.5) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * this.noise(x * f, y * f); norm += amp; amp *= gain; f *= lac; }
    return sum / norm;
  }
  ridge(x, y, oct = 4) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * (1 - Math.abs(this.noise(x * f, y * f))); norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
  }
}

// ------------------------------------------------------------ Hex-Gitter (spitze Oberseite, "odd-r")
export const HEX_R = 24;                    // Radius in Welteinheiten (1 Kachel ≈ 1 km)
export const HEX_W = Math.sqrt(3) * HEX_R;  // Breite
export const HEX_H = 1.5 * HEX_R;           // Zeilenabstand

const DIRS = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]],
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]],
];

export class HexGrid {
  constructor(w, h) { this.w = w; this.h = h; this.n = w * h; }
  idx(q, r) { return r * this.w + q; }
  q(i) { return i % this.w; }
  r(i) { return (i / this.w) | 0; }
  inside(q, r) { return q >= 0 && r >= 0 && q < this.w && r < this.h; }
  cx(i) { const r = this.r(i); return HEX_W * (this.q(i) + 0.5 * (r & 1)) + HEX_W / 2; }
  cy(i) { return HEX_H * this.r(i) + HEX_R; }
  neighbors(i, out = []) {
    out.length = 0;
    const q = this.q(i), r = this.r(i);
    for (const [dq, dr] of DIRS[r & 1]) { const nq = q + dq, nr = r + dr; if (this.inside(nq, nr)) out.push(nr * this.w + nq); }
    return out;
  }
  // Nachbar in Richtung d (0..5) oder -1
  neighbor(i, d) {
    const q = this.q(i), r = this.r(i);
    const [dq, dr] = DIRS[r & 1][d];
    const nq = q + dq, nr = r + dr;
    return this.inside(nq, nr) ? nr * this.w + nq : -1;
  }
  toCube(i) { const q = this.q(i), r = this.r(i); const x = q - (r - (r & 1)) / 2; return [x, r, -x - r]; }
  dist(a, b) {
    const [ax, ay, az] = this.toCube(a), [bx, by, bz] = this.toCube(b);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
  }
  // Weltkoordinate -> Kachelindex (oder -1)
  at(x, y) {
    x -= HEX_W / 2; y -= HEX_R;
    const fq = (Math.sqrt(3) / 3 * x - y / 3) / HEX_R;
    const fr = (2 / 3 * y) / HEX_R;
    let rx = Math.round(fq), rz = Math.round(fr), ry = Math.round(-fq - fr);
    const dx = Math.abs(rx - fq), dz = Math.abs(rz - fr), dy = Math.abs(ry + fq + fr);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dz > dy) rz = -rx - ry;
    const col = rx + (rz - (rz & 1)) / 2, row = rz;
    return this.inside(col, row) ? this.idx(col, row) : -1;
  }
  corners(i) {
    const cx = this.cx(i), cy = this.cy(i), out = [];
    for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); out.push([cx + HEX_R * Math.cos(a), cy + HEX_R * Math.sin(a)]); }
    return out;
  }
  // Ecke k (0..5) liegt zwischen den Richtungen; Kante d verbindet Ecken (d+5)%6 und d? -> eigene Zuordnung
  edgeCorners(i, d) {
    // Richtung 0 = Osten, 1 = Nordost, 2 = Nordwest, 3 = Westen, 4 = Südwest, 5 = Südost
    // Ecken: 0=O-unten(30° unter Ost? ) – Winkel 60k-30: k0=-30°(NO), k1=30°(SO), k2=90°(S), k3=150°(SW), k4=210°(NW), k5=270°(N)
    const map = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
    const c = this.corners(i);
    return [c[map[d][0]], c[map[d][1]]];
  }
  get worldW() { return HEX_W * (this.w + 0.5) + HEX_W / 2 - HEX_W / 2; }
  get worldH() { return HEX_H * (this.h - 1) + 2 * HEX_R; }
}

// ------------------------------------------------------------ Binäre Halde
export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// ------------------------------------------------------------ Sonstiges
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}
export function fmt(n, d = 0) {
  if (!isFinite(n)) return '–';
  return n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtShort(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return fmt(n / 1e6, 1) + ' Mio';
  if (a >= 1e4) return fmt(n / 1e3, 1) + ' T';
  return fmt(n, a < 10 && n % 1 ? 1 : 0);
}
