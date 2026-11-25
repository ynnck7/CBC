// Spielsimulation: Städte, Gebäude, Wirtschaft, Markt, Handel, Forschung
import { generateMap } from './mapgen.js';
import { Pathfinder } from './path.js';
import { HEX_R, HEX_W, segDist, clamp, Rng } from './util.js';
import {
  BIOMES, B, DEPOSITS, GOODS, QUALITY, goodKey, parseKey, keyName, keyBasePrice, ALL_KEYS, NEEDS, FOOD_GOODS,
  BUILDINGS, ROAD, TECHS, TECH_IDS, ERA_THRESHOLD, ERAS, TRANSPORT, FOREIGN, START, DIFFICULTY, CITY_COLORS, START_YEAR, END_YEAR,
} from './data.js';
import { aiDaily, aiPickFoundingProvince, aiTrade } from './ai.js';

export const SPEEDS = [0, 1, 3, 8, 24, 72];   // Spielstunden pro Echtsekunde
const SAVE_VERSION = 1;
const BASE_STORAGE = 300;
const TAX_BASE = 0.1;
const UPKEEP_MULT = 0.4;
const LOCAL_SALE = { perDay: 5, price: 0.35, goods: 3 };
const TIER_TAX = [0, 1, 1.7, 2.6, 4.5];

export function gameDate(hour) {
  const d = new Date(Date.UTC(START_YEAR, 2, 1) + Math.floor(hour) * 3600_000);
  d.setUTCFullYear(d.getUTCFullYear()); // Jahr bleibt korrekt (Date kann Jahre < 1970)
  return d;
}
export function fmtDate(hour, withHour = false) {
  const d = gameDate(hour);
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `${d.getUTCDate()}. ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}` + (withHour ? `, ${String(d.getUTCHours()).padStart(2, '0')}:00` : '');
}

export class Game {
  constructor(state) {
    this.state = state;
    this.map = generateMap(state.params);
    this.pf = new Pathfinder(this.map);
    this.listeners = {};
    this.rng = new Rng(Date.now() & 0xffffffff);
    this.buildRiverIndex();
    this.rebuildIndexes();
    for (const c of state.cities) this.map.cityNames.used.add(c.name);
  }

  // ------------------------------------------------------------ Erzeugen / Laden
  static create(params) {
    const state = {
      version: SAVE_VERSION,
      params: { seed: params.seed, cities: params.cities, mapType: params.mapType, difficulty: params.difficulty || 'normal' },
      hour: 0, playTime: 0, nextId: 1, speed: 0,
      cities: [], playerId: -1,
      provOwner: [], provNames: {},
      merchants: [], relations: {}, aiQueue: [], log: [],
      history: { monthly: [], yearly: [] }, endShown: false, lastMonth: -1,
    };
    const game = new Game(state);
    state.params.mapType = game.map.params.mapType;
    state.provOwner = new Array(game.map.provinces.length).fill(-1);
    // KI-Städte: ein Teil existiert schon, der Rest gründet sich zeitversetzt
    const aiCount = game.map.params.cities - 1;
    const already = Math.max(1, Math.round(aiCount * 0.4));
    for (let k = 0; k < aiCount; k++) state.aiQueue.push({ at: k < already ? 0 : 12 + (k - already) * game.rng.range(10, 30) + game.rng.range(0, 10), afterPlayer: k >= already });
    // Erste KI-Städte abhängig vom Seed, danach echter Zufall
    game.rng = new Rng('ai-' + params.seed);
    game.processAiQueue(true);
    game.rng = new Rng(Date.now() & 0xffffffff);
    return game;
  }

  static load(state) {
    const game = new Game(state);
    return game;
  }

  serialize() {
    const s = this.state;
    // Abgeleitete Felder nicht speichern
    return JSON.parse(JSON.stringify(s, (k, v) => (k[0] === '_' ? undefined : v)));
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach(fn => fn(data)); }

  get player() { return this.state.playerId >= 0 ? this.cityById(this.state.playerId) : null; }
  cityById(id) { return this.state.cities.find(c => c.id === id) || null; }
  newId() { return this.state.nextId++; }
  log(text, type = 'info') {
    const e = { h: this.state.hour, text, type };
    this.state.log.push(e);
    if (this.state.log.length > 80) this.state.log.shift();
    this.emit('log', e);
  }

