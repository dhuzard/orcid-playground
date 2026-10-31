// Team-workspace backend client (docs/team-workspaces.md), with no SDK: REST only.
// 1. A verified ORCID ID token goes to our exchange function, which returns a
//    Firebase custom token whose uid is the ORCID iD.
// 2. Identity Toolkit turns it into a Firebase ID token (1 hour) and refresh token.
// 3. Firestore REST calls carry that ID token; firestore.rules decide everything.
// Tokens are kept in sessionStorage: they end with the browser tab session.
import { config } from '/auth.js';

const KEY = 'orcid-playground-cloud';
const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
const write = value => { try { value ? sessionStorage.setItem(KEY, JSON.stringify(value)) : sessionStorage.removeItem(KEY); } catch { /* tab-only session */ } };

let settings = null;
async function cloudConfig() {
  settings ??= (await config()).cloud || null;
  return settings;
}

export async function available() {
  const c = await cloudConfig();
  return Boolean(c?.apiKey && c?.projectId && c?.exchangeUrl);
}

export function session() {
  const s = read();
  return s ? { orcid: s.orcid, name: s.name } : null;
}

export function signOutCloud() { write(null); }

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `HTTP ${response.status}`);
  return body;
}

// Called right after ORCID sign-in with the token auth.js verified.
export async function exchange(orcidIdToken) {
  const c = await cloudConfig();
  if (!c || !orcidIdToken) return null;
  const minted = await json(await fetch(c.exchangeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_token: orcidIdToken }) }));
  const signed = await json(await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(c.apiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: minted.custom_token, returnSecureToken: true }) }));
  write({ orcid: minted.orcid, name: minted.name, idToken: signed.idToken, refreshToken: signed.refreshToken, expiresAt: Date.now() + Number(signed.expiresIn) * 1000 });
  return session();
}

async function idToken() {
  const s = read();
  if (!s) throw new Error('Sign in with ORCID to open team workspaces.');
  if (Date.now() < s.expiresAt - 60000) return s.idToken;
  const c = await cloudConfig();
  const fresh = await json(await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(c.apiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken }) }));
  write({ ...s, idToken: fresh.id_token, refreshToken: fresh.refresh_token, expiresAt: Date.now() + Number(fresh.expires_in) * 1000 });
  return fresh.id_token;
}

// ---- Firestore REST -------------------------------------------------------

const root = async () => `projects/${(await cloudConfig()).projectId}/databases/(default)/documents`;
const api = async path => `https://firestore.googleapis.com/v1/${path}`;

export function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
  return { stringValue: String(value) };
}

export function decode(value) {
  if (!value || 'nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return fields(value.mapValue.fields);
  return null;
}

const fields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, decode(v)]));
const fromDoc = d => ({ id: d.name.split('/').pop(), path: d.name.split('/documents/')[1], ...fields(d.fields) });

async function call(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken()}`, ...(init.headers || {}) } });
  if (response.status === 404) return null;
  return json(response);
}

export async function get(path) {
  const doc = await call(await api(`${await root()}/${path}`));
  return doc ? fromDoc(doc) : null;
}

export async function list(path) {
  const page = await call(await api(`${await root()}/${path}?pageSize=300`));
  return (page?.documents || []).map(fromDoc);
}

export async function remove(path) {
  await call(await api(`${await root()}/${path}`), { method: 'DELETE' });
}

// Atomic writes: [{ set: path, data, mustNotExist?, mask? } | { remove: path }]
export async function commit(writes) {
  const base = await root();
  const body = { writes: writes.map(w => w.remove ? { delete: `${base}/${w.remove}` } : {
    update: { name: `${base}/${w.set}`, fields: encode(w.data).mapValue.fields },
    ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
    ...(w.mustNotExist ? { currentDocument: { exists: false } } : w.mustExist ? { currentDocument: { exists: true } } : {}),
  }) };
  return call(await api(`${base}:commit`), { method: 'POST', body: JSON.stringify(body) });
}

// Collection-group query: documents in any `collection` where field == value.
export async function findAll(collection, field, value) {
  const rows = await call(await api(`${await root()}:runQuery`), { method: 'POST', body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: collection, allDescendants: true }],
    where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encode(value) } },
  } }) });
  return (rows || []).filter(r => r.document).map(r => fromDoc(r.document));
}
