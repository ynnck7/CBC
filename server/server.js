// Kronland – Spielserver
// Kein externes Paket nötig: reines Node.js (http, crypto, fs, zlib).
// Liefert die statischen Spieldateien aus und bietet eine kleine REST-API
// für Benutzerkonten und 5 Speicherslots pro Benutzer.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ALLOW_REGISTRATION = (process.env.ALLOW_REGISTRATION ?? 'true').toLowerCase() !== 'false';
const SECURE_COOKIE = (process.env.SECURE_COOKIE ?? 'false').toLowerCase() === 'true';
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '30', 10);
const MAX_BODY = 25 * 1024 * 1024;
const SLOT_COUNT = 5;

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SAVES_DIR = path.join(DATA_DIR, 'saves');

fs.mkdirSync(SAVES_DIR, { recursive: true });

// ---------------------------------------------------------------- Speicher
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

let users = readJson(USERS_FILE, {});        // name(lowercase) -> {name, salt, hash, created}
let sessions = readJson(SESSIONS_FILE, {});  // token -> {user, expires}

function saveUsers() { writeJsonAtomic(USERS_FILE, users); }
let sessionSaveTimer = null;
function saveSessionsSoon() {
  if (sessionSaveTimer) return;
  sessionSaveTimer = setTimeout(() => { sessionSaveTimer = null; writeJsonAtomic(SESSIONS_FILE, sessions); }, 500);
}
function pruneSessions() {
  const now = Date.now();
  let changed = false;
  for (const [t, s] of Object.entries(sessions)) if (s.expires < now) { delete sessions[t]; changed = true; }
  if (changed) saveSessionsSoon();
}
setInterval(pruneSessions, 3600_000).unref();

// ---------------------------------------------------------------- Passwörter
function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function verifyPassword(pw, salt, hash) {
  const h = Buffer.from(hashPassword(pw, salt), 'hex');
  const ref = Buffer.from(hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}

// Einfache Bremse gegen Passwort-Raten: pro IP max. 10 Fehlversuche in 10 Minuten.
const failed = new Map();
function tooManyFailures(ip) {
  const e = failed.get(ip);
  if (!e) return false;
  if (Date.now() - e.first > 600_000) { failed.delete(ip); return false; }
  return e.count >= 10;
}
function noteFailure(ip) {
  const e = failed.get(ip);
  if (!e || Date.now() - e.first > 600_000) failed.set(ip, { first: Date.now(), count: 1 });
  else e.count++;
}

// ---------------------------------------------------------------- HTTP-Helfer
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Zu groß'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Ungültiges JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function clientIp(req) {
  return (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}
function currentUser(req) {
  const tok = parseCookies(req).kl_session;
  if (!tok) return null;
  const s = sessions[tok];
  if (!s || s.expires < Date.now()) return null;
  return users[s.user] ? s.user : null;
}
function sessionCookie(token, maxAgeSec) {
  return `kl_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${SECURE_COOKIE ? '; Secure' : ''}`;
}

// ---------------------------------------------------------------- Spielstände
function userDir(user) {
  // Benutzername ist bereits auf [a-z0-9_.-] beschränkt
  return path.join(SAVES_DIR, user);
}
function slotFile(user, n) { return path.join(userDir(user), `slot${n}.json.gz`); }
function metaFile(user, n) { return path.join(userDir(user), `slot${n}.meta.json`); }

async function listSlots(user) {
  const out = [];
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const meta = readJson(metaFile(user, n), null);
    out.push(meta ? { slot: n, ...meta } : { slot: n, empty: true });
  }
  return out;
}

// ---------------------------------------------------------------- Statische Dateien
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};
async function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, p));
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, 'Verboten');
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return send(res, 404, 'Nicht gefunden');
    const ext = path.extname(full);
    const accept = req.headers['accept-encoding'] || '';
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' };
    const data = await fsp.readFile(full);
    if (/\bgzip\b/.test(accept) && ['.js', '.css', '.html', '.svg', '.json'].includes(ext)) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(zlib.gzipSync(data));
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  } catch {
    send(res, 404, 'Nicht gefunden');
  }
}

