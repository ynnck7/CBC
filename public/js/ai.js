// KI der Nachbarstädte: Standortwahl, Bauen, Forschen, Expandieren, Handeln
import { HEX_W, HEX_R } from './util.js';
import { BUILDINGS, TECHS, TECH_IDS, NEEDS, FOOD_GOODS, GOODS, TRANSPORT, DEP } from './data.js';

// ------------------------------------------------------------ Gründung
export function aiPickFoundingProvince(game) {
  const st = game.state, m = game.map, g = m.grid;
  let best = -1, bs = -Infinity;
  for (const pr of m.provinces) {
    if (st.provOwner[pr.id] !== -1 || pr.size < 12) continue;
    if (pr.neighbors.some(n => st.provOwner[n] !== -1)) continue; // nie direkt an eine bestehende Stadt
    let dNear = 99, dPlayer = 99;
    for (const c of st.cities) {
      const d = g.dist(pr.center, c.tile);
      if (c.player) dPlayer = Math.min(dPlayer, d); else dNear = Math.min(dNear, d);
    }
    let s = pr.score + Math.min(dNear, 24) / 24 * 1.6 + game.rng.float() * 0.35;
    if (dNear < 11) s -= 4;
    if (dPlayer < 14) s -= 4;
    if (s > bs) { bs = s; best = pr.id; }
  }
  return best;
}

// ------------------------------------------------------------ Hilfen
const count = (c, type) => c.buildings.filter(b => b.type === type).length;
const net = (c, k) => (c.avg[k]?.p || 0) - (c.avg[k]?.u || 0);

function producersOf(game, c, good) {
  const out = [];
  for (const [type, d] of Object.entries(BUILDINGS)) {
    if (!d.recipes || !game.isUnlocked(c, type)) continue;
    if (d.recipes === 'deposit') { if (['eisenerz', 'kupfererz', 'zinnerz', 'kohle', 'golderz', 'edelsteine'].includes(good)) out.push({ type, dep: Object.keys(DEP).find(k => ({ eisen: 'eisenerz', kupfer: 'kupfererz', zinn: 'zinnerz', kohle: 'kohle', gold: 'golderz', edelstein: 'edelsteine' })[k] === good) }); continue; }
    d.recipes.forEach((r, i) => { if (r.out[good]) out.push({ type, recipe: i }); });
  }
  // Großbetriebe bevorzugen, wenn freigeschaltet
  out.sort((a, b) => (BUILDINGS[b.type].era || 1) - (BUILDINGS[a.type].era || 1));
  return out;
}

function findSpot(game, c, type, opts = {}) {
  const d = BUILDINGS[type];
  const g = game.map.grid;
  const cost = game.costOf(c, type);
  if (!game.canAfford(c, cost)) return null;
  const central = d.house || ['stadt', 'handel'].includes(d.cat) && type !== 'hafen';
  const tiles = [];
  for (const pid of c.provinces) for (const t of game.map.provinces[pid].tiles) tiles.push(t);
  let best = null, bs = -Infinity;
  const nb = c.buildings.length;
  const R = 18 + Math.sqrt(nb) * 9;
  const tries = central ? 45 : 60;
  for (let k = 0; k < tries; k++) {
    let x, y;
    if (central && k < 50) {
      const a = game.rng.float() * Math.PI * 2, r = 8 + game.rng.float() * R;
      x = c.x + Math.cos(a) * r; y = c.y + Math.sin(a) * r;
    } else {
      const t = tiles[Math.floor(game.rng.float() * tiles.length)];
      const a = game.rng.float() * Math.PI * 2, r = game.rng.float() * HEX_R * 0.85;
      x = g.cx(t) + Math.cos(a) * r; y = g.cy(t) + Math.sin(a) * r;
    }
    const chk = game.canPlace(c, type, x, y);
    if (!chk.ok) continue;
    if (opts.dep && chk.loc.dep !== opts.dep) continue;
    const dist = Math.hypot(x - c.x, y - c.y);
    const s = central ? -dist / 10 + game.rng.float() * 0.5 : chk.loc.f * 3 - dist / 60;
    if (s > bs) { bs = s; best = { x, y, loc: chk.loc }; }
  }
  if (!central && best && best.loc.f < 0.45) best.weak = true;
  return best;
}

