// Darstellung: Pergament-Karte mit weichen Biomen, Küsten, Flüssen, Provinzen und Städten
import { HEX_R, HEX_W, HEX_H, clamp, hashString, mulberry32 } from './util.js';
import { BIOMES, B, DEPOSITS, BUILDINGS, TRANSPORT } from './data.js';

const FOG = '#2b2822';
const LOW = 1 / 6;          // Auflösung der weichen Farbtexturen (Pixel je Welteinheit)
const CHUNK = 512;          // Kachelgröße der Detailtextur in Pixeln
const CHUNK_SCALE = 4;      // Pixel je Welteinheit in Detailtexturen

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }
function shade([r, g, b], f) { return f >= 0 ? [r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f] : [r * (1 + f), g * (1 + f), b * (1 + f)]; }
function chaikin(pts, closed, iter = 2) {
  for (let k = 0; k < iter; k++) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) { out.unshift(pts[0]); out.push(pts[n - 1]); }
    pts = out;
  }
  return pts;
}

export class Renderer {
  constructor(canvas, game) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.map = game.map;
    this.g = game.map.grid;
    this.worldW = this.g.worldW; this.worldH = this.g.worldH;
    this.cam = { x: this.worldW / 2, y: this.worldH / 2, zoom: 0.2 };
    this.mode = 'gelaende';
    this.chunks = new Map();
    this.hover = null;          // {tile, prov, x, y}
    this.ghost = null;          // Platzierungsvorschau
    this.selected = null;
    this.time = 0;
    this.buildStatic();
    this.buildPolitical();
    this.resize();
  }

  // ------------------------------------------------------------ Vorberechnung
  buildStatic() {
    const m = this.map, g = this.g, N = g.n;
    const W = this.worldW, H = this.worldH;
    // Weiche Landfarbe
    const cw = Math.ceil(W * LOW), ch = Math.ceil(H * LOW);
    const col = document.createElement('canvas'); col.width = cw; col.height = ch;
    const sea = document.createElement('canvas'); sea.width = cw; sea.height = ch;
    const cc = col.getContext('2d'), sc = sea.getContext('2d');
    cc.setTransform(LOW, 0, 0, LOW, 0, 0); sc.setTransform(LOW, 0, 0, LOW, 0, 0);
    const nb = [];
    const landColor = new Array(N);
    for (let i = 0; i < N; i++) {
      const b = m.biome[i];
      if (b === B.meer) continue;
      let c = hexToRgb(BIOMES[b].color);
      // Schattierung nach Höhe (Licht von Nordwest)
      const e = m.elev[i];
      const nE = g.neighbor(i, 0), nW = g.neighbor(i, 3), nN = g.neighbor(i, 2), nS = g.neighbor(i, 5);
      const ex = (nE >= 0 ? m.elev[nE] : e) - (nW >= 0 ? m.elev[nW] : e);
      const ey = (nS >= 0 ? m.elev[nS] : e) - (nN >= 0 ? m.elev[nN] : e);
      const sh = clamp(-(ex + ey) * 2.2, -0.18, 0.18);
      const h = (hashString('t' + i) % 1000) / 1000;
      c = shade(c, sh + (h - 0.5) * 0.03);
      if (m.river[i] >= 0 || (b === B.flach && m.fert[i] > 1.05)) c = shade(c, -0.03);
      landColor[i] = c;
    }
    for (let i = 0; i < N; i++) {
      let c = landColor[i];
      if (!c) {
        // Meerkacheln übernehmen die Farbe benachbarten Landes (keine bläulichen Ränder)
        const ln = g.neighbors(i, nb).find(n => landColor[n]);
        c = ln !== undefined ? landColor[ln] : [120, 130, 90];
      }
      cc.fillStyle = rgb(...c);
      this.hexPath(cc, i, 1.08); cc.fill();
      // Meerestiefe
      const d = Math.min(m.distSea[i] === 0 ? this.seaDepth(i) : 0, 10) / 10;
      const s1 = [96, 146, 166], s2 = [40, 82, 110];
      sc.fillStyle = rgb(s1[0] + (s2[0] - s1[0]) * d, s1[1] + (s2[1] - s1[1]) * d, s1[2] + (s2[2] - s1[2]) * d);
      this.hexPath(sc, i, 1.08); sc.fill();
    }
    // Weichzeichnen: Biome gehen fließend ineinander über
    const blur = (src, px) => { const out = document.createElement('canvas'); out.width = src.width; out.height = src.height; const o = out.getContext('2d'); o.filter = `blur(${px}px)`; o.drawImage(src, 0, 0); if (o.filter === 'none' || !('filter' in o)) o.drawImage(src, 0, 0); return out; };
    this.colorCv = blur(col, 2.2); this.seaCv = blur(sea, 3);
    // Küstenlinie als geglättete Pfade
    this.landPath = this.buildLandPath();
    // Flüsse geglättet
    this.riverPolys = m.rivers.map(rv => {
      const pts = [...rv.tiles, rv.mouth].map(t => [g.cx(t), g.cy(t)]);
      if (rv.fromEdge) { const a = pts[0], b = pts[1]; pts.unshift([a[0] * 2 - b[0], a[1] * 2 - b[1]]); }
      return chaikin(pts, false, 3);
    });
    // Grundtextur der ganzen Karte
    const bs = Math.min(0.6, 4096 / W);
    this.baseScale = bs;
    const base = document.createElement('canvas');
    base.width = Math.ceil(W * bs); base.height = Math.ceil(H * bs);
    this.drawTerrain(base.getContext('2d'), bs, 0, 0, W, H, 0);
    this.baseCv = base;
    // Papierkörnung
    const grain = document.createElement('canvas'); grain.width = grain.height = 256;
    const gc = grain.getContext('2d'); const id = gc.createImageData(256, 256);
    const rnd = mulberry32(7);
    for (let k = 0; k < id.data.length; k += 4) { const v = 120 + rnd() * 135; id.data[k] = v; id.data[k + 1] = v * 0.95; id.data[k + 2] = v * 0.82; id.data[k + 3] = 255; }
    gc.putImageData(id, 0, 0);
    this.grain = this.ctx.createPattern(grain, 'repeat');
    // Minikarte
    this.mini = document.createElement('canvas');
  }
  seaDepth(i) {
    // Abstand zum Land (für Meer) per Breitensuche begrenzt
    if (!this._landDist) {
      const m = this.map, g = this.g, N = g.n;
      const d = new Int16Array(N).fill(99); const q = [];
      for (let k = 0; k < N; k++) if (m.biome[k] !== B.meer) { d[k] = 0; q.push(k); }
      for (let k = 0; k < q.length; k++) { const c = q[k]; if (d[c] > 10) continue; for (const n of g.neighbors(c, [])) if (d[n] > d[c] + 1) { d[n] = d[c] + 1; q.push(n); } }
      this._landDist = d;
    }
    return this._landDist[i];
  }
  hexPath(ctx, i, s = 1) {
    const cx = this.g.cx(i), cy = this.g.cy(i);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); const x = cx + HEX_R * s * Math.cos(a), y = cy + HEX_R * s * Math.sin(a); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
  }
  buildLandPath() {
    const m = this.map, g = this.g;
    const key = p => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
    const edges = new Map();
    for (let i = 0; i < g.n; i++) {
      if (m.biome[i] === B.meer) continue;
      for (let d = 0; d < 6; d++) {
        const n = g.neighbor(i, d);
        if (n >= 0 && m.biome[n] !== B.meer) continue;
        const [a, b] = g.edgeCorners(i, d);
        const k = key(a);
        if (!edges.has(k)) edges.set(k, []);
        edges.get(k).push({ a, b, used: false });
      }
    }
    const path = new Path2D();
    for (const list of edges.values()) for (const e of list) {
      if (e.used) continue;
      const pts = []; let cur = e;
      while (cur && !cur.used) {
        cur.used = true; pts.push(cur.a);
        const nxt = edges.get(key(cur.b));
        cur = nxt ? nxt.find(x => !x.used) : null;
      }
      if (pts.length < 3) continue;
      // Kantenmitten statt Ecken: nimmt den Sechseck-Zickzack heraus
      const mid = pts.map((p, k) => {
        const q = pts[(k + 1) % pts.length];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const h = hashString(key([mx, my]));
        const j = ((h % 1000) / 1000 - 0.5) * HEX_R * 0.5, j2 = (((h >> 10) % 1000) / 1000 - 0.5) * HEX_R * 0.5;
        return [mx + j, my + j2];
      });
      const sm = chaikin(mid, true, 3);
      path.moveTo(sm[0][0], sm[0][1]);
      for (let k = 1; k < sm.length; k++) path.lineTo(sm[k][0], sm[k][1]);
      path.closePath();
    }
    return path;
  }

  // Gelände in einen Kontext zeichnen (Weltbereich x0..x1, y0..y1)
  drawTerrain(ctx, s, x0, y0, x1, y1, level) {
    const m = this.map, g = this.g;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.seaCv, 0, 0, this.seaCv.width / LOW, this.seaCv.height / LOW);
    // Wellenlinien im Meer
    const r0 = Math.max(0, Math.floor(y0 / HEX_H) - 1), r1 = Math.min(g.h - 1, Math.ceil(y1 / HEX_H) + 1);
    const q0 = Math.max(0, Math.floor(x0 / HEX_W) - 1), q1 = Math.min(g.w - 1, Math.ceil(x1 / HEX_W) + 1);
    ctx.strokeStyle = 'rgba(220,235,240,0.16)'; ctx.lineWidth = 1.2;
    for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
      const i = g.idx(q, r);
      if (m.biome[i] !== B.meer || this.seaDepth(i) < 2 || (hashString('w' + i) % 3)) continue;
      const cx = g.cx(i), cy = g.cy(i);
      ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.quadraticCurveTo(cx - 4, cy - 3, cx, cy); ctx.quadraticCurveTo(cx + 4, cy + 3, cx + 8, cy); ctx.stroke();
    }
    // Flachwasser-Saum
    ctx.save();
    ctx.strokeStyle = 'rgba(170,205,205,0.35)'; ctx.lineWidth = 9; ctx.stroke(this.landPath);
    ctx.strokeStyle = 'rgba(190,215,210,0.35)'; ctx.lineWidth = 4; ctx.stroke(this.landPath);
    ctx.restore();
    // Land
    ctx.save();
    ctx.clip(this.landPath);
    ctx.drawImage(this.colorCv, 0, 0, this.colorCv.width / LOW, this.colorCv.height / LOW);
    for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) this.drawTileDecor(ctx, g.idx(q, r), level);
    ctx.restore();
    // Küstenlinie
    ctx.strokeStyle = 'rgba(70,60,40,0.55)'; ctx.lineWidth = level ? 0.8 : 1.4; ctx.stroke(this.landPath);
    // Flüsse
    for (const pts of this.riverPolys) {
      for (let k = 0; k < pts.length - 1; k++) {
        const t = k / pts.length;
        ctx.strokeStyle = '#4b7f9c';
        ctx.lineWidth = 1.6 + t * 4.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(pts[k][0], pts[k][1]); ctx.lineTo(pts[k + 1][0], pts[k + 1][1]); ctx.stroke();
      }
    }
    // Furten
    if (level) {
      ctx.fillStyle = 'rgba(200,190,150,0.9)';
      for (let i = 0; i < g.n; i++) if (m.ford[i]) { const x = g.cx(i), y = g.cy(i); if (x < x0 - 50 || x > x1 + 50 || y < y0 - 50 || y > y1 + 50) continue; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(x + k * 1.6, y + (k % 2) * 1.2, 0.9, 0, 7); ctx.fill(); } }
    }
    ctx.restore();
  }

  drawTileDecor(ctx, i, level) {
    const m = this.map, g = this.g;
    const b = m.biome[i];
    if (b === B.meer) return;
    const cx = g.cx(i), cy = g.cy(i);
    const rnd = mulberry32(i * 7919 + 13);
    const pos = () => { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * HEX_R * 0.85; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
    const avoidRiver = (x, y) => m.river[i] >= 0 && this.game.riverDist(x, y) < 5;
    // Bäume (überall, im Wald dicht)
    const nTrees = Math.round(m.trees[i] * (level ? 55 : 4) + (rnd() < (m.trees[i] * 4) % 1 ? 1 : 0));
    for (let k = 0; k < nTrees; k++) {
      const [x, y] = pos(); if (avoidRiver(x, y)) continue;
      const rr = level ? 0.9 + rnd() * 0.9 : 2.6 + rnd() * 1.4;
      const dark = b === B.sumpf ? '#4d5a3a' : b === B.hoch || b === B.pass ? '#4f5f3a' : '#3f5a2e';
      ctx.fillStyle = 'rgba(30,30,20,0.25)'; ctx.beginPath(); ctx.ellipse(x + rr * 0.4, y + rr * 0.5, rr, rr * 0.6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(160,190,110,0.35)'; ctx.beginPath(); ctx.arc(x - rr * 0.3, y - rr * 0.35, rr * 0.45, 0, 7); ctx.fill();
    }
    if (b === B.gebirge || b === B.pass) {
      const n = b === B.gebirge ? 2 + (rnd() < 0.5) : 1;
      for (let k = 0; k < n; k++) {
        const [x, y] = pos(); const w = (b === B.gebirge ? 11 : 7) + rnd() * 5, h = w * (0.9 + rnd() * 0.4);
        ctx.fillStyle = '#9a8f80'; ctx.beginPath(); ctx.moveTo(x - w, y + h * 0.4); ctx.lineTo(x, y - h * 0.6); ctx.lineTo(x + w, y + h * 0.4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6a6156'; ctx.beginPath(); ctx.moveTo(x, y - h * 0.6); ctx.lineTo(x + w, y + h * 0.4); ctx.lineTo(x + w * 0.15, y + h * 0.4); ctx.closePath(); ctx.fill();
        if (b === B.gebirge) { ctx.fillStyle = '#efeae0'; ctx.beginPath(); ctx.moveTo(x - w * 0.28, y - h * 0.18); ctx.lineTo(x, y - h * 0.6); ctx.lineTo(x + w * 0.3, y - h * 0.16); ctx.lineTo(x + w * 0.05, y - h * 0.25); ctx.closePath(); ctx.fill(); }
      }
    } else if (b === B.hoch) {
      for (let k = 0; k < (level ? 4 : 2); k++) {
        const [x, y] = pos(); const w = level ? 3 + rnd() * 2.5 : 6 + rnd() * 4;
        ctx.strokeStyle = 'rgba(90,75,50,0.45)'; ctx.lineWidth = level ? 0.6 : 1.3;
        ctx.beginPath(); ctx.arc(x, y + w * 0.5, w, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    } else if (b === B.sumpf) {
      for (let k = 0; k < (level ? 5 : 2); k++) {
        const [x, y] = pos();
        ctx.fillStyle = 'rgba(80,110,120,0.5)'; ctx.beginPath(); ctx.ellipse(x, y, 3.5, 1.5, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(60,70,40,0.7)'; ctx.lineWidth = 0.7;
        for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.moveTo(x + j * 1.5 + 3, y); ctx.lineTo(x + j * 2 + 3, y - 3.5); ctx.stroke(); }
      }
    } else if (b === B.wueste) {
      for (let k = 0; k < 2; k++) {
        const [x, y] = pos();
        ctx.strokeStyle = 'rgba(170,135,70,0.55)'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(x - 7, y + 2); ctx.quadraticCurveTo(x, y - 4, x + 7, y + 2); ctx.stroke();
      }
    } else if (b === B.flach && level) {
      ctx.strokeStyle = 'rgba(110,120,60,0.4)'; ctx.lineWidth = 0.6;
      for (let k = 0; k < 6; k++) { const [x, y] = pos(); ctx.beginPath(); ctx.moveTo(x - 1, y); ctx.lineTo(x, y - 2); ctx.lineTo(x + 1, y); ctx.stroke(); }
    }
  }

  chunk(cx, cy) {
    const k = cx + ',' + cy;
    let c = this.chunks.get(k);
    if (c) { c.used = this.frame; return c.cv; }
    const cv = document.createElement('canvas'); cv.width = cv.height = CHUNK;
    const wsz = CHUNK / CHUNK_SCALE;
    this.drawTerrain(cv.getContext('2d'), CHUNK_SCALE, cx * wsz, cy * wsz, (cx + 1) * wsz, (cy + 1) * wsz, 1);
    this.chunks.set(k, { cv, used: this.frame });
    if (this.chunks.size > 90) {
      const old = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 20);
      for (const [kk] of old) this.chunks.delete(kk);
    }
    return cv;
  }

  // ------------------------------------------------------------ Provinzen & Territorien
  buildPolitical() {
    const m = this.map, g = this.g, st = this.game.state;
    // Provinzgrenzen (einmal)
    if (!this.provBorders) {
      const p = new Path2D();
      for (let i = 0; i < g.n; i++) {
        const a = m.prov[i]; if (a < 0) continue;
        for (let d = 0; d < 3; d++) {
          const n = g.neighbor(i, d); if (n < 0) continue;
          const b = m.prov[n]; if (b < 0 || b === a) continue;
          const [p1, p2] = g.edgeCorners(i, d); p.moveTo(p1[0], p1[1]); p.lineTo(p2[0], p2[1]);
        }
      }
      this.provBorders = p;
      this.provPaths = m.provinces.map(pr => { const pp = new Path2D(); for (const t of pr.tiles) { const cs = g.corners(t); pp.moveTo(cs[0][0], cs[0][1]); for (let k = 1; k < 6; k++) pp.lineTo(cs[k][0], cs[k][1]); pp.closePath(); } return pp; });
    }
    // Stadtgebiete
    this.territory = new Map();
    for (const c of st.cities) {
      const fill = new Path2D(), edge = new Path2D();
      for (const pid of c.provinces) {
        fill.addPath(this.provPaths[pid]);
        for (const t of m.provinces[pid].tiles) for (let d = 0; d < 6; d++) {
          const n = g.neighbor(t, d);
          const own = n >= 0 && m.prov[n] >= 0 ? st.provOwner[m.prov[n]] : -1;
          if (own === c.id) continue;
          const [p1, p2] = g.edgeCorners(t, d); edge.moveTo(p1[0], p1[1]); edge.lineTo(p2[0], p2[1]);
        }
      }
      this.territory.set(c.id, { fill, edge });
    }
    this.miniDirty = true;
  }

  provEdge(pid) {
    this._provEdges ||= new Map();
    if (this._provEdges.has(pid)) return this._provEdges.get(pid);
    const m = this.map, g = this.g, p = new Path2D();
    for (const t of m.provinces[pid].tiles) for (let d = 0; d < 6; d++) {
      const n = g.neighbor(t, d);
      if (n >= 0 && m.prov[n] === pid) continue;
      const [p1, p2] = g.edgeCorners(t, d); p.moveTo(p1[0], p1[1]); p.lineTo(p2[0], p2[1]);
    }
    this._provEdges.set(pid, p);
    return p;
  }

  // ------------------------------------------------------------ Kamera
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.dpr = dpr; this.vw = w; this.vh = h;
    this.minZoom = Math.min(w / this.worldW, h / this.worldH) * 0.85;
    this.cam.zoom = Math.max(this.cam.zoom, this.minZoom);
  }
  toWorld(sx, sy) { const z = this.cam.zoom; return [(sx - this.vw / 2) / z + this.cam.x, (sy - this.vh / 2) / z + this.cam.y]; }
  toScreen(wx, wy) { const z = this.cam.zoom; return [(wx - this.cam.x) * z + this.vw / 2, (wy - this.cam.y) * z + this.vh / 2]; }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * f, this.minZoom, 16);
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny;
    this.clampCam();
  }
  pan(dx, dy) { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); }
  clampCam() {
    const m = 200;
    this.cam.x = clamp(this.cam.x, -m, this.worldW + m); this.cam.y = clamp(this.cam.y, -m, this.worldH + m);
  }
  centerOn(x, y, zoom) { this.cam.x = x; this.cam.y = y; if (zoom) this.cam.zoom = clamp(zoom, this.minZoom, 16); }

  // ------------------------------------------------------------ Zeichnen
  draw(dt) {
    this.time += dt; this.frame = (this.frame || 0) + 1;
    const ctx = this.ctx, z = this.cam.zoom, dpr = this.dpr;
    const st = this.game.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = FOG; ctx.fillRect(0, 0, this.vw, this.vh);
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.vw, this.vh);
    // Welt-Transformation
    const T = () => ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.vw / 2 - this.cam.x * z), dpr * (this.vh / 2 - this.cam.y * z));
    T();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, this.worldW, this.worldH); ctx.clip();
    const detail = z * dpr > this.baseScale * 1.6;
    if (detail) {
      const wsz = CHUNK / CHUNK_SCALE;
      ctx.imageSmoothingEnabled = true;
      for (let cy = Math.max(0, Math.floor(y0 / wsz)); cy <= Math.min(Math.floor(this.worldH / wsz), Math.floor(y1 / wsz)); cy++)
        for (let cx = Math.max(0, Math.floor(x0 / wsz)); cx <= Math.min(Math.floor(this.worldW / wsz), Math.floor(x1 / wsz)); cx++)
          ctx.drawImage(this.chunk(cx, cy), cx * wsz, cy * wsz, wsz + 0.5 / z, wsz + 0.5 / z);
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.baseCv, 0, 0, this.worldW, this.worldH);
    }
    // Provinzen (nur an Land)
    ctx.save(); ctx.clip(this.landPath);
    const polAlpha = this.mode === 'politisch' ? 0.62 : z < 0.5 ? 0.3 : z < 2 ? 0.18 : 0.08;
    ctx.lineWidth = 0.8 / Math.max(z, 0.35) * (z < 0.4 ? 0.8 : 1);
    ctx.strokeStyle = this.mode === 'politisch' ? 'rgba(40,30,20,0.45)' : 'rgba(60,45,30,0.4)';
    ctx.setLineDash([3, 2.5]);
    ctx.stroke(this.provBorders);
    ctx.setLineDash([]);
    for (const c of st.cities) {
      const t = this.territory.get(c.id); if (!t) continue;
      ctx.globalAlpha = polAlpha; ctx.fillStyle = c.color; ctx.fill(t.fill);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = c.color; ctx.lineWidth = Math.max(1.5, 2.6 / z); ctx.stroke(t.edge);
      ctx.globalAlpha = 1;
    }
    // Hervorhebung Provinz
    if (this.hover && this.hover.prov >= 0 && this.highlightProvince) {
      ctx.fillStyle = 'rgba(255,250,220,0.22)'; ctx.fill(this.provPaths[this.hover.prov]);
      ctx.strokeStyle = 'rgba(255,245,200,0.9)'; ctx.lineWidth = 2 / z; ctx.stroke(this.provEdge(this.hover.prov));
    }
    if (this.selectedProvince != null) {
      ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 2.5 / z; ctx.setLineDash([6 / z, 4 / z]); ctx.stroke(this.provEdge(this.selectedProvince)); ctx.setLineDash([]);
    }
    ctx.restore();
    // Ressourcenansicht
    if (this.mode === 'ressourcen') this.drawResources(ctx, x0, y0, x1, y1, z);
    // Städte im Detail
    if (z >= 0.9) for (const c of st.cities) this.drawCity(ctx, c, x0, y0, x1, y1, z);
    // Händler
    this.drawMerchants(ctx, z);
    // Vorschau
    if (this.ghost) this.drawGhost(ctx, z);
    ctx.restore();
    // Nebel am Kartenrand (Entfernungsnebel)
    this.drawFog(ctx, z);
    // Papierkörnung über allem
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this.grain; ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // Vignette
    const vg = ctx.createRadialGradient(this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.45, this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,12,0,0.35)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, this.vw, this.vh);
    // Beschriftungen in Bildschirmkoordinaten
    this.drawLabels(ctx, z);
  }

  drawFog(ctx, z) {
    const dpr = this.dpr;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.vw / 2 - this.cam.x * z), dpr * (this.vh / 2 - this.cam.y * z));
    const f = HEX_W * 4, W = this.worldW, H = this.worldH;
    const fogA = 'rgba(43,40,34,1)', fogB = 'rgba(43,40,34,0)';
    const lin = (xa, ya, xb, yb, rx, ry, rw, rh) => { const gr = ctx.createLinearGradient(xa, ya, xb, yb); gr.addColorStop(0, fogA); gr.addColorStop(0.35, 'rgba(43,40,34,0.85)'); gr.addColorStop(1, fogB); ctx.fillStyle = gr; ctx.fillRect(rx, ry, rw, rh); };
    lin(0, 0, f, 0, 0, 0, f, H);
    lin(W, 0, W - f, 0, W - f, 0, f, H);
    lin(0, 0, 0, f, 0, 0, W, f);
    lin(0, H, 0, H - f, 0, H - f, W, f);
    // Nebelschwaden
    const t = this.time * 0.02;
    ctx.globalAlpha = 0.25;
    for (let k = 0; k < 14; k++) {
      const side = k % 4;
      const p = ((k * 0.137 + t * (k % 2 ? 1 : -1) * 0.1) % 1 + 1) % 1;
      const x = side === 0 ? f * 0.4 : side === 1 ? W - f * 0.4 : p * W;
      const y = side === 2 ? f * 0.4 : side === 3 ? H - f * 0.4 : p * H;
      const r = f * (1 + (k % 3) * 0.4);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(70,66,58,0.9)'); gr.addColorStop(1, 'rgba(70,66,58,0)');
      ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  drawResources(ctx, x0, y0, x1, y1, z) {
    const m = this.map, g = this.g;
    const r0 = Math.max(0, Math.floor(y0 / HEX_H) - 1), r1 = Math.min(g.h - 1, Math.ceil(y1 / HEX_H) + 1);
    const q0 = Math.max(0, Math.floor(x0 / HEX_W) - 1), q1 = Math.min(g.w - 1, Math.ceil(x1 / HEX_W) + 1);
    const s = Math.max(4, 7 / z);
    for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
      const i = g.idx(q, r); const d = DEPOSITS[m.dep[i]]; if (!d) continue;
      const x = g.cx(i), y = g.cy(i);
      ctx.fillStyle = d.color; ctx.strokeStyle = '#2a2014'; ctx.lineWidth = s * 0.15;
      ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  drawCity(ctx, c, x0, y0, x1, y1, z) {
    if (c.x < x0 - 400 || c.x > x1 + 400 || c.y < y0 - 400 || c.y > y1 + 400) return;
    const game = this.game;
    // Trampelpfade
    ctx.strokeStyle = 'rgba(120,95,60,0.55)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of c.buildings) {
      if (b.type === 'zentrum' || b.type === 'bruecke') continue;
      if (c.roads.some(r => this.segD(b.x, b.y, r) < Math.max(b.w, b.h) / 2 + 6)) {
        const r = c.roads.reduce((best, r) => { const d = this.segD(b.x, b.y, r); return d < best.d ? { d, r } : best; }, { d: Infinity }).r;
        const p = this.closest(b.x, b.y, r); ctx.moveTo(b.x, b.y); ctx.lineTo(p[0], p[1]);
        continue;
      }
      let tx = c.x, ty = c.y, bd = Math.hypot(b.x - c.x, b.y - c.y);
      for (const r of c.roads) { const p = this.closest(b.x, b.y, r); const d = Math.hypot(p[0] - b.x, p[1] - b.y); if (d < bd) { bd = d; tx = p[0]; ty = p[1]; } }
      ctx.moveTo(b.x, b.y);
      const mx = (b.x + tx) / 2 + (b.y - ty) * 0.08, my = (b.y + ty) / 2 - (b.x - tx) * 0.08;
      ctx.quadraticCurveTo(mx, my, tx, ty);
    }
    ctx.stroke();
    // Straßen
    for (const r of c.roads) {
      ctx.strokeStyle = '#6e5a3e'; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke();
      ctx.strokeStyle = '#c9b48a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke();
    }
    // Gebäude
    for (const b of c.buildings) {
      if (b.x < x0 - 20 || b.x > x1 + 20 || b.y < y0 - 20 || b.y > y1 + 20) continue;
      this.drawBuilding(ctx, b, c, z);
    }
  }
  segD(x, y, r) { const p = this.closest(x, y, r); return Math.hypot(p[0] - x, p[1] - y); }
  closest(x, y, r) {
    const dx = r.x2 - r.x1, dy = r.y2 - r.y1, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((x - r.x1) * dx + (y - r.y1) * dy) / l2, 0, 1) : 0;
    return [r.x1 + t * dx, r.y1 + t * dy];
  }

  drawBuilding(ctx, b, c, z) {
    const d = BUILDINGS[b.type];
    const x = b.x - b.w / 2, y = b.y - b.h / 2, w = b.w, h = b.h;
    const sel = this.selected === b;
    const prog = b.done ? 1 : clamp(b.progress / d.time, 0, 1);
    if (b.type === 'bruecke') {
      const ang = this.riverAngle(b.x, b.y) + Math.PI / 2;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(ang);
      ctx.globalAlpha = b.done ? 1 : 0.45 + prog * 0.4;
      ctx.fillStyle = '#7a5a36'; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = '#4a3420'; ctx.lineWidth = 0.4;
      for (let k = -w / 2 + 1; k < w / 2; k += 1.2) { ctx.beginPath(); ctx.moveTo(k, -h / 2); ctx.lineTo(k, h / 2); ctx.stroke(); }
      ctx.restore(); ctx.globalAlpha = 1;
      return;
    }
    // Schatten
    ctx.fillStyle = 'rgba(30,20,10,0.28)'; ctx.fillRect(x + 0.9, y + 1.1, w, h);
    if (!b.done) {
      // Baustelle: Fundament, wachsendes Gebäude, Gerüst, Hammer
      ctx.fillStyle = '#b8a580'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = d.color; ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y + h * (1 - prog), w, h * prog);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#5a4026'; ctx.lineWidth = 0.35;
      for (let k = 0; k <= w; k += 2) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k, y + h); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x, y + h / 3); ctx.lineTo(x + w, y + h / 3); ctx.moveTo(x, y + 2 * h / 3); ctx.lineTo(x + w, y + 2 * h / 3); ctx.stroke();
      ctx.setLineDash([1, 0.8]); ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 0.4; ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
      const bob = Math.abs(Math.sin(this.time * 6 + b.id)) * 1.2;
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(b.x + w * 0.2, y - 1.5 - bob, 1.6, 0.8); ctx.fillRect(b.x + w * 0.2 + 0.6, y - 1.5 - bob, 0.4, 2.2);
      // Fortschrittsbalken
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y + h + 0.8, w, 1);
      ctx.fillStyle = '#e8c547'; ctx.fillRect(x, y + h + 0.8, w * prog, 1);
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.6; ctx.strokeRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6); }
      return;
    }
    const col = hexToRgb(d.color);
    switch (b.type) {
      case 'zentrum': {
        ctx.fillStyle = '#d8c69a'; ctx.beginPath(); ctx.arc(b.x, b.y, w / 2, 0, 7); ctx.fill();
        ctx.strokeStyle = '#8a7650'; ctx.lineWidth = 0.6; ctx.stroke();
        ctx.fillStyle = '#7a6a4a'; ctx.beginPath(); ctx.arc(b.x, b.y, 1.2, 0, 7); ctx.fill();
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y - 6); ctx.stroke();
        ctx.fillStyle = c.color; ctx.beginPath(); ctx.moveTo(b.x, b.y - 6); ctx.lineTo(b.x + 3.5 + Math.sin(this.time * 3) * 0.4, b.y - 5); ctx.lineTo(b.x, b.y - 4); ctx.fill();
        break;
      }
      case 'bauernhof': case 'schaeferei': {
        ctx.fillStyle = b.type === 'bauernhof' ? '#cdb35a' : '#9fb06a'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(90,70,30,0.5)'; ctx.lineWidth = 0.35;
        if (b.type === 'bauernhof') for (let k = 1; k < h; k += 1.2) { ctx.beginPath(); ctx.moveTo(x, y + k); ctx.lineTo(x + w * 0.65, y + k); ctx.stroke(); }
        else { ctx.fillStyle = '#f2efe2'; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(x + 1.5 + ((k * 37) % 10) / 10 * (w * 0.6), y + 1.5 + ((k * 53) % 10) / 10 * (h - 3), 0.6, 0, 7); ctx.fill(); } }
        this.roofRect(ctx, x + w * 0.68, y + h * 0.15, w * 0.3, h * 0.45, [150, 80, 40]);
        break;
      }
      case 'marktplatz': {
        ctx.fillStyle = '#d8c69a'; ctx.fillRect(x, y, w, h);
        const cols = ['#b03a2e', '#2e6ab0', '#c9a227', '#3a8a4a'];
        for (let k = 0; k < 6; k++) { ctx.fillStyle = cols[k % 4]; ctx.fillRect(x + 1 + (k % 3) * (w / 3), y + 1.5 + Math.floor(k / 3) * (h / 2), w / 3 - 1.6, h / 2 - 3); }
        break;
      }
      case 'brunnen': {
        ctx.fillStyle = '#8a8a80'; ctx.beginPath(); ctx.arc(b.x, b.y, w / 2, 0, 7); ctx.fill();
        ctx.fillStyle = '#5a8aaa'; ctx.beginPath(); ctx.arc(b.x, b.y, w / 3, 0, 7); ctx.fill();
        break;
      }
      case 'park': {
        ctx.fillStyle = '#6f9a52'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#3f6a2e'; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.arc(x + 2 + ((k * 29) % 9) / 9 * (w - 4), y + 2 + ((k * 47) % 9) / 9 * (h - 4), 1.4, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#d8c69a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x + w, b.y); ctx.moveTo(b.x, y); ctx.lineTo(b.x, y + h); ctx.stroke();
        break;
      }
      case 'hafen': {
        ctx.fillStyle = '#7a5a36'; ctx.fillRect(x, y, w, h * 0.55);
        this.roofRect(ctx, x + 1, y + 1, w * 0.5, h * 0.4, col);
        ctx.fillStyle = '#5a3a1a'; ctx.fillRect(x + w * 0.6, y + h * 0.55, w * 0.2, h * 0.45);
        break;
      }
      default: {
        this.roofRect(ctx, x, y, w, h, col);
        if (d.house && b.residents === 0) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, w, h); }
        if (d.cat === 'stadt' && (b.type === 'kapelle' || b.type === 'dom')) { ctx.fillStyle = '#6a5a4a'; ctx.fillRect(b.x - 0.7, y - 2, 1.4, 3); }
      }
    }
    // Hinweis: unterbesetzt / Rohstoffmangel
    if (z > 2.2 && d.workers && (b.workers < d.workers || b.inputShort || b.paused || b.full)) {
      ctx.fillStyle = b.paused || b.full ? '#888' : b.workers < d.workers ? '#d9534f' : '#f0ad4e';
      ctx.beginPath(); ctx.arc(x + w, y, 1.1, 0, 7); ctx.fill();
    }
    if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.6; ctx.strokeRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6); }
  }
  roofRect(ctx, x, y, w, h, col) {
    const horiz = w >= h;
    ctx.fillStyle = rgb(...shade(col, 0.08)); ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgb(...shade(col, -0.22));
    if (horiz) ctx.fillRect(x, y + h / 2, w, h / 2); else ctx.fillRect(x + w / 2, y, w / 2, h);
    ctx.strokeStyle = rgb(...shade(col, -0.45)); ctx.lineWidth = 0.3;
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath(); if (horiz) { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); } else { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); } ctx.stroke();
  }
  riverAngle(x, y) {
    const segs = this.game.riverSegs.get(this.g.at(x, y)) || [];
    let best = null, bd = Infinity;
    for (const s of segs) { const d = this.segD(x, y, { x1: s[0], y1: s[1], x2: s[2], y2: s[3] }); if (d < bd) { bd = d; best = s; } }
    return best ? Math.atan2(best[3] - best[1], best[2] - best[0]) : 0;
  }

  merchantPos(m) {
    const g = this.g, game = this.game;
    if (!m._pts) {
      const a = game.cityById(m.home), b = game.partnerById(m.partner);
      const pts = m.tiles.map(t => [g.cx(t), g.cy(t)]);
      if (m.mode !== 'boot') { if (a) pts[0] = [a.x, a.y]; if (b && !b.foreign) pts[pts.length - 1] = [b.x, b.y]; }
      const sm = pts.length > 2 ? chaikin(pts, false, 2) : pts;
      const cum = [0]; for (let k = 1; k < sm.length; k++) cum.push(cum[k - 1] + Math.hypot(sm[k][0] - sm[k - 1][0], sm[k][1] - sm[k - 1][1]));
      m._pts = sm; m._cum = cum;
    }
    const t = m.t + this.game.subHour;
    const vis = m.visibleHours ?? m.hours;
    let p;
    if (t <= m.hours) { if (t > vis) return null; p = t / vis; }
    else { const back = 2 * m.hours - t; if (back > vis) return null; p = back / vis; }
    p = clamp(p, 0, 1);
    const L = m._cum[m._cum.length - 1] * p;
    let k = 1; while (k < m._cum.length && m._cum[k] < L) k++;
    if (k >= m._pts.length) return m._pts[m._pts.length - 1];
    const a = m._pts[k - 1], b = m._pts[k], seg = m._cum[k] - m._cum[k - 1] || 1, f = (L - m._cum[k - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0]), t > m.hours];
  }
  drawMerchants(ctx, z) {
    const s = clamp(5 / z, 1.5, 14);
    for (const m of this.game.state.merchants) {
      const p = this.merchantPos(m); if (!p) continue;
      const c = this.game.cityById(m.home); if (!c) continue;
      const [x, y] = p;
      ctx.save(); ctx.translate(x, y);
      if (m.mode === 'boot') {
        ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.ellipse(0, 0, s * 1.2, s * 0.45, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#f3ecd8'; ctx.beginPath(); ctx.moveTo(0, -s * 1.6); ctx.lineTo(s * 0.9, -s * 0.2); ctx.lineTo(0, -s * 0.2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c.color; ctx.fillRect(-0.1 * s, -s * 1.9, s * 0.6, s * 0.35);
      } else if (m.mode === 'karren') {
        ctx.fillStyle = '#7a5a36'; ctx.fillRect(-s * 0.9, -s * 0.6, s * 1.8, s * 0.9);
        ctx.fillStyle = c.color; ctx.fillRect(-s * 0.7, -s * 1, s * 1.4, s * 0.45);
        ctx.fillStyle = '#2a1a0a'; ctx.beginPath(); ctx.arc(-s * 0.55, s * 0.35, s * 0.35, 0, 7); ctx.arc(s * 0.55, s * 0.35, s * 0.35, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(0, -s * 0.2, s * 0.55, 0, 7); ctx.fill();
        ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = s * 0.18; ctx.stroke();
        ctx.fillStyle = '#c9a86a'; ctx.fillRect(s * 0.3, -s * 0.6, s * 0.45, s * 0.5);
      }
      ctx.restore();
    }
  }

  drawGhost(ctx, z) {
    const gh = this.ghost;
    if (gh.kind === 'road') {
      ctx.strokeStyle = gh.ok ? 'rgba(120,220,120,0.9)' : 'rgba(230,80,70,0.9)'; ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(gh.x1, gh.y1); ctx.lineTo(gh.x2, gh.y2); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    if (gh.kind === 'building') {
      const d = BUILDINGS[gh.type];
      if (d.loc && d.loc !== 'water') { ctx.strokeStyle = 'rgba(255,240,180,0.6)'; ctx.lineWidth = 1 / z; ctx.setLineDash([4 / z, 3 / z]); ctx.beginPath(); ctx.arc(gh.x, gh.y, HEX_W * 1.5, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = gh.ok ? 'rgba(110,210,110,0.55)' : 'rgba(230,80,70,0.55)';
      ctx.fillRect(gh.x - d.size[0] / 2, gh.y - d.size[1] / 2, d.size[0], d.size[1]);
      ctx.strokeStyle = gh.ok ? '#d8ffd0' : '#ffd0c8'; ctx.lineWidth = 0.5; ctx.strokeRect(gh.x - d.size[0] / 2, gh.y - d.size[1] / 2, d.size[0], d.size[1]);
    }
    if (gh.kind === 'found') {
      ctx.strokeStyle = 'rgba(255,240,180,0.95)'; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(gh.x, gh.y, 8, 0, 7); ctx.stroke();
    }
  }

  drawLabels(ctx, z) {
    const dpr = this.dpr, st = this.game.state, m = this.map, g = this.g;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const boxes = [];
    const free = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
    this._labelFree = free;
    // Städtenamen zuerst (Spieler, dann nach Größe)
    const cityOrder = st.cities.slice().sort((a, b) => (b.player - a.player) || b.pop - a.pop);
    this.drawCityLabels(ctx, z, cityOrder, free);
    // Provinznamen
    if (z > 0.32 && z < 3.2) {
      const a = clamp((z - 0.32) * 4, 0, 1) * clamp((3.2 - z) * 2, 0, 1);
      ctx.font = `italic ${Math.round(clamp(9 + z * 3, 10, 14))}px "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
      ctx.fillStyle = `rgba(55,38,20,${0.75 * a})`;
      for (const pr of m.provinces) {
        const [sx, sy] = this.toScreen(g.cx(pr.center), g.cy(pr.center));
        if (sx < -60 || sy < -20 || sx > this.vw + 60 || sy > this.vh + 20) continue;
        if (pr.size < 14 && z < 0.7) continue;
        const owner = st.provOwner[pr.id];
        if (owner >= 0 && z < 0.9 && this.game.cityById(owner)?.provinces[0] === pr.id) continue;
        const name = this.game.provName(pr.id), w = ctx.measureText(name).width, yy = sy + (z > 0.9 ? 18 : 0);
        if (free(sx - w / 2, yy - 7, w, 14)) ctx.fillText(name, sx, yy);
      }
    }
  }
  drawCityLabels(ctx, z, cities, free) {
    for (const c of cities) {
      const [sx, sy] = this.toScreen(c.x, c.y);
      if (sx < -150 || sy < -50 || sx > this.vw + 150 || sy > this.vh + 50) continue;
      const big = z < 0.9;
      const fs = big ? clamp(13 + z * 14, 13, 22) : clamp(10 + z, 12, 16);
      ctx.font = `bold ${Math.round(fs)}px "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
      const label = c.name.toUpperCase().split('').join(big ? ' ' : '');
      const y = big ? sy : sy - (c.buildings[0]?.h || 10) * z / 2 - 14;
      const lw = ctx.measureText(label).width;
      if (!free(sx - lw / 2, y - fs / 2 - (big ? 18 : 0), lw, fs + (big ? 18 : 14))) {
        // Kein Platz für den Namen: nur Wappen
        if (big) { ctx.fillStyle = c.color; ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx - 5, sy - 6); ctx.lineTo(sx + 5, sy - 6); ctx.lineTo(sx + 5, sy); ctx.quadraticCurveTo(sx, sy + 5, sx - 5, sy); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        continue;
      }
      if (big) {
        // Wappen
        ctx.fillStyle = c.color; ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx - 6, sy - 26); ctx.lineTo(sx + 6, sy - 26); ctx.lineTo(sx + 6, sy - 18); ctx.quadraticCurveTo(sx, sy - 11, sx - 6, sy - 18); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (c.player) { ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(sx, sy - 21, 2, 0, 7); ctx.fill(); }
      }
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(245,232,200,0.85)'; ctx.strokeText(label, sx, y);
      ctx.fillStyle = c.player ? '#5a3a00' : '#2a1a0a'; ctx.fillText(label, sx, y);
      if (!big) { ctx.font = `11px Georgia, serif`; ctx.fillStyle = 'rgba(40,25,10,0.85)'; ctx.fillText(`${c.pop} Einw.`, sx, y + 13); }
    }
  }

  // Minikarte in eigenes Canvas
  drawMini(cv) {
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    if (this.miniDirty || !this._miniBase) {
      const mb = document.createElement('canvas'); mb.width = w; mb.height = h;
      const mc = mb.getContext('2d');
      mc.fillStyle = FOG; mc.fillRect(0, 0, w, h);
      const s = Math.min(w / this.worldW, h / this.worldH);
      mc.setTransform(s, 0, 0, s, (w - this.worldW * s) / 2, (h - this.worldH * s) / 2);
      mc.drawImage(this.baseCv, 0, 0, this.worldW, this.worldH);
      for (const c of this.game.state.cities) { const t = this.territory.get(c.id); if (!t) continue; mc.globalAlpha = 0.6; mc.fillStyle = c.color; mc.fill(t.fill); }
      mc.globalAlpha = 1;
      this._miniBase = mb; this._miniS = s; this.miniDirty = false;
    }
    ctx.drawImage(this._miniBase, 0, 0);
    const s = this._miniS, ox = (w - this.worldW * s) / 2, oy = (h - this.worldH * s) / 2;
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.vw, this.vh);
    ctx.strokeStyle = '#fff3c0'; ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s);
    return { s, ox, oy };
  }
  thumbnail(w = 240, h = 150) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    this.miniDirty = true; this.drawMini(cv);
    // Rahmen der Ansicht nicht im Vorschaubild
    const ctx = cv.getContext('2d'); ctx.drawImage(this._miniBase, 0, 0);
    return cv.toDataURL('image/jpeg', 0.7);
  }
}
