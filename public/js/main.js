// Einstieg: Anmeldung, Spielstände, neues Spiel, Laden
import { api } from './api.js';
import { Game, fmtDate } from './sim.js';
import { GameUI } from './ui.js';
import { fmt } from './util.js';

const $ = s => document.querySelector(s);
const screens = ['login', 'slots', 'new', 'loading', 'game'];
function show(name) { for (const s of screens) $(`#screen-${s}`).classList.toggle('hidden', s !== name); }

export function modal(html, buttons = [{ label: 'OK', value: true, primary: true }]) {
  return new Promise(resolve => {
    const m = $('#modal');
    m.querySelector('.modal-body').innerHTML = html;
    const acts = m.querySelector('.modal-actions'); acts.innerHTML = '';
    const close = v => { m.classList.add('hidden'); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && buttons.find(b => b.primary)) { e.preventDefault(); close(collect(buttons.find(b => b.primary).value)); } };
    const collect = v => { if (v !== 'form') return v; const out = {}; m.querySelectorAll('[name]').forEach(i => out[i.name] = i.value); return out; };
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label; el.type = 'button';
      el.onclick = () => close(collect(b.value));
      acts.appendChild(el);
    }
    m.classList.remove('hidden');
    document.addEventListener('keydown', onKey);
    const first = m.querySelector('input'); if (first) setTimeout(() => first.focus(), 30);
  });
}
export function toast(text, ms = 2200) {
  const t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------ Anmeldung
let config = { allowRegistration: true };
async function boot() {
  try { config = await api.config(); } catch { }
  if (!config.allowRegistration) $('#btn-register').classList.add('hidden');
  try { const me = await api.me(); $('#user-name').textContent = me.username; await showSlots(); }
  catch { show('login'); }
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { const me = await api.login(f.get('username'), f.get('password')); $('#user-name').textContent = me.username; $('#login-err').textContent = ''; await showSlots(); }
  catch (err) { $('#login-err').textContent = err.message; }
});
$('#btn-register').addEventListener('click', async () => {
  const f = new FormData($('#login-form'));
  try { const me = await api.register(f.get('username'), f.get('password')); $('#user-name').textContent = me.username; $('#login-err').textContent = ''; await showSlots(); }
  catch (err) { $('#login-err').textContent = err.message; }
});
$('#btn-logout').addEventListener('click', async e => { e.preventDefault(); await api.logout(); show('login'); });
$('#btn-pw').addEventListener('click', async e => {
  e.preventDefault();
  const r = await modal(`<h3>Passwort ändern</h3><label>Altes Passwort<input type="password" name="old"></label><label>Neues Passwort<input type="password" name="neu" minlength="6"></label>`, [{ label: 'Abbrechen', value: null }, { label: 'Ändern', value: 'form', primary: true }]);
  if (!r) return;
  try { await api.password(r.old, r.neu); toast('Passwort geändert.'); } catch (err) { toast(err.message, 3500); }
});