function tryBuild(game, c, type, opts = {}) {
  if (!game.isUnlocked(c, type)) return false;
  if (BUILDINGS[type].unique && count(c, type)) return false;
  const spot = findSpot(game, c, type, opts);
  if (!spot || spot.weak) {
    // Kein guter Platz: passende Nachbarprovinz beanspruchen
    if (aiExpand(game, c, type, opts)) return 'expanded';
    if (!spot) return false;
  }
  const r = game.place(c, type, spot.x, spot.y);
  if (r.ok && opts.recipe != null) r.building.recipe = opts.recipe;
  if (r.ok && BUILDINGS[type].quality) r.building.quality = c.pop > 300 ? 1 : 0;
  return r.ok;
}

function aiExpand(game, c, type, opts = {}) {
  const st = game.state;
  const cand = new Set();
  for (const pid of c.provinces) for (const n of game.map.provinces[pid].neighbors) if (st.provOwner[n] === -1) cand.add(n);
  if (!cand.size) return false;
  const d = type ? BUILDINGS[type] : null;
  let best = -1, bs = -Infinity;
  for (const pid of cand) {
    const pr = game.map.provinces[pid];
    let s = pr.score;
    if (d?.loc === 'trees') s += pr.trees * 2;
    if (d?.loc === 'fert') s += pr.fert * 2;
    if (d?.loc === 'water') s += pr.coast || pr.river ? 2 : -3;
    if (d?.loc?.startsWith('deposit:')) {
      const keys = opts.dep ? [opts.dep] : d.loc.slice(8).split(',');
      s += keys.some(k => pr.deposits[k]) ? 3 : -2;
    }
    if (s > bs) { bs = s; best = pid; }
  }
  if (best < 0 || !game.canClaim(c, best).ok) return false;
  game.claim(c, best);
  return true;
}

function pickHouse(game, c) {
  let type = 'haus1';
  for (const [t, T] of [['haus2', 2], ['haus3', 3], ['haus4', 4]]) {
    if (!game.isUnlocked(c, t)) continue;
    const n = count(c, t);
    if (n < 2 || (c.sat[T] ?? 0) >= 0.55) type = t;
  }
  // Mischung: nicht nur die höchste Stufe
  if (type !== 'haus1' && game.rng.float() < 0.25) type = 'haus1';
  return type;
}

