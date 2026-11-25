// Wegfindung für Händler: zu Fuß/Karren über Land, Boote über Meer und Flüsse
import { MinHeap } from './util.js';
import { B, MOVE_COST, RIVER_CROSS, FORD_CROSS, BOAT_HOURS } from './data.js';

export class Pathfinder {
  constructor(map) {
    this.map = map;
    this.cache = new Map();
    this.version = 0;
    this.roadTiles = new Uint8Array(map.grid.n);
    this.bridgeTiles = new Uint8Array(map.grid.n);
    this.roadFactor = 0.6;
  }
  invalidate() { this.cache.clear(); this.version++; }

  landCost(from, to) {
    const m = this.map, b = m.biome[to];
    if (b === B.meer || b === B.gebirge) return Infinity;
    let c = MOVE_COST[b] ?? 0.4;
    if (this.roadTiles[to] && this.roadTiles[from]) c *= this.roadFactor;
    if (m.river[to] >= 0 && m.river[from] < 0) {
      c += this.bridgeTiles[to] ? 0.05 : m.ford[to] ? FORD_CROSS : RIVER_CROSS;
    }
    return c;
  }
  isBoatNode(i) { return this.map.biome[i] === B.meer || this.map.river[i] >= 0; }
  boatCost(from, to) {
    if (!this.isBoatNode(to)) return Infinity;
    const m = this.map;
    // flussaufwärts etwas langsamer
    if (m.river[to] >= 0 && m.river[from] >= 0 && m.elev[to] > m.elev[from]) return BOAT_HOURS * 1.4;
    return BOAT_HOURS;
  }

  // A* zwischen Kacheln; liefert {tiles, hours} oder null
  find(start, goal, mode) {
    const key = `${start}-${goal}-${mode}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const g = this.map.grid;
    const boat = mode === 'boot';
    const costFn = boat ? (a, b) => this.boatCost(a, b) : (a, b) => this.landCost(a, b);
    const minStep = boat ? BOAT_HOURS : 0.25 * this.roadFactor;
    const dist = new Map();
    const prev = new Map();
    const heap = new MinHeap();
    dist.set(start, 0);
    heap.push(g.dist(start, goal) * minStep, start);
    const nb = [];
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < 200000) {
      const c = heap.pop();
      if (c === goal) { found = true; break; }
      const dc = dist.get(c);
      for (const n of g.neighbors(c, nb)) {
        const step = costFn(c, n);
        if (step === Infinity) continue;
        const nd = dc + step;
        if (nd < (dist.get(n) ?? Infinity)) {
          dist.set(n, nd); prev.set(n, c);
          heap.push(nd + g.dist(n, goal) * minStep, n);
        }
      }
    }
    let res = null;
    if (found) {
      const tiles = [];
      for (let c = goal; c !== undefined; c = prev.get(c)) tiles.push(c);
      tiles.reverse();
      res = { tiles, hours: dist.get(goal) };
    }
    if (this.cache.size > 3000) this.cache.clear();
    this.cache.set(key, res);
    return res;
  }

  // Nächste Bootskachel zu einem Weltpunkt (für Häfen)
  nearestBoatNode(x, y, maxTiles = 2) {
    const g = this.map.grid;
    const t = g.at(x, y);
    if (t < 0) return -1;
    let best = -1, bd = Infinity;
    const seen = new Set([t]); let frontier = [t];
    for (let d = 0; d <= maxTiles; d++) {
      const next = [];
      for (const c of frontier) {
        if (this.isBoatNode(c)) { const dd = (g.cx(c) - x) ** 2 + (g.cy(c) - y) ** 2; if (dd < bd) { bd = dd; best = c; } }
        for (const n of g.neighbors(c, [])) if (!seen.has(n)) { seen.add(n); next.push(n); }
      }
      if (best >= 0) return best;
      frontier = next;
    }
    return best;
  }

  // Nächste Meerkachel am Kartenrand (Ausfahrt zum Fernhandel), per Bootsweg
  findEdgeExit(start) {
    const key = `edge-${start}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const g = this.map.grid;
    const dist = new Map([[start, 0]]), prev = new Map();
    const heap = new MinHeap(); heap.push(0, start);
    const nb = [];
    let end = -1;
    while (heap.size) {
      const c = heap.pop();
      const q = g.q(c), r = g.r(c);
      if (this.map.biome[c] === B.meer && (q === 0 || r === 0 || q === g.w - 1 || r === g.h - 1)) { end = c; break; }
      for (const n of g.neighbors(c, nb)) {
        const s = this.boatCost(c, n); if (s === Infinity) continue;
        const nd = dist.get(c) + s;
        if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, c); heap.push(nd, n); }
      }
    }
    let res = null;
    if (end >= 0) {
      const tiles = []; for (let c = end; c !== undefined; c = prev.get(c)) tiles.push(c);
      tiles.reverse(); res = { tiles, hours: dist.get(end) };
    }
    this.cache.set(key, res);
    return res;
  }
}
