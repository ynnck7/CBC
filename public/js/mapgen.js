// Zufallskarte: Höhen, Meer, Gebirge, Flüsse, Biome, Lagerstätten, Provinzen
import { Rng, Noise2D, HexGrid, MinHeap, hashString, clamp } from './util.js';
import { BIOMES, B, DEP, DEPOSITS } from './data.js';

export const MAP_TYPES = {
  insel: { name: 'Insel', land: 0.55 },
  halbinsel: { name: 'Halbinsel', land: 0.62 },
  kueste: { name: 'Küstenland', land: 0.74 },
  buchten: { name: 'Buchten & Inseln', land: 0.6 },
};

const PRE = ['Alt', 'Bren', 'Dorn', 'Eich', 'Fal', 'Grau', 'Hag', 'Ilm', 'Kalt', 'Lind', 'Mar', 'Nord', 'Ost', 'Rab', 'Sal', 'Tann', 'Ul', 'Wald', 'Wes', 'Wolf', 'Zell', 'Ber', 'Kron', 'Sturm', 'Hel', 'Gold', 'Rot', 'Weiß', 'Schwarz', 'Stein', 'Bir', 'Erl', 'Hasel', 'Moor', 'Fels', 'Asch', 'Buch', 'Dachs', 'Eber', 'Fichten', 'Gries', 'Hirsch', 'Kling', 'Lauter', 'Mühl', 'Neu', 'Ober', 'Quell', 'Reh', 'Schön', 'Tal', 'Unter', 'Vogel', 'Wiesen', 'Linden', 'Hohen', 'Grün', 'Silber', 'Blau', 'Ulmen', 'Raben', 'Falken', 'Kessel', 'Brunn', 'Sommer', 'Winter', 'Morgen', 'Abend'];
const SUF = ['au', 'bach', 'berg', 'burg', 'dorf', 'feld', 'furt', 'hain', 'hausen', 'heim', 'hof', 'ingen', 'mark', 'rode', 'see', 'stedt', 'tal', 'wald', 'wang', 'weiler', 'brück', 'wiesen', 'grund', 'hag', 'leben', 'eck', 'horst', 'kirch', 'stein', 'thal', 'born', 'lohe', 'ried', 'moos', 'heide', 'warte', 'brunn', 'hall'];

export class NameGen {
  constructor(seed) { this.rng = new Rng(seed); this.used = new Set(); }
  next() {
    for (let t = 0; t < 200; t++) {
      let p = this.rng.pick(PRE), s = this.rng.pick(SUF);
      if (p.toLowerCase().endsWith(s[0])) continue;
      const n = p + s;
      if (!this.used.has(n)) { this.used.add(n); return n; }
    }
    const n = this.rng.pick(PRE) + this.rng.pick(SUF) + ' ' + this.used.size;
    this.used.add(n); return n;
  }
}

function quantile(values, q) {
  const a = Float32Array.from(values).sort();
  return a[clamp(Math.floor(q * (a.length - 1)), 0, a.length - 1)];
}

