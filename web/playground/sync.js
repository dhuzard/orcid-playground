// Sync the research-network workspace to the signed-in researcher's own cloud space
// (users/{orcid}/workspace in Firestore, readable only by them: firestore.rules).
// The same export/restore as "Download my workspace", compressed and split into chunks.
import { call } from '/engine-client.js';
import * as cloud from '/cloud.js';
import { config, signIn } from '/auth.js';

const CHUNK = 800000;               // characters of base64 per document, under Firestore's 1 MiB limit
const AUTO_KEY = 'orcid-playground-autosave';
const $ = selector => document.querySelector(selector);

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function gunzip(base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

const base = () => `users/${cloud.session().orcid}/workspace`;
const device = () => `${navigator.platform || 'browser'} · ${new Date().toLocaleString()}`;

export async function lastSaved() {
  return cloud.get(`${base()}/manifest`).catch(() => null);
}

export async function save() {
  const text = await call('exportWorkspace');
  const packed = await gzip(text);
  const parts = [];
  for (let i = 0; i < packed.length; i += CHUNK) parts.push(packed.slice(i, i + CHUNK));
  const previous = await lastSaved();
  const stale = Array.from({ length: Math.max(0, (previous?.count || 0) - parts.length) }, (_, k) => ({ remove: `${base()}/chunk-${parts.length + k}` }));
  await cloud.commit([
    ...parts.map((data, index) => ({ set: `${base()}/chunk-${index}`, data: { data, index } })),
    ...stale,
    { set: `${base()}/manifest`, data: { count: parts.length, sha256: await sha256(text), updatedAt: new Date(), device: device() } },
  ]);
  return parts.length;
}

export async function load() {
  const manifest = await lastSaved();
  if (!manifest) throw new Error('Nothing is saved in your account yet.');
  const chunks = (await cloud.list(base())).filter(d => d.id.startsWith('chunk-')).sort((a, b) => a.index - b.index).slice(0, manifest.count);
  if (chunks.length !== manifest.count) throw new Error('The saved workspace is incomplete; save it again from the device that has it.');
  const text = await gunzip(chunks.map(c => c.data).join(''));
  if (await sha256(text) !== manifest.sha256) throw new Error('The saved workspace does not match its checksum; it was not loaded.');
  return { text, manifest };
}

export async function removeSaved() {
  const docs = await cloud.list(base());
  await cloud.commit(docs.map(d => ({ remove: `${base()}/${d.id}` })));
}

// ---- Network sidebar -----------------------------------------------------

function setStatus(text) {
  const line = $('#sync-status');
  if (line) line.textContent = text;
}

async function describe() {
  const manifest = await lastSaved();
  setStatus(manifest ? `Last saved ${new Date(manifest.updatedAt).toLocaleString()} (${manifest.device}).` : 'Nothing saved to your account yet.');
}

let timer = null;
function autosave() {
  clearTimeout(timer);
  timer = setTimeout(() => save().then(describe).catch(error => setStatus(`Auto-save failed: ${error.message}`)), 4000);
}

async function setup() {
  const box = $('#sync');
  if (!box || !(await cloud.available())) return;
  box.hidden = false;
  if (!cloud.session()) {
    const { orcid_client_id: clientId } = await config();
    box.replaceChildren('Sign in with ORCID to keep this workspace in your own account and open it on other devices. ',
      Object.assign(document.createElement('button'), { className: 'button quiet small', type: 'button', textContent: 'Sign in to sync',
        onclick: () => signIn(clientId, location.pathname + location.hash) }));
    return;
  }
  $('#sync-save').addEventListener('click', async () => {
    try { setStatus('Saving…'); await save(); await describe(); } catch (error) { setStatus(`Not saved: ${error.message}`); }
  });
  $('#sync-load').addEventListener('click', async () => {
    try {
      setStatus('Loading…');
      const { text, manifest } = await load();
      const summary = JSON.parse(await call('checkWorkspace', { text }));
      const counts = Object.entries(summary).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${v} ${k}`).join(', ');
      if (!confirm(`Replace this browser's workspace with the copy saved ${new Date(manifest.updatedAt).toLocaleString()} (${counts})?`)) return describe();
      await call('importWorkspace', { text });
      location.reload();
    } catch (error) { setStatus(`Not loaded: ${error.message}`); }
  });
  $('#sync-delete').addEventListener('click', async () => {
    if (!confirm('Delete the copy saved in your account? This browser keeps its own workspace.')) return;
    try { await removeSaved(); await describe(); } catch (error) { setStatus(`Not deleted: ${error.message}`); }
  });
  const auto = $('#sync-auto');
  try { auto.checked = localStorage.getItem(AUTO_KEY) === '1'; } catch { /* per-device preference only */ }
  auto.addEventListener('change', () => { try { localStorage.setItem(AUTO_KEY, auto.checked ? '1' : '0'); } catch { /* ignore */ } if (auto.checked) autosave(); });
  window.addEventListener('workspace-changed', () => { if (auto.checked) autosave(); });
  await describe();
}

setup().catch(error => setStatus(error.message));
