// Kleine Hülle um die Server-API
async function req(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) { const e = new Error((data && data.error) || `Fehler ${res.status}`); e.status = res.status; throw e; }
  return data;
}
export const api = {
  config: () => req('GET', '/api/config'),
  me: () => req('GET', '/api/me'),
  login: (username, password) => req('POST', '/api/login', { username, password }),
  register: (username, password) => req('POST', '/api/register', { username, password }),
  logout: () => req('POST', '/api/logout'),
  password: (oldPassword, newPassword) => req('POST', '/api/password', { oldPassword, newPassword }),
  slots: () => req('GET', '/api/slots'),
  load: n => req('GET', `/api/slots/${n}`),
  save: (n, state, meta) => req('PUT', `/api/slots/${n}`, { state, meta }),
  remove: n => req('DELETE', `/api/slots/${n}`),
};