export function generateMap(params) {
  const seedNum = hashString(String(params.seed));
  const rng = new Rng(seedNum);
  const cities = clamp(params.cities | 0, 5, 20);
  let type = params.mapType;
  if (!MAP_TYPES[type]) type = new Rng(seedNum ^ 0x7777).pick(Object.keys(MAP_TYPES));
  const W = Math.round(Math.sqrt(cities * 800 * 1.6));
  const H = Math.round(W / 1.6);
  const g = new HexGrid(W, H);
  const N = g.n;
  const nz = new Noise2D(seedNum ^ 0x1234);
  const nz2 = new Noise2D(seedNum ^ 0x9876);
  const nz3 = new Noise2D(seedNum ^ 0x5555);

  // ---------------- Höhe mit Formmaske
  const elev = new Float32Array(N);
  const side = rng.int(0, 3);              // Meerseite für Küste/Halbinsel
  const ox = rng.range(0, 1000), oy = rng.range(0, 1000);
  for (let i = 0; i < N; i++) {
    const q = g.q(i), r = g.r(i);
    const u = (q + 0.5) / W, v = (r + 0.5) / H;
    const n = nz.fbm(ox + q / 24, oy + r / 24, 5);
    let mask;
    const du = u - 0.5, dv = (v - 0.5);
    const edgeDist = [v, 1 - u, 1 - v, u];  // Nähe zu Oben, Rechts, Unten, Links
    if (type === 'insel') {
      mask = 0.9 - Math.pow(Math.sqrt(du * du * 1.1 + dv * dv * 1.3) * 2, 2) * 1.2;
    } else if (type === 'halbinsel') {
      // Land hängt an Seite "side", Meer an den anderen drei
      const toLand = edgeDist[side];
      const sides = [0, 1, 2, 3].filter(s => s !== side).map(s => edgeDist[s]);
      mask = Math.min(...sides) * 2.4 - 0.25 + (1 - toLand) * 0.15;
    } else if (type === 'kueste') {
      mask = edgeDist[side] * 1.6 - 0.15;
    } else {
      // Buchten: zwei Meerseiten + Rauschen für Inseln
      mask = Math.min(edgeDist[side], edgeDist[(side + 1) % 4]) * 2.2 + nz3.fbm(q / 12, r / 12, 3) * 0.35;
    }
    elev[i] = n * 0.75 + mask;
  }
  const seaLevel = quantile(elev, 1 - MAP_TYPES[type].land);
  const biome = new Uint8Array(N);
  const isLand = i => biome[i] !== B.meer;
  for (let i = 0; i < N; i++) biome[i] = elev[i] > seaLevel ? B.flach : B.meer;

  // Kleine Seen im Inland zu Land machen (keine Binnenseen, damit Meer = Ozean)
  {
    const seen = new Uint8Array(N);
    const nb = [];
    for (let i = 0; i < N; i++) {
      if (biome[i] !== B.meer || seen[i]) continue;
      const comp = [i]; seen[i] = 1; let touchesEdge = false;
      for (let k = 0; k < comp.length; k++) {
        const c = comp[k]; const q = g.q(c), r = g.r(c);
        if (q === 0 || r === 0 || q === W - 1 || r === H - 1) touchesEdge = true;
        for (const n of g.neighbors(c, nb)) if (biome[n] === B.meer && !seen[n]) { seen[n] = 1; comp.push(n); }
      }
      if (!touchesEdge && comp.length < 60) for (const c of comp) { biome[c] = B.flach; elev[c] = seaLevel + 0.01; }
    }
  }

  // Normierte Landhöhe 0..1
  const landIdx = [];
  for (let i = 0; i < N; i++) if (isLand(i)) landIdx.push(i);
  const landSorted = landIdx.slice().sort((a, b) => elev[a] - elev[b]);
  const le = new Float32Array(N);
  landSorted.forEach((i, k) => { le[i] = k / Math.max(1, landSorted.length - 1); });

  // ---------------- Gebirge, Pässe, Hochland
  const mScore = new Float32Array(N);
  for (const i of landIdx) mScore[i] = le[i] * 0.55 + nz2.ridge(g.q(i) / 13 + 50, g.r(i) / 13 + 50, 4) * 0.45;
  const mThr = quantile(landIdx.map(i => mScore[i]), 0.935);
  const hThr = quantile(landIdx.map(i => mScore[i]), 0.80);
  for (const i of landIdx) {
    if (mScore[i] >= mThr) biome[i] = B.gebirge;
    else if (mScore[i] >= hThr) biome[i] = B.hoch;
  }
  // Pässe: schmale Täler durch Gebirgszüge
  for (const i of landIdx) {
    if (biome[i] !== B.gebirge) continue;
    const pn = Math.abs(nz3.noise(g.q(i) / 7 + 200, g.r(i) / 7 + 200));
    if (pn < 0.09) biome[i] = B.pass;
  }

  // ---------------- Abstand zum Meer
  const distSea = new Int16Array(N).fill(9999);
  {
    const queue = [];
    for (let i = 0; i < N; i++) if (biome[i] === B.meer) { distSea[i] = 0; queue.push(i); }
    const nb = [];
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k];
      for (const n of g.neighbors(c, nb)) if (distSea[n] > distSea[c] + 1) { distSea[n] = distSea[c] + 1; queue.push(n); }
    }
  }

  // ---------------- Flüsse (max. 2, schneiden sich nie)
  const river = new Int8Array(N).fill(-1);
  const riverNear = new Uint8Array(N);   // Sperrzone um bestehende Flüsse
  const rivers = [];
  const riverCount = rng.chance(0.75) ? 2 : 1;
  const nb = [];
  for (let rIdx = 0; rIdx < riverCount; rIdx++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      // Quelle: hohes Inland oder Kartenrand (Fluss kommt aus dem Nebel)
      let src;
      const fromEdge = rng.chance(0.45);
      const cands = landIdx.filter(i => {
        if (riverNear[i] || biome[i] === B.gebirge) return false;
        if (fromEdge) { const q = g.q(i), r = g.r(i); return (q === 0 || r === 0 || q === W - 1 || r === H - 1) && distSea[i] > 14; }
        return distSea[i] > 14 && le[i] > 0.6;
      });
      if (!cands.length) continue;
      src = rng.pick(cands);
      // Dijkstra zum Meer, bergab bevorzugt, mit Mäandern
      const cost = new Float32Array(N).fill(Infinity);
      const prev = new Int32Array(N).fill(-1);
      const heap = new MinHeap();
      cost[src] = 0; heap.push(0, src);
      let end = -1;
      while (heap.size) {
        const c = heap.pop();
        if (biome[c] === B.meer) { end = c; break; }
        for (const n of g.neighbors(c, nb)) {
          if (riverNear[n]) continue;
          let step = 1 + rng.float() * 0.9;
          if (biome[n] !== B.meer) step += Math.max(0, elev[n] - elev[c]) * 40;
          if (biome[n] === B.gebirge) step += 25;
          const nc = cost[c] + step;
          if (nc < cost[n]) { cost[n] = nc; prev[n] = c; heap.push(nc, n); }
        }
      }
      if (end < 0) continue;
      const path = [];
      for (let c = end; c >= 0; c = prev[c]) path.push(c);
      path.reverse();               // Quelle -> Mündung (letzte Kachel = Meer)
      if (path.length < 14) continue;
      const tiles = path.slice(0, -1);
      for (const t of tiles) { river[t] = rIdx; if (biome[t] === B.gebirge) biome[t] = B.pass; }
      // Sperrzone (Abstand 2) für den nächsten Fluss
      for (const t of path) {
        riverNear[t] = 1;
        for (const n of g.neighbors(t, [])) { riverNear[n] = 1; for (const m of g.neighbors(n, [])) riverNear[m] = 1; }
      }
      rivers.push({ id: rIdx, tiles, mouth: path[path.length - 1], fromEdge });
      break;
    }
  }

  // ---------------- Feuchtigkeit & restliche Biome
  const distRiver = new Int16Array(N).fill(99);
  {
    const queue = [];
    for (let i = 0; i < N; i++) if (river[i] >= 0) { distRiver[i] = 0; queue.push(i); }
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k]; if (distRiver[c] > 6) continue;
      for (const n of g.neighbors(c, nb)) if (distRiver[n] > distRiver[c] + 1) { distRiver[n] = distRiver[c] + 1; queue.push(n); }
    }
  }
  const moist = new Float32Array(N);
  for (const i of landIdx) {
    moist[i] = nz3.fbm(g.q(i) / 20 + 400, g.r(i) / 20 + 400, 4) + (distRiver[i] < 4 ? (4 - distRiver[i]) * 0.07 : 0) + (distSea[i] < 3 ? 0.05 : 0);
  }
  let rest = landIdx.filter(i => biome[i] === B.flach);
  // Sumpf: feucht und tief
  const swampScore = i => moist[i] + (0.45 - le[i]) * 0.8 + (distRiver[i] < 3 ? 0.2 : 0);
  const sThr = quantile(rest.map(swampScore), 0.93);
  for (const i of rest) if (swampScore(i) >= sThr) biome[i] = B.sumpf;
  rest = rest.filter(i => biome[i] === B.flach);
  // Wüste: trocken, nicht am Fluss
  const dryScore = i => -moist[i] - (distRiver[i] < 3 ? 1 : 0) - (distSea[i] < 2 ? 0.3 : 0);
  const dThr = quantile(rest.map(dryScore), 0.90);
  for (const i of rest) if (dryScore(i) >= dThr) biome[i] = B.wueste;
  rest = rest.filter(i => biome[i] === B.flach);
  // Wald: mittelfeucht, eigenes Rauschen
  const forestScore = i => moist[i] * 0.6 + nz.fbm(g.q(i) / 10 + 700, g.r(i) / 10 + 700, 3) * 0.6;
  const fThr = quantile(rest.map(forestScore), 0.58);
  for (const i of rest) if (forestScore(i) >= fThr) biome[i] = B.wald;
  // Einzelkacheln glätten (wirkt natürlicher)
  for (let pass = 0; pass < 2; pass++) {
    for (const i of landIdx) {
      const bi = biome[i];
      if (bi === B.gebirge || bi === B.pass || river[i] >= 0) continue;
      const nbs = g.neighbors(i, nb);
      const same = nbs.filter(n => biome[n] === bi).length;
      if (same === 0) {
        const cnt = {};
        for (const n of nbs) if (biome[n] !== B.meer && biome[n] !== B.gebirge) cnt[biome[n]] = (cnt[biome[n]] || 0) + 1;
        const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
        if (best) biome[i] = +best[0];
      }
    }
  }

  // ---------------- Küste, Furten, Bäume, Fruchtbarkeit
  const coast = new Uint8Array(N);
  for (const i of landIdx) if (g.neighbors(i, nb).some(n => biome[n] === B.meer)) coast[i] = 1;
  const ford = new Uint8Array(N);
  for (const rv of rivers) {
    rv.tiles.forEach((t, k) => {
      if (k > 2 && k < rv.tiles.length - 3 && (biome[t] === B.flach || biome[t] === B.hoch || biome[t] === B.pass) && rng.chance(0.1)) ford[t] = 1;
    });
  }
  const trees = new Float32Array(N), fert = new Float32Array(N);
  for (const i of landIdx) {
    const bd = BIOMES[biome[i]];
    const jitter = 0.85 + 0.3 * (nz2.noise(g.q(i) / 3, g.r(i) / 3) + 1) / 2;
    trees[i] = clamp((bd.trees || 0) * jitter, 0, 1.2);
    fert[i] = clamp((bd.fert || 0) * jitter + (distRiver[i] <= 1 ? 0.25 : 0), 0, 1.4);
  }

  // ---------------- Lagerstätten
  const dep = new Uint8Array(N);
  const P = {
    [B.flach]: { lehm: 0.04, stein: 0.02 },
    [B.wald]: { stein: 0.03, kohle: 0.02, lehm: 0.02 },
    [B.hoch]: { stein: 0.16, eisen: 0.06, kupfer: 0.045, zinn: 0.03, kohle: 0.05, gold: 0.008, edelstein: 0.004 },
    [B.pass]: { stein: 0.2, eisen: 0.07, kupfer: 0.05, zinn: 0.04, kohle: 0.05, gold: 0.012, edelstein: 0.006 },
    [B.sumpf]: { lehm: 0.14, kohle: 0.02 },
    [B.wueste]: { sand: 0.28, salz: 0.07, gold: 0.018, edelstein: 0.012, stein: 0.05, kupfer: 0.02 },
  };
  for (const i of landIdx) {
    const table = P[biome[i]]; if (!table) continue;
    let roll = rng.float();
    for (const [k, p] of Object.entries(table)) { if (roll < p) { dep[i] = DEP[k]; break; } roll -= p; }
    if (!dep[i] && coast[i] && rng.chance(0.035)) dep[i] = DEP.salz;
    if (!dep[i] && distRiver[i] === 0 && rng.chance(0.08)) dep[i] = DEP.lehm;
  }
  // Mindestmengen garantieren, damit jede Karte alle Ketten erlaubt
  const habitable = i => biome[i] !== B.meer && biome[i] !== B.gebirge;
  const ensure = (key, min, biomesPref) => {
    let have = 0; for (const i of landIdx) if (dep[i] === DEP[key]) have++;
    let pool = landIdx.filter(i => !dep[i] && habitable(i) && biomesPref.includes(biome[i]));
    if (!pool.length) pool = landIdx.filter(i => !dep[i] && habitable(i));
    rng.shuffle(pool);
    for (let k = 0; have < min && k < pool.length; k++, have++) dep[pool[k]] = DEP[key];
  };
  ensure('stein', cities * 3, [B.hoch, B.pass]);
  ensure('lehm', cities * 2, [B.sumpf, B.flach]);
  ensure('eisen', Math.ceil(cities * 0.8), [B.hoch, B.pass]);
  ensure('kohle', Math.ceil(cities * 0.8), [B.hoch, B.pass, B.wald]);
  ensure('kupfer', Math.ceil(cities * 0.5), [B.hoch, B.pass]);
  ensure('zinn', Math.ceil(cities * 0.4), [B.hoch, B.pass]);
  ensure('gold', Math.max(2, Math.ceil(cities * 0.2)), [B.wueste, B.pass, B.hoch]);
  ensure('edelstein', Math.max(1, Math.ceil(cities * 0.1)), [B.wueste, B.hoch]);
  ensure('salz', Math.ceil(cities * 0.6), [B.wueste]);
  ensure('sand', Math.ceil(cities * 0.6), [B.wueste]);

  // ---------------- Provinzen (unregelmäßige Formen)
  const prov = new Int16Array(N).fill(-1);
  const habIdx = landIdx.filter(habitable);
  const avgSize = 32;
  const target = Math.max(cities * 6, Math.round(habIdx.length / avgSize));
  const minSeedDist = Math.max(3, Math.round(Math.sqrt(avgSize) * 0.75));
  const seeds = [];
  {
    const pool = rng.shuffle(habIdx.slice());
    for (const i of pool) {
      if (seeds.length >= target) break;
      if (seeds.every(s => g.dist(s, i) >= minSeedDist)) seeds.push(i);
    }
  }
  const weight = seeds.map(() => rng.range(0.65, 1.45));
  {
    const cost = new Float32Array(N).fill(Infinity);
    const heap = new MinHeap();
    seeds.forEach((s, k) => { cost[s] = 0; prov[s] = k; heap.push(0, s); });
    const jit = new Float32Array(N); for (let i = 0; i < N; i++) jit[i] = rng.float() * 0.9;
    while (heap.size) {
      const c = heap.pop();
      const p = prov[c];
      for (const n of g.neighbors(c, nb)) {
        if (!habitable(n)) continue;
        let step = (1 + jit[n]) * weight[p];
        if (biome[n] !== biome[c]) step += 0.45;
        if (river[n] >= 0 !== river[c] >= 0) step += 0.6;
        const nc = cost[c] + step;
        if (nc < cost[n]) { cost[n] = nc; prov[n] = p; heap.push(nc, n); }
      }
    }
  }
  // Unerreichte Landstücke (kleine Inseln) zu eigenen Provinzen
  let nextId = seeds.length;
  for (const i of habIdx) {
    if (prov[i] >= 0) continue;
    const comp = [i]; prov[i] = nextId;
    for (let k = 0; k < comp.length; k++) for (const n of g.neighbors(comp[k], nb)) if (habitable(n) && prov[n] < 0) { prov[n] = nextId; comp.push(n); }
    if (comp.length < 4) for (const c of comp) prov[c] = -1; else nextId++;
  }
  // Provinzen zusammenhängend machen (nur größte Komponente behalten)
  const tilesOf = Array.from({ length: nextId }, () => []);
  for (const i of habIdx) if (prov[i] >= 0) tilesOf[prov[i]].push(i);
  // Winzige Provinzen in Nachbarn verschmelzen
  for (let pass = 0; pass < 3; pass++) {
    for (let p = 0; p < nextId; p++) {
      const ts = tilesOf[p];
      if (!ts.length || ts.length >= 9) continue;
      const border = {};
      for (const t of ts) for (const n of g.neighbors(t, nb)) if (prov[n] >= 0 && prov[n] !== p) border[prov[n]] = (border[prov[n]] || 0) + 1;
      const best = Object.entries(border).sort((a, b) => b[1] - a[1])[0];
      if (!best) continue;
      const q = +best[0];
      for (const t of ts) { prov[t] = q; tilesOf[q].push(t); }
      tilesOf[p] = [];
    }
  }
  // Neu nummerieren
  const remap = new Int16Array(nextId).fill(-1);
  const provinces = [];
  const names = new NameGen(seedNum ^ 0xabc);
  for (let p = 0; p < nextId; p++) {
    if (!tilesOf[p].length) continue;
    remap[p] = provinces.length;
    provinces.push({ id: provinces.length, tiles: tilesOf[p] });
  }
  for (let i = 0; i < N; i++) if (prov[i] >= 0) prov[i] = remap[prov[i]];

  for (const pr of provinces) {
    const cnt = {};
    let sx = 0, sy = 0, tr = 0, fe = 0;
    const deps = {};
    pr.coast = false; pr.river = false;
    const nbrs = new Set();
    for (const t of pr.tiles) {
      cnt[biome[t]] = (cnt[biome[t]] || 0) + 1;
      sx += g.cx(t); sy += g.cy(t); tr += trees[t]; fe += fert[t];
      if (dep[t]) deps[DEPOSITS[dep[t]].key] = (deps[DEPOSITS[dep[t]].key] || 0) + 1;
      if (coast[t]) pr.coast = true;
      if (river[t] >= 0) pr.river = true;
      for (const n of g.neighbors(t, nb)) if (prov[n] >= 0 && prov[n] !== pr.id) nbrs.add(prov[n]);
    }
    pr.neighbors = [...nbrs];
    const n = pr.tiles.length;
    const cx = sx / n, cy = sy / n;
    // Mittelpunkt: Kachel der Provinz, die dem Schwerpunkt am nächsten liegt
    let best = pr.tiles[0], bd = Infinity;
    for (const t of pr.tiles) { const d = (g.cx(t) - cx) ** 2 + (g.cy(t) - cy) ** 2; if (d < bd) { bd = d; best = t; } }
    pr.center = best;
    pr.size = n;
    pr.trees = tr / n; pr.fert = fe / n;
    pr.deposits = deps;
    const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    pr.biomeShare = Object.fromEntries(sorted.map(([b, c]) => [b, c / n]));
    pr.primary = +sorted[0][0];
    pr.secondary = sorted[1] && sorted[1][1] / n >= 0.25 ? +sorted[1][0] : -1;
    const m1 = BIOMES[pr.primary].mods;
    if (pr.secondary >= 0) {
      const m2 = BIOMES[pr.secondary].mods;
      pr.mods = Object.fromEntries(Object.keys(m1).map(k => [k, +(0.5 * m1[k] + 0.5 * m2[k]).toFixed(3)]));
    } else pr.mods = { ...m1 };
    pr.name = names.next();
    // Bewertung für KI-Standortwahl
    const depScore = Object.entries(deps).reduce((s, [k, c]) => s + Math.min(c, 3) * (k === 'stein' ? 0.25 : k === 'lehm' ? 0.12 : 0.35), 0);
    pr.score = pr.fert * pr.mods.nahrung * 1.2 + pr.trees * pr.mods.holz + depScore + (pr.coast ? 0.45 : 0) + (pr.river ? 0.55 : 0) + Math.min(n, 40) / 80;
  }

  return { params: { ...params, mapType: type, cities }, seedNum, W, H, grid: g, biome, elev, river, rivers, ford, coast, trees, fert, dep, prov, provinces, distSea, cityNames: new NameGen(seedNum ^ 0xc17) };
}
