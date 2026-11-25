// Bedienoberfläche im Spiel: Eingabe, Leisten, Fenster
import { Renderer } from './render.js';
import { SPEEDS, fmtDate } from './sim.js';
import { HEX_W, clamp, fmt, fmtShort } from './util.js';
import {
  BIOMES, B, DEPOSITS, GOODS, QUALITY, goodKey, parseKey, keyName, keyIcon, keyBasePrice, ALL_KEYS, NEEDS, FOOD_GOODS,
  BUILDINGS, CATEGORIES, TECHS, TECH_IDS, ERAS, ERA_THRESHOLD, TRANSPORT, MOD_NAMES, ROAD, END_YEAR,
} from './data.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => `${Math.round(x * 100)} %`;
const sign = x => (x >= 0 ? '+' : '') + fmt(x, Math.abs(x) < 10 ? 1 : 0);
const hoursText = h => (h < 48 ? `${Math.ceil(h)} Std.` : `${fmt(h / 24, 1)} Tage`);
const AUTOSAVE_MS = 5 * 60 * 1000;

export class GameUI {
  constructor(game, slot, hooks) {
    this.game = game; this.slot = slot; this.hooks = hooks;
    this.cv = $('#map');
    this.renderer = new Renderer(this.cv, game);
    this.tool = null; this.cat = 'wohnen'; this.win = null;
    this.dirty = false;
    this.bindInput();
    this.bindGameEvents();
    this.renderBuildbar(); this.renderTopbar(); this.renderLog();
    $('#infopanel').classList.add('hidden');
    $('#window').classList.add('hidden');
    document.querySelectorAll('#minimap-wrap [data-mode]').forEach(b => b.onclick = () => { this.renderer.mode = b.dataset.mode; this.updateModeButtons(); });
    this.updateModeButtons();
    const p = game.player;
    if (!p) {
      this.setTool({ kind: 'found' });
      this.renderer.cam.zoom = this.renderer.minZoom * 1.05;
      this.banner('Wähle eine Provinz für deine Stadt. Fahre über die Karte, um die Werte jeder Provinz zu sehen. Die Zeit läuft erst nach der Gründung.');
    } else {
      this.renderer.centerOn(p.x, p.y, 2.5);
    }
    this.last = performance.now();
    this.running = true;
    this.uiTick = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.autosave = setInterval(() => { if (this.game.player) this.save(true).then(() => this.hooks.toast('Automatisch gespeichert.')).catch(() => {}); }, AUTOSAVE_MS);
    this.onResize = () => this.renderer.resize();
    window.addEventListener('resize', this.onResize);
  }
  destroy() {
    this.running = false; clearInterval(this.autosave);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('keyup', this.onKey);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup', this._mu);
    $('#window').classList.add('hidden'); $('#infopanel').classList.add('hidden'); $('#banner').classList.add('hidden'); $('#tooltip').classList.add('hidden');
    this.cv.replaceWith(this.cv.cloneNode(true));
  }
  async save(silent) { await this.hooks.save(silent); this.dirty = false; }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.last) / 1000); this.last = now;
    if (!this.hooks.modalOpen) this.game.advance(dt);
    if (this.keys) this.keyPan(dt);
    this.renderer.draw(dt);
    this.uiTick += dt;
    if (this.uiTick > 0.25) {
      this.uiTick = 0;
      this.renderTopbar();
      this.renderer.drawMini($('#minimap'));
      if (this.selectedBuilding) this.showBuilding(this.selectedBuilding, true);
      this.liveTick = (this.liveTick || 0) + 1;
      if (this.win && this.win.live && this.liveTick % 4 === 0) this.refreshWindow();
    }
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ Ereignisse
  bindGameEvents() {
    const g = this.game;
    g.on('log', () => { this.renderLog(); this.dirty = true; });
    g.on('territory', () => this.renderer.buildPolitical());
    g.on('changed', () => { this.dirty = true; this.buildbarDirty = true; });
    g.on('day', () => { if (this.buildbarDirty || (g.state.hour / 24) % 1 === 0) { this.renderBuildbar(); this.buildbarDirty = false; } });
    g.on('research', () => { this.renderBuildbar(); if (this.win?.name === 'research') this.refreshWindow(); });
    g.on('end', () => this.showEnd());
  }

  // ------------------------------------------------------------ Eingabe
  bindInput() {
    const cv = this.cv, r = this.renderer;
    let down = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      down = { x: e.clientX, y: e.clientY, btn: e.button, moved: false, lx: e.clientX, ly: e.clientY };
    });
    window.addEventListener('mousemove', this._mm = e => {
      if (down) {
        const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
        if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5) down.moved = true;
        if (down.moved) { r.pan(dx, dy); cv.classList.add('dragging'); }
        down.lx = e.clientX; down.ly = e.clientY;
      }
      if (e.target === cv) this.hoverAt(e.clientX, e.clientY);
      else $('#tooltip').classList.add('hidden');
    });
    window.addEventListener('mouseup', this._mu = e => {
      if (!down) return;
      const wasDrag = down.moved, btn = down.btn;
      down = null; cv.classList.remove('dragging');
      if (wasDrag || e.target !== cv) return;
      if (btn === 2) { if (this.tool && this.tool.kind !== 'found') this.setTool(null); else this.select(null); return; }
      if (btn === 0) this.clickAt(e.clientX, e.clientY, e);
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); r.zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY)); this.hoverAt(e.clientX, e.clientY); }, { passive: false });
    $('#minimap').addEventListener('mousedown', e => {
      const info = r.drawMini($('#minimap'));
      const rect = e.target.getBoundingClientRect();
      const go = ev => { r.centerOn((ev.clientX - rect.left - info.ox) / info.s, (ev.clientY - rect.top - info.oy) / info.s); };
      go(e);
      const mv = ev => go(ev), up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    this.keys = new Set();
    this.onKey = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || !$('#modal').classList.contains('hidden')) return;
      const k = e.key.toLowerCase();
      if (e.type === 'keyup') { this.keys.delete(k); return; }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.keys.add(k); e.preventDefault(); return; }
      if (k === ' ') { e.preventDefault(); this.togglePause(); }
      else if (k >= '1' && k <= '5') this.setSpeed(+k);
      else if (k === 'escape') { if (this.win) this.closeWindow(); else if (this.tool && this.tool.kind !== 'found') this.setTool(null); else this.select(null); }
      else if (k === 'r') this.setTool({ kind: 'road' });
      else if (k === 'x') this.setTool({ kind: 'demolish' });
      else if (k === 'm') this.openWindow('market');
      else if (k === 't') this.openWindow('trade');
      else if (k === 'f') this.openWindow('research');
      else if (k === 'c') this.openWindow('city');
      else if (k === '+') r.zoomAt(r.vw / 2, r.vh / 2, 1.25);
      else if (k === '-') r.zoomAt(r.vw / 2, r.vh / 2, 0.8);
    };
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('keyup', this.onKey);
    $('#window .win-close').onclick = () => this.closeWindow();
  }
  keyPan(dt) {
    if (!this.keys.size) return;
    const s = 700 * dt; let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += s;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= s;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += s;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= s;
    this.renderer.pan(dx, dy);
  }
  togglePause() {
    const st = this.game.state;
    if (st.speed) { this._lastSpeed = st.speed; st.speed = 0; } else st.speed = this._lastSpeed || 1;
    this.renderTopbar(true);
  }
  setSpeed(n) { this.game.state.speed = n; this.renderTopbar(true); }

  setTool(t) {
    this.tool = t;
    this.renderer.ghost = null;
    this.renderer.highlightProvince = t && (t.kind === 'found' || t.kind === 'claim');
    this.cv.classList.toggle('tool', !!t);
    if (!t || t.kind !== 'found') $('#banner').classList.add('hidden');
    if (t && t.kind === 'road') this.banner('Straße bauen: Klicke Anfang und Ende. Rechtsklick oder Esc beendet. Kosten je 10 Längeneinheiten: 2 Gold, 1 Stein.');
    if (t && t.kind === 'demolish') this.banner('Abreißen: Klicke auf ein Gebäude oder eine Straße. Rechtsklick oder Esc beendet.');
    if (t && t.kind === 'claim') this.banner('Provinz beanspruchen: Klicke auf eine angrenzende freie Provinz.');
    this.renderBuildbar();
  }
  banner(html) { const b = $('#banner'); b.innerHTML = html; b.classList.remove('hidden'); }

  hoverAt(sx, sy) {
    const r = this.renderer, g = this.game;
    const [wx, wy] = r.toWorld(sx, sy);
    const tile = g.map.grid.at(wx, wy);
    const prov = tile >= 0 ? g.map.prov[tile] : -1;
    r.hover = { tile, prov, x: wx, y: wy };
    const tt = $('#tooltip');
    const showTip = html => { tt.innerHTML = html; tt.classList.remove('hidden'); tt.style.left = Math.min(sx + 16, window.innerWidth - 330) + 'px'; tt.style.top = Math.min(sy + 16, window.innerHeight - tt.offsetHeight - 10) + 'px'; };
    const p = g.player;
    const t = this.tool;
    if (t?.kind === 'found') {
      r.ghost = prov >= 0 ? { kind: 'found', x: wx, y: wy } : null;
      if (prov >= 0) showTip(this.provinceHtml(prov, true)); else tt.classList.add('hidden');
      return;
    }
    if (t?.kind === 'claim') {
      if (prov >= 0) { const chk = g.canClaim(p, prov); showTip(`<h4>${esc(g.provName(prov))}</h4>${chk.ok ? `<span class="ok">Beanspruchen für ${chk.cost} Gold</span>` : `<span class="no">${esc(chk.reason)}</span>`}`); }
      else tt.classList.add('hidden');
      return;
    }
    if (t?.kind === 'build') {
      const snap = this.snap(wx, wy);
      const chk = g.canPlace(p, t.type, snap[0], snap[1]);
      r.ghost = { kind: 'building', type: t.type, x: snap[0], y: snap[1], ok: chk.ok };
      const d = BUILDINGS[t.type];
      let html = `<h4>${esc(d.name)}</h4>`;
      html += chk.ok ? '<span class="ok">Hier baubar</span>' : `<span class="no">${esc(chk.reason)}</span>`;
      if (chk.loc && d.loc) html += `<div>Standort: <b>${pct(chk.loc.f)}</b> ${esc(chk.loc.info || '')}</div>`;
      if (prov >= 0 && d.mod) { const m = g.map.provinces[prov].mods[d.mod]; html += `<div>Provinzbonus ${esc(MOD_NAMES[d.mod])}: <b>${sign((m - 1) * 100)} %</b></div>`; }
      html += `<div>${this.costHtml(g.costOf(p, t.type), p)}</div>`;
      showTip(html);
      return;
    }
    if (t?.kind === 'road') {
      if (t.start) {
        const e = this.snap(wx, wy, true);
        const chk = g.canRoad(p, t.start[0], t.start[1], e[0], e[1]);
        r.ghost = { kind: 'road', x1: t.start[0], y1: t.start[1], x2: e[0], y2: e[1], ok: chk.ok };
        showTip(chk.ok ? `Länge ${Math.round(chk.len)} · ${this.costHtml(chk.cost, p)}` : `<span class="no">${esc(chk.reason)}</span>`);
      } else { r.ghost = null; tt.classList.add('hidden'); }
      return;
    }
    // Kein Werkzeug: Gebäude oder Provinz anzeigen
    const b = r.cam.zoom > 0.9 ? g.buildingAt(wx, wy) : null;
    if (b) {
      const d = BUILDINGS[b.type];
      const own = b._c;
      let html = `<h4>${esc(d.name)}</h4><div>${esc(own.name)}</div>`;
      if (!b.done) html += `<div>Im Bau: noch ${hoursText(d.time - b.progress)}</div>`;
      else if (d.house || b.type === 'zentrum') html += `<div>${b.residents} / ${g.houseCap(b)} Bewohner</div>`;
      else if (d.workers) html += `<div>Arbeiter ${b.workers}/${d.workers} · Leistung ${pct(b.eff || 0)}</div>`;
      showTip(html);
    } else if (prov >= 0 && r.cam.zoom < 1.4) {
      const owner = g.state.provOwner[prov];
      const oc = owner >= 0 ? g.cityById(owner) : null;
      showTip(`<h4>${esc(g.provName(prov))}</h4><div>${oc ? 'Gehört zu ' + esc(oc.name) : 'Freie Provinz'}</div><div>${this.biomeText(g.map.provinces[prov])}</div>`);
    } else tt.classList.add('hidden');
  }
  // Am Raster ausrichten (2 Einheiten) und an Straßenenden einrasten
  snap(x, y, roadMode) {
    const p = this.game.player;
    if (roadMode && p) {
      let best = null, bd = 6 / Math.max(0.5, this.renderer.cam.zoom) + 3;
      const pts = [[p.x, p.y], ...p.roads.flatMap(r => [[r.x1, r.y1], [r.x2, r.y2]])];
      for (const q of pts) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = q; } }
      if (best) return best;
    }
    return [Math.round(x), Math.round(y)];
  }

  clickAt(sx, sy, e) {
    const r = this.renderer, g = this.game, p = g.player;
    const [wx, wy] = r.toWorld(sx, sy);
    const tile = g.map.grid.at(wx, wy);
    const prov = tile >= 0 ? g.map.prov[tile] : -1;
    const t = this.tool;
    if (t?.kind === 'found') return this.tryFound(prov, wx, wy);
    if (t?.kind === 'claim') {
      if (prov < 0) return;
      const res = g.claim(p, prov);
      if (res.ok) { this.hooks.toast(`${g.provName(prov)} gehört jetzt zu ${p.name}.`); this.setTool(null); }
      else this.hooks.toast(res.reason);
      return;
    }
    if (t?.kind === 'build') {
      const [x, y] = this.snap(wx, wy);
      const res = g.place(p, t.type, x, y);
      if (!res.ok) this.hooks.toast(res.reason);
      else { this.renderBuildbar(); if (!e.shiftKey && BUILDINGS[t.type].unique) this.setTool(null); }
      this.hoverAt(sx, sy);
      return;
    }
    if (t?.kind === 'road') {
      const pt = this.snap(wx, wy, true);
      if (!t.start) { t.start = pt; return; }
      const res = g.placeRoad(p, t.start[0], t.start[1], pt[0], pt[1]);
      if (!res.ok) this.hooks.toast(res.reason); else t.start = pt;
      return;
    }
    if (t?.kind === 'demolish') {
      const b = g.buildingAt(wx, wy);
      if (b && b._c === p && b.type !== 'zentrum') {
        this.hooks.modal(`<p><b>${esc(BUILDINGS[b.type].name)}</b> abreißen? Du erhältst ${b.done ? '30' : '60'} % des Goldes zurück.</p>`, [{ label: 'Abbrechen', value: false }, { label: 'Abreißen', value: true, danger: true }])
          .then(ok => { if (ok) { g.demolish(p, b); if (this.selectedBuilding === b) this.select(null); } });
        return;
      }
      const road = p && g.roadNear(p, wx, wy, 4);
      if (road) { g.removeRoad(p, road); return; }
      return;
    }
    // Auswahl
    const b = r.cam.zoom > 0.9 ? g.buildingAt(wx, wy) : null;
    if (b) return this.select({ building: b });
    // Stadt bei weiter Sicht
    const city = g.state.cities.find(c => Math.hypot(c.x - wx, c.y - wy) < 22 / r.cam.zoom);
    if (city && r.cam.zoom < 0.9) return this.select({ city });
    if (prov >= 0) return this.select({ province: prov });
    this.select(null);
  }

  async tryFound(prov, x, y) {
    const g = this.game;
    if (prov < 0) return;
    const chk = g.canFound(prov);
    if (!chk.ok) return this.hooks.toast(chk.reason);
    const tile = g.map.grid.at(x, y);
    if (g.map.biome[tile] === B.meer || g.map.biome[tile] === B.gebirge) return this.hooks.toast('Hier kann keine Stadt stehen.');
    const name = g.map.cityNames.next();
    const res = await this.hooks.modal(`<h3>Stadt gründen in ${esc(g.provName(prov))}?</h3>${this.provinceHtml(prov, false)}<label>Name deiner Stadt<input name="name" value="${esc(name)}" maxlength="30"></label>`, [{ label: 'Abbrechen', value: null }, { label: 'Gründen', value: 'form', primary: true }]);
    if (!res) return;
    const c = g.foundCity(prov, x, y, { player: true, name: (res.name || name).trim() });
    this.setTool(null);
    $('#banner').classList.add('hidden');
    this.renderer.centerOn(c.x, c.y, 3);
    g.state.speed = 1;
    this.renderBuildbar(); this.renderTopbar(true);
    this.hooks.modal(`<h3>Willkommen, Gründer von ${esc(c.name)}!</h3>
      <p>Deine Siedler haben einen Dorfplatz errichtet. Ein paar Tipps für den Anfang:</p>
      <ul><li>Baue zuerst <b>Holzfäller</b> (nah am Wald) und eine <b>Sammler-</b> oder <b>Fischerhütte</b>.</li>
      <li><b>Einfamilienhäuser</b> bringen neue Einwohner, aber nur, wenn es Arbeit gibt.</li>
      <li>Ein <b>Marktplatz</b> ermöglicht Handel mit den Nachbarstädten.</li>
      <li>Wähle eine <b>Forschung</b> (Taste F), um neue Gebäude freizuschalten.</li>
      <li>Steuerung: Ziehen = Karte bewegen, Mausrad = Zoom, Leertaste = Pause, 1–5 = Tempo, Rechtsklick = abbrechen.</li></ul>`);
  }

  select(sel) {
    const r = this.renderer;
    this.selectedBuilding = null; r.selected = null; r.selectedProvince = null;
    const ip = $('#infopanel');
    if (!sel) { ip.classList.add('hidden'); return; }
    ip.classList.remove('hidden');
    if (sel.building) { this.selectedBuilding = sel.building; r.selected = sel.building; this.showBuilding(sel.building); }
    else if (sel.province != null) { r.selectedProvince = sel.province; this.showProvince(sel.province); }
    else if (sel.city) this.showCity(sel.city);
  }

  // ------------------------------------------------------------ Darstellungshilfen
  costHtml(cost, c) {
    return Object.entries(cost).map(([k, v]) => {
      const have = k === 'geld' ? c?.money ?? 0 : c ? this.game.stockOf(c, k) : 0;
      const label = k === 'geld' ? `🪙 ${fmt(v)}` : `${GOODS[k].icon} ${fmt(v)} ${GOODS[k].name}`;
      return have >= v ? label : `<span class="no">${label}</span>`;
    }).join(' · ');
  }
  recipeText(r, q = 0) {
    const qi = QUALITY[q].input;
    const ins = Object.entries(r.in).map(([k, v]) => `${fmt(v * qi, 1)} ${GOODS[k].name}`).join(' + ');
    const outs = Object.entries(r.out).map(([k, v]) => `${fmt(v, 1)} ${GOODS[k].name}`).join(' + ');
    return (ins ? ins + ' → ' : '') + outs + ' / Tag';
  }
  biomeText(pr) {
    return Object.entries(pr.biomeShare).filter(([, s]) => s >= 0.08).map(([b, s]) => `${BIOMES[b].name} ${pct(s)}`).join(', ');
  }
  provinceHtml(pid, short) {
    const g = this.game, pr = g.map.provinces[pid];
    const owner = g.state.provOwner[pid];
    const oc = owner >= 0 ? g.cityById(owner) : null;
    const mods = Object.entries(pr.mods).map(([k, v]) => {
      const d = Math.round((v - 1) * 100);
      const good = k === 'bau' ? d <= 0 : d >= 0;
      return `<span class="pill ${d === 0 ? '' : good ? 'pos' : 'neg'}">${MOD_NAMES[k]} ${d > 0 ? '+' : ''}${d} %</span>`;
    }).join('');
    const deps = Object.entries(pr.deposits).map(([k, n]) => `${DEPOSITS.find(d => d && d.key === k).name}${n > 1 ? ` ×${n}` : ''}`).join(', ') || 'keine';
    const mix = pr.secondary >= 0 ? `<div><i>Mischprovinz: Boni beider Biome je zur Hälfte</i></div>` : '';
    return `${short ? `<h4>${esc(g.provName(pid))}</h4>` : ''}
      <div>${oc ? `<b>Gehört zu ${esc(oc.name)}</b>` : 'Freie Provinz'}</div>
      <div class="kv"><span>Größe</span><span>${pr.size} km²</span>
      <span>Landschaft</span><span>${this.biomeText(pr)}</span>
      <span>Bäume</span><span>${pct(pr.trees)}</span>
      <span>Fruchtbarkeit</span><span>${pct(pr.fert)}</span>
      <span>Wasser</span><span>${[pr.coast ? 'Küste' : '', pr.river ? 'Fluss' : ''].filter(Boolean).join(' & ') || '–'}</span>
      <span>Lagerstätten</span><span>${esc(deps)}</span></div>
      <div style="margin-top:4px">${mods}</div>${mix}`;
  }

  // ------------------------------------------------------------ Obere Leiste
  renderTopbar(force) {
    const g = this.game, st = g.state, p = g.player;
    const bar = $('#topbar');
    if (!bar.dataset.built || force) {
      bar.innerHTML = `
        <span class="city" data-w="city"></span>
        <span class="res" data-r="money" title="Gold (Veränderung pro Tag)"></span>
        <span class="res" data-r="pop" title="Einwohner / Wohnraum"></span>
        <span class="res" data-r="happy" title="Zufriedenheit (Grundbedarf)"></span>
        <span class="res" data-r="know" title="Wissen pro Tag und aktuelle Forschung" style="cursor:pointer"></span>
        <span class="res" data-r="goods"></span>
        <span class="spacer"></span>
        <span class="speed"></span>
        <span class="date"></span>
        <span class="spacer"></span>
        <span class="menu-btns">
          <button class="btn" data-w="city" title="Stadt (C)">🏛️</button>
          <button class="btn" data-w="market" title="Lager & Markt (M)">⚖️</button>
          <button class="btn" data-w="trade" title="Handel (T)">🐎</button>
          <button class="btn" data-w="research" title="Forschung (F)">📜</button>
          <button class="btn" data-w="diplo" title="Diplomatie">🤝</button>
          <button class="btn" data-w="stats" title="Statistik">📈</button>
          <button class="btn" data-w="menu" title="Menü">☰</button>
        </span>`;
      bar.querySelectorAll('[data-w]').forEach(b => b.onclick = () => this.openWindow(b.dataset.w));
      bar.querySelector('[data-r=know]').onclick = () => this.openWindow('research');
      const sp = bar.querySelector('.speed');
      sp.innerHTML = `<button class="btn tiny" data-s="0" title="Pause (Leertaste)">⏸</button>` + [1, 2, 3, 4, 5].map(n => `<button class="btn tiny" data-s="${n}" title="Tempo ${n}: ${SPEEDS[n]} Spielstunden pro Sekunde">${n}</button>`).join('');
      sp.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { const n = +b.dataset.s; if (n) this.setSpeed(n); else this.togglePause(); });
      bar.dataset.built = '1';
    }
    bar.querySelectorAll('.speed [data-s]').forEach(b => b.classList.toggle('active', +b.dataset.s === st.speed));
    bar.querySelector('.date').textContent = fmtDate(st.hour, true);
    if (!p) { bar.querySelector('.city').textContent = 'Keine Stadt'; return; }
    bar.querySelector('.city').textContent = p.name;
    const net = (p.lastTax || 0) + (p.lastTrade || 0) - (p.lastUpkeep || 0);
    bar.querySelector('[data-r=money]').innerHTML = `🪙 <b>${fmtShort(p.money)}</b> <span class="d ${net >= 0 ? 'pos' : 'neg'}">${sign(net)}</span>`;
    const cap = p.buildings.reduce((s, b) => s + (b.done ? g.houseCap(b) : 0), 0);
    bar.querySelector('[data-r=pop]').innerHTML = `👥 <b>${p.pop}</b><span class="d">/${cap}</span>`;
    bar.querySelector('[data-r=happy]').innerHTML = `🙂 ${pct(p.happy[1] || 0)}`;
    const cur = p.research.current ? TECHS[p.research.current] : null;
    bar.querySelector('[data-r=know]').innerHTML = `📜 ${fmt(p.knowledge || 0, 1)}/Tag ${cur ? `· ${esc(cur.name)} ${Math.floor(p.research.points / cur.cost * 100)} %` : '<span class="neg">· keine Forschung</span>'}`;
    const food = FOOD_GOODS.reduce((s, k) => s + (p.stock[k] || 0), 0);
    const show = [['holz', '🪵'], ['stein', '🪨'], ['bretter', '🪚'], ['werkstein', '🧱']].filter(([k]) => k === 'holz' || k === 'stein' || (p.stock[k] || 0) > 0);
    bar.querySelector('[data-r=goods]').innerHTML = `🍞 ${fmt(food)} ` + show.map(([k, i]) => `${i} ${fmt(p.stock[k] || 0)}`).join(' ');
  }

  // ------------------------------------------------------------ Bauleiste
  renderBuildbar() {
    const g = this.game, p = g.player, bb = $('#buildbar');
    if (!p) { bb.innerHTML = '<h3>Gründung</h3><p>Wähle zuerst einen Standort für deine Stadt. Achte auf Wald (Holz), Flachland (Nahrung), Hochland (Stein und Erz) und Wasser (Fisch, Handel per Boot).</p><p class="hint">Grüne und rote Werte zeigen die Boni der Provinz.</p>'; return; }
    const t = this.tool;
    let html = `<div class="cats">${CATEGORIES.map(c => `<button class="btn ${this.cat === c.id ? 'active' : ''}" data-cat="${c.id}" title="${c.name}">${c.icon}</button>`).join('')}</div>`;
    const catName = CATEGORIES.find(c => c.id === this.cat).name;
    html += `<h3>${catName}</h3>`;
    if (this.cat === 'wege') {
      html += `<div class="tools"><button class="btn ${t?.kind === 'road' ? 'active' : ''}" data-tool="road">🛤️ Straße (R)</button><button class="btn ${t?.kind === 'demolish' ? 'active' : ''}" data-tool="demolish">🪓 Abreißen (X)</button><button class="btn ${t?.kind === 'claim' ? 'active' : ''}" data-tool="claim">🚩 Provinz</button></div>
        <p class="hint">Straßen sind freiwillig. Gebäude an Straßen arbeiten ${pct(ROAD.prod)} besser, Straßen bringen Prestige und Reinheit und beschleunigen Händler. Sonst entstehen Trampelpfade.</p>`;
    }
    const types = Object.entries(BUILDINGS).filter(([, d]) => d.cat === this.cat && !d.hidden);
    for (const [type, d] of types) {
      const unlocked = g.isUnlocked(p, type);
      const cost = g.costOf(p, type);
      const afford = g.canAfford(p, cost);
      const lockText = d.tech ? `Benötigt Forschung: ${TECHS[d.tech].name}` : `Ab Zeitalter ${ERAS[(d.era || 1) - 1].name}`;
      const extra = d.house ? `👥 ${d.house.cap}` : d.workers ? `👷 ${d.workers}` : '';
      html += `<div class="bitem ${!unlocked ? 'locked' : !afford ? 'cant' : ''} ${t?.type === type ? 'sel' : ''}" data-type="${type}" title="${esc(unlocked ? d.desc : lockText)}">
        <span class="nm">${esc(d.name)}</span><span class="wk">${extra}</span>
        <span class="cost">${unlocked ? this.costHtml(cost, p) : '🔒 ' + esc(lockText)}</span></div>`;
    }
    bb.innerHTML = html;
    bb.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { this.cat = b.dataset.cat; this.renderBuildbar(); });
    bb.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => this.setTool(this.tool?.kind === b.dataset.tool ? null : { kind: b.dataset.tool }));
    bb.querySelectorAll('.bitem').forEach(el => {
      el.onclick = () => {
        const type = el.dataset.type;
        if (!g.isUnlocked(p, type)) return this.hooks.toast(el.title);
        this.setTool(this.tool?.type === type ? null : { kind: 'build', type });
      };
      el.onmouseenter = () => this.buildTip(el);
      el.onmouseleave = () => $('#tooltip').classList.add('hidden');
    });
  }
  buildTip(el) {
    const d = BUILDINGS[el.dataset.type];
    const tt = $('#tooltip');
    let html = `<h4>${esc(d.name)}</h4><div>${esc(d.desc)}</div>`;
    if (Array.isArray(d.recipes)) html += d.recipes.map(r => `<div>• ${esc(this.recipeText(r))}</div>`).join('');
    if (d.recipes === 'deposit') html += `<div>• ca. 5 Erz / Tag (Gold 1,5, Edelsteine 0,8)</div>`;
    html += `<div>Bauzeit ${hoursText(d.time)}${d.workers ? ` · ${d.workers} Arbeiter` : ''} · Unterhalt ${fmt((d.upkeep || 0) * 0.4, 2)} / Tag</div>`;
    tt.innerHTML = html; tt.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    tt.style.left = (r.right + 10) + 'px'; tt.style.top = Math.min(r.top, window.innerHeight - tt.offsetHeight - 10) + 'px';
  }

  // ------------------------------------------------------------ Infofeld rechts
  showBuilding(b, live) {
    const g = this.game, d = BUILDINGS[b.type], c = b._c, p = g.player;
    if (!c.buildings.includes(b)) { this.select(null); return; }
    const ip = $('#infopanel');
    const own = c === p;
    if (live && this._ipFocus && ip.contains(document.activeElement)) return;
    let html = `<h2>${esc(d.name)}</h2><div class="hint">${esc(d.desc)}</div>`;
    if (!own) html += `<p>Gehört zu <b>${esc(c.name)}</b>.</p>`;
    if (!b.done) {
      const left = d.time - b.progress;
      const sp = SPEEDS[g.state.speed] || 1;
      html += `<h3>Baustelle</h3><div class="bar-meter"><div style="width:${pct(b.progress / d.time)}"></div></div><p>Fertig in <b>${hoursText(left)}</b> (≈ ${Math.ceil(left / sp)} s bei aktuellem Tempo)</p>`;
    } else if (d.house || b.type === 'zentrum') {
      const T = g.houseTier(b);
      html += `<div class="kv"><span>Bewohner</span><span>${b.residents} / ${g.houseCap(b)}</span><span>Stufe</span><span>${esc(NEEDS[T - 1].name)}</span><span>Zufriedenheit</span><span>${pct(c.happy[T] || 0)}</span></div>`;
      if (b.type === 'zentrum') html += `<p class="hint">Der Dorfplatz beherbergt die ersten Siedler und ist das Lager der Stadt.</p>`;
    } else {
      html += `<div class="kv">`;
      if (d.workers) html += `<span>Arbeiter</span><span>${b.workers} / ${d.workers}${b.workers < d.workers ? ' <span class="neg">(unterbesetzt)</span>' : ''}</span>`;
      if (d.loc) html += `<span>Standort</span><span>${pct(b.loc)}${b.dep ? ` (${esc(DEPOSITS.find(x => x && x.key === b.dep).name)})` : ''}</span>`;
      if (d.recipes) html += `<span>Leistung</span><span>${pct(b.eff || 0)}${b.inputShort ? ' <span class="neg">(Rohstoffe fehlen)</span>' : ''}</span>`;
      if (d.knowledge) html += `<span>Wissen</span><span>${fmt(d.knowledge, 1)} / Tag</span>`;
      if (d.traders) html += `<span>Händler</span><span>${Object.entries(d.traders).map(([m, n]) => `${n}× ${TRANSPORT[m].name}`).join(', ')}</span>`;
      if (d.storage) html += `<span>Lager</span><span>+${d.storage} je Ware</span>`;
      html += `</div>`;
      if (Array.isArray(d.recipes)) {
        if (d.recipes.length > 1 && own) html += `<label>Rezept<select data-k="recipe">${d.recipes.map((r, i) => `<option value="${i}" ${i === b.recipe ? 'selected' : ''}>${esc(this.recipeText(r, b.quality))}</option>`).join('')}</select></label>`;
        else html += `<p>${esc(this.recipeText(d.recipes[b.recipe] || d.recipes[0], b.quality))} <span class="hint">(bei voller Leistung)</span></p>`;
        if (d.quality && own) html += `<label>Qualität<select data-k="quality">${QUALITY.map((q, i) => `<option value="${i}" ${i === b.quality ? 'selected' : ''}>${q.name} (Material ×${q.input}, Preis ×${q.price})</option>`).join('')}</select></label>`;
      } else if (d.recipes === 'deposit') html += `<p>Fördert ${esc(GOODS[b.out]?.name || '–')}.</p>`;
    }
    if (own && b.type !== 'zentrum') {
      html += `<div class="row">`;
      if (d.workers && b.done) html += `<button class="btn" data-a="pause">${b.paused ? '▶ Fortsetzen' : '⏸ Stilllegen'}</button>`;
      html += `<button class="btn danger" data-a="demolish">Abreißen</button></div>`;
    }
    ip.innerHTML = html;
    ip.querySelectorAll('select').forEach(s => {
      s.onfocus = () => { this._ipFocus = true; }; s.onblur = () => { this._ipFocus = false; };
      s.onchange = () => { b[s.dataset.k] = +s.value; this._ipFocus = false; this.showBuilding(b); };
    });
    const pa = ip.querySelector('[data-a=pause]'); if (pa) pa.onclick = () => { b.paused = !b.paused; this.showBuilding(b); };
    const de = ip.querySelector('[data-a=demolish]');
    if (de) de.onclick = () => this.hooks.modal(`<p><b>${esc(d.name)}</b> abreißen?</p>`, [{ label: 'Abbrechen', value: false }, { label: 'Abreißen', value: true, danger: true }]).then(ok => { if (ok) { g.demolish(c, b); this.select(null); } });
  }

  showProvince(pid) {
    const g = this.game, p = g.player, ip = $('#infopanel');
    const owner = g.state.provOwner[pid];
    let html = `<h2>${esc(g.provName(pid))}</h2>${this.provinceHtml(pid, false)}`;
    html += `<div class="row">`;
    if (owner === p?.id) html += `<button class="btn" data-a="rename">Umbenennen</button>`;
    if (p && owner === -1) { const chk = g.canClaim(p, pid); html += `<button class="btn primary" data-a="claim" ${chk.ok ? '' : 'disabled'} title="${esc(chk.reason || '')}">Beanspruchen${chk.cost ? ` (${chk.cost} 🪙)` : ''}</button>`; if (!chk.ok) html += `<div class="hint" style="width:100%">${esc(chk.reason)}</div>`; }
    if (owner >= 0 && owner !== p?.id) html += `<button class="btn" data-a="city">Stadt ansehen</button>`;
    html += `</div>`;
    ip.innerHTML = html;
    const rn = ip.querySelector('[data-a=rename]');
    if (rn) rn.onclick = async () => {
      const r = await this.hooks.modal(`<label>Neuer Name<input name="n" value="${esc(g.provName(pid))}" maxlength="30"></label>`, [{ label: 'Abbrechen', value: null }, { label: 'Umbenennen', value: 'form', primary: true }]);
      if (r && r.n.trim()) { g.state.provNames[pid] = r.n.trim(); this.showProvince(pid); }
    };
    const cl = ip.querySelector('[data-a=claim]'); if (cl) cl.onclick = () => { const r = g.claim(p, pid); this.hooks.toast(r.ok ? 'Provinz beansprucht.' : r.reason); this.showProvince(pid); };
    const ct = ip.querySelector('[data-a=city]'); if (ct) ct.onclick = () => this.showCity(g.cityById(owner));
  }

  showCity(c) {
    const g = this.game, ip = $('#infopanel'), p = g.player;
    ip.classList.remove('hidden');
    if (c === p) { this.openWindow('city'); return; }
    const rel = g.rel(c.id);
    ip.innerHTML = `<h2>${esc(c.name)}</h2>
      <div class="kv"><span>Einwohner</span><span>${c.pop}</span><span>Gebäude</span><span>${c.buildings.length}</span><span>Zeitalter</span><span>${ERAS[g.cityEra(c) - 1].name}</span>
      <span>Provinzen</span><span>${c.provinces.length}</span><span>Marktplatz</span><span>${g.hasMarket(c) ? 'ja' : 'nein'}</span><span>Hafen</span><span>${g.hasHarbor(c) ? 'ja' : 'nein'}</span>
      <span>Beziehung</span><span>${Math.round(rel.rel)}${rel.agreement ? ' · Handelsabkommen' : ''}</span></div>
      <div class="row"><button class="btn" data-a="goto">Hinfahren</button><button class="btn primary" data-a="trade">Handeln</button><button class="btn" data-a="diplo">Diplomatie</button></div>`;
    ip.querySelector('[data-a=goto]').onclick = () => this.renderer.centerOn(c.x, c.y, 2.5);
    ip.querySelector('[data-a=trade]').onclick = () => { this.tradePartner = c.id; this.openWindow('trade'); };
    ip.querySelector('[data-a=diplo]').onclick = () => this.openWindow('diplo');
  }

  // ------------------------------------------------------------ Meldungen
  renderLog() {
    const log = $('#log');
    log.innerHTML = this.game.state.log.slice(-40).reverse().map(e => `<div class="e ${e.type}"><span class="t">${fmtDate(e.h)}</span>${esc(e.text)}</div>`).join('') || '<div class="hint">Noch keine Meldungen.</div>';
  }

  // ------------------------------------------------------------ Fenster
  openWindow(name) {
    if (!this.game.player && name !== 'menu') return this.hooks.toast('Gründe zuerst deine Stadt.');
    if (this.win?.name === name) return this.closeWindow();
    this.win = { name, live: ['city', 'market', 'trade', 'research', 'diplo'].includes(name), tab: this.win?.name === name ? this.win.tab : null };
    $('#window').classList.remove('hidden');
    this.refreshWindow();
  }
  closeWindow() { this.win = null; $('#window').classList.add('hidden'); }
  refreshWindow() {
    if (!this.win) return;
    const w = $('#window'), body = w.querySelector('.win-body');
    if (body.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;  // nicht beim Tippen stören
    const scroll = body.scrollTop;
    const titles = { city: 'Stadt', market: 'Lager & Markt', trade: 'Handel', research: 'Forschung', diplo: 'Diplomatie', stats: 'Statistik', menu: 'Menü' };
    w.querySelector('.win-title').textContent = titles[this.win.name];
    this['win_' + this.win.name](body);
    body.scrollTop = scroll;
  }
  tabs(body, list, def) {
    const cur = this.win.tab || def;
    return `<div class="tabs">${list.map(([id, n]) => `<button class="btn ${cur === id ? 'active' : ''}" data-tab="${id}">${n}</button>`).join('')}</div>`;
  }
  bindTabs(body) { body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.win.tab = b.dataset.tab; this.refreshWindow(); }); }

  win_city(body) {
    const g = this.game, c = g.player;
    const tab = this.win.tab || 'overview';
    let html = this.tabs(body, [['overview', 'Übersicht'], ['needs', 'Bedürfnisse'], ['buildings', 'Gebäude']], 'overview');
    if (tab === 'overview') {
      const hd = g.housingDemand(c);
      const lvl = ['kein', 'gering', 'hoch', 'sehr hoch'];
      const cap = c.buildings.reduce((s, b) => s + (b.done ? g.houseCap(b) : 0), 0);
      html += `<div class="cards">
        <div class="card"><h4>Bevölkerung</h4><div class="kv">
          <span>Einwohner</span><span><b>${c.pop}</b> / ${cap} Wohnplätze</span>
          <span>Arbeitskräfte</span><span>${c.workforce}</span>
          <span>Arbeitsplätze</span><span>${c.jobs}</span>
          <span>Arbeitslos</span><span>${c.unemployed || 0}</span>
          <span>Fehlende Arbeiter</span><span class="${hd.freeJobs ? 'neg' : ''}">${hd.freeJobs}</span></div>
          <p class="hint">Neue Einwohner ziehen nur zu, wenn es Wohnraum und Arbeit gibt und sie zufrieden sind.</p></div>
        <div class="card"><h4>Wohnbedarf</h4>${hd.list.map(x => `<div>${esc(BUILDINGS[x.type].name)}: <span class="demand-${x.level}">${x.unlocked ? lvl[x.level] : '🔒'}</span> <span class="hint">(Belegung ${pct(x.fill)}, Zufriedenheit ${pct(x.happy)})</span></div>`).join('')}</div>
        <div class="card"><h4>Finanzen pro Tag</h4><div class="kv">
          <span>Steuern & Umland</span><span class="pos">${sign(c.lastTax || 0)}</span>
          <span>davon Umlandmarkt</span><span>${fmt(c.lastLocal || 0, 1)}</span>
          <span>Handel</span><span class="${(c.lastTrade || 0) >= 0 ? 'pos' : 'neg'}">${sign(c.lastTrade || 0)}</span>
          <span>Unterhalt</span><span class="neg">${sign(-(c.lastUpkeep || 0))}</span></div>
          <label>Steuersatz: <b>${Math.round(c.taxRate * 100)} %</b><input type="range" min="0" max="30" value="${Math.round(c.taxRate * 100)}" data-k="tax"></label>
          <p class="hint">Über 10 % sinkt die Zufriedenheit, darunter steigt sie.</p></div>
        <div class="card"><h4>Stadt</h4><div class="kv">
          <span>Zeitalter</span><span>${ERAS[g.cityEra(c) - 1].name}</span>
          <span>Prestige</span><span>${fmt(c.prestige, 1)}</span>
          <span>Reinheit</span><span>${fmt(c.clean, 1)}</span>
          <span>Provinzen</span><span>${c.provinces.length} / ${g.provinceLimit(c)}</span>
          <span>Gebäude</span><span>${c.buildings.length} / 100</span>
          <span>Lager je Ware</span><span>${g.storageCap(c)}</span></div>
          <div class="row"><button class="btn" data-a="rename">Umbenennen</button><button class="btn" data-a="claim">Provinz beanspruchen</button></div></div>
      </div>`;
    } else if (tab === 'needs') {
      const tierPop = [0, 0, 0, 0, 0];
      for (const b of c.buildings) { const T = g.houseTier(b); if (T && b.done) for (let t = 1; t <= T; t++) tierPop[t] += b.residents; }
      html += NEEDS.map(n => `<h3>${esc(n.name)} – ${tierPop[n.tier]} Einwohner</h3>
        <div class="bar-meter"><div style="width:${pct(Math.min(1, c.sat[n.tier] || 0))}"></div></div>
        <table class="t"><tr><th>Ware</th><th class="n">Bedarf / Tag</th><th class="n">Lager</th></tr>
        ${n.items.map(it => {
          const dem = tierPop[n.tier] / 100 * it.amount;
          const st = it.group ? FOOD_GOODS.reduce((s, k) => s + (c.stock[k] || 0), 0) : g.stockOf(c, it.good);
          return `<tr><td>${esc(it.name)}${it.group ? ` <span class="hint">(${FOOD_GOODS.map(k => GOODS[k].name).join(', ')})</span>` : ''}</td><td class="n">${fmt(dem, 1)}</td><td class="n">${fmt(st)}</td></tr>`;
        }).join('')}</table>`).join('');
      html += `<p class="hint">Bewohner eines Hauses brauchen alle Stufen bis zu ihrer eigenen. Höhere Qualität (Möbel, Schmuck …) steigert die Zufriedenheit zusätzlich.</p>`;
    } else {
      const groups = {};
      for (const b of c.buildings) (groups[b.type] ||= []).push(b);
      html += `<table class="t"><tr><th>Gebäude</th><th class="n">Anzahl</th><th class="n">Arbeiter</th><th class="n">Ø Leistung</th><th></th></tr>` +
        Object.entries(groups).map(([type, bs]) => {
          const d = BUILDINGS[type];
          const w = bs.reduce((s, b) => s + (b.workers || 0), 0), need = bs.length * (d.workers || 0);
          const eff = bs.filter(b => b.done).reduce((s, b) => s + (b.eff || 0), 0) / Math.max(1, bs.filter(b => b.done).length);
          return `<tr><td>${esc(d.name)}</td><td class="n">${bs.length}${bs.some(b => !b.done) ? ` (${bs.filter(b => !b.done).length} im Bau)` : ''}</td><td class="n">${need ? `${w}/${need}` : '–'}</td><td class="n">${d.recipes ? pct(eff) : '–'}</td><td><button class="btn tiny" data-goto="${bs[0].id}">📍</button></td></tr>`;
        }).join('') + '</table>';
    }
    body.innerHTML = html;
    this.bindTabs(body);
    const tax = body.querySelector('[data-k=tax]'); if (tax) tax.oninput = () => { c.taxRate = +tax.value / 100; tax.previousSibling.textContent; tax.parentElement.querySelector('b').textContent = tax.value + ' %'; };
    const rn = body.querySelector('[data-a=rename]');
    if (rn) rn.onclick = async () => { const r = await this.hooks.modal(`<label>Neuer Name<input name="n" value="${esc(c.name)}" maxlength="30"></label>`, [{ label: 'Abbrechen', value: null }, { label: 'Umbenennen', value: 'form', primary: true }]); if (r && r.n.trim()) { c.name = r.n.trim(); this.renderTopbar(true); this.refreshWindow(); } };
    const cl = body.querySelector('[data-a=claim]'); if (cl) cl.onclick = () => { this.closeWindow(); this.setTool({ kind: 'claim' }); };
    body.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { const bd = c.buildings.find(x => x.id === +b.dataset.goto); if (bd) { this.renderer.centerOn(bd.x, bd.y, Math.max(3, this.renderer.cam.zoom)); this.select({ building: bd }); } });
  }

  win_market(body) {
    const g = this.game, c = g.player;
    const keys = ALL_KEYS.filter(k => (c.stock[k] || 0) > 0.05 || c.avg[k] || c.autoTrade[k]);
    let html = `<p>Lager je Ware: <b>${g.storageCap(c)}</b>. Lege fest, ab wann deine Händler automatisch kaufen oder verkaufen. „Umland“ verkauft Überschüsse zusätzlich günstig an die Bauern der Umgebung (max. 5 je Tag). Nachbarstädte kaufen nur, was über deiner Verkaufsgrenze liegt.</p>
      ${g.hasMarket(c) ? '' : '<p class="neg"><b>Ohne fertigen Marktplatz gibt es keinen Handel.</b></p>'}
      <table class="t"><tr><th>Ware</th><th class="n">Lager</th><th class="n">Erzeugt</th><th class="n">Verbraucht</th><th class="n">Preis hier</th><th class="n">Kaufen unter</th><th class="n">Verkaufen über</th><th>Umland</th></tr>`;
    for (const k of keys) {
      const a = c.avg[k] || { p: 0, u: 0 };
      const at = c.autoTrade[k] || {};
      html += `<tr><td>${keyIcon(k)} ${esc(keyName(k))}</td><td class="n">${fmt(c.stock[k] || 0)}</td><td class="n pos">${fmt(a.p, 1)}</td><td class="n neg">${fmt(a.u, 1)}</td><td class="n">${fmt(g.price(c, k), 2)}</td>
        <td class="n"><input type="number" min="0" data-k="${k}" data-f="min" value="${at.min ?? ''}" placeholder="–"></td>
        <td class="n"><input type="number" min="0" data-k="${k}" data-f="max" value="${at.max ?? ''}" placeholder="–"></td>
        <td><input type="checkbox" data-k="${k}" data-f="local" ${at.local ? 'checked' : ''} style="width:auto"></td></tr>`;
    }
    html += `</table><h3>Ware hinzufügen</h3><select data-a="add"><option value="">– Ware wählen –</option>${ALL_KEYS.filter(k => !keys.includes(k)).map(k => `<option value="${k}">${esc(keyName(k))}</option>`).join('')}</select>`;
    body.innerHTML = html;
    body.querySelectorAll('input[data-k]').forEach(inp => {
      inp.onchange = () => {
        const k = inp.dataset.k, f = inp.dataset.f;
        const at = c.autoTrade[k] || (c.autoTrade[k] = {});
        if (f === 'local') at.local = inp.checked;
        else at[f] = inp.value === '' ? null : Math.max(0, +inp.value);
        if (at.min != null && at.max != null && at.max < at.min) { at.max = at.min; }
        if (at.min == null && at.max == null && !at.local) delete c.autoTrade[k];
        inp.blur();
      };
    });
    body.querySelector('[data-a=add]').onchange = e => { if (e.target.value) { c.autoTrade[e.target.value] = { min: null, max: null }; e.target.blur(); this.refreshWindow(); } };
  }

  win_trade(body) {
    const g = this.game, c = g.player;
    const partners = g.state.cities.filter(o => o !== c).concat(g.hasHarbor(c) ? g.foreignCities() : []);
    if (this.tradePartner == null && partners.length) this.tradePartner = partners[0].id;
    const partner = g.partnerById(this.tradePartner);
    const busy = ['fuss', 'karren', 'boot'].map(m => `${TRANSPORT[m].icon} ${g.tradersFree(c, m)}/${g.traderCount(c, m)} ${TRANSPORT[m].name}`).join(' · ');
    let html = `<p>Freie Händler: ${busy}</p><div style="display:grid;grid-template-columns:300px 1fr;gap:14px">`;
    // Partnerliste
    html += `<div><table class="t"><tr><th>Stadt</th><th class="n">Reise</th><th>Markt</th></tr>`;
    for (const o of partners) {
      const r = g.route(c, o, o.foreign ? 'boot' : 'fuss');
      html += `<tr data-p="${o.id}" style="cursor:pointer;${o.id === this.tradePartner ? 'background:#f3dc9a' : ''}"><td>${o.foreign ? '⛵ ' : ''}${esc(o.name)}${o.foreign ? ' <span class="hint">(Fernhandel)</span>' : ''}</td><td class="n">${r ? hoursText(r.hours) : '–'}</td><td>${g.hasMarket(o) ? '✔' : '✘'}</td></tr>`;
    }
    html += `</table>${g.hasHarbor(c) ? '' : '<p class="hint">Mit einem Hafen erreichst du auch Fernhandelsstädte außerhalb der Karte.</p>'}</div><div>`;
    if (partner) {
      const modes = g.modesBetween(c, partner);
      const o = this.order ||= { mode: modes[0] || 'fuss', dir: 'buy', rows: [{ key: 'holz', qty: 10 }] };
      if (!modes.includes(o.mode) && modes.length) o.mode = modes[0];
      const T = TRANSPORT[o.mode];
      while (o.rows.length > T.goods) o.rows.pop();
      const tariff = g.tariff(c, partner);
      html += `<h3>${esc(partner.name)}</h3><div>Zoll: ${pct(tariff)}${!partner.foreign ? ` · Beziehung ${Math.round(g.rel(partner.id).rel)}` : ''}</div>`;
      // Preisvergleich
      const keys = ALL_KEYS.filter(k => (partner.foreign ? partner.def.cheap.concat(partner.def.dear).includes(parseKey(k).id) : (partner.stock[k] || 0) > 1) || (c.stock[k] || 0) > 1);
      html += `<div style="max-height:220px;overflow:auto;margin:6px 0"><table class="t"><tr><th>Ware</th><th class="n">Dort Preis</th><th class="n">Dort Angebot</th><th class="n">Hier Preis</th><th class="n">Dein Lager</th></tr>`;
      for (const k of keys) {
        const pp = g.price(partner, k), hp = g.price(c, k);
        html += `<tr><td>${keyIcon(k)} ${esc(keyName(k))}</td><td class="n ${pp < hp ? 'pos' : ''}">${fmt(pp, 2)}</td><td class="n">${partner.foreign ? '∞' : fmt(g.available(partner, k))}</td><td class="n ${hp < pp ? 'pos' : ''}">${fmt(hp, 2)}</td><td class="n">${fmt(c.stock[k] || 0)}</td></tr>`;
      }
      html += `</table></div>`;
      // Auftrag
      html += `<h3>Auftrag</h3><div class="inline">
        <select data-o="dir" style="width:auto"><option value="buy" ${o.dir === 'buy' ? 'selected' : ''}>Kaufen in ${esc(partner.name)}</option><option value="sell" ${o.dir === 'sell' ? 'selected' : ''}>Verkaufen an ${esc(partner.name)}</option></select>
        <select data-o="mode" style="width:auto">${(modes.length ? modes : ['fuss']).map(m => `<option value="${m}" ${m === o.mode ? 'selected' : ''}>${TRANSPORT[m].icon} ${TRANSPORT[m].name} (max. ${TRANSPORT[m].cap}, ${TRANSPORT[m].goods} Waren)</option>`).join('')}</select></div>`;
      o.rows.forEach((r, i) => {
        html += `<div class="inline" style="margin-top:4px"><select data-row="${i}" data-f="key" style="width:auto">${ALL_KEYS.map(k => `<option value="${k}" ${k === r.key ? 'selected' : ''}>${esc(keyName(k))}</option>`).join('')}</select>
          <input type="number" min="1" max="${T.cap}" value="${r.qty}" data-row="${i}" data-f="qty"> ${o.rows.length > 1 ? `<button class="btn tiny" data-del="${i}">✕</button>` : ''}</div>`;
      });
      if (o.rows.length < T.goods) html += `<button class="btn tiny" data-a="addrow" style="margin-top:4px">+ Ware</button>`;
      const q = modes.length ? g.quote(c, partner, o.mode, o.rows, o.dir) : { ok: false, reason: 'Kein passendes Transportmittel (Marktplatz, Fuhrhof oder Hafen nötig).' };
      if (q.hours != null || q.ok) {
        html += `<div class="kv" style="margin-top:8px"><span>Reisezeit</span><span>${hoursText(q.hours)} hin, ebenso zurück</span>
          <span>Warenwert</span><span>${fmt(q.goodsValue, 1)}</span><span>Zoll</span><span>${fmt(q.tariffCost, 1)}</span><span>Transport</span><span>${fmt(q.transport, 1)}</span>
          <span>${o.dir === 'buy' ? 'Gesamtkosten' : 'Erlös (geschätzt)'}</span><span><b class="${q.net >= 0 ? 'pos' : 'neg'}">${sign(q.net)}</b></span></div>`;
      }
      if (!q.ok) html += `<p class="neg">${esc(q.reason)}</p>`;
      html += `<div class="row"><label style="margin:0">alle <input type="number" min="1" value="${this.routeEvery || 7}" data-a="every" style="width:60px"> Tage</label><button class="btn" data-a="route" ${modes.length ? '' : 'disabled'}>Als feste Route speichern</button><button class="btn primary" data-a="send" ${q.ok ? '' : 'disabled'}>Händler losschicken</button></div>`;
    }
    html += `</div></div>`;
    // Routen & unterwegs
    html += `<h3>Feste Handelsrouten</h3>`;
    if (!c.routes.length) html += `<p class="hint">Noch keine Routen. Routen schicken regelmäßig einen Händler los, sobald einer frei ist.</p>`;
    else html += `<table class="t"><tr><th>Partner</th><th>Auftrag</th><th>Mittel</th><th class="n">Alle</th><th>Zuletzt</th><th></th></tr>` + c.routes.map((r, i) => `<tr><td>${esc(g.partnerById(r.partner)?.name || '?')}</td><td>${r.dir === 'buy' ? 'Kauf' : 'Verkauf'}: ${r.cargo.map(x => `${x.qty} ${esc(keyName(x.key))}`).join(', ')}</td><td>${TRANSPORT[r.mode].icon}</td><td class="n">${r.every} Tage</td><td>${esc(r.lastResult || '–')}</td><td><button class="btn tiny" data-rt="${i}">${r.active ? '⏸' : '▶'}</button> <button class="btn tiny" data-rd="${i}">✕</button></td></tr>`).join('') + '</table>';
    const mine = g.state.merchants.filter(m => m.home === c.id);
    html += `<h3>Unterwegs (${mine.length})</h3>` + (mine.length ? `<table class="t"><tr><th>Ziel</th><th>Ladung</th><th>Mittel</th><th>Status</th></tr>${mine.map(m => `<tr><td>${esc(g.partnerById(m.partner)?.name || '?')}</td><td>${m.dir === 'buy' ? 'Kauf' : 'Verkauf'}: ${m.cargo.map(x => `${x.qty} ${esc(keyName(x.key))}`).join(', ')}</td><td>${TRANSPORT[m.mode].icon}</td><td>${m.t < m.hours ? `Hinweg, noch ${hoursText(m.hours - m.t)}` : `Rückweg, noch ${hoursText(2 * m.hours - m.t)}`}</td></tr>`).join('')}</table>` : '<p class="hint">Keine Händler unterwegs.</p>');
    body.innerHTML = html;
    body.querySelectorAll('[data-p]').forEach(tr => tr.onclick = () => { const id = tr.dataset.p; this.tradePartner = isNaN(+id) ? id : +id; this.refreshWindow(); });
    const o = this.order;
    body.querySelectorAll('[data-o]').forEach(s => s.onchange = () => { o[s.dataset.o] = s.value; s.blur(); this.refreshWindow(); });
    body.querySelectorAll('[data-row]').forEach(s => s.onchange = () => { const r = o.rows[+s.dataset.row]; r[s.dataset.f] = s.dataset.f === 'qty' ? Math.max(1, +s.value) : s.value; s.blur(); this.refreshWindow(); });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { o.rows.splice(+b.dataset.del, 1); this.refreshWindow(); });
    const ar = body.querySelector('[data-a=addrow]'); if (ar) ar.onclick = () => { o.rows.push({ key: 'stein', qty: 10 }); this.refreshWindow(); };
    const ev = body.querySelector('[data-a=every]'); if (ev) ev.onchange = () => { this.routeEvery = Math.max(1, +ev.value); ev.blur(); };
    const send = body.querySelector('[data-a=send]');
    if (send) send.onclick = () => { const r = g.dispatch(c, partner, o.mode, o.rows, o.dir); this.hooks.toast(r.ok ? 'Händler ist aufgebrochen.' : r.reason); this.refreshWindow(); };
    const rt = body.querySelector('[data-a=route]');
    if (rt) rt.onclick = () => { c.routes.push({ partner: partner.id, mode: o.mode, cargo: o.rows.map(r => ({ ...r })), dir: o.dir, every: this.routeEvery || 7, active: true, lastDay: null }); this.hooks.toast('Route gespeichert.'); this.refreshWindow(); };
    body.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { const r = c.routes[+b.dataset.rt]; r.active = !r.active; this.refreshWindow(); });
    body.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => { c.routes.splice(+b.dataset.rd, 1); this.refreshWindow(); });
  }

  win_research(body) {
    const g = this.game, c = g.player, r = c.research;
    const era = g.cityEra(c);
    const cur = r.current ? TECHS[r.current] : null;
    let html = `<p>Wissen: <b>${fmt(c.knowledge, 1)}</b> Punkte pro Tag · Zeitalter: <b>${ERAS[era - 1].name}</b> · ${ERA_THRESHOLD} Forschungen eines Zeitalters öffnen das nächste.</p>`;
    if (cur) html += `<p>Aktuell: <b>${esc(cur.name)}</b> – ${fmt(r.points)} / ${fmt(cur.cost)} <span class="hint">(noch ≈ ${hoursText(Math.max(0, cur.cost - r.points) / Math.max(0.1, c.knowledge) * 24)})</span></p><div class="bar-meter"><div style="width:${pct(r.points / cur.cost)}"></div></div>`;
    else html += `<p class="neg">Keine Forschung gewählt. Ungenutztes Wissen wird nur zur Hälfte angespart (${fmt(r.points)} Punkte).</p>`;
    if (r.queue?.length) html += `<p>Warteschlange: ${r.queue.map(t => esc(TECHS[t].name)).join(' → ')} <button class="btn tiny" data-a="clearq">leeren</button></p>`;
    html += `<p class="hint">Klick wählt die Forschung, Umschalt+Klick reiht sie ein.</p><div class="tech-cols">`;
    for (const e of ERAS) {
      html += `<div class="tech-col"><h4>${esc(e.name)}</h4>`;
      for (const id of TECH_IDS.filter(t => TECHS[t].era === e.id)) {
        const t = TECHS[id];
        const done = g.techDone(c, id), av = g.techAvailable(c, id);
        const cls = done ? 'done' : id === r.current ? 'cur' : av ? 'avail' : 'locked';
        html += `<div class="tech ${cls}" data-t="${id}"><div class="nm">${done ? '✔ ' : ''}${esc(t.name)}</div><div>${esc(t.desc)}</div><div class="rq">${fmt(t.cost)} Wissen${t.req.length ? ' · braucht ' + t.req.map(q => esc(TECHS[q].name)).join(', ') : ''}</div></div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    body.innerHTML = html;
    body.querySelectorAll('.tech.avail, .tech.locked').forEach(el => el.onclick = e => {
      const id = el.dataset.t;
      if (e.shiftKey || !g.techAvailable(c, id)) {
        if (g.techDone(c, id)) return;
        r.queue ||= [];
        if (!r.queue.includes(id)) r.queue.push(id);
        if (!r.current) r.current = r.queue.shift();
      } else r.current = id;
      this.refreshWindow(); this.renderTopbar();
    });
    const cq = body.querySelector('[data-a=clearq]'); if (cq) cq.onclick = () => { r.queue = []; this.refreshWindow(); };
  }

  win_diplo(body) {
    const g = this.game, c = g.player;
    let html = `<p>Gute Beziehungen senken Zölle. Ein Handelsabkommen (ab Beziehung +25, kostet ${g.agreementCost()} Gold) hebt sie ganz auf. Handel verbessert die Beziehung, Grenzkonflikte um Provinzen verschlechtern sie.</p>
      <table class="t"><tr><th>Stadt</th><th class="n">Einwohner</th><th class="n">Entfernung</th><th>Beziehung</th><th class="n">Zoll</th><th>Abkommen</th><th></th></tr>`;
    for (const o of g.state.cities.filter(x => x !== c)) {
      const r = g.rel(o.id), route = g.route(c, o, 'fuss');
      html += `<tr><td>${esc(o.name)}</td><td class="n">${o.pop}</td><td class="n">${route ? hoursText(route.hours) : '–'}</td>
        <td><div class="bar-meter" title="${Math.round(r.rel)}"><div style="width:${(r.rel + 100) / 2}%"></div></div></td>
        <td class="n">${pct(g.tariff(c, o))}</td><td>${r.agreement ? '✔' : `<button class="btn tiny" data-ag="${o.id}" ${r.rel >= 25 ? '' : 'disabled'}>schließen</button>`}</td>
        <td><button class="btn tiny" data-gift="${o.id}">🎁 100</button> <button class="btn tiny" data-tr="${o.id}">Handel</button></td></tr>`;
    }
    html += '</table>';
    body.innerHTML = html;
    body.querySelectorAll('[data-ag]').forEach(b => b.onclick = () => { const r = g.makeAgreement(+b.dataset.ag); this.hooks.toast(r.ok ? 'Abkommen geschlossen.' : r.reason); this.refreshWindow(); });
    body.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => { this.hooks.toast(g.gift(+b.dataset.gift, 100) ? 'Geschenk überbracht.' : 'Nicht genug Gold.'); this.refreshWindow(); });
    body.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { this.tradePartner = +b.dataset.tr; this.openWindow('trade'); });
  }

  win_stats(body) {
    const g = this.game, st = g.state;
    const rank = st.cities.slice().sort((a, b) => b.pop - a.pop);
    let html = `<h3>Entwicklung deiner Stadt</h3><canvas class="chart" id="chart"></canvas><div class="legend"><span><i style="background:#2e6ab0"></i>Einwohner</span><span><i style="background:#c9a227"></i>Gold</span><span><i style="background:#3a8a4a"></i>Gebäude</span></div>
      <h3>Rangliste</h3><table class="t"><tr><th>#</th><th>Stadt</th><th class="n">Einwohner</th><th class="n">Gebäude</th><th class="n">Prestige</th><th class="n">Gold</th><th>Zeitalter</th></tr>
      ${rank.map((c, i) => `<tr style="${c.player ? 'font-weight:bold;background:#f3e3b0' : ''}"><td>${i + 1}</td><td><i style="display:inline-block;width:10px;height:10px;background:${c.color}"></i> ${esc(c.name)}</td><td class="n">${c.pop}</td><td class="n">${c.buildings.length}</td><td class="n">${fmt(c.prestige)}</td><td class="n">${fmtShort(c.money)}</td><td>${ERAS[g.cityEra(c) - 1].name}</td></tr>`).join('')}</table>`;
    body.innerHTML = html;
    const cv = body.querySelector('#chart');
    cv.width = cv.clientWidth * (window.devicePixelRatio || 1); cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
    const ctx = cv.getContext('2d'); ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight, data = st.history.monthly;
    ctx.font = '12px Georgia'; ctx.fillStyle = '#5a4630';
    if (data.length < 2) { ctx.fillText('Noch zu wenig Daten – die Statistik wird monatlich erfasst.', 14, 24); return; }
    const series = [['pop', '#2e6ab0'], ['money', '#c9a227'], ['b', '#3a8a4a']];
    for (const [k, col] of series) {
      const max = Math.max(1, ...data.map(d => d[k]));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      data.forEach((d, i) => { const x = 30 + i / (data.length - 1) * (W - 40), y = H - 20 - Math.max(0, d[k]) / max * (H - 40); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(fmtShort(max), W - 60, 14 + series.findIndex(s => s[0] === k) * 14);
    }
    ctx.fillStyle = '#5a4630'; ctx.fillText(fmtDate(data[0].h), 30, H - 4); ctx.textAlign = 'right'; ctx.fillText(fmtDate(data[data.length - 1].h), W - 10, H - 4);
  }

  win_menu(body) {
    body.innerHTML = `<div class="cards">
      <div class="card"><h4>Spielstand</h4><p>Slot ${this.slot}: <b>${esc(this.game.state.saveName || '')}</b></p><p class="hint">Automatisches Speichern alle 5 Minuten.</p>
        <div class="row"><button class="btn primary" data-a="save">Speichern</button><button class="btn" data-a="exit">Speichern & Hauptmenü</button><button class="btn danger" data-a="quit">Ohne Speichern verlassen</button></div></div>
      <div class="card"><h4>Steuerung</h4><div class="kv">
        <span>Karte bewegen</span><span>Ziehen mit der Maus, WASD oder Pfeiltasten</span>
        <span>Zoom</span><span>Mausrad, + / −</span>
        <span>Pause / Tempo</span><span>Leertaste / 1–5</span>
        <span>Abbrechen</span><span>Rechtsklick oder Esc</span>
        <span>Straße / Abriss</span><span>R / X</span>
        <span>Fenster</span><span>C Stadt, M Markt, T Handel, F Forschung</span></div></div>
      <div class="card"><h4>Kartenansicht</h4><p>Unten links: 🗺️ Gelände, 🏰 Politisch, ⛏️ Lagerstätten.</p><p>Seed dieser Karte: <b>${esc(this.game.state.params.seed)}</b></p></div>
    </div>`;
    body.querySelector('[data-a=save]').onclick = () => this.save(false).catch(e => this.hooks.toast('Speichern fehlgeschlagen: ' + e.message, 4000));
    body.querySelector('[data-a=exit]').onclick = async () => { try { if (this.game.player) await this.save(true); this.hooks.exit(); } catch (e) { this.hooks.toast('Speichern fehlgeschlagen: ' + e.message, 4000); } };
    body.querySelector('[data-a=quit]').onclick = async () => { const ok = await this.hooks.modal('<p>Ungespeicherte Fortschritte gehen verloren. Wirklich verlassen?</p>', [{ label: 'Abbrechen', value: false }, { label: 'Verlassen', value: true, danger: true }]); if (ok) { this.dirty = false; this.hooks.exit(); } };
  }

  showEnd() {
    const g = this.game, st = g.state, p = g.player;
    st.speed = 0;
    const rank = st.cities.slice().sort((a, b) => b.pop - a.pop);
    const place = rank.indexOf(p) + 1;
    const richest = st.cities.slice().sort((a, b) => b.money - a.money)[0];
    this.hooks.modal(`<h2>Das Jahr ${END_YEAR} ist angebrochen</h2>
      <p>Eine Epoche geht zu Ende. So steht ${esc(p.name)} da:</p>
      <div class="kv"><span>Platz nach Einwohnern</span><span><b>${place}.</b> von ${rank.length}</span><span>Einwohner</span><span>${p.pop}</span><span>Gebäude</span><span>${p.buildings.length}</span><span>Gold</span><span>${fmtShort(p.money)}</span><span>Zeitalter</span><span>${ERAS[g.cityEra(p) - 1].name}</span><span>Forschungen</span><span>${p.research.done.length} / ${TECH_IDS.length}</span><span>Provinzen</span><span>${p.provinces.length}</span><span>Reichste Stadt</span><span>${esc(richest.name)}</span></div>
      <h3>Rangliste</h3><table class="t">${rank.slice(0, 10).map((c, i) => `<tr style="${c.player ? 'font-weight:bold' : ''}"><td>${i + 1}.</td><td>${esc(c.name)}</td><td class="n">${c.pop} Einw.</td></tr>`).join('')}</table>
      <p>Du kannst ohne Ende weiterspielen.</p>`, [{ label: 'Weiterspielen', value: true, primary: true }]);
  }

  updateModeButtons() { document.querySelectorAll('#minimap-wrap [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === this.renderer.mode)); }
}