// ------------------------------------------------------------ Tagesablauf
export function aiDaily(game, c) {
  // Forschung wählen
  if (!c.research.current) {
    const av = TECH_IDS.filter(t => game.techAvailable(c, t)).sort((a, b) => TECHS[a].cost - TECHS[b].cost);
    if (av.length) c.research.current = av[Math.floor(game.rng.float() * Math.min(3, av.length))];
  }
  // Steuern anpassen
  c.taxRate = c.money < 60 ? 0.14 : c.money > 1500 ? 0.08 : 0.1;
  const under = c.buildings.filter(b => !b.done).length;
  const maxUnder = 1 + Math.min(3, Math.floor(c.pop / 90));
  if (under >= maxUnder || c.money < 15) return;
  if (c.buildings.length >= 101) { aiRenew(game, c); return; }

  const pop = c.pop;
  const plan = [];
  const add = (type, opts) => plan.push([type, opts || {}]);
  const stock = k => game.stockOf(c, k);
  const done = c.buildings.filter(b => b.done);

  // Holz zuerst – ohne Holz geht nichts
  if (stock('holz') < 30 && net(c, 'holz') < 1.5) add('holzfaeller');
  // Wohnraum
  let cap = 0;
  for (const b of c.buildings) cap += game.houseCap(b);
  const freeSpace = cap - pop;
  if (freeSpace < 4 + pop * 0.06 && c.happy[1] >= 0.45 && (c.unemployed || 0) < 3 + pop * 0.05) add(pickHouse(game, c));
  // Nahrung
  const foodStock = FOOD_GOODS.reduce((s, g) => s + stock(g), 0);
  const foodNet = FOOD_GOODS.reduce((s, g) => s + net(c, g), 0);
  if (foodNet < 1 + pop * 0.01 || foodStock < pop * 0.4) {
    const opts = ['fischer', 'jaeger', 'sammler'];
    if (game.isUnlocked(c, 'bauernhof') && count(c, 'bauernhof') < 1 + pop / 120) opts.unshift(count(c, 'muehle') && count(c, 'baeckerei') ? 'bauernhof' : 'sammler');
    if (count(c, 'bauernhof') >= 1 && game.isUnlocked(c, 'muehle') && !count(c, 'muehle')) opts.unshift('muehle');
    if (count(c, 'muehle') >= 1 && !count(c, 'baeckerei')) opts.unshift('baeckerei');
    for (const o of opts) add(o);
  }
  if (count(c, 'muehle') && count(c, 'bauernhof') < 2 * count(c, 'muehle')) add('bauernhof');
  // Holz und Stein
  if (stock('holz') < 50 || net(c, 'holz') < 2) add('holzfaeller');
  if (!count(c, 'marktplatz') && done.length >= 4) add('marktplatz');
  if (stock('stein') < 40 && count(c, 'steinbruch') < 1 + pop / 200) add('steinbruch');
  if (game.isUnlocked(c, 'schreiner') && (stock('bretter') < 40 || net(c, 'bretter') < 1) && count(c, 'schreiner') < 1 + pop / 250) add('schreiner');
  if (game.isUnlocked(c, 'steinmetz') && (stock('werkstein') < 30 || net(c, 'werkstein') < 0.5) && count(c, 'steinmetz') < 1 + pop / 300) add('steinmetz');
  // Wissen
  const kb = done.filter(b => BUILDINGS[b.type].knowledge).length;
  if (kb < 1 + pop / 160) for (const t of ['universitaet', 'bibliothek', 'schule', 'kapelle']) if (game.isUnlocked(c, t) && !(BUILDINGS[t].unique && count(c, t))) { add(t); break; }
  // Bedarf nach Gütern höherer Stufen
  const tiersInUse = new Set(c.buildings.map(b => game.houseTier(b)).filter(Boolean));
  for (const need of NEEDS) {
    if (need.tier === 1) continue;
    if (!tiersInUse.has(need.tier) && !(need.tier === 2 && game.isUnlocked(c, 'haus2'))) continue;
    for (const it of need.items) {
      if (it.group) continue;
      if (stock(it.good) > 60 || net(c, it.good) > 0.3) continue;
      for (const p of producersOf(game, c, it.good)) add(p.type, p);
    }
  }
  // Eingangswaren, die fehlen
  for (const b of done) {
    if (!b.inputShort) continue;
    const d = BUILDINGS[b.type];
    if (!Array.isArray(d.recipes)) continue;
    const r = d.recipes[b.recipe] || d.recipes[0];
    for (const k of Object.keys(r.in)) if (stock(k) < 20) for (const p of producersOf(game, c, k)) add(p.type, p);
  }
  // Baustoffe späterer Zeitalter
  if (game.isUnlocked(c, 'ziegelei') && stock('ziegel') < 30 && count(c, 'ziegelei') < 1 + pop / 300) { add('ziegelei'); if (stock('lehm') < 20) add('lehmgrube'); }
  if (game.isUnlocked(c, 'glashuette') && stock('glas') < 15 && game.isUnlocked(c, 'haus3') && !count(c, 'glashuette')) { add('glashuette'); add('sandgrube'); }
  // Öffentliche Gebäude & Handel
  if (count(c, 'brunnen') < pop / 90) add('brunnen');
  if (pop > 150 && count(c, 'badehaus') < pop / 350) add('badehaus');
  if (pop > 130) add('rathaus');
  if (pop > 260 && count(c, 'park') < pop / 400) add('park');
  if (pop > 500) add('dom');
  if (pop > 160 && count(c, 'fuhrhof') < 1 + pop / 500) add('fuhrhof');
  if (pop > 110 && !count(c, 'hafen')) add('hafen');
  if (pop > 200 && count(c, 'lager') < pop / 300) add('lager');
  // Exportgüter in späteren Zeitaltern
  if (pop > 250) for (const t of ['moebel', 'waffenschmiede', 'goldschmied', 'wagnerei', 'werkzeugmanufaktur', 'textilmanufaktur', 'dampfsaege', 'eisenwerk', 'moebelfabrik']) if (game.isUnlocked(c, t) && count(c, t) < 1 + Math.floor(pop / 600)) add(t);

  // Erste umsetzbare Aktion ausführen (bei viel Geld zwei)
  let actions = c.money > 600 ? 2 : 1;
  const tried = new Set();
  const pendingJobs = c.buildings.filter(b => !b.done).reduce((s, b) => s + (BUILDINGS[b.type].workers || 0), 0);
  let freeWorkers = (c.unemployed || 0) - pendingJobs;
  let wantHouse = false;
  let attempts = 0;
  for (const [type, opts] of plan) {
    const key = type + (opts.dep || '') + (opts.recipe ?? '');
    if (tried.has(key)) continue;
    tried.add(key);
    const d = BUILDINGS[type];
    if (c.buildings.some(b => !b.done && b.type === type)) continue;
    if (!d.house && count(c, type) >= 3 + pop / 60) continue;
    if (d.workers && freeWorkers < Math.ceil(d.workers * 0.6)) { wantHouse = true; continue; }
    if (++attempts > 4) break;
    const r = tryBuild(game, c, type, opts);
    if (r) { freeWorkers -= d.workers || 0; if (--actions <= 0) break; }
  }
  // Arbeitskräfte fehlen: Wohnraum schaffen
  if (actions > 0 && wantHouse && c.happy[1] >= 0.45 && !c.buildings.some(b => !b.done && BUILDINGS[b.type].house)) tryBuild(game, c, pickHouse(game, c));
  // Gelegentlich expandieren
  if (c.provinces.length < game.provinceLimit(c) && c.money > game.claimCost(c) * 3 && game.rng.float() < 0.04) aiExpand(game, c);
}