  // ------------------------------------------------------------ Indizes
  buildRiverIndex() {
    const g = this.map.grid;
    this.riverSegs = new Map();   // Kachel -> Liste [ax,ay,bx,by]
    this.riverLines = [];
    const add = (t, seg) => { if (!this.riverSegs.has(t)) this.riverSegs.set(t, []); this.riverSegs.get(t).push(seg); };
    for (const rv of this.map.rivers) {
      const pts = [...rv.tiles, rv.mouth].map(t => [g.cx(t), g.cy(t)]);
      this.riverLines.push(pts);
      const all = [...rv.tiles, rv.mouth];
      for (let k = 0; k < all.length - 1; k++) {
        const seg = [pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]];
        const touch = new Set([all[k], all[k + 1], ...g.neighbors(all[k], []), ...g.neighbors(all[k + 1], [])]);
        for (const t of touch) add(t, seg);
      }
    }
  }

  rebuildIndexes() {
    this.bIndex = new Map();    // Kachel -> Gebäude[]
    this.pf.roadTiles.fill(0);
    this.pf.bridgeTiles.fill(0);
    for (const c of this.state.cities) {
      for (const b of c.buildings) this.indexBuilding(b, c);
      for (const r of c.roads) this.markRoad(r);
    }
    this.updateRoadFactor();
    this.pf.invalidate();
  }
  updateRoadFactor() {
    const p = this.player;
    this.pf.roadFactor = p && this.techDone(p, 'kanalbau') ? 0.4 : 0.6;
  }
  buildingTiles(b) {
    const g = this.map.grid; const set = new Set();
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const t = g.at(b.x + dx * b.w / 2, b.y + dy * b.h / 2); if (t >= 0) set.add(t); }
    return [...set];
  }
  indexBuilding(b, c) {
    b._c = c;
    for (const t of this.buildingTiles(b)) { if (!this.bIndex.has(t)) this.bIndex.set(t, []); this.bIndex.get(t).push(b); }
    if (b.type === 'bruecke' && b.done) { const t = this.map.grid.at(b.x, b.y); if (t >= 0) this.pf.bridgeTiles[t] = 1; }
  }
  unindexBuilding(b) {
    for (const t of this.buildingTiles(b)) { const arr = this.bIndex.get(t); if (arr) { const i = arr.indexOf(b); if (i >= 0) arr.splice(i, 1); } }
  }
  markRoad(r) {
    const g = this.map.grid;
    const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
    for (let s = 0; s <= len; s += 6) { const t = g.at(r.x1 + (r.x2 - r.x1) * s / len, r.y1 + (r.y2 - r.y1) * s / len); if (t >= 0) this.pf.roadTiles[t] = 1; }
  }
  buildingsNear(x, y, rad) {
    const g = this.map.grid; const out = new Set();
    for (const t of this.tilesInRadius(x, y, rad + HEX_W)) for (const b of this.bIndex.get(t) || []) out.add(b);
    return [...out];
  }
  buildingAt(x, y) {
    const t = this.map.grid.at(x, y); if (t < 0) return null;
    for (const t2 of [t, ...this.map.grid.neighbors(t, [])]) for (const b of this.bIndex.get(t2) || []) {
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2) return b;
    }
    return null;
  }
  tilesInRadius(x, y, rad) {
    const g = this.map.grid;
    const res = [];
    const r0 = Math.max(0, Math.floor((y - rad - HEX_R) / (HEX_R * 1.5))), r1 = Math.min(g.h - 1, Math.ceil((y + rad - HEX_R) / (HEX_R * 1.5)));
    const q0 = Math.max(0, Math.floor((x - rad) / HEX_W) - 1), q1 = Math.min(g.w - 1, Math.ceil((x + rad) / HEX_W));
    const r2 = rad * rad;
    for (let r = r0; r <= r1; r++) {
      const cy = HEX_R * 1.5 * r + HEX_R, off = (r & 1) * 0.5 * HEX_W + HEX_W / 2;
      const dy2 = (cy - y) * (cy - y);
      if (dy2 > r2) continue;
      for (let q = q0; q <= q1; q++) { const cx = HEX_W * q + off; if ((cx - x) * (cx - x) + dy2 <= r2) res.push(r * g.w + q); }
    }
    if (!res.length) { const t = g.at(x, y); if (t >= 0) res.push(t); }
    return res;
  }

  // ------------------------------------------------------------ Geometrie-Abfragen
  riverDist(x, y) {
    const t = this.map.grid.at(x, y);
    const segs = this.riverSegs.get(t);
    if (!segs) return Infinity;
    let d = Infinity; for (const s of segs) d = Math.min(d, segDist(x, y, s[0], s[1], s[2], s[3]));
    return d;
  }
  seaDist(x, y) {
    const g = this.map.grid; const t = g.at(x, y);
    if (t < 0) return Infinity;
    let d = Infinity;
    for (const n of [t, ...g.neighbors(t, [])]) if (this.map.biome[n] === B.meer) d = Math.min(d, Math.max(0, Math.hypot(g.cx(n) - x, g.cy(n) - y) - HEX_R * 0.86));
    return d;
  }
  waterDist(x, y) { return Math.min(this.riverDist(x, y), this.seaDist(x, y)); }
  tileOwner(t) { const p = this.map.prov[t]; return p >= 0 ? this.state.provOwner[p] : -1; }
  provName(pid) { return this.state.provNames[pid] || this.map.provinces[pid].name; }

  // ------------------------------------------------------------ Forschung & Freischaltung
  techDone(c, id) { return c.research.done.includes(id); }
  cityEra(c) {
    let era = 1;
    for (let e = 1; e < ERAS.length; e++) {
      const n = c.research.done.filter(t => TECHS[t].era === e).length;
      if (n >= ERA_THRESHOLD) era = e + 1; else break;
    }
    return era;
  }
  techAvailable(c, id) {
    const t = TECHS[id];
    return !this.techDone(c, id) && t.era <= this.cityEra(c) && t.req.every(r => this.techDone(c, r));
  }
  isUnlocked(c, type) {
    const d = BUILDINGS[type];
    if (d.hidden) return false;
    if (d.tech) return this.techDone(c, d.tech);
    return (d.era || 1) <= this.cityEra(c);
  }
  techBonus(c, b) {
    let m = 1;
    const d = BUILDINGS[b.type];
    for (const id of c.research.done) {
      const e = TECHS[id].effect; if (!e || !e.prod) continue;
      if (e.building === b.type || e.cat === d.cat) m += e.prod;
    }
    return m;
  }
  transportMod(c) { return c && this.techDone(c, 'handelskompanie') ? 0.8 : 1; }

  // ------------------------------------------------------------ Kosten
  centerMods(c) { const p = this.map.prov[c.tile]; return p >= 0 ? this.map.provinces[p].mods : { bau: 1 }; }
  costOf(c, type) {
    const d = BUILDINGS[type];
    const m = this.centerMods(c).bau || 1;
    const out = {};
    for (const [k, v] of Object.entries(d.cost)) out[k] = Math.ceil(v * m);
    return out;
  }
  canAfford(c, cost) {
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'geld') { if (c.money < v) return false; }
      else if (this.stockOf(c, k) < v) return false;
    }
    return true;
  }
  pay(c, cost) {
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'geld') c.money -= v; else this.takeGood(c, k, v);
    }
  }
  // Ware ohne Qualitätsangabe: beliebige Qualität (niedrigste zuerst)
  stockOf(c, id) {
    if (GOODS[id] && GOODS[id].q) return [0, 1, 2].reduce((s, q) => s + (c.stock[`${id}#${q}`] || 0), 0);
    return c.stock[id] || 0;
  }
  takeGood(c, id, amt) {
    if (GOODS[id] && GOODS[id].q) {
      for (const q of [0, 1, 2]) { const k = `${id}#${q}`; const t = Math.min(amt, c.stock[k] || 0); c.stock[k] = (c.stock[k] || 0) - t; amt -= t; if (amt <= 0) break; }
    } else c.stock[id] = Math.max(0, (c.stock[id] || 0) - amt);
  }
  storageCap(c) { return BASE_STORAGE + c.buildings.filter(b => b.done && BUILDINGS[b.type].storage).reduce((s, b) => s + BUILDINGS[b.type].storage, 0); }
  addGood(c, key, amt) {
    const cap = this.storageCap(c);
    const cur = c.stock[key] || 0;
    const add = Math.max(0, Math.min(amt, cap - cur));
    c.stock[key] = cur + add;
    return add;
  }

  // ------------------------------------------------------------ Standort
  locFactor(c, type, x, y) {
    const d = BUILDINGS[type];
    const m = this.map;
    const res = { f: 1, dep: null, info: '' };
    if (!d.loc) return res;
    const near = this.tilesInRadius(x, y, HEX_W * 1.5);
    const avg = arr => near.reduce((s, t) => s + arr[t], 0) / near.length;
    const sameNear = this.buildingsNear(x, y, HEX_W * 1.2).filter(b => b.type === type && b._c === c).length;
    const crowd = 1 / (1 + 0.18 * sameNear);
    if (d.loc === 'trees') { const a = avg(m.trees); res.f = (0.3 + 0.85 * a) * crowd; res.info = `Bäume ${Math.round(a * 100)} %`; }
    else if (d.loc === 'fert') { const a = avg(m.fert); res.f = (0.2 + 0.9 * a) * crowd; res.info = `Fruchtbarkeit ${Math.round(a * 100)} %`; }
    else if (d.loc === 'forage') { const a = 0.4 + 0.4 * avg(m.trees) + 0.3 * avg(m.fert); res.f = a * crowd; res.info = `Sammelgebiet ${Math.round(a * 100)} %`; }
    else if (d.loc === 'grass') { const a = near.filter(t => m.biome[t] === B.flach || m.biome[t] === B.hoch || m.biome[t] === B.pass).length / near.length; res.f = (0.3 + 0.9 * a) * crowd; res.info = `Weideland ${Math.round(a * 100)} %`; }
    else if (d.loc === 'water') { const wd = this.waterDist(x, y); res.f = wd <= 14 ? crowd : 0; res.info = wd <= 14 ? 'Am Wasser' : 'Kein Wasser in der Nähe'; res.needWater = true; }
    else if (d.loc.startsWith('deposit:')) {
      const keys = d.loc.slice(8).split(',');
      let best = null, bd = Infinity, count = 0;
      for (const t of near) {
        const dp = DEPOSITS[m.dep[t]];
        if (dp && keys.includes(dp.key)) { count++; const dd = Math.hypot(m.grid.cx(t) - x, m.grid.cy(t) - y); if (dd < bd) { bd = dd; best = dp; } }
      }
      if (best) { res.dep = best.key; res.f = (1 + Math.min(count - 1, 2) * 0.15) * crowd; res.info = `${best.name} (${count})`; }
      else {
        const tb = m.biome[m.grid.at(x, y)];
        if (type === 'bergwerk') { res.f = 0; res.info = 'Keine Erzlagerstätte in der Nähe'; }
        else if (keys[0] === 'stein') res.f = (tb === B.hoch || tb === B.pass ? 0.5 : 0.15) * crowd;
        else if (keys[0] === 'lehm') res.f = (tb === B.sumpf || this.riverDist(x, y) < 30 ? 0.55 : 0.15) * crowd;
        else if (keys[0] === 'sand') res.f = (tb === B.wueste ? 0.6 : 0.1) * crowd;
        else if (keys[0] === 'salz') res.f = (this.seaDist(x, y) < 20 ? 0.45 : 0) * crowd;
        if (!res.info) res.info = res.f > 0 ? 'Ohne Lagerstätte (geringer Ertrag)' : 'Keine Lagerstätte';
      }
      if (type === 'bergwerk' && best) res.info = `Fördert ${GOODS[best.good].name}`;
    }
    if (sameNear > 0) res.info += ` · ${sameNear}× Konkurrenz in der Nähe`;
    return res;
  }

  // ------------------------------------------------------------ Bauen
  canPlace(c, type, x, y) {
    const d = BUILDINGS[type];
    const g = this.map.grid, m = this.map;
    if (!c) return { ok: false, reason: 'Keine Stadt' };
    if (!this.isUnlocked(c, type)) return { ok: false, reason: 'Noch nicht erforscht' };
    if (d.unique && c.buildings.some(b => b.type === type)) return { ok: false, reason: 'Nur einmal baubar' };
    if (c.buildings.filter(b => !BUILDINGS[b.type].hidden).length >= 100 && type !== 'bruecke') return { ok: false, reason: 'Maximal 100 Gebäude pro Stadt' };
    const [w, h] = d.size;
    const pts = [[x, y], [x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x - w / 2, y + h / 2], [x + w / 2, y + h / 2]];
    for (const [px, py] of pts) {
      const t = g.at(px, py);
      if (t < 0) return { ok: false, reason: 'Außerhalb der Karte' };
      const bi = m.biome[t];
      if (bi === B.meer) return { ok: false, reason: 'Nicht auf dem Wasser' };
      if (bi === B.gebirge) return { ok: false, reason: 'Gebirge ist unbewohnbar' };
      if (this.tileOwner(t) !== c.id) return { ok: false, reason: 'Außerhalb des Stadtgebiets' };
    }
    const rd = this.riverDist(x, y);
    if (d.bridge) {
      if (rd > 3) return { ok: false, reason: 'Brücken müssen auf einem Fluss stehen' };
      const t = g.at(x, y);
      if (this.pf.bridgeTiles[t]) return { ok: false, reason: 'Hier gibt es schon eine Brücke' };
    } else if (rd < Math.max(w, h) / 2 + 3) return { ok: false, reason: 'Zu nah am Fluss' };
    // Überschneidung
    for (const b of this.buildingsNear(x, y, 20)) {
      if (Math.abs(b.x - x) < (b.w + w) / 2 + 1 && Math.abs(b.y - y) < (b.h + h) / 2 + 1) return { ok: false, reason: 'Platz belegt' };
    }
    // Straßen nicht überbauen
    for (const r of c.roads) if (segDist(x, y, r.x1, r.y1, r.x2, r.y2) < Math.min(w, h) / 2 + 1) return { ok: false, reason: 'Straße im Weg' };
    const loc = this.locFactor(c, type, x, y);
    if ((d.needWater || d.loc === 'water') && loc.f <= 0) return { ok: false, reason: 'Muss am Wasser stehen', loc };
    if (type === 'bergwerk' && !loc.dep) return { ok: false, reason: 'Keine Erzlagerstätte in der Nähe', loc };
    if (loc.f <= 0 && d.loc) return { ok: false, reason: loc.info || 'Ungeeigneter Standort', loc };
    const cost = this.costOf(c, type);
    if (!this.canAfford(c, cost)) return { ok: false, reason: 'Nicht genug Geld oder Material', loc, cost, afford: false };
    return { ok: true, loc, cost };
  }

  place(c, type, x, y, opts = {}) {
    const chk = this.canPlace(c, type, x, y);
    if (!chk.ok) return chk;
    const d = BUILDINGS[type];
    this.pay(c, chk.cost);
    const b = {
      id: this.newId(), type, x, y, w: d.size[0], h: d.size[1],
      progress: 0, done: d.time === 0, residents: 0, recipe: 0, quality: 0,
      loc: +chk.loc.f.toFixed(3), dep: chk.loc.dep || null, workers: 0, eff: 0, paused: false, placedAt: this.state.hour,
    };
    if (type === 'bergwerk' && b.dep) b.out = DEPOSITS.find(x => x && x.key === b.dep).good;
    c.buildings.push(b);
    this.indexBuilding(b, c);
    this.emit('changed', { city: c });
    return { ok: true, building: b };
  }

  demolish(c, b) {
    const i = c.buildings.indexOf(b);
    if (i < 0 || b.type === 'zentrum') return false;
    c.buildings.splice(i, 1);
    this.unindexBuilding(b);
    if (b.type === 'bruecke') { this.rebuildIndexes(); }
    // 30 % des Geldes zurück, bei laufendem Bau 60 %
    const cost = this.costOf(c, b.type);
    c.money += Math.round((cost.geld || 0) * (b.done ? 0.3 : 0.6));
    this.emit('changed', { city: c });
    return true;
  }

  roadCost(len) {
    const n = Math.max(1, Math.ceil(len / 10));
    return Object.fromEntries(Object.entries(ROAD.costPer10).map(([k, v]) => [k, v * n]));
  }
  canRoad(c, x1, y1, x2, y2) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 4) return { ok: false, reason: 'Zu kurz' };
    if (len > 160) return { ok: false, reason: 'Zu lang (max. 160)' };
    const g = this.map.grid;
    for (let s = 0; s <= len; s += 3) {
      const px = x1 + (x2 - x1) * s / len, py = y1 + (y2 - y1) * s / len;
      const t = g.at(px, py);
      if (t < 0 || this.map.biome[t] === B.meer || this.map.biome[t] === B.gebirge) return { ok: false, reason: 'Ungültiges Gelände' };
      if (this.tileOwner(t) !== c.id) return { ok: false, reason: 'Außerhalb des Stadtgebiets' };
      const b = this.buildingAt(px, py);
      if (b && b.type !== 'bruecke' && b.type !== 'zentrum' && b.type !== 'marktplatz') return { ok: false, reason: 'Gebäude im Weg' };
    }
    const cost = this.roadCost(len);
    if (!this.canAfford(c, cost)) return { ok: false, reason: 'Nicht genug Geld oder Stein', cost };
    return { ok: true, cost, len };
  }
  placeRoad(c, x1, y1, x2, y2) {
    const chk = this.canRoad(c, x1, y1, x2, y2);
    if (!chk.ok) return chk;
    this.pay(c, chk.cost);
    const r = { id: this.newId(), x1, y1, x2, y2 };
    c.roads.push(r);
    this.markRoad(r);
    this.pf.invalidate();
    this.emit('changed', { city: c });
    return { ok: true, road: r };
  }
  removeRoad(c, r) {
    const i = c.roads.indexOf(r); if (i < 0) return;
    c.roads.splice(i, 1); this.rebuildIndexes(); this.emit('changed', { city: c });
  }
  roadNear(c, x, y, d = 4) { return c.roads.find(r => segDist(x, y, r.x1, r.y1, r.x2, r.y2) <= d) || null; }

  // ------------------------------------------------------------ Provinzen
  provinceLimit(c) {
    const rath = c.buildings.some(b => b.done && BUILDINGS[b.type].provinces) ? 1 : 0;
    return 1 + Math.floor(c.pop / 60) + rath;
  }
  claimCost(c) { return 60 + 45 * c.provinces.length; }
  canClaim(c, pid) {
    if (this.state.provOwner[pid] !== -1) return { ok: false, reason: 'Provinz gehört bereits einer Stadt' };
    const pr = this.map.provinces[pid];
    if (!pr.neighbors.some(n => this.state.provOwner[n] === c.id)) return { ok: false, reason: 'Muss an das Stadtgebiet angrenzen' };
    if (c.provinces.length >= this.provinceLimit(c)) return { ok: false, reason: `Limit erreicht (${this.provinceLimit(c)} Provinzen, mehr Einwohner nötig)` };
    const cost = this.claimCost(c);
    if (c.money < cost) return { ok: false, reason: `${cost} Gold nötig`, cost };
    return { ok: true, cost };
  }
  claim(c, pid) {
    const chk = this.canClaim(c, pid);
    if (!chk.ok) return chk;
    c.money -= chk.cost;
    this.state.provOwner[pid] = c.id;
    c.provinces.push(pid);
    // Grenzkonkurrenz verschlechtert Beziehungen
    const pr = this.map.provinces[pid];
    const neighOwners = new Set(pr.neighbors.map(n => this.state.provOwner[n]).filter(o => o >= 0 && o !== c.id));
    for (const o of neighOwners) {
      if (c.id === this.state.playerId) this.changeRelation(o, -4);
      else if (o === this.state.playerId) this.changeRelation(c.id, -3);
    }
    this.emit('territory', { city: c, pid });
    return { ok: true };
  }

  // ------------------------------------------------------------ Städte gründen
  canFound(pid) {
    if (pid < 0) return { ok: false, reason: 'Hier ist keine Provinz' };
    if (this.state.provOwner[pid] !== -1) return { ok: false, reason: 'Provinz gehört bereits einer Stadt' };
    return { ok: true };
  }
  foundCity(pid, x, y, opts = {}) {
    const st = this.state;
    const isPlayer = !!opts.player;
    const g = this.map.grid;
    const pr = this.map.provinces[pid];
    if (x === undefined) { x = g.cx(pr.center); y = g.cy(pr.center); }
    // Mittelpunkt darf nicht im Fluss liegen
    if (this.riverDist(x, y) < 10) {
      const alt = pr.tiles.map(t => [g.cx(t), g.cy(t)]).filter(([px, py]) => this.riverDist(px, py) >= 12 && this.map.biome[g.at(px, py)] !== B.meer)
        .sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))[0];
      if (alt) [x, y] = alt;
    }
    const diff = DIFFICULTY[st.params.difficulty] || DIFFICULTY.normal;
    const mult = isPlayer ? diff.player : diff.ai;
    const idx = st.cities.length;
    const c = {
      id: this.newId(), name: opts.name || this.map.cityNames.next(), color: isPlayer ? '#d4af37' : CITY_COLORS[idx % CITY_COLORS.length],
      player: isPlayer, founded: st.hour, x, y, tile: g.at(x, y), provinces: [pid], buildings: [], roads: [],
      stock: {}, money: Math.round(START.geld * mult), taxRate: 0.1,
      research: { done: [], current: null, points: 0 },
      autoTrade: {}, routes: [], flow: {}, avg: {}, sat: [1, 1, 0, 0, 0], happy: [1, 1, 1, 1, 1], pop: 0,
      knowledge: 0, prestige: 0, clean: 0, income: 0, expense: 0, tradeIncome: 0, jobs: 0, workforce: 0,
      mult, aiPersona: this.rng.int(0, 2), lastIncome: [],
    };
    for (const [k, v] of Object.entries(START)) if (k !== 'geld') c.stock[k] = Math.round(v * mult);
    st.cities.push(c);
    st.provOwner[pid] = c.id;
    const center = { id: this.newId(), type: 'zentrum', x, y, w: 10, h: 10, progress: 0, done: true, residents: 6, recipe: 0, quality: 0, loc: 1, workers: 0, eff: 1, paused: false };
    c.buildings.push(center);
    this.indexBuilding(center, c);
    if (isPlayer) {
      st.playerId = c.id;
      for (const o of st.cities) if (!o.player) st.relations[o.id] = { rel: 0, agreement: false };
      this.log(`Die Stadt ${c.name} wurde gegründet.`, 'good');
    } else {
      if (st.playerId >= 0) st.relations[c.id] = { rel: 0, agreement: false };
      if (st.playerId >= 0) this.log(`Neue Stadt in der Nachbarschaft: ${c.name} (${this.provName(pid)}).`, 'info');
    }
    this.updatePop(c);
    this.emit('territory', { city: c, pid });
    return c;
  }

  processAiQueue(initial = false) {
    const st = this.state;
    const playerFounded = st.playerId >= 0;
    for (const q of st.aiQueue) {
      if (q.done) continue;
      if (q.afterPlayer && !playerFounded) continue;
      const due = q.afterPlayer ? (q.at + (q.base ?? (q.base = st.hour))) : q.at;
      if (st.hour >= due) {
        const pid = aiPickFoundingProvince(this);
        if (pid >= 0) this.foundCity(pid);
        q.done = true;
      }
    }
    st.aiQueue = st.aiQueue.filter(q => !q.done);
  }

  // ------------------------------------------------------------ Diplomatie
  rel(id) { return this.state.relations[id] || (this.state.relations[id] = { rel: 0, agreement: false }); }
  changeRelation(id, d) { const r = this.rel(id); r.rel = clamp(r.rel + d, -100, 100); if (r.agreement && r.rel < 0) { r.agreement = false; this.log(`Das Handelsabkommen mit ${this.cityById(id)?.name} wurde gekündigt.`, 'bad'); } }
  tariff(a, b) {
    const pid = this.state.playerId;
    if (a.player || b.player) {
      const other = a.player ? b : a;
      if (other.foreign) return 0.1;
      const r = this.rel(other.id);
      if (r.agreement) return 0;
      return clamp(0.15 - r.rel * 0.0008, 0.07, 0.25);
    }
    return 0.1;
  }
  gift(id, amount) {
    const p = this.player; if (!p || p.money < amount || amount <= 0) return false;
    p.money -= amount; const o = this.cityById(id); if (o) o.money += amount;
    this.changeRelation(id, Math.min(25, amount / 12));
    return true;
  }
  agreementCost() { return 150; }
  makeAgreement(id) {
    const p = this.player; const r = this.rel(id);
    if (r.agreement) return { ok: false, reason: 'Besteht bereits' };
    if (r.rel < 25) return { ok: false, reason: 'Beziehung mindestens +25 nötig' };
    if (p.money < this.agreementCost()) return { ok: false, reason: `${this.agreementCost()} Gold nötig` };
    p.money -= this.agreementCost(); r.agreement = true; this.changeRelation(id, 5);
    this.log(`Handelsabkommen mit ${this.cityById(id).name} geschlossen: keine Zölle mehr.`, 'good');
    return { ok: true };
  }

  // ------------------------------------------------------------ Markt
  reserveOf(c, key) {
    const a = c.avg[key]; const use = a ? a.u : 0;
    return Math.ceil(use * 5 + 10);
  }
  available(c, key) {
    if (c.foreign) return 9999;
    if (c.player) {
      const at = c.autoTrade[key];
      if (!at || at.max == null) return 0;
      return Math.max(0, Math.floor((c.stock[key] || 0) - at.max));
    }
    return Math.max(0, Math.floor((c.stock[key] || 0) - this.reserveOf(c, key)));
  }
  price(c, key, delta = 0) {
    const base = keyBasePrice(key);
    if (c.foreign) {
      const { id } = parseKey(key);
      const f = c.def;
      return +(base * (f.cheap.includes(id) ? 0.65 : f.dear.includes(id) ? 1.6 : 1.08)).toFixed(2);
    }
    const s = Math.max(0, (c.stock[key] || 0) + delta);
    const a = c.avg[key]; const use = a ? a.u : 0;
    const target = 40 + use * 8;
    return +(base * clamp(Math.pow((target + 10) / (s + 10), 0.55), 0.35, 3)).toFixed(2);
  }
  hasMarket(c) { return c.foreign || c.buildings.some(b => b.type === 'marktplatz' && b.done); }
  hasHarbor(c) { return c.foreign || c.buildings.some(b => b.type === 'hafen' && b.done); }
  traderCount(c, mode) {
    return c.buildings.filter(b => b.done && BUILDINGS[b.type].traders && BUILDINGS[b.type].traders[mode]).reduce((s, b) => s + BUILDINGS[b.type].traders[mode], 0);
  }
  tradersBusy(c, mode) { return this.state.merchants.filter(m => m.home === c.id && m.mode === mode).length; }
  tradersFree(c, mode) { return this.traderCount(c, mode) - this.tradersBusy(c, mode); }
  foreignCities() { return FOREIGN.map(f => ({ id: f.id, name: f.name, foreign: true, def: f, stock: {}, avg: {} })); }
  partnerById(id) { if (typeof id === 'string') return this.foreignCities().find(f => f.id === id); return this.cityById(id); }
  harborNode(c) {
    const h = c.buildings.find(b => b.type === 'hafen' && b.done); if (!h) return -1;
    return this.pf.nearestBoatNode(h.x, h.y, 2);
  }
  route(a, b, mode) {
    if (mode === 'boot') {
      const s = this.harborNode(a); if (s < 0) return null;
      if (b.foreign) {
        const e = this.pf.findEdgeExit(s); if (!e) return null;
        return { tiles: e.tiles, hours: e.hours + b.def.hours, foreign: true, visibleHours: e.hours };
      }
      const t = this.harborNode(b); if (t < 0) return null;
      const p = this.pf.find(s, t, 'boot');
      return p ? { tiles: p.tiles, hours: p.hours, visibleHours: p.hours } : null;
    }
    if (b.foreign) return null;
    const p = this.pf.find(a.tile, b.tile, 'land');
    if (!p) return null;
    const sp = TRANSPORT[mode].speed;
    return { tiles: p.tiles, hours: p.hours / sp, visibleHours: p.hours / sp };
  }
  modesBetween(a, b) {
    const out = [];
    if (!b.foreign) { if (this.traderCount(a, 'fuss')) out.push('fuss'); if (this.traderCount(a, 'karren')) out.push('karren'); }
    if (this.hasHarbor(a) && this.hasHarbor(b) && this.traderCount(a, 'boot')) out.push('boot');
    return out;
  }
  // Angebot für einen Handel berechnen; dir = 'buy' (a kauft bei b) oder 'sell' (a verkauft an b)
  quote(a, b, mode, cargo, dir) {
    if (!this.hasMarket(a)) return { ok: false, reason: 'Du brauchst einen fertigen Marktplatz.' };
    if (!this.hasMarket(b)) return { ok: false, reason: `${b.name} hat keinen Marktplatz.` };
    const T = TRANSPORT[mode];
    if (!T) return { ok: false, reason: 'Unbekanntes Transportmittel' };
    if (mode === 'boot' && (!this.hasHarbor(a) || !this.hasHarbor(b))) return { ok: false, reason: 'Beide Städte brauchen einen Hafen.' };
    if (this.tradersFree(a, mode) <= 0) return { ok: false, reason: `Kein freier ${T.name}.` };
    cargo = cargo.filter(x => x.qty > 0);
    if (!cargo.length) return { ok: false, reason: 'Keine Ware gewählt.' };
    if (cargo.length > T.goods) return { ok: false, reason: `${T.name}: höchstens ${T.goods} Warenarten.` };
    const total = cargo.reduce((s, x) => s + x.qty, 0);
    if (total > T.cap) return { ok: false, reason: `${T.name}: höchstens ${T.cap} Einheiten.` };
    if (a.player && !b.foreign && this.rel(b.id).rel <= -40) return { ok: false, reason: `${b.name} verweigert den Handel.` };
    const r = this.route(a, b, mode);
    if (!r) return { ok: false, reason: 'Kein Weg dorthin.' };
    const tariff = this.tariff(a, b);
    let goodsValue = 0;
    for (const x of cargo) {
      if (dir === 'buy') {
        const av = this.available(b, x.key);
        if (av < x.qty) return { ok: false, reason: `${b.name} bietet nur ${av} ${keyName(x.key)} an.` };
        goodsValue += this.price(b, x.key, -x.qty / 2) * x.qty;
      } else {
        if ((a.stock[x.key] || 0) < x.qty) return { ok: false, reason: `Nicht genug ${keyName(x.key)} im Lager.` };
        goodsValue += this.price(b, x.key, x.qty / 2) * x.qty;
      }
    }
    const transport = Math.round((2 + total * r.hours * T.costPerUnitHour) * this.transportMod(a) * 100) / 100;
    const tariffCost = goodsValue * tariff;
    const net = dir === 'buy' ? -(goodsValue + tariffCost + transport) : goodsValue - tariffCost - transport;
    if (dir === 'buy' && a.money < -net) return { ok: false, reason: 'Nicht genug Geld.', hours: r.hours, transport, goodsValue, tariffCost, net };
    if (dir === 'sell' && !b.foreign && b.money < goodsValue * 0.5) return { ok: false, reason: `${b.name} kann sich das nicht leisten.` };
    return { ok: true, hours: r.hours, route: r, transport, goodsValue, tariffCost, net, tariff };
  }
  dispatch(a, b, mode, cargo, dir, opts = {}) {
    const q = this.quote(a, b, mode, cargo, dir);
    if (!q.ok) return q;
    cargo = cargo.filter(x => x.qty > 0).map(x => ({ key: x.key, qty: Math.floor(x.qty) }));
    const tariff = q.tariff;
    if (dir === 'buy') {
      a.money -= q.goodsValue + q.tariffCost + q.transport;
      if (!b.foreign) { b.money += q.goodsValue; for (const x of cargo) b.stock[x.key] -= x.qty; }
      this.trackTrade(a, -(q.goodsValue + q.tariffCost + q.transport));
    } else {
      a.money -= q.transport;
      for (const x of cargo) a.stock[x.key] -= x.qty;
      this.trackTrade(a, -q.transport);
    }
    const m = {
      id: this.newId(), home: a.id, partner: b.id, mode, cargo, dir, tariff,
      tiles: q.route.tiles, hours: q.route.hours, visibleHours: q.route.visibleHours, t: 0, arrived: false, auto: !!opts.auto,
    };
    this.state.merchants.push(m);
    if (a.player && !b.foreign && !b.player) this.changeRelation(b.id, 0.4);
    return { ok: true, merchant: m, quote: q };
  }
  trackTrade(c, amount) { c.tradeToday = (c.tradeToday || 0) + amount; }

  merchantArrive(m) {
    const a = this.cityById(m.home), b = this.partnerById(m.partner);
    if (!a || !b) return;
    if (m.dir === 'sell') {
      let earned = 0;
      for (const x of m.cargo) {
        const p = this.price(b, x.key, x.qty / 2);
        earned += p * x.qty * (1 - m.tariff);
        if (!b.foreign) { this.addGood(b, x.key, x.qty); b.money -= p * x.qty; }
      }
      a.money += earned;
      this.trackTrade(a, earned);
      m.earned = Math.round(earned);
      if (a.player && !m.auto) this.log(`Händler hat in ${b.name} Waren für ${Math.round(earned)} Gold verkauft.`, 'good');
    }
  }
  merchantHome(m) {
    const a = this.cityById(m.home);
    if (!a) return;
    if (m.dir === 'buy') {
      for (const x of m.cargo) this.addGood(a, x.key, x.qty);
      if (a.player && !m.auto) this.log(`Händler ist zurück: ${m.cargo.map(x => `${x.qty} ${keyName(x.key)}`).join(', ')}.`, 'good');
    }
  }

  // Automatischer Handel (Spieler): Grenzwerte je Ware
  autoTrade(c) {
    if (!this.hasMarket(c)) return;
    const partners = this.state.cities.filter(o => o !== c && this.hasMarket(o)).concat(this.hasHarbor(c) ? this.foreignCities() : []);
    for (const [key, at] of Object.entries(c.autoTrade)) {
      if (!at) continue;
      const stock = c.stock[key] || 0;
      if (at.min != null && stock < at.min) {
        const need = at.min - stock;
        let best = null;
        for (const o of partners) for (const mode of this.modesBetween(c, o)) {
          if (this.tradersFree(c, mode) <= 0) continue;
          const qty = Math.min(TRANSPORT[mode].cap, Math.max(need, 5), this.available(o, key));
          if (qty < 1) continue;
          const q = this.quote(c, o, mode, [{ key, qty }], 'buy');
          if (!q.ok) continue;
          const unit = -q.net / qty;
          if (!best || unit < best.unit) best = { o, mode, qty, unit };
        }
        if (best && (at.maxPrice == null || best.unit <= at.maxPrice)) this.dispatch(c, best.o, best.mode, [{ key, qty: best.qty }], 'buy', { auto: true });
      } else if (at.max != null && stock > at.max + 4) {
        const surplus = stock - at.max;
        let best = null;
        for (const o of partners) for (const mode of this.modesBetween(c, o)) {
          if (this.tradersFree(c, mode) <= 0) continue;
          const qty = Math.min(TRANSPORT[mode].cap, surplus);
          const q = this.quote(c, o, mode, [{ key, qty }], 'sell');
          if (!q.ok) continue;
          const unit = q.net / qty;
          if (!best || unit > best.unit) best = { o, mode, qty, unit };
        }
        if (best && best.unit > (at.minPrice ?? 0)) this.dispatch(c, best.o, best.mode, [{ key, qty: best.qty }], 'sell', { auto: true });
      }
    }
    // Feste Handelsrouten
    for (const r of c.routes) {
      if (!r.active) continue;
      const day = Math.floor(this.state.hour / 24);
      if (r.lastDay != null && day - r.lastDay < r.every) continue;
      const o = this.partnerById(r.partner); if (!o) continue;
      if (this.tradersFree(c, r.mode) <= 0) continue;
      const res = this.dispatch(c, o, r.mode, r.cargo, r.dir, { auto: true });
      r.lastDay = day;
      r.lastResult = res.ok ? 'ok' : res.reason;
    }
  }

  // ------------------------------------------------------------ Bevölkerung
  updatePop(c) {
    let pop = 0;
    for (const b of c.buildings) if (b.done && (BUILDINGS[b.type].house || b.type === 'zentrum')) pop += b.residents;
    c.pop = pop;
    return pop;
  }
  houseCap(b) { if (b.type === 'zentrum') return 6; const h = BUILDINGS[b.type].house; return h ? h.cap : 0; }
  houseTier(b) { if (b.type === 'zentrum') return 1; return BUILDINGS[b.type].house?.tier || 0; }

  // ------------------------------------------------------------ Zeit
  advance(realSeconds) {
    const st = this.state;
    const sp = SPEEDS[st.speed] || 0;
    st.playTime += realSeconds;
    if (!sp) return;
    if (st.playerId < 0) return;     // Uhr steht, bis die eigene Stadt gegründet ist
    let hours = sp * realSeconds;
    this._frac = (this._frac || 0) + hours;
    let steps = Math.floor(this._frac);
    if (steps > 200) steps = 200;  // Schutz bei Tab-Wechsel
    this._frac -= Math.floor(this._frac);
    for (let i = 0; i < steps; i++) this.hourStep();
  }
  get subHour() { return this._frac || 0; }

  hourStep() {
    const st = this.state;
    st.hour++;
    // Bau
    for (const c of st.cities) {
      for (const b of c.buildings) {
        if (b.done) continue;
        b.progress += 1 * (c.player ? 1 : c.mult);
        if (b.progress >= BUILDINGS[b.type].time) {
          b.done = true;
          if (BUILDINGS[b.type].house) b.residents = Math.min(2, this.houseCap(b));
          if (b.type === 'bruecke') { this.pf.bridgeTiles[this.map.grid.at(b.x, b.y)] = 1; this.pf.invalidate(); }
          if (c.player) this.log(`${BUILDINGS[b.type].name} fertiggestellt.`, 'build');
          this.emit('changed', { city: c });
        }
      }
    }
    // Händler
    for (const m of st.merchants) {
      m.t += 1;
      if (!m.arrived && m.t >= m.hours) { m.arrived = true; this.merchantArrive(m); }
      if (m.t >= m.hours * 2) { m.finished = true; this.merchantHome(m); }
    }
    st.merchants = st.merchants.filter(m => !m.finished);
    this.processAiQueue();
    if (st.hour % 24 === 0) this.dayStep();
  }

  dayStep() {
    const st = this.state;
    for (const c of st.cities) this.cityDay(c);
    for (const c of st.cities) {
      if (c.player) this.autoTrade(c);
      else { aiDaily(this, c); aiTrade(this, c); }
    }
    // Beziehungen gleiten langsam Richtung 0
    for (const r of Object.values(st.relations)) r.rel *= 0.997;
    // Monatsstatistik
    const d = gameDate(st.hour);
    const mk = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (mk !== st.lastMonth) {
      st.lastMonth = mk;
      const p = this.player;
      if (p) {
        st.history.monthly.push({ h: st.hour, pop: p.pop, money: Math.round(p.money), b: p.buildings.length, inc: Math.round(p.income), exp: Math.round(p.expense) });
        if (st.history.monthly.length > 360) st.history.monthly.shift();
      }
      if (d.getUTCMonth() === 0) {
        st.history.yearly.push({ y: d.getUTCFullYear(), c: st.cities.map(c => [c.id, c.pop, Math.round(c.money), c.buildings.length, Math.round(c.prestige)]) });
      }
      if (!st.endShown && d.getUTCFullYear() >= END_YEAR) { st.endShown = true; this.emit('end'); }
    }
    this.emit('day');
  }

  cityDay(c) {
    const st = this.state;
    const flow = {};
    const P = (k, v) => { (flow[k] ||= { p: 0, u: 0 }).p += v; };
    const U = (k, v) => { (flow[k] ||= { p: 0, u: 0 }).u += v; };
    const done = c.buildings.filter(b => b.done);
    this.updatePop(c);
    const pop = c.pop;
    const workforce = Math.ceil(pop * 0.7);
    c.workforce = workforce;
    // Arbeiter verteilen: Nahrung zuerst
    const jobs = done.filter(b => BUILDINGS[b.type].workers > 0 && !b.paused);
    jobs.sort((a, b) => (BUILDINGS[a.type].cat === 'nahrung' ? 0 : 1) - (BUILDINGS[b.type].cat === 'nahrung' ? 0 : 1));
    let free = workforce, jobTotal = 0;
    for (const b of done) if (b.paused) b.workers = 0;
    for (const b of jobs) { const need = BUILDINGS[b.type].workers; jobTotal += need; const a = Math.min(need, free); b.workers = a; free -= a; }
    c.jobs = jobTotal; c.unemployed = Math.max(0, free);
    // Straßennähe
    const nearRoad = b => c.roads.some(r => segDist(b.x, b.y, r.x1, r.y1, r.x2, r.y2) <= ROAD.bonusDist + Math.max(b.w, b.h) / 2);
    // Produktion
    for (const b of jobs) {
      const d = BUILDINGS[b.type];
      if (!d.recipes) { b.eff = b.workers / d.workers; continue; }
      let recipe;
      if (d.recipes === 'deposit') recipe = { in: {}, out: { [b.out]: b.out === 'golderz' ? 1.5 : b.out === 'edelsteine' ? 0.8 : 5 } };
      else recipe = d.recipes[b.recipe] || d.recipes[0];
      const prov = this.map.prov[this.map.grid.at(b.x, b.y)];
      const pm = prov >= 0 && d.mod ? (this.map.provinces[prov].mods[d.mod] || 1) : 1;
      const road = nearRoad(b) ? 1 + ROAD.prod : 1;
      let eff = (b.workers / d.workers) * b.loc * pm * road * this.techBonus(c, b) * (c.player ? 1 : c.mult);
      const qual = d.quality ? QUALITY[b.quality] : QUALITY[0];
      // Eingangswaren begrenzen
      let scale = 1;
      for (const [k, v] of Object.entries(recipe.in)) {
        const need = v * eff * qual.input;
        if (need > 0) scale = Math.min(scale, this.stockOf(c, k) / need);
      }
      const inputScale = clamp(scale, 0, 1);
      // Lager voll?
      const cap = this.storageCap(c);
      b.full = false;
      for (const k of Object.keys(recipe.out)) { const key = goodKey(k, d.quality ? b.quality : 0); if ((c.stock[key] || 0) >= cap) { scale = 0; b.full = true; } }
      scale = clamp(scale, 0, 1);
      for (const [k, v] of Object.entries(recipe.in)) { const amt = v * eff * qual.input * scale; this.takeGood(c, k, amt); U(k, amt); }
      for (const [k, v] of Object.entries(recipe.out)) { const key = goodKey(k, d.quality ? b.quality : 0); const amt = this.addGood(c, key, v * eff * scale); P(key, amt); }
      b.eff = eff * scale;
      b.inputShort = inputScale < 0.99;
    }
    // Bedürfnisse
    const tierPop = [0, 0, 0, 0, 0];
    for (const b of done) { const T = this.houseTier(b); if (T) for (let t = 1; t <= T; t++) tierPop[t] += b.residents; }
    const sat = [1, 1, 1, 1, 1];
    for (const need of NEEDS) {
      const tp = tierPop[need.tier];
      if (tp <= 0) { sat[need.tier] = this.previewSat(c, need); continue; }
      let s = 0;
      for (const it of need.items) {
        const demand = tp / 100 * it.amount;
        if (it.group === 'nahrung') {
          let total = 0; for (const g of FOOD_GOODS) total += (c.stock[g] || 0) * GOODS[g].food;
          const ratio = total > 0 ? Math.min(1, demand / total) : 0;
          for (const g of FOOD_GOODS) { const amt = (c.stock[g] || 0) * ratio; c.stock[g] = (c.stock[g] || 0) - amt; U(g, amt); }
          s += Math.min(1, total / demand);
        } else if (GOODS[it.good].q) {
          let left = demand, value = 0;
          for (const q of [2, 1, 0]) {
            const k = `${it.good}#${q}`; const t = Math.min(left, c.stock[k] || 0);
            c.stock[k] = (c.stock[k] || 0) - t; U(k, t); left -= t; value += t * QUALITY[q].sat;
          }
          s += Math.min(1.25, value / demand);
        } else {
          const t = Math.min(demand, c.stock[it.good] || 0);
          c.stock[it.good] = (c.stock[it.good] || 0) - t; U(it.good, t);
          s += t / demand;
        }
      }
      sat[need.tier] = s / need.items.length;
    }
    c.sat = sat;
    // Reinheit, Prestige, Zufriedenheit
    let clean = 0, prestige = 0, happyB = 0, knowledge = 1.2, taxB = 0;
    for (const b of done) {
      const d = BUILDINGS[b.type];
      const staffed = d.workers ? b.workers / d.workers : 1;
      clean += (d.clean || 0) * staffed; prestige += d.prestige || 0; happyB += (d.happy || 0) * staffed;
      knowledge += (d.knowledge || 0) * staffed; taxB += d.tax || 0;
    }
    const roadLen = c.roads.reduce((s, r) => s + Math.hypot(r.x2 - r.x1, r.y2 - r.y1), 0);
    prestige += roadLen / 100 * ROAD.prestigePer100; clean += roadLen / 100 * ROAD.cleanPer100;
    prestige += pop / 50;
    c.prestige = prestige; c.clean = clean;
    const cleanBonus = Math.min(0.1, clean / (pop / 100 + 1) * 0.02);
    const happyBonus = Math.min(0.2, happyB) + cleanBonus + Math.min(0.06, prestige * 0.0015) - (c.taxRate - 0.1) * 1.6 - (c.money < 0 ? 0.15 : 0);
    const foodTypes = FOOD_GOODS.filter(g => (c.stock[g] || 0) > 1).length;
    const variety = foodTypes >= 3 ? 0.04 : 0;
    const happy = [1, 0, 0, 0, 0];
    for (let T = 1; T <= 4; T++) {
      const arr = sat.slice(1, T + 1).map(x => Math.min(1, x));
      const h = 0.6 * Math.min(...arr) + 0.4 * arr.reduce((s, x) => s + x, 0) / arr.length;
      happy[T] = clamp(h + happyBonus + variety, 0, 1);
    }
    c.happy = happy;
    // Wachstum (keine Geburten: Zuzug/Wegzug je nach Zufriedenheit und Platz)
    const growMod = (this.map.provinces[this.map.prov[c.tile]]?.mods.wachstum || 1) * (1 + Math.min(0.3, prestige * 0.003));
    // Zuzug nur, wenn es Arbeit gibt (oder die Stadt noch sehr klein ist)
    let openJobs = Math.max(0, jobTotal - workforce) / 0.7 + Math.max(4, pop * 0.08) - (c.unemployed || 0);
    for (const b of done) {
      const cap = this.houseCap(b); if (!cap) continue;
      const h = happy[this.houseTier(b)];
      if (b.residents < cap && h >= 0.5 && openJobs > 0 && this.rng.float() < (h > 0.8 ? 0.9 : 0.55) * growMod) { const add = Math.min(cap - b.residents, h > 0.85 ? 2 : 1); b.residents += add; openJobs -= add; }
      else if (h < 0.3 && b.residents > (b.type === 'zentrum' ? 4 : 0) && this.rng.float() < 0.5) b.residents--;
    }
    this.updatePop(c);
    // Geld
    let tax = 0;
    for (const b of done) { const T = this.houseTier(b); if (T) tax += b.residents * TAX_BASE * TIER_TAX[T] * (c.taxRate / 0.1) * (0.6 + 0.4 * happy[T]); }
    tax *= 1 + taxB;
    let upkeep = 0;
    for (const b of c.buildings) upkeep += (BUILDINGS[b.type].upkeep || 0) * UPKEEP_MULT;
    upkeep += c.roads.length * 0.02;
    // Umlandmarkt: Bauern aus der Umgebung kaufen Überschüsse zu niedrigen Preisen
    let local = 0;
    if (this.hasMarket(c)) {
      let n = 0;
      const entries = Object.entries(c.stock).sort((a, b) => b[1] - a[1]);
      for (const [key, v] of entries) {
        if (n >= LOCAL_SALE.goods || (!c.player && c.money > 3000)) break;
        let surplus;
        if (c.player) { const at = c.autoTrade[key]; if (!at || at.max == null || !at.local) continue; surplus = v - at.max; }
        else surplus = v - Math.max(60, this.reserveOf(c, key) * 3);
        if (surplus <= 1) continue;
        const amt = Math.min(LOCAL_SALE.perDay, surplus);
        c.stock[key] -= amt; local += amt * keyBasePrice(key) * LOCAL_SALE.price; n++;
      }
    }
    c.lastLocal = local;
    tax += local;
    c.money += tax - upkeep;
    c.income = tax + Math.max(0, c.tradeToday || 0); c.expense = upkeep + Math.max(0, -(c.tradeToday || 0));
    c.lastTax = tax; c.lastUpkeep = upkeep; c.lastTrade = c.tradeToday || 0; c.tradeToday = 0;
    // Forschung
    let kp = knowledge + pop / 200;
    if (this.techDone(c, 'aufklaerung')) kp *= 1.1;
    c.knowledge = kp;
    const r = c.research;
    if (r.current && !this.techAvailable(c, r.current)) r.current = null;
    if (r.current) {
      r.points += kp * (c.player ? 1 : c.mult);
      const t = TECHS[r.current];
      if (r.points >= t.cost) {
        r.points -= t.cost; r.done.push(r.current);
        if (c.player) { this.log(`Forschung abgeschlossen: ${t.name}.`, 'research'); this.updateRoadFactor(); if (r.current === 'kanalbau') this.pf.invalidate(); }
        const before = this.cityEra(c) ;
        r.current = c.player && r.queue && r.queue.length ? r.queue.shift() : null;
        if (c.player) this.emit('research', { tech: t });
        if (c.player && before > (c._era || 1)) this.log(`Neues Zeitalter: ${ERAS[before - 1].name}!`, 'research');
        c._era = before;
      }
    } else r.points += kp * 0.5;   // ungenutztes Wissen wird zur Hälfte gesammelt
    // Mittelwerte für Markt und KI
    for (const k of new Set([...Object.keys(flow), ...Object.keys(c.avg)])) {
      const f = flow[k] || { p: 0, u: 0 };
      const a = c.avg[k] || { p: f.p, u: f.u };
      a.p = a.p * 0.8 + f.p * 0.2; a.u = a.u * 0.8 + f.u * 0.2;
      if (a.p < 0.01 && a.u < 0.01 && !(c.stock[k] > 0)) delete c.avg[k]; else c.avg[k] = a;
    }
    c.flow = flow;
    // Lagerreste aufräumen
    for (const k of Object.keys(c.stock)) if (c.stock[k] < 0.001) c.stock[k] = 0;
  }

  // Zufriedenheit für eine Stufe ohne Bewohner (Vorschau für Wohnbedarf)
  previewSat(c, need) {
    let s = 0;
    for (const it of need.items) {
      const have = it.group === 'nahrung' ? FOOD_GOODS.reduce((t, g) => t + (c.stock[g] || 0), 0) : this.stockOf(c, it.good);
      s += Math.min(1, have / (it.amount * 2));
    }
    return s / need.items.length;
  }

  // Wohnbedarf je Haustyp (für Anzeige)
  housingDemand(c) {
    const out = [];
    const freeJobs = Math.max(0, c.jobs - c.workforce);
    for (const type of ['haus1', 'haus2', 'haus3', 'haus4']) {
      const d = BUILDINGS[type]; const T = d.house.tier;
      const houses = c.buildings.filter(b => b.done && (b.type === type || (T === 1 && b.type === 'zentrum')));
      const cap = houses.reduce((s, b) => s + this.houseCap(b), 0);
      const res = houses.reduce((s, b) => s + b.residents, 0);
      const fill = cap ? res / cap : 1;
      const h = c.happy[T] ?? 0;
      let level = 0;
      if (h >= 0.5 && fill >= 0.8) level = 1;
      if (h >= 0.7 && (fill >= 0.9 || freeJobs > 5)) level = 2;
      if (h >= 0.85 && fill >= 0.95 && freeJobs > 10) level = 3;
      out.push({ type, tier: T, level, fill, happy: h, unlocked: this.isUnlocked(c, type) });
    }
    return { list: out, freeJobs };
  }

  // Vorschau-Zahlen einer Provinz für die Standortwahl
  provinceStats(pid) {
    const pr = this.map.provinces[pid];
    return pr;
  }
}