// ------------------------------------------------------------ Spielstände
async function showSlots() {
  show('slots');
  const list = $('#slot-list');
  list.innerHTML = '<div class="hint">Lade …</div>';
  let slots;
  try { slots = await api.slots(); } catch (e) { if (e.status === 401) return show('login'); list.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  list.innerHTML = '';
  for (const s of slots) {
    const el = document.createElement('div');
    el.className = 'slot';
    if (s.empty) {
      el.innerHTML = `<div class="noimg">∅</div><div class="meta"><b>Slot ${s.slot} – leer</b><div>Hier ist noch kein Spielstand.</div></div><div class="acts"><button class="btn primary" data-a="new">Neues Spiel</button></div>`;
    } else {
      const saved = new Date(s.savedAt).toLocaleString('de-DE');
      const h = Math.floor(s.playTime / 3600), m = Math.floor(s.playTime / 60) % 60;
      el.innerHTML = `${s.preview ? `<img src="${s.preview}" alt="">` : '<div class="noimg">🗺️</div>'}
        <div class="meta"><b>Slot ${s.slot}: ${esc(s.name)}</b>
          <div>${s.cityName ? `Stadt <b>${esc(s.cityName)}</b> · ${fmt(s.population)} Einwohner` : 'Noch keine Stadt gegründet'}</div>
          <div>Spieldatum: ${esc(s.gameDate)} · Spielzeit ${h} h ${m} min</div>
          <div>Gespeichert: ${saved}</div></div>
        <div class="acts"><button class="btn primary" data-a="load">Fortsetzen</button><button class="btn" data-a="new">Neu beginnen</button><button class="btn danger" data-a="del">Löschen</button></div>`;
    }
    el.querySelector('[data-a=new]').onclick = async () => {
      if (!s.empty) { const ok = await modal(`<p>Slot ${s.slot} enthält <b>${esc(s.name)}</b>. Wirklich überschreiben?</p>`, [{ label: 'Abbrechen', value: false }, { label: 'Überschreiben', value: true, danger: true }]); if (!ok) return; }
      showNew(s.slot);
    };
    const ld = el.querySelector('[data-a=load]'); if (ld) ld.onclick = () => loadSlot(s.slot);
    const del = el.querySelector('[data-a=del]');
    if (del) del.onclick = async () => {
      const ok = await modal(`<p>Spielstand <b>${esc(s.name)}</b> in Slot ${s.slot} endgültig löschen?</p>`, [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, danger: true }]);
      if (!ok) return;
      await api.remove(s.slot); toast('Spielstand gelöscht.'); showSlots();
    };
    list.appendChild(el);
  }
}

// ------------------------------------------------------------ Neues Spiel
let newSlot = 1;
const randomSeed = () => Math.random().toString(36).slice(2, 9);
function showNew(n) {
  newSlot = n;
  $('#new-slot-n').textContent = n;
  const f = $('#new-form');
  f.seed.value = randomSeed();
  f.name.value = `Kronland ${n}`;
  show('new');
}
$('#btn-reseed').onclick = () => { $('#new-form').seed.value = randomSeed(); };
$('#new-form').cities.oninput = e => { $('#cities-val').textContent = e.target.value; };
$('#btn-new-back').onclick = () => showSlots();
$('#new-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  show('loading'); $('#loading-text').textContent = 'Die Welt entsteht …';
  await new Promise(r => setTimeout(r, 30));
  const game = Game.create({ seed: f.get('seed') || randomSeed(), cities: +f.get('cities'), mapType: f.get('mapType'), difficulty: f.get('difficulty') });
  game.state.saveName = f.get('name') || `Kronland ${newSlot}`;
  start(game, newSlot, true);
});

async function loadSlot(n) {
  show('loading'); $('#loading-text').textContent = 'Spielstand wird geladen …';
  try {
    const state = await api.load(n);
    await new Promise(r => setTimeout(r, 30));
    const game = Game.load(state);
    start(game, n, false);
  } catch (e) {
    toast('Laden fehlgeschlagen: ' + e.message, 4000);
    showSlots();
  }
}

let ui = null;
function start(game, slot, fresh) {
  show('game');
  ui = new GameUI(game, slot, {
    save: async (silent) => {
      const p = game.player;
      const meta = { name: game.state.saveName || `Spielstand ${slot}`, cityName: p ? p.name : '', gameDate: fmtDate(game.state.hour), playTime: Math.round(game.state.playTime), population: p ? p.pop : 0, preview: ui.renderer.thumbnail() };
      await api.save(slot, game.serialize(), meta);
      if (!silent) toast('Spiel gespeichert.');
    },
    exit: () => { ui.destroy(); ui = null; showSlots(); },
    modal, toast,
  });
  window.__kronland = ui;
  if (fresh) ui.save(true).catch(() => {});
}

window.addEventListener('beforeunload', e => { if (ui && ui.dirty) { e.preventDefault(); e.returnValue = ''; } });
boot();