// ------------------------------------------------------------ Handel der KI
export function aiTrade(game, c) {
  if (!game.hasMarket(c) || game.rng.float() > 0.6) return;
  const st = game.state;
  const wants = [];
  for (const [k, a] of Object.entries(c.avg)) {
    const s = c.stock[k] || 0;
    if (a.u > 0.2 && s < a.u * 3 + 5) wants.push([k, Math.ceil(a.u * 6 + 10 - s)]);
  }
  for (const k of ['holz', 'stein', 'bretter', 'werkstein']) if ((c.stock[k] || 0) < 20) wants.push([k, 25]);
  if (!wants.length) return;
  const [key, need] = wants[Math.floor(game.rng.float() * wants.length)];
  let best = null;
  for (const o of st.cities) {
    if (o === c || !game.hasMarket(o)) continue;
    const av = game.available(o, key);
    if (av < 3) continue;
    for (const mode of game.modesBetween(c, o)) {
      if (game.tradersFree(c, mode) <= 0) continue;
      const qty = Math.min(TRANSPORT[mode].cap, need, av);
      const q = game.quote(c, o, mode, [{ key, qty }], 'buy');
      if (!q.ok) continue;
      const unit = -q.net / qty;
      if (!best || unit < best.unit) best = { o, mode, qty, unit };
    }
  }
  if (best && c.money > -best.unit * best.qty + 30) {
    const r = game.dispatch(c, best.o, best.mode, [{ key, qty: best.qty }], 'buy', { auto: true });
    if (r.ok && best.o.player) game.log(`Händler aus ${c.name} kauft ${best.qty} ${GOODS[key.split('#')[0]].name} an deinem Markt (+${Math.round(r.quote.goodsValue)} Gold).`, 'trade');
  }
}

// Bei 100 Gebäuden: einfache Bauten durch bessere ersetzen
function aiRenew(game, c) {
  if (game.rng.float() > 0.15 || c.money < 400) return;
  if (c.buildings.some(b => !b.done)) return;
  const tiers = [['haus4', 4, 'haus3'], ['haus3', 3, 'haus2'], ['haus2', 2, 'haus1']];
  for (const [type, T, from] of tiers) {
    if (!game.isUnlocked(c, type) || (c.sat[T] ?? 0) < 0.6) continue;
    if (!game.canAfford(c, game.costOf(c, type))) continue;
    const old = c.buildings.filter(b => b.type === from);
    if (old.length < 3) continue;
    const victim = old[Math.floor(game.rng.float() * old.length)];
    const { x, y } = victim;
    game.demolish(c, victim);
    // möglichst an gleicher Stelle, sonst irgendwo
    const r = game.place(c, type, x, y);
    if (!r.ok) tryBuild(game, c, type);
    return;
  }
  // Schwache Rohstoffbetriebe ersetzen
  const weak = c.buildings.filter(b => b.done && (b.type === 'sammler' || b.type === 'jaeger') && b.eff < 0.4);
  if (weak.length && game.isUnlocked(c, 'bauernhof')) { game.demolish(c, weak[0]); tryBuild(game, c, 'bauernhof'); }
}
