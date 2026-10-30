// Serves the network pilot's /api/* requests from the in-browser engine, so
// web/network/app.js runs unchanged and the workspace never leaves this browser.
import { call } from '/engine-client.js';

const nativeFetch = window.fetch.bind(window);

function decode(reply) {
  if (reply.body_b64 === undefined) return reply.body;
  return Uint8Array.from(atob(reply.body_b64), c => c.charCodeAt(0));
}

window.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  const method = (init.method || request?.method || 'GET').toUpperCase();
  try {
    const body = init.body ?? (request && method !== 'GET' ? await request.text() : null);
    const reply = JSON.parse(await call('api', { method, target: url.pathname + url.search, body }));
    return new Response(decode(reply), { status: reply.status, headers: { 'Content-Type': reply.content_type } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// Links from the Studio either hand over one iD (?import=) or ask for sample data
// (?sample=1); run that first so the app's initial state already includes it.
const params = new URLSearchParams(location.search);
const handoff = params.get('import');
const wanted = handoff ? ['/api/import', { orcid: handoff }] : params.has('sample') ? ['/api/demo', {}] : null;
// A link must not change someone's workspace or call ORCID without them agreeing.
const setup = wanted && confirm(handoff
  ? `Add the public ORCID record ${handoff} to the research network stored in this browser?`
  : 'Add the labelled sample people and group to the research network stored in this browser?') ? wanted : null;
if (wanted) history.replaceState(null, '', location.pathname + (location.hash || (handoff ? '#people' : '#feed')));
if (setup) {
  const ready = window.fetch(setup[0], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setup[1]) })
    .then(async response => {
      if (response.ok) return;
      const { error } = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      alert(handoff ? `Could not add ${handoff}: ${error}` : `Could not load the sample data: ${error}`);
    })
    .catch(() => {});
  const bridged = window.fetch;
  window.fetch = async (input, init) => { await ready; return bridged(input, init); };
}

document.querySelector('#reset-workspace')?.addEventListener('click', async () => {
  if (!confirm('Delete every person, group and saved output stored in this browser?')) return;
  await call('reset');
  location.reload();
});

// "What's new since your last visit": the previous visit time is kept for this
// browser tab session, so the digest stays stable while the visitor works.
let since = null;
try {
  since = sessionStorage.getItem('orcid-playground-digest-since');
  if (since === null) {
    since = localStorage.getItem('orcid-playground-last-visit') || '';
    sessionStorage.setItem('orcid-playground-digest-since', since);
  }
  localStorage.setItem('orcid-playground-last-visit', new Date().toISOString());
} catch { /* Storage unavailable: the digest covers everything observed. */ }

const readState = async () => (await window.fetch('/api/state')).json();
const digestButton = document.querySelector('#digest');

async function digest() {
  const { buildDigest } = await import('/digest.js');
  return buildDigest(await readState(), since || null);
}

if (digestButton) {
  digest().then(({ count }) => { digestButton.textContent = `What’s new since your last visit (${count})`; }).catch(() => {});
  digestButton.addEventListener('click', async () => {
    const { markdown } = await digest();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    link.download = 'whats-new.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
}

// Re-reading followed records is an explicit, one-off action; nothing polls ORCID.
document.querySelector('#refresh-followed')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const followed = (await readState()).people.filter(p => p.following && p.orcid && !p.demo);
  if (!followed.length) return alert('Follow at least one researcher with a public ORCID record first.');
  if (!confirm(`Read the public ORCID records of the ${followed.length} researcher(s) you follow again?`)) return;
  button.disabled = true;
  const failed = [];
  for (const [i, person] of followed.entries()) {
    button.textContent = `Refreshing ${i + 1} of ${followed.length}…`;
    const response = await window.fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orcid: person.orcid }) });
    if (!response.ok) failed.push(person.name);
  }
  if (failed.length) alert(`Could not refresh: ${failed.join(', ')}`);
  location.reload();
});