// ---------------------------------------------------------------- API
async function handleApi(req, res, url) {
  const m = req.method;
  const p = url.pathname;

  if (p === '/api/health') return send(res, 200, { ok: true });

  if (p === '/api/config' && m === 'GET') return send(res, 200, { allowRegistration: ALLOW_REGISTRATION, slots: SLOT_COUNT });

  if (p === '/api/register' && m === 'POST') {
    if (!ALLOW_REGISTRATION) return send(res, 403, { error: 'Registrierung ist deaktiviert.' });
    const { username, password } = await readBody(req);
    const name = String(username || '').trim();
    const key = name.toLowerCase();
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(name)) return send(res, 400, { error: 'Benutzername: 3–24 Zeichen, nur Buchstaben, Ziffern, _ . -' });
    if (String(password || '').length < 6) return send(res, 400, { error: 'Passwort muss mindestens 6 Zeichen haben.' });
    if (users[key]) return send(res, 409, { error: 'Benutzername ist bereits vergeben.' });
    const salt = crypto.randomBytes(16).toString('hex');
    users[key] = { name, salt, hash: hashPassword(String(password), salt), created: Date.now() };
    saveUsers();
    fs.mkdirSync(userDir(key), { recursive: true });
    return loginResponse(res, key);
  }

  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (tooManyFailures(ip)) return send(res, 429, { error: 'Zu viele Fehlversuche. Bitte 10 Minuten warten.' });
    const { username, password } = await readBody(req);
    const key = String(username || '').trim().toLowerCase();
    const u = users[key];
    if (!u || !verifyPassword(String(password || ''), u.salt, u.hash)) {
      noteFailure(ip);
      return send(res, 401, { error: 'Benutzername oder Passwort falsch.' });
    }
    return loginResponse(res, key);
  }

  if (p === '/api/logout' && m === 'POST') {
    const tok = parseCookies(req).kl_session;
    if (tok && sessions[tok]) { delete sessions[tok]; saveSessionsSoon(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const user = currentUser(req);
  if (p === '/api/me' && m === 'GET') {
    if (!user) return send(res, 401, { error: 'Nicht angemeldet' });
    return send(res, 200, { username: users[user].name });
  }
  if (!user) return send(res, 401, { error: 'Nicht angemeldet' });

  if (p === '/api/password' && m === 'POST') {
    const { oldPassword, newPassword } = await readBody(req);
    const u = users[user];
    if (!verifyPassword(String(oldPassword || ''), u.salt, u.hash)) return send(res, 401, { error: 'Altes Passwort falsch.' });
    if (String(newPassword || '').length < 6) return send(res, 400, { error: 'Neues Passwort zu kurz.' });
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPassword(String(newPassword), u.salt);
    saveUsers();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/slots' && m === 'GET') return send(res, 200, await listSlots(user));

  const sm = p.match(/^\/api\/slots\/([1-9])$/);
  if (sm) {
    const n = parseInt(sm[1], 10);
    if (n < 1 || n > SLOT_COUNT) return send(res, 404, { error: 'Slot existiert nicht' });
    fs.mkdirSync(userDir(user), { recursive: true });
    if (m === 'GET') {
      try {
        const buf = await fsp.readFile(slotFile(user, n));
        const json = zlib.gunzipSync(buf).toString('utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(json);
      } catch {
        return send(res, 404, { error: 'Slot ist leer' });
      }
    }
    if (m === 'PUT') {
      const body = await readBody(req);
      if (!body || typeof body.state !== 'object' || typeof body.meta !== 'object') return send(res, 400, { error: 'state und meta erwartet' });
      const meta = {
        name: String(body.meta.name || 'Spielstand').slice(0, 60),
        cityName: String(body.meta.cityName || '').slice(0, 60),
        gameDate: String(body.meta.gameDate || '').slice(0, 40),
        playTime: Number(body.meta.playTime) || 0,
        population: Number(body.meta.population) || 0,
        preview: typeof body.meta.preview === 'string' && body.meta.preview.length < 400_000 ? body.meta.preview : null,
        savedAt: Date.now(),
      };
      const gz = zlib.gzipSync(JSON.stringify(body.state));
      const tmp = slotFile(user, n) + '.tmp';
      await fsp.writeFile(tmp, gz);
      await fsp.rename(tmp, slotFile(user, n));
      writeJsonAtomic(metaFile(user, n), meta);
      return send(res, 200, { ok: true, savedAt: meta.savedAt });
    }
    if (m === 'DELETE') {
      await fsp.rm(slotFile(user, n), { force: true });
      await fsp.rm(metaFile(user, n), { force: true });
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Unbekannter Endpunkt' });
}

function loginResponse(res, key) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { user: key, expires: Date.now() + SESSION_DAYS * 86400_000 };
  saveSessionsSoon();
  return send(res, 200, { username: users[key].name }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
}

// ---------------------------------------------------------------- Start
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    if (url.pathname.startsWith('/api/')) {
      // Schutz gegen Cross-Site-Anfragen: schreibende Aufrufe nur vom eigenen Origin
      if (req.method !== 'GET' && req.headers.origin) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (new URL(req.headers.origin).host !== host) return send(res, 403, { error: 'Fremder Ursprung' });
      }
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Methode nicht erlaubt');
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Serverfehler' });
  }
});

server.listen(PORT, () => {
  console.log(`Kronland läuft auf Port ${PORT} – Daten in ${DATA_DIR} – Registrierung ${ALLOW_REGISTRATION ? 'offen' : 'geschlossen'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { writeJsonAtomic(SESSIONS_FILE, sessions); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
