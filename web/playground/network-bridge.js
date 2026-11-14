// Serves the network pilot's /api/* requests from the in-browser engine, so
// web/network/app.js runs unchanged and the workspace never leaves this browser.
import { call } from '/engine-client.js';
import '/sync.js';

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
    if (method !== 'GET' && reply.status === 200) window.dispatchEvent(new Event('workspace-changed'));
    return new Response(decode(reply), { status: reply.status, headers: { 'Content-Type': reply.content_type } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// Links from Explore either hand over one iD to follow (?import=) or ask for sample data
// (?sample=1); run that first so the app's initial state already includes it. "Save as contact"
// and "Add to group" use #contacts?save= / #groups?add=, which the app itself confirms.
const params = new URLSearchParams(location.search);
const handoff = params.get('import');
const sample = !handoff && params.has('sample');
if (handoff || sample) history.replaceState(null, '', location.pathname + (location.hash || (handoff ? '#people' : '#feed')));

// The labelled sample never silently mixes with someone's own network: the question says what is
// already here. These helpers are exact copies of workspaceSummary / sampleMessage in
// web/network/app.js (which this page loads after the bridge has run); tests/test_onboarding.py
// fails if the copies drift apart.
const isSampleGroup = group => /^demo-/.test(group.id);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

function workspaceSummary(data) {
  const sample = new Set(data.people.filter(p => p.demo).map(p => p.id));
  return {
    people: data.people.length - sample.size,
    sample_people: sample.size,
    contacts: Object.keys(data.contacts || {}).filter(id => !sample.has(id)).length,
    groups: data.groups.filter(g => !isSampleGroup(g)).length,
    sample_groups: data.groups.filter(isSampleGroup).length,
  };
}

function sampleMessage(summary) {
  if (summary.sample_people) return null;
  const intro = 'Add the labelled sample people and group to the research network stored in this browser?';
  if (!summary.people && !summary.contacts && !summary.groups) {
    return `${intro}\n\nEvery sample person, output and group is fictional and labelled “Demo”. Remove sample data takes it out again.`;
  }
  return `${intro}\n\nThis workspace already holds your own network: ${plural(summary.people, 'researcher')}, ${plural(summary.contacts, 'contact')} and ${plural(summary.groups, 'group')}. `
    + 'Nothing of yours is replaced or changed. The sample is added next to it, every item labelled “Demo”, and Remove sample data takes only the sample out again. '
    + 'To keep the two apart entirely, download your workspace first or try the sample in a private window.';
}

// The engine may still be downloading on a first visit; wait for it a while, then ask without counts.
const ENGINE_WAIT_MS = 20000;

async function sampleQuestion() {
  try {
    const reply = JSON.parse(await Promise.race([call('api', { method: 'GET', target: '/api/state', body: null }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), ENGINE_WAIT_MS))]));
    return sampleMessage(workspaceSummary(JSON.parse(reply.body)));
  } catch {
    // The engine is unavailable or still starting: ask without the counts, saying the same thing.
    return 'Add the labelled sample people and group to the research network stored in this browser?\n\n'
      + 'Every sample person, output and group is fictional and labelled “Demo”. If this browser already holds your own network, nothing of it is replaced: '
      + 'the sample is added next to it, and Remove sample data takes only the sample out again.';
  }
}

// A link must not change someone's workspace or call ORCID without them agreeing.
async function setup() {
  if (handoff) {
    return confirm(`Follow the public ORCID record ${handoff} in the research network stored in this browser?\n\n`
      + 'This reads their public record once and shows the outputs a refresh newly finds in your Feed. It does not save them as a contact, add them to a group or notify them.')
      ? ['/api/import', { orcid: handoff }] : null;
  }
  if (params.has('sample')) {
    const question = await sampleQuestion();
    return question && confirm(question) ? ['/api/demo', {}] : null;
  }
  return null;
}

if (handoff || sample) {
  const direct = window.fetch;
  const ready = setup().then(async wanted => {
    if (!wanted) return;
    const response = await direct(wanted[0], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wanted[1]) });
    if (response.ok) {
      // Follow means follow: an import keeps an existing preference (e.g. someone saved as a contact
      // without following), so set it explicitly after the confirmed import.
      if (!handoff) return;
      const state = await response.json();
      const id = handoff.trim().replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '').replace(/\/$/, '').toUpperCase();
      const person = state.people.find(p => p.orcid === id);
      if (person && !person.following) {
        await direct('/api/follow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: person.id, following: true }) });
      }
      return;
    }
    const { error } = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    alert(handoff ? `Could not add ${handoff}: ${error}` : `Could not load the sample data: ${error}`);
  }).catch(() => {});
  window.fetch = async (input, init) => { await ready; return direct(input, init); };
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
    saveFile(markdown, 'whats-new.md', 'text/markdown');
  });
}

function saveFile(text, filename, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---- Backup and restore: a file the visitor keeps; nothing is uploaded ----

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

document.querySelector('#export-workspace')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!confirm('Download a copy of the research network stored in this browser?\n\n'
    + 'The file contains every imported public ORCID record, who you follow, your saved outputs, your contacts with their tags, private notes and follow-ups, and your groups with their local roles, expertise, contributions, project selections and requests.\n\n'
    + 'It is not encrypted: anyone who gets the file can read all of it. Group membership and roles in it are your own notes; the people listed have not confirmed them.')) return;
  button.disabled = true;
  try {
    const text = await call('exportWorkspace');
    saveFile(text, `research-workspace-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  } catch (error) {
    alert(`Could not export the workspace: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

const restoreInput = document.querySelector('#import-workspace-file');
document.querySelector('#import-workspace')?.addEventListener('click', () => restoreInput?.click());
restoreInput?.addEventListener('change', async () => {
  const [file] = restoreInput.files;
  restoreInput.value = '';
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) return alert('This file is too large to be a workspace backup.');
  try {
    const text = await file.text();
    const summary = JSON.parse(await call('checkWorkspace', { text }));
    const made = Number.isNaN(Date.parse(summary.exported_at)) ? 'an unknown date' : new Date(summary.exported_at).toLocaleString();
    const groups = summary.group_names.length ? `: ${summary.group_names.slice(0, 5).join(', ')}${summary.group_names.length > 5 ? '…' : ''}` : '';
    if (!confirm(`Replace this browser’s research network with this backup (made ${made})?\n\n`
      + `The backup holds ${summary.people} researcher(s), ${summary.sample_people} sample people, ${summary.saved} saved output(s) and ${summary.groups} group(s)${groups}.\n\n`
      + 'Everything currently stored in this browser’s network (people, follows, saved outputs, groups, roles, contributions and requests) will be replaced. Download your current workspace first if you may need it.')) return;
    await call('importWorkspace', { text });
    location.reload();
  } catch (error) {
    alert(`Could not restore this file: ${error.message}\n\nNothing was changed.`);
  }
});

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
