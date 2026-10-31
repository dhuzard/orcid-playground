// Offline tests for the "Sign in with ORCID" implicit flow (auth.js). No network:
// keys are generated locally, JWTs are signed here, and fetch/location/history/
// sessionStorage are replaced by in-memory fakes on globalThis.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { completeSignIn, current, signIn, signOut } from './auth.js';

const CLIENT = 'APP-TESTCLIENT0000001';
const ORIGIN = 'https://orcid-playground-889.web.app';
const JWKS_URL = 'https://orcid.org/oauth/jwks';
const PENDING = 'orcid-playground-signin-pending';
const SESSION = 'orcid-playground-signin';
const GLOBALS = ['location', 'history', 'sessionStorage', 'fetch'];

const subtle = globalThis.crypto.subtle;
const b64url = data => Buffer.from(data).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

async function makeKey(kid) {
  const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const { kty, e, n } = await subtle.exportKey('jwk', pair.publicKey);
  // Same shape as the live https://orcid.org/oauth/jwks entry: no alg, key_ops or ext.
  return { kid, privateKey: pair.privateKey, jwk: { kty, e, use: 'sig', kid, n } };
}

async function sign(key, claims, { kid = key.kid, alg = 'RS256', rawPayload } = {}) {
  const header = b64url(JSON.stringify({ kid, alg }));
  const payload = b64url(rawPayload ?? JSON.stringify(claims));
  const signature = await subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

function claimsFor(nonce, overrides = {}) {
  const iat = now();
  return { at_hash: 'ignored', aud: CLIENT, sub: '0000-0002-1825-0097', auth_time: iat, iss: 'https://orcid.org', name: 'Credit Name', exp: iat + 600, given_name: 'Josiah', iat, nonce, family_name: 'Carberry', jti: 'test-jti', ...overrides };
}

let keyA;
let keyB;
let jwks;
let storage;
let replaced;
let assigned;
let fetched;
let saved;

const setGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

function installBrowser({ hash = '', search = '', pathname = '/' } = {}) {
  storage = new Map();
  replaced = [];
  assigned = [];
  fetched = [];
  const location = {
    origin: ORIGIN, pathname, search, hash,
    assign(url) { assigned.push(url); },
  };
  setGlobal('location', location);
  setGlobal('history', {
    replaceState(_state, _title, url) {
      replaced.push(url);
      const parsed = new URL(url, ORIGIN);
      Object.assign(location, { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash });
    },
  });
  setGlobal('sessionStorage', {
    getItem: name => (storage.has(name) ? storage.get(name) : null),
    setItem: (name, value) => { storage.set(name, String(value)); },
    removeItem: name => { storage.delete(name); },
  });
  setGlobal('fetch', async (url, options) => {
    fetched.push(url);
    assert.equal(url, JWKS_URL, 'only the ORCID JWKS may be fetched');
    assert.equal(options, undefined);
    return { ok: true, json: async () => structuredClone(jwks) };
  });
}

function pending(state = 'state-123', nonce = 'nonce-456') {
  storage.set(PENDING, JSON.stringify({ state, nonce }));
  return { state, nonce };
}

function redirectWith(params) {
  globalThis.location.hash = `#${new URLSearchParams(params)}`;
}

beforeEach(async () => {
  saved = Object.fromEntries(GLOBALS.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  keyA ??= await makeKey('production-orcid-org-test-a');
  keyB ??= await makeKey('production-orcid-org-test-b');
  jwks = { keys: [keyA.jwk] };
  installBrowser();
});

afterEach(() => {
  for (const [name, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test('signIn asks ORCID for the documented implicit OpenID response', () => {
  signIn(CLIENT);
  assert.equal(assigned.length, 1);
  const url = new URL(assigned[0]);
  assert.equal(`${url.origin}${url.pathname}`, 'https://orcid.org/oauth/authorize');
  const params = Object.fromEntries(url.searchParams);
  const stored = JSON.parse(storage.get(PENDING));
  assert.deepEqual(params, { client_id: CLIENT, response_type: 'id_token token', scope: 'openid', redirect_uri: `${ORIGIN}/`, state: stored.state, nonce: stored.nonce });
  assert.match(stored.state, /^[0-9a-f]{32}$/);
  assert.match(stored.nonce, /^[0-9a-f]{32}$/);
  assert.notEqual(stored.state, stored.nonce);
});

test('a valid ID token signs the visitor in with iD and name only', async () => {
  const { state, nonce } = pending();
  // ORCID escapes slashes in the issuer ("https:\/\/orcid.org"), as in its documented example.
  const raw = JSON.stringify(claimsFor(nonce)).replace('"https://orcid.org"', '"https:\\/\\/orcid.org"');
  assert.match(raw, /https:\\\/\\\/orcid\.org/);
  const idToken = await sign(keyA, null, { rawPayload: raw });
  redirectWith({ access_token: 'unused-access-token', token_type: 'bearer', expires_in: '599', tokenVersion: '1', persistent: 'false', id_token: idToken, state });

  const session = await completeSignIn(CLIENT);
  assert.deepEqual(session, { orcid: '0000-0002-1825-0097', name: 'Josiah Carberry' });
  assert.deepEqual(current(), session);
  assert.deepEqual(JSON.parse(storage.get(SESSION)), session);
  assert.equal(storage.has(PENDING), false);
  assert.deepEqual(replaced, ['/'], 'the fragment, including the access token, is cleared');
  assert.equal(location.hash, '');
  assert.deepEqual(fetched, [JWKS_URL]);
  assert.equal([...storage.values()].some(value => value.includes('unused-access-token')), false);

  signOut();
  assert.equal(current(), null);
});

test('a token without name claims keeps the iD and a null name', async () => {
  const { state, nonce } = pending();
  const claims = claimsFor(nonce);
  delete claims.given_name;
  delete claims.family_name;
  redirectWith({ id_token: await sign(keyA, claims), state });
  assert.deepEqual(await completeSignIn(CLIENT), { orcid: '0000-0002-1825-0097', name: null });
});

const rejected = {
  'wrong nonce': async ({ nonce }) => sign(keyA, claimsFor(`${nonce}-other`)),
  'wrong audience': async ({ nonce }) => sign(keyA, claimsFor(nonce, { aud: 'APP-SOMEONEELSE00001' })),
  'wrong issuer': async ({ nonce }) => sign(keyA, claimsFor(nonce, { iss: 'https://sandbox.orcid.org' })),
  'expired token': async ({ nonce }) => sign(keyA, claimsFor(nonce, { exp: now() - 3600 })),
  'missing exp': async ({ nonce }) => { const claims = claimsFor(nonce); delete claims.exp; return sign(keyA, claims); },
  'non-numeric exp': async ({ nonce }) => sign(keyA, claimsFor(nonce, { exp: String(now() + 600) })),
  'signature from another key': async ({ nonce }) => sign(keyB, claimsFor(nonce), { kid: keyA.kid }),
  'tampered payload': async ({ nonce }) => {
    const [header, , signature] = (await sign(keyA, claimsFor(nonce))).split('.');
    return `${header}.${b64url(JSON.stringify(claimsFor(nonce, { sub: '0000-0001-5109-3700' })))}.${signature}`;
  },
};

for (const [name, makeToken] of Object.entries(rejected)) {
  test(`rejects an ID token with ${name}`, async () => {
    const values = pending();
    redirectWith({ id_token: await makeToken(values), state: values.state });
    await assert.rejects(completeSignIn(CLIENT), /could not be verified/);
    assert.equal(current(), null);
    assert.equal(storage.has(PENDING), false, 'a failed response cannot be replayed');
    assert.deepEqual(replaced, ['/']);
  });
}

test('accepts a token that expired within the clock-skew allowance', async () => {
  const { state, nonce } = pending();
  redirectWith({ id_token: await sign(keyA, claimsFor(nonce, { exp: now() - 60 })), state });
  assert.equal((await completeSignIn(CLIENT)).orcid, '0000-0002-1825-0097');
});

test('rejects a token signed with an algorithm other than RS256', async () => {
  const { state, nonce } = pending();
  redirectWith({ id_token: await sign(keyA, claimsFor(nonce), { alg: 'none' }), state });
  await assert.rejects(completeSignIn(CLIENT), /Unexpected token algorithm/);
  assert.equal(current(), null);
});

test('picks the key by kid when ORCID publishes several', async () => {
  jwks = { keys: [keyA.jwk, keyB.jwk] };
  const { state, nonce } = pending();
  redirectWith({ id_token: await sign(keyB, claimsFor(nonce)), state });
  assert.equal((await completeSignIn(CLIENT)).orcid, '0000-0002-1825-0097');
});

test('rejects an unknown kid when several keys are published', async () => {
  jwks = { keys: [keyA.jwk, keyB.jwk] };
  const { state, nonce } = pending();
  redirectWith({ id_token: await sign(keyA, claimsFor(nonce), { kid: 'retired-key' }), state });
  await assert.rejects(completeSignIn(CLIENT), /signing key not found/);
  assert.equal(current(), null);
});

test('rejects a response whose state does not match this tab', async () => {
  const { nonce } = pending();
  redirectWith({ id_token: await sign(keyA, claimsFor(nonce)), state: 'forged-state' });
  await assert.rejects(completeSignIn(CLIENT), /did not match this browser tab/);
  assert.deepEqual(fetched, [], 'the token is not even inspected');
  assert.equal(current(), null);
  assert.equal(storage.has(PENDING), false);
});

test('rejects a response when no sign-in was started in this tab', async () => {
  redirectWith({ id_token: await sign(keyA, claimsFor('n')), state: 'state-123' });
  await assert.rejects(completeSignIn(CLIENT), /did not match this browser tab/);
  assert.equal(current(), null);
});

test('reports an error in the fragment when the state matches', async () => {
  const { state } = pending();
  redirectWith({ error: 'access_denied', error_description: 'User denied access', state });
  await assert.rejects(completeSignIn(CLIENT), /cancelled or refused/);
  assert.deepEqual(replaced, ['/']);
  assert.equal(storage.has(PENDING), false);
  assert.deepEqual(fetched, []);
  assert.equal(current(), null);
});

test('reports an error in the query string while a sign-in is pending', async () => {
  installBrowser({ search: '?error=access_denied&error_description=User%20denied%20access&orcid=0000-0002-1825-0097' });
  pending();
  await assert.rejects(completeSignIn(CLIENT), /cancelled or refused/);
  assert.deepEqual(replaced, ['/?orcid=0000-0002-1825-0097'], 'unrelated query parameters survive');
  assert.equal(storage.has(PENDING), false);
});

test('ignores an error in the query string when no sign-in is pending', async () => {
  installBrowser({ search: '?error=access_denied' });
  assert.equal(await completeSignIn(CLIENT), null);
  assert.deepEqual(replaced, []);
});

test('without a fragment returns the current session untouched', async () => {
  assert.equal(await completeSignIn(CLIENT), null);
  const session = { orcid: '0000-0002-1825-0097', name: 'Josiah Carberry' };
  installBrowser({ hash: '#unrelated' });
  storage.set(SESSION, JSON.stringify(session));
  assert.deepEqual(await completeSignIn(CLIENT), session);
  assert.deepEqual(replaced, []);
  assert.deepEqual(fetched, []);
  assert.equal(location.hash, '#unrelated');
});
