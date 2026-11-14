const emptyState = () => ({ people: [], works: [], events: [], groups: [], contacts: {} });
let state = emptyState();
let currentView = 'feed';
let selectedPerson = null;
let selectedGroup = null;
let editorGroup = undefined;
let search = '';
let busy = false;
let loaded = false;
let groupTab = 'roster';
let bulkRunning = false;
let activeBulkGroup = null;
let pendingCreateGroup = false;
let activeTag = '';
let feedView = 'new';
let feedScope = '';
let feedType = '';
let feedTopic = '';
let feedFiltersOpen = false;
// Long lists render a page of cards at a time; this remembers how far each list was opened.
const PAGE_SIZE = 50;
const listLimits = new Map();
let previousVisit = null;
let dismissedSuggestions = [];
const contactDrafts = { meeting: { tag: '', date: '', text: '', bulk: null }, notes: {}, actions: {}, tagInput: {} };
const groupDrafts = new Map();
// A pending "Save as contact" / "Add to group" handoff from Explore (#56); see handoffRoute().
let handoff = null;
// Per-viewer guide state (hidden, team pack downloaded). A convenience only; the page works without it.
let guideMemory = {};

export function parseOrcidList(text) {
  const tokens = text.replace(/&#(?:x20|32);/gi, ' ').replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1').trim().split(/[\s,;]+/).filter(Boolean);
  const seen = new Set();
  const entries = [];
  for (const token of tokens) {
    const id = token.replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '').replace(/\/$/, '').toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    let valid = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id);
    if (valid) {
      const digits = id.replaceAll('-', '');
      let total = 0;
      for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
      const check = (12 - total % 11) % 11;
      valid = digits[15] === (check === 10 ? 'X' : String(check));
    }
    entries.push({ id, valid, status: valid ? 'ready' : 'invalid', message: valid ? 'Ready to import' : 'Invalid ORCID iD or checksum' });
  }
  return { entries, overLimit: entries.length > 50 };
}

export function groupRoute(hash) {
  const [view, encodedId] = hash.replace(/^#/, '').split('?')[0].split('/');
  let id = null;
  try { id = view === 'groups' && encodedId ? decodeURIComponent(encodedId) : null; } catch { /* Invalid URL stays at the groups list. */ }
  return { view: ['feed', 'people', 'contacts', 'groups', 'saved'].includes(view) ? view : 'feed', id };
}

// "#contacts?add=<iD>" pre-fills "I just met people". Nothing is imported until the user confirms.
export function addRoute(hash) {
  const raw = hash.replace(/^#/, '');
  const at = raw.indexOf('?');
  if (at < 0 || raw.slice(0, at) !== 'contacts') return null;
  const value = new URLSearchParams(raw.slice(at + 1)).get('add');
  return value ? value.slice(0, 2000) : null;
}

// "#contacts?save=<iD>" (Save as contact) and "#groups?add=<iD>" (Add to group) arrive from
// Explore with one ORCID iD (#56). Nothing is read or saved until the visitor confirms in the panel.
export function handoffRoute(hash) {
  const raw = hash.replace(/^#/, '');
  const at = raw.indexOf('?');
  if (at < 0) return null;
  const view = raw.slice(0, at);
  const params = new URLSearchParams(raw.slice(at + 1));
  const value = view === 'contacts' ? params.get('save') : view === 'groups' ? params.get('add') : null;
  if (!value) return null;
  const text = value.trim().slice(0, 200);
  const { entries } = parseOrcidList(text);
  const valid = entries.length === 1 && entries[0].valid;
  return { intent: view === 'contacts' ? 'contact' : 'group', raw: text, id: valid ? entries[0].id : '', valid };
}

// The real (non-sample) record for an iD, so a handoff reuses it instead of duplicating it.
export const knownPerson = (data, orcid) => data.people.find(p => p.orcid === orcid && !p.demo) || null;

const isSampleGroup = group => /^demo-/.test(group.id);

// What this workspace holds, own data and labelled sample apart.
export function workspaceSummary(data) {
  const sample = new Set(data.people.filter(p => p.demo).map(p => p.id));
  return {
    people: data.people.length - sample.size,
    sample_people: sample.size,
    contacts: Object.keys(data.contacts || {}).filter(id => !sample.has(id)).length,
    groups: data.groups.filter(g => !isSampleGroup(g)).length,
    sample_groups: data.groups.filter(isSampleGroup).length,
  };
}

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

// The sample group as NetworkStore.add_demo creates it; any other name or description is the user's.
const SAMPLE_GROUP = { name: 'Open Science Circle · Demo', description: 'A fictional working group for trying the pilot.' };

// What "Remove sample data" would do. A sample group that holds the user's own members, requests,
// name or description is kept (renamed without "· Demo"); the same rule as NetworkStore.remove_demo.
export function sampleRemoval(data) {
  const sample = new Set(data.people.filter(p => p.demo).map(p => p.id));
  const groups = data.groups.filter(isSampleGroup);
  const kept = groups.filter(g => g.member_ids.some(id => !sample.has(id)) || (g.requests || []).length > 0
    || g.name !== SAMPLE_GROUP.name || (g.description || '') !== SAMPLE_GROUP.description);
  return { people: sample.size, deleted: groups.length - kept.length, kept: kept.map(g => ({ id: g.id, from: g.name, to: g.name.replace(/\s*·\s*Demo$/, '').trim() || 'Working group' })) };
}

// Default group for "Add to group": one of the user's own groups the person is not in yet,
// never a sample group; otherwise a new group.
export function defaultHandoffGroup(data, person) {
  return data.groups.find(g => !isSampleGroup(g) && !(person && g.member_ids.includes(person.id)))?.id || '';
}

// The confirmation before the labelled sample is added; null when it is already here.
// The hosted bridge (web/playground/network-bridge.js) asks the same for ?sample=1.
export function sampleMessage(summary) {
  if (summary.sample_people) return null;
  const intro = 'Add the labelled sample people and group to the research network stored in this browser?';
  if (!summary.people && !summary.contacts && !summary.groups) {
    return `${intro}\n\nEvery sample person, output and group is fictional and labelled “Demo”. Remove sample data takes it out again.`;
  }
  return `${intro}\n\nThis workspace already holds your own network: ${plural(summary.people, 'researcher')}, ${plural(summary.contacts, 'contact')} and ${plural(summary.groups, 'group')}. `
    + 'Nothing of yours is replaced or changed. The sample is added next to it, every item labelled “Demo”, and Remove sample data takes only the sample out again. '
    + 'To keep the two apart entirely, download your workspace first or try the sample in a private window.';
}

// The Connect & Organize first-run guide, derived from the workspace itself.
export function guideSteps(data, packDownloaded = false) {
  const contacts = data.contacts || {};
  const records = Object.values(contacts);
  return [
    { id: 'person', label: 'Add a person: import an ORCID iD, or use the labelled sample', href: '#people', done: data.people.length > 0 },
    { id: 'context', label: 'Save them as a contact with a conference or context tag', href: '#contacts', done: records.some(c => c.tags.length > 0) },
    { id: 'note', label: 'Write a private note about them', href: '#contacts', done: records.some(c => c.notes.length > 0) },
    { id: 'follow-up', label: 'Plan a follow-up', href: '#contacts', done: records.some(c => c.actions.length > 0) },
    { id: 'group', label: 'Add a contact to a local group', href: '#groups', done: data.groups.some(g => g.member_ids.some(id => contacts[id])) },
    { id: 'curate', label: 'Select a project output in that group', href: '#groups', done: data.groups.some(g => (g.selected_work_ids || []).length > 0) },
    { id: 'pack', label: 'Download the group’s team pack', href: '#groups', done: Boolean(packDownloaded) },
  ];
}

// A bookmark for ORCID record pages. It reads only the iD in the page address and opens this app
// (reusing its tab where the browser allows), so the person lands in the list above.
export function bookmarklet(base) {
  const code = `(()=>{const m=/^\\/(\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dXx])(?:\\/|$)/.exec(location.pathname);if(!/^(www\\.)?orcid\\.org$/.test(location.hostname)||!m){alert('Open an ORCID record page (orcid.org/0000-…) first.');return}window.open(${JSON.stringify(`${base}#contacts?add=`)}+m[1].toUpperCase(),'orcid-network')})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

function draftsFor(group) {
  if (!groupDrafts.has(group.id)) groupDrafts.set(group.id, { bulkText: '', bulk: null, cancel: false, members: {}, request: {}, pack: {} });
  return groupDrafts.get(group.id);
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function dateLabel(value) {
  if (!value) return 'Date unavailable';
  if (/^\d{4}$/.test(value)) return value;
  const isMonth = /^\d{4}-\d{2}$/.test(value);
  const date = new Date(isMonth ? `${value}-01T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString('en', { year: 'numeric', month: 'short', ...(isMonth ? {} : { day: 'numeric' }), timeZone: 'UTC' });
}

// ---- Feed: whose research, which view, and filters. Derived from the local workspace only. ----

// Matches the server's tag key: whitespace collapsed, then Python's str.casefold()
// (upper-then-lower folds ß to ss and ligatures like the server does).
export const foldKey = text => text.split(/\s+/).filter(Boolean).join(' ').toUpperCase().toLowerCase();

// Truncate by character, not UTF-16 unit, so an emoji is never split.
const clip = (text, limit) => Array.from(text).slice(0, limit).join('');

// A scope is '' (everyone followed), 'group:<id>' or 'tag:<name>'.
export function scopeIds(data, scope = '') {
  const split = scope.indexOf(':');
  const kind = scope.slice(0, split);
  const value = scope.slice(split + 1);
  if (kind === 'group') return new Set(data.groups.find(g => g.id === value)?.member_ids || []);
  if (kind === 'tag') {
    const wanted = foldKey(value);
    return new Set(Object.entries(data.contacts || {}).filter(([, contact]) => contact.tags.some(t => foldKey(t) === wanted)).map(([id]) => id));
  }
  return new Set(data.people.filter(p => p.following).map(p => p.id));
}

// Keywords people list on their own ORCID records. They describe the person, not an output.
export function feedTopics(data, scope = '') {
  const ids = scopeIds(data, scope);
  const topics = new Map();
  for (const person of data.people) {
    if (!ids.has(person.id)) continue;
    const own = new Map(person.keywords.map(word => word.split(/\s+/).filter(Boolean).join(' ')).filter(Boolean).map(word => [foldKey(word), word]));
    for (const [key, label] of own) {
      if (!topics.has(key)) topics.set(key, { key, label, people_ids: [] });
      topics.get(key).people_ids.push(person.id);
    }
  }
  return [...topics.values()].sort((a, b) => b.people_ids.length - a.people_ids.length || a.label.localeCompare(b.label));
}

// 'new': newly observed outputs, latest observation first. 'published': outputs by publication
// date, undated last. 'together': outputs listing two or more people in scope.
export function feedItems(data, { view = 'new', scope = '', type = '', topic = '' } = {}) {
  const ids = scopeIds(data, scope);
  let items;
  if (view === 'new') {
    const works = new Map(data.works.map(w => [w.id, w]));
    const entries = new Map();
    for (const event of data.events) {
      if (!event.people_ids.some(id => ids.has(id))) continue;
      const work = works.get(event.work_id);
      if (!work) continue;
      const previous = entries.get(work.id);
      if (!previous || event.observed_at > previous.event.observed_at) entries.set(work.id, { work, event });
    }
    items = [...entries.values()].sort((a, b) => b.event.observed_at.localeCompare(a.event.observed_at));
  } else {
    const needed = view === 'together' ? 2 : 1;
    items = data.works.filter(work => new Set(work.people_ids.filter(id => ids.has(id))).size >= needed).map(work => ({ work, event: null }))
      .sort((a, b) => (b.work.date || '').localeCompare(a.work.date || '') || (a.work.title || '').localeCompare(b.work.title || ''));
  }
  if (type) items = items.filter(({ work }) => work.type === type);
  if (topic) {
    const listers = new Set(feedTopics(data, scope).find(t => t.key === topic)?.people_ids || []);
    items = items.filter(({ work }) => work.people_ids.some(id => listers.has(id)));
  }
  return items;
}

export const feedEntries = data => feedItems(data);

// Outputs listing more people than this in scope (consortium papers) say little about who
// works together and would cost O(n²) pairs each, so they do not produce pair suggestions.
const PAIR_PEOPLE_LIMIT = 25;

// Suggested tags or groups, each with its evidence: a keyword two or more people list, or
// outputs two people are both listed on. Nothing already grouped, tagged or dismissed.
export function groupSuggestions(data, scope = '', dismissed = []) {
  const ids = scopeIds(data, scope);
  const skip = new Set(dismissed);
  const contacts = data.contacts || {};
  const taken = new Set([...data.groups.map(g => g.name), ...allTags(contacts).map(([t]) => t)].map(foldKey));
  // Every group and tag each person is in, built once so the pair check stays cheap.
  const circles = new Map();
  const join = (id, circle) => { if (!circles.has(id)) circles.set(id, new Set()); circles.get(id).add(circle); };
  for (const group of data.groups) for (const id of group.member_ids) join(id, `group:${group.id}`);
  for (const [id, contact] of Object.entries(contacts)) for (const t of contact.tags) join(id, `tag:${foldKey(t)}`);
  const alreadyTogether = (a, b) => [...(circles.get(a) || [])].some(circle => circles.get(b)?.has(circle));
  const keywords = feedTopics(data, scope).filter(t => t.people_ids.length >= 2 && !taken.has(t.key))
    .map(t => ({ id: `keyword:${t.key}`, kind: 'keyword', label: t.label, people_ids: t.people_ids, works: [] }));
  const pairs = new Map();
  for (const work of data.works) {
    const listed = [...new Set(work.people_ids.filter(id => ids.has(id)))].sort();
    if (listed.length > PAIR_PEOPLE_LIMIT) continue;
    for (let i = 0; i < listed.length; i++) {
      for (let j = i + 1; j < listed.length; j++) {
        const key = `${listed[i]}|${listed[j]}`;
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(work);
      }
    }
  }
  const shared = [...pairs].filter(([key]) => !alreadyTogether(...key.split('|')))
    .map(([key, works]) => ({ id: `pair:${key}`, kind: 'pair', label: '', people_ids: key.split('|'), works }))
    .sort((a, b) => b.works.length - a.works.length || a.id.localeCompare(b.id));
  return [...keywords, ...shared].filter(s => !skip.has(s.id));
}

// Counts the same newly observed outputs the feed shows for this scope and filters.
export function sinceLastVisit(data, since, options = {}) {
  if (!since) return null;
  const fresh = feedItems(data, { ...options, view: 'new' }).filter(({ event }) => event.observed_at > since);
  const groups = data.groups.map(g => {
    const members = new Set(g.member_ids);
    return { id: g.id, name: g.name, count: fresh.filter(({ work }) => work.people_ids.some(id => members.has(id))).length };
  }).filter(g => g.count).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { total: fresh.length, groups };
}

// The visit before this one survives reloads and extra tabs within half an hour, so
// "new since your last visit" is not wiped by a refresh.
export function nextVisit(stored, now, sessionMs = 30 * 60 * 1000) {
  const valid = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
  const seen = valid(stored?.seen) ? stored.seen : null;
  const previous = valid(stored?.previous) ? stored.previous : null;
  if (seen && Date.parse(now) - Date.parse(seen) < sessionMs) return { seen: now, previous };
  return { seen: now, previous: seen };
}

export function groupWorks(data, memberIds) {
  const ids = new Set(memberIds);
  const unique = new Map();
  for (const work of data.works) {
    if (work.people_ids.some(id => ids.has(id))) unique.set(work.id, work);
  }
  return [...unique.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'checked' || key === 'disabled') node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const button = (label, action, variant = 'quiet', attrs = {}) => el('button', { type: 'button', class: `button ${variant}`, onclick: action, disabled: busy || bulkRunning, ...attrs }, label);
const tag = (label, demo = false) => el('span', { class: `chip${demo ? ' demo' : ''}` }, label);
const externalLink = (label, url, attrs = {}) => {
  const safe = safeUrl(url);
  return safe ? el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', ...attrs }, label) : el('span', {}, label);
};
const peopleFor = ids => state.people.filter(p => ids.includes(p.id));
const initials = name => name.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() || '?';
const avatar = (person, large = false) => el('span', { class: `avatar${large ? ' large' : ''}`, 'aria-hidden': 'true' }, initials(person.name));
const matches = work => `${work.title} ${work.type} ${peopleFor(work.people_ids).map(p => p.name).join(' ')}`.toLowerCase().includes(search.toLowerCase());

function notice(message, error = false) {
  const node = document.querySelector('#notice');
  node.hidden = !message;
  node.className = `notice${error ? ' error' : ''}`;
  node.replaceChildren(document.createTextNode(message), button('Dismiss', () => { node.hidden = true; }, '', { 'aria-label': 'Dismiss notification' }));
}

async function mutate(path, body = {}, success = '') {
  if (busy || bulkRunning) return false;
  busy = true;
  document.querySelectorAll('button').forEach(node => { node.disabled = true; });
  document.querySelector('#view').setAttribute('aria-busy', 'true');
  notice(path === '/api/import' ? 'Reading the public ORCID record. This can take a moment…' : 'Saving your workspace…');
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pilot-Request': '1' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    state = result;
    if (success) notice(success);
    else notice('Workspace updated.');
    return true;
  } catch (error) {
    notice(error.message || 'Could not reach the local server. Please try again.', true);
    return false;
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach(node => { node.disabled = false; });
    document.querySelector('#view').removeAttribute('aria-busy');
  }
}

async function update(path, body, message) {
  if (await mutate(path, body, message)) render();
}

function importForm(compact = false) {
  const input = el('input', { class: 'input', type: 'text', name: 'orcid', placeholder: '0000-0002-1825-0097', required: true, 'aria-label': 'ORCID iD or ORCID profile URL', autocomplete: 'off' });
  const form = el('form', { class: compact ? '' : 'import-bar', onsubmit: async event => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    if (await mutate('/api/import', { orcid: value }, 'Public record loaded. New imports are followed; existing follow preferences are preserved. The first import establishes a baseline for future updates.')) {
      input.value = '';
      render();
    }
  } }, input, el('button', { type: 'submit', class: 'button accent', disabled: busy }, 'Import ORCID ↗'));
  return form;
}

function empty(title, message, action) {
  return el('div', { class: 'empty' }, el('h2', {}, title), el('p', {}, message), action);
}

function toolbar(label, placeholder, refresh) {
  const input = el('input', { class: 'input', type: 'search', placeholder, value: search, 'aria-label': placeholder, oninput: event => { search = event.target.value; refresh(); } });
  return el('div', { class: 'toolbar' }, el('span', { class: 'section-kicker' }, label), input);
}

// Per-viewer conveniences (last visit, dismissed suggestions); the page works without them.
const remembered = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage unavailable; keep it in memory only. */ } };

function workCard(work, event = null, fresh = false) {
  const people = peopleFor(work.people_ids);
  const following = people.filter(p => p.following);
  const url = work.doi ? `https://doi.org/${work.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}` : work.url;
  return el('article', { class: 'work-card' },
    el('div', { class: 'card-top' },
      el('div', { class: 'people-line' }, el('div', { class: 'avatars' }, people.slice(0, 3).map(p => avatar(p))),
        el('span', {}, people.map(p => p.name).join(' · ') || 'Research output')),
      el('div', { class: 'chips' }, fresh && tag('New since last visit'), work.demo && tag('Demo', true))),
    tag((work.type || 'Research output').replaceAll('-', ' ')),
    el('h3', {}, externalLink(work.title || 'Untitled output', url)),
    el('div', { class: 'work-meta' }, el('span', {}, `Publication date: ${dateLabel(work.date)}`), event && el('span', { title: 'When your refresh first saw this output in a public ORCID record, not its publication date.' }, `• First seen by your refresh ${dateLabel(event.observed_at)}`)),
    event && el('p', { class: 'helper' }, work.demo ? 'Illustrative update from the sample workspace.' : 'Newly found in a public ORCID record. This may be an older publication.'),
    following.length > 1 && el('p', { class: 'helper' }, `${following.length} researchers you follow share this output. Shown once.`),
    el('div', { class: 'work-bottom' },
      el('div', { class: 'work-meta' }, work.demo ? el('span', {}, 'Source: sample data') : people.filter(p => p.orcid).map(p => externalLink(`ORCID: ${p.name} ↗`, `https://orcid.org/${p.orcid}`))),
      button(work.saved ? '✓ Saved' : '+ Save', () => update('/api/save', { id: work.id, saved: !work.saved }, work.saved ? 'Removed from your reading list.' : 'Saved to your reading list.'), 'quiet small', { 'aria-pressed': String(work.saved), 'aria-label': `${work.saved ? 'Unsave' : 'Save'} ${work.title}` })));
}

// The server refuses a tag write for everyone if one person would pass this limit.
const TAG_LIMIT = 20;
const tagLimitReached = (personId, name) => {
  const tags = contactOf(personId).tags;
  return tags.length >= TAG_LIMIT && !tags.some(t => foldKey(t) === foldKey(name));
};

function suggestionCard(suggestion) {
  const people = peopleFor(suggestion.people_ids);
  const names = people.map(p => p.name);
  const keyword = suggestion.kind === 'keyword';
  const name = keyword ? suggestion.label : names.join(' & ');
  const tagName = clip(name, 60);
  const full = people.filter(p => tagLimitReached(p.id, tagName)).map(p => p.name);
  const count = suggestion.works.length;
  const evidence = keyword
    ? `${names.length} people list “${suggestion.label}” on their ORCID records: ${names.join(', ')}.`
    : `Both listed on ${count} output${count > 1 ? 's' : ''}: ${suggestion.works.slice(0, 2).map(w => `“${w.title || 'Untitled output'}”`).join(', ')}${count > 2 ? '…' : ''}`;
  const description = keyword ? `Suggested because each member lists “${suggestion.label}” on their ORCID record.` : `Suggested because both are listed on ${count} shared output${count > 1 ? 's' : ''}.`;
  return el('div', { class: 'suggestion' }, el('strong', {}, name), el('p', {}, evidence),
    button('Make it a tag', () => update('/api/contacts/tags', { person_ids: suggestion.people_ids, add: [tagName] }, `Tagged ${names.length} people “${tagName}”. Find them in Contacts.`), 'quiet small', { 'aria-label': `Make a tag: ${name}`, disabled: busy || bulkRunning || full.length > 0 }),
    full.length > 0 && el('p', { class: 'helper' }, `${full.join(', ')} already ${full.length > 1 ? 'have' : 'has'} ${TAG_LIMIT} tags. Remove one in Contacts first, or make a group instead.`),
    button('Make it a group', () => update('/api/groups', { name: clip(name, 120), description, member_ids: suggestion.people_ids }, 'Group created. Add roles and requests in Groups.'), 'quiet small', { 'aria-label': `Make a group: ${name}` }),
    button('Dismiss', () => {
      dismissedSuggestions = [...dismissedSuggestions, suggestion.id];
      remember('network-feed-dismissed', dismissedSuggestions);
      render();
      (document.querySelector('.suggestion .button') || document.querySelector('#main')).focus();
    }, 'quiet small', { 'aria-label': `Dismiss suggestion: ${name}` }));
}

// Pair suggestions are the costliest thing on the page; recompute only when the workspace,
// scope or dismissals change. Every write replaces `state`, which invalidates this.
let suggestionCache = {};

function suggestionsPanel() {
  if (suggestionCache.state !== state || suggestionCache.scope !== feedScope || suggestionCache.dismissed !== dismissedSuggestions) {
    suggestionCache = { state, scope: feedScope, dismissed: dismissedSuggestions, value: groupSuggestions(state, feedScope, dismissedSuggestions) };
  }
  const all = suggestionCache.value;
  const picks = [...all.filter(s => s.kind === 'keyword').slice(0, 2), ...all.filter(s => s.kind === 'pair').slice(0, 2)];
  if (!picks.length) return null;
  return el('aside', { class: 'panel feed-suggest' }, el('div', { class: 'eyebrow' }, 'GROUP SUGGESTIONS'), el('h3', { class: 'panel-title' }, 'Who belongs together?'),
    picks.map(suggestionCard),
    el('p', {}, 'Based only on keywords and outputs in the imported records. Nothing is created until you choose, and nobody is notified.'));
}

function sidePanels() {
  const followed = state.people.filter(p => p.following).slice(0, 4);
  return el('div', { class: 'stack feed-side' },
    el('aside', { class: 'panel' }, el('div', { class: 'eyebrow' }, 'MAKE YOUR CIRCLE'), el('h3', { class: 'panel-title' }, 'Good research starts with people.'), el('p', {}, 'Paste an ORCID iD or profile link to follow their public research record.'), importForm(true), el('p', {}, 'Updates are checked only when you choose Refresh. No background polling.')),
    el('aside', { class: 'panel' }, el('h3', {}, 'In your circle'), followed.length ? el('div', { class: 'small-list' }, followed.map(p => el('div', { class: 'small-person' }, avatar(p), el('div', {}, el('strong', {}, p.name), el('span', {}, p.affiliation || (p.demo ? 'Sample researcher' : 'Imported public record')))))) : el('p', {}, 'Follow your first researcher to start a circle.'), button('Explore people →', () => navigate('people'), 'quiet small')),
    el('aside', { class: 'panel' }, el('h3', {}, 'Less admin. More discovery.'), el('p', {}, 'Bring a working group together and download its member roster, bibliography, and biosketches in one team pack.'), button('Create a group →', () => { editorGroup = null; navigate('groups'); }, 'quiet small')));
}

const feedViews = [['new', 'Newly observed'], ['published', 'Recently published'], ['together', 'Together']];

function feedEmpty() {
  if (!state.people.length) return empty('Your feed is empty.', 'Follow researchers to see the outputs a refresh newly finds in their public ORCID records.', nextSteps());
  if (search) return empty('No matching outputs.', 'Try another title or researcher name.');
  if (feedType || feedTopic) return empty('Nothing matches these filters.', 'Try another output type or topic.');
  if (feedView === 'together') return empty('No shared outputs here yet.', 'Outputs listed by two or more people in this view appear here. Nothing is inferred beyond the imported records.');
  if (feedView === 'published') return empty('No outputs here yet.', 'Follow researchers in People, or choose a group or tag with imported records.', button('Browse people →', () => navigate('people'), 'quiet'));
  return empty('You’re all caught up.', 'The first ORCID import creates a baseline, so older papers do not flood your feed. Refresh a researcher in People to discover newly added works, or switch to Recently published to browse everything imported.', button('Browse people →', () => navigate('people'), 'quiet'));
}

// The first page of `items` as cards, then a "Show more" button that calls `refresh`
// (the list's own redraw) so the rest of the page is left alone.
function paged(key, items, card, refresh) {
  const limit = listLimits.get(key) || PAGE_SIZE;
  const rest = items.length - Math.min(limit, items.length);
  const focusKey = `more-${key}`;
  return [...items.slice(0, limit).map(card), rest > 0 && button(`Show ${Math.min(PAGE_SIZE, rest)} more (${rest} left)`, () => {
    listLimits.set(key, limit + PAGE_SIZE);
    refresh();
    document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
  }, 'quiet show-more', { 'data-focus': focusKey })].filter(Boolean);
}

// A control change starts the list again from its first page.
function changeFeed(apply) {
  apply();
  listLimits.delete('feed');
  render();
}

function feedControls(types, topics) {
  const tags = allTags(state.contacts);
  const scope = el('select', { class: 'input', 'aria-label': 'Whose research', 'data-focus': 'feed-scope', onchange: event => changeFeed(() => { feedScope = event.target.value; feedTopic = ''; }) },
    el('option', { value: '' }, 'Everyone I follow'),
    state.groups.length > 0 && el('optgroup', { label: 'Groups' }, state.groups.map(g => el('option', { value: `group:${g.id}` }, g.name))),
    tags.length > 0 && el('optgroup', { label: 'Tags' }, tags.map(([t]) => el('option', { value: `tag:${t}` }, t))));
  scope.value = feedScope;
  const type = el('select', { class: 'input', 'aria-label': 'Output type', 'data-focus': 'feed-type', onchange: event => changeFeed(() => { feedType = event.target.value; }) },
    el('option', { value: '' }, 'All output types'), types.map(t => el('option', { value: t }, t.replaceAll('-', ' '))));
  type.value = feedType;
  const shown = topics.slice(0, 12);
  const chosen = topics.find(t => t.key === feedTopic);
  if (chosen && !shown.includes(chosen)) shown.push(chosen);
  // On phones the filters fold behind a toggle; on wider screens the toggle is hidden by CSS.
  const active = [feedScope, feedType, feedTopic].filter(Boolean).length;
  const panel = el('div', { class: `feed-filter-panel${feedFiltersOpen ? ' open' : ''}`, id: 'feed-filter-panel' },
    el('div', { class: 'feed-filters' }, scope, type),
    shown.length > 0 && el('div', { class: 'chips', role: 'group', 'aria-label': 'Topics people list on their ORCID records' },
      el('span', { class: 'section-kicker' }, 'PEOPLE WHO LIST'),
      button('Any topic', () => changeFeed(() => { feedTopic = ''; }), feedTopic ? 'quiet small' : 'small', { 'aria-pressed': String(!feedTopic), 'data-focus': 'feed-topic-any' }),
      shown.map(t => button(`${t.label} (${t.people_ids.length})`, () => changeFeed(() => { feedTopic = feedTopic === t.key ? '' : t.key; }), feedTopic === t.key ? 'small' : 'quiet small', { 'aria-pressed': String(feedTopic === t.key), 'data-focus': `feed-topic-${t.key}` }))),
    chosen && el('p', { class: 'helper' }, `Outputs listing someone who lists “${chosen.label}” on their ORCID record. The keyword describes the person, not necessarily the output.`));
  const toggle = button(active ? `Filters · ${active} on` : 'Filters', () => {
    feedFiltersOpen = !feedFiltersOpen;
    panel.classList.toggle('open', feedFiltersOpen);
    toggle.setAttribute('aria-expanded', String(feedFiltersOpen));
  }, 'quiet small filters-toggle', { 'aria-expanded': String(feedFiltersOpen), 'aria-controls': 'feed-filter-panel', 'data-focus': 'feed-filters-toggle' });
  return el('div', { class: 'feed-controls' },
    el('div', { class: 'feed-controls-top' },
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Feed view' }, feedViews.map(([id, label]) =>
        button(label, () => changeFeed(() => { feedView = id; }), feedView === id ? 'small' : 'quiet small', { 'aria-pressed': String(feedView === id), 'data-focus': `feed-view-${id}` }))),
      toggle),
    feedView === 'new' && el('p', { class: 'helper feed-observed-note' }, 'Newly observed means your refresh first saw an output in a public ORCID record. It is not the publication date, which is shown separately on each card.'),
    panel);
}

function sinceBanner() {
  const since = feedView === 'new' && sinceLastVisit(state, previousVisit, { scope: feedScope, type: feedType, topic: feedTopic });
  if (!since?.total) return null;
  const groups = since.groups.slice(0, 3).map(g => `${g.count} from ${g.name}`);
  return el('div', { class: 'since-banner', role: 'status' },
    el('span', {}, el('strong', {}, `${since.total} newly observed since your last visit (${dateLabel(previousVisit)})`), groups.length ? ` · ${groups.join(' · ')}` : ''),
    button('Mark as seen', () => {
      previousVisit = new Date().toISOString();
      remember('network-feed-visit', { seen: previousVisit, previous: previousVisit });
      render();
      document.querySelector('#main').focus();
    }, 'quiet small'));
}

function renderFeed(view) {
  const [kind, value] = [feedScope.slice(0, feedScope.indexOf(':')), feedScope.slice(feedScope.indexOf(':') + 1)];
  if ((kind === 'group' && !state.groups.some(g => g.id === value)) || (kind === 'tag' && !allTags(state.contacts).some(([t]) => t === value))) feedScope = '';
  const topics = feedTopics(state, feedScope);
  if (!topics.some(t => t.key === feedTopic)) feedTopic = '';
  const base = feedItems(state, { view: feedView, scope: feedScope, topic: feedTopic });
  const types = [...new Set(base.map(({ work }) => work.type).filter(Boolean))].sort();
  if (!types.includes(feedType)) feedType = '';
  const items = feedType ? base.filter(({ work }) => work.type === feedType) : base;
  const list = el('div', { class: 'stack feed-list' });
  function results() {
    const entries = items.filter(({ work }) => matches(work));
    list.replaceChildren(...(entries.length ? paged('feed', entries, ({ work, event }) => workCard(work, event, Boolean(event && previousVisit && event.observed_at > previousVisit)), results) : [feedEmpty()]));
  }
  // Suggestions come before the list in the page so narrow screens show them first;
  // on wide screens CSS grid areas put them at the top of the side column.
  // Unlike el(), append() would print a missing banner as the text "null".
  view.append(...[toolbar('RESEARCH, WITHOUT THE NOISE', 'Search updates or researchers', results), feedControls(types, topics), sinceBanner(),
    el('div', { class: 'feed-layout' }, suggestionsPanel(), list, sidePanels())].filter(Boolean));
  results();
}

function personGroupPicker(person, label = '+') {
  const panelId = `person-groups-${person.id}`;
  const triggerId = `person-groups-trigger-${person.id}`;
  const panel = el('div', { class: 'person-groups-panel', id: panelId, hidden: true });
  const trigger = button(label, () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
  }, 'quiet small person-groups-trigger', {
    id: triggerId, 'aria-label': `Add ${person.name} to a group or tag`,
    title: 'Add to a group or tag', 'aria-expanded': 'false', 'aria-controls': panelId, ...(label === '+' ? {} : { 'aria-label': null }),
  });
  // Re-render, then reopen this person's panel so several additions can follow each other.
  const saveAndReopen = async (path, body, message) => {
    if (busy || !await mutate(path, body, message)) return false;
    render();
    const nextTrigger = document.getElementById(triggerId);
    if (nextTrigger) {
      nextTrigger.click();
      nextTrigger.focus();
    }
    return true;
  };
  panel.append(el('p', { class: 'person-groups-heading' }, 'Add to an existing group'));
  if (state.groups.length) {
    for (const group of state.groups) {
      const included = group.member_ids.includes(person.id);
      panel.append(el('div', { class: 'person-group-option' },
        el('span', {}, group.name),
        included ? el('span', { class: 'person-group-added' }, '✓ Added') :
          button('Add', () => {
            const current = state.groups.find(item => item.id === group.id);
            if (current) saveAndReopen('/api/groups/members/add', { id: current.id, member_ids: [person.id] }, `${person.name} added to ${current.name}.`);
          }, 'quiet small', { 'aria-label': `Add ${person.name} to ${group.name}` })));
    }
  } else {
    panel.append(el('p', { class: 'helper' }, 'No groups yet. Create one to start your roster.'),
      button('Create a group →', () => { editorGroup = null; navigate('groups'); }, 'quiet small'));
  }
  const personTags = contactOf(person.id).tags;
  const tagged = new Set(personTags.map(foldKey));
  const full = personTags.length >= TAG_LIMIT;
  panel.append(el('p', { class: 'person-groups-heading spaced' }, 'Tag'));
  for (const [name] of allTags(state.contacts)) {
    panel.append(el('div', { class: 'person-group-option' },
      el('span', {}, name),
      tagged.has(foldKey(name)) ? el('span', { class: 'person-group-added' }, '✓ Tagged') :
        button('Add', () => saveAndReopen('/api/contacts/tags', { person_ids: [person.id], add: [name] }, `${person.name} tagged “${name}”.`),
          'quiet small', { 'aria-label': `Tag ${person.name} with ${name}`, disabled: busy || bulkRunning || full })));
  }
  const newTag = el('input', { class: 'input', maxlength: '60', placeholder: 'New tag, e.g. FENS 2026', 'aria-label': `New tag for ${person.name}`, disabled: full });
  panel.append(el('form', { class: 'person-group-option', onsubmit: event => {
    event.preventDefault();
    const name = newTag.value.trim();
    if (!name) { newTag.focus(); return; }
    saveAndReopen('/api/contacts/tags', { person_ids: [person.id], add: [name] }, `${person.name} tagged “${name}”.`);
  } }, newTag, el('button', { type: 'submit', class: 'button quiet small', disabled: busy || full }, 'Add tag')),
  el('p', { class: 'helper' }, full ? `${person.name} has ${TAG_LIMIT} tags, the most allowed. Remove one in Contacts to add another.` : 'Tags are private to this workspace, like those in Contacts. They do not notify anyone.'));
  const picker = el('div', { class: 'person-groups', onkeydown: event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
  } }, trigger, panel);
  return picker;
}

function personCard(person) {
  return el('article', { class: 'person-card' },
    el('div', { class: 'person-head' }, avatar(person, true), el('div', { class: 'person-heading-text' }, el('h3', {}, person.name), el('p', {}, person.affiliation || 'Affiliation not provided'))),
    personGroupPicker(person),
    tag(person.demo ? 'Demo' : 'Imported · not connected', person.demo),
    person.headline && el('p', {}, person.headline),
    el('div', { class: 'keywords' }, person.keywords.slice(0, 5).map(word => tag(word))),
    el('div', { class: 'card-actions' }, exploreLink(person), person.orcid && externalLink('ORCID profile ↗', `https://orcid.org/${person.orcid}`), button(person.following ? '✓ Following' : '+ Follow', () => update('/api/follow', { id: person.id, following: !person.following }), 'quiet small', { 'aria-pressed': String(person.following), 'aria-label': `${person.following ? 'Unfollow' : 'Follow'} ${person.name}` }), button(`${person.work_count} outputs →`, () => { selectedPerson = person.id; search = ''; render(); }, 'quiet small')),
    el('div', { class: 'checked' }, `Last checked: ${dateLabel(person.last_checked)}`),
    el('div', { class: 'card-actions' },
      !person.demo && button('Refresh public record ↻', () => update('/api/import', { orcid: person.orcid }, 'Public record refreshed. Newly observed additions appear in your feed when you follow this researcher.'), 'quiet small'),
      button('Remove from workspace', () => removePerson(person), 'quiet small danger', { 'aria-label': `Remove ${person.name} from this workspace` })));
}

// What removing someone takes with it, for the confirmation. Outputs another person here lists stay.
export function removalImpact(data, id) {
  const own = data.works.filter(w => w.people_ids.length === 1 && w.people_ids[0] === id);
  return { outputs: own.length, saved: own.filter(w => w.saved).length,
    groups: data.groups.filter(g => g.member_ids.includes(id)).map(g => g.name), contact: Boolean(data.contacts?.[id]) };
}

async function removePerson(person) {
  const impact = removalImpact(state, person.id);
  const lines = [
    impact.outputs && `• ${impact.outputs} output${impact.outputs === 1 ? '' : 's'} only they are listed on${impact.saved ? ` (${impact.saved} saved)` : ''}`,
    impact.groups.length && `• their place in ${impact.groups.length === 1 ? 'the group' : `${impact.groups.length} groups:`} ${impact.groups.join(', ')}, with their role details; requests they own become unassigned`,
    impact.contact && '• your contact record: tags, date met, notes and follow-ups'
  ].filter(Boolean);
  if (!confirm([`Remove ${person.name} from this workspace?`, lines.length && `This also removes:\n${lines.join('\n')}`,
    'Outputs that other people here also list are kept. Nothing changes on ORCID, and you can import them again later.'].filter(Boolean).join('\n\n'))) return;
  if (!await mutate('/api/people/remove', { id: person.id }, `${person.name} removed from this workspace.`)) return;
  if (selectedPerson === person.id) selectedPerson = null;
  render();
  // The focused Remove button is gone; land on the page instead of <body>.
  document.querySelector('#main').focus();
}

function renderPeople(view) {
  if (selectedPerson) {
    const person = state.people.find(p => p.id === selectedPerson);
    if (person) {
      view.append(button('← All people', () => { selectedPerson = null; search = ''; render(); }, 'quiet back'), personCard(person));
      const list = el('div', { class: 'stack spaced' });
      const results = () => {
        const works = groupWorks(state, [person.id]).filter(matches);
        list.replaceChildren(...(works.length ? paged(`person:${person.id}`, works, w => workCard(w), results) : [empty('No outputs to show.', search ? 'Try a different search.' : 'This imported record has no public outputs available.')]));
      };
      view.append(el('div', { class: 'spaced' }, toolbar('PUBLIC RESEARCH OUTPUTS', 'Search this researcher’s outputs', results)), list);
      results();
      return;
    }
    selectedPerson = null;
  }
  view.append(importForm(), el('p', { class: 'helper' }, 'Imports read public records. Researchers have not signed in or confirmed these profiles.'));
  const list = el('div', { class: 'grid' });
  const results = () => {
    const people = state.people.filter(p => `${p.name} ${p.affiliation} ${p.keywords.join(' ')} ${p.orcid || ''}`.toLowerCase().includes(search.toLowerCase()));
    list.replaceChildren(...(people.length ? people.map(personCard) : [empty(search ? 'No researchers found.' : 'Start with someone you know.', search ? 'Try a name, affiliation, keyword, or ORCID iD.' : 'Import a collaborator’s ORCID record above, or explore the sample workspace.', !search && nextSteps({ people: false }))]));
  };
  view.append(toolbar('PEOPLE IN YOUR WORKSPACE', 'Search people, topics, or affiliations', results), list);
  results();
}

function groupEditor(group) {
  const name = el('input', { class: 'input', required: true, maxlength: '120', value: group?.name || '', name: 'name' });
  const description = el('textarea', { class: 'input', maxlength: '2000', name: 'description' }, group?.description || '');
  const checkboxes = state.people.map(person => ({ person, input: el('input', { type: 'checkbox', value: person.id, checked: group?.member_ids.includes(person.id) || false }) }));
  return el('form', { class: 'editor', onsubmit: async event => {
    event.preventDefault();
    const body = { name: name.value.trim(), description: description.value.trim(), member_ids: checkboxes.filter(c => c.input.checked).map(c => c.person.id) };
    if (!body.name) { name.focus(); return; }
    if (group) body.id = group.id;
    if (await mutate(group ? '/api/groups/update' : '/api/groups', body, group ? 'Group updated.' : 'Group created. Your locally curated roster is ready.')) {
      editorGroup = undefined;
      render();
    }
  } }, el('h2', {}, group ? 'Edit your group' : 'A place for your collaborators'),
  el('label', { class: 'field' }, 'Group name', name), el('label', { class: 'field' }, 'Description', description),
  el('fieldset', { class: 'roster' }, el('legend', {}, 'Members from your workspace'), checkboxes.length ? checkboxes.map(({ person, input }) => el('label', { class: 'check-label' }, input, person.name, person.demo && tag('Demo', true))) : el('p', { class: 'helper' }, 'Import people first, or create an empty group and add members later.')),
  el('p', { class: 'helper' }, 'This is a local roster. Adding someone does not notify them, confirm membership, or change their ORCID record.'),
  el('div', { class: 'card-actions' }, el('button', { type: 'submit', class: 'button', disabled: busy }, group ? 'Save group' : 'Create group'), button('Cancel', () => { editorGroup = undefined; render(); }),
    group && button('Delete group', () => deleteGroup(group), 'quiet danger', { 'aria-label': `Delete group ${group.name}` })));
}

async function deleteGroup(group) {
  if (!confirm(`Delete “${group.name}”? Its member roles, project selections and requests are removed from this workspace. The people, their outputs and your contact notes stay.`)) return;
  if (!await mutate('/api/groups/delete', { id: group.id }, `Group “${group.name}” deleted.`)) return;
  editorGroup = undefined;
  groupDrafts.delete(group.id);
  if (selectedGroup === group.id) location.hash = 'groups';
  else render();
  // The focused Delete button is gone; land on the page instead of <body>.
  document.querySelector('#main').focus();
}

async function postState(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pilot-Request': '1' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  state = result;
}

async function runBulk(group, retry = false) {
  const draft = draftsFor(group);
  if (busy || bulkRunning || !draft.bulk || draft.bulk.overLimit) return;
  const pending = draft.bulk.entries.filter(entry => entry.valid && (retry ? entry.status === 'error' : ['ready', 'cancelled'].includes(entry.status)));
  draft.cancel = false;
  bulkRunning = true;
  activeBulkGroup = group.id;
  try {
    for (const entry of pending) {
      if (draft.cancel) { entry.status = 'cancelled'; entry.message = 'Not processed · ready to resume'; continue; }
      entry.status = 'loading'; entry.message = 'Reading public record…'; render();
      try {
        let person = state.people.find(p => p.orcid === entry.id && !p.demo);
        const reused = Boolean(person);
        if (!person) {
          await postState('/api/import', { orcid: entry.id });
          person = state.people.find(p => p.orcid === entry.id && !p.demo);
          if (!person) throw new Error('Import returned no researcher. No member was added.');
        }
        const current = state.groups.find(g => g.id === group.id);
        if (!current) throw new Error('This group is no longer available.');
        const included = current.member_ids.includes(person.id);
        if (!included) await postState('/api/groups/members/add', { id: group.id, member_ids: [person.id] });
        entry.status = 'done';
        entry.message = `${person.name} · ${included ? 'already a member' : 'added'}${reused ? ' · existing import reused' : ''}`;
      } catch (error) { entry.status = 'error'; entry.message = error.message || 'Could not reach the server. Retry this entry.'; }
      render();
    }
  } finally {
    bulkRunning = false;
    activeBulkGroup = null;
    render();
    notice(draft.cancel ? 'Import stopped after the current record. Completed additions are saved.' : 'Bulk import finished. Review the per-record results below.');
  }
}

function bulkRoster(group) {
  const draft = draftsFor(group);
  const input = el('textarea', { class: 'input', rows: '4', 'aria-label': 'ORCID list', placeholder: 'Paste ORCID iDs or profile links, one per line', disabled: bulkRunning, oninput: event => { draft.bulkText = event.target.value; draft.bulk = null; results.replaceChildren(); } }, draft.bulkText);
  const results = el('div', { class: 'bulk-results', 'aria-live': 'polite' });
  const refresh = () => {
    if (!draft.bulk) return;
    const entries = draft.bulk.entries;
    results.replaceChildren(...[
      el('p', { class: 'helper' }, `${entries.filter(e => e.valid).length} valid · ${entries.filter(e => !e.valid).length} invalid · duplicates removed`),
      draft.bulk.overLimit && el('p', { class: 'inline-error', role: 'alert' }, 'Use at most 50 unique entries per batch. No imports have started.'),
      el('ul', { class: 'bulk-list' }, entries.map(entry => el('li', { class: `bulk-entry ${entry.status}` }, el('strong', {}, entry.id), el('span', {}, entry.status === 'ready' && state.people.some(p => p.orcid === entry.id && !p.demo) ? 'Existing import will be reused' : entry.message)))),
      el('div', { class: 'card-actions' },
        button('Import & add to group', () => runBulk(group), 'accent', { disabled: busy || bulkRunning || draft.bulk.overLimit || !entries.some(e => ['ready', 'cancelled'].includes(e.status)) }),
        entries.some(e => e.status === 'error') && button('Retry failed entries', () => runBulk(group, true), 'quiet', { disabled: busy || bulkRunning || draft.bulk.overLimit }),
        bulkRunning && button(draft.cancel ? 'Stopping after this record…' : 'Stop after current record', () => { draft.cancel = true; refresh(); }, 'quiet', { disabled: draft.cancel }))].filter(Boolean)
    );
  };
  refresh();
  return el('section', { class: 'editor' }, el('h3', {}, 'Add collaborators by ORCID'),
    el('p', { class: 'helper' }, 'Paste up to 50 ORCID iDs or links, including Markdown links. Preview first, then import public records one at a time. Existing imports are reused.'),
    el('label', { class: 'field' }, 'ORCID list', input),
    button('Preview list', () => { draft.bulk = parseOrcidList(input.value); refresh(); }, 'quiet'), results);
}

function memberEditor(group, person) {
  const drafts = draftsFor(group).members;
  const draft = drafts[person.id] ||= { ...(group.member_details?.[person.id] || {}) };
  const field = (key, label, limit, multiline = false) => {
    const attrs = { class: 'input', maxlength: String(limit), name: key, 'aria-label': label, oninput: event => { draft[key] = event.target.value; } };
    return el('label', { class: 'field' }, label, multiline ? el('textarea', { ...attrs, rows: '2' }, draft[key] || '') : el('input', { ...attrs, value: draft[key] || '' }));
  };
  return el('form', { class: 'editor member-editor', onsubmit: async event => {
    event.preventDefault();
    if (await mutate('/api/groups/member', { id: group.id, person_id: person.id, role: draft.role || '', expertise: draft.expertise || '', contribution: draft.contribution || '' }, `Local details saved for ${person.name}.`)) render();
  } }, el('div', { class: 'person-head' }, avatar(person), el('div', {}, el('h3', {}, person.name), el('p', { class: 'helper' }, person.affiliation || 'Affiliation not provided'))),
    el('div', { class: 'card-actions' }, person.orcid && externalLink(person.orcid, `https://orcid.org/${person.orcid}`), exploreLink(person)),
    el('fieldset', { class: 'form-fields', disabled: bulkRunning }, field('role', 'Project role', 120), field('expertise', 'Expertise', 500), field('contribution', 'Contribution to this group', 1000, true),
      el('button', { type: 'submit', class: 'button quiet small', disabled: busy || bulkRunning }, 'Save member details')));
}

function renderRoster(view, group) {
  view.append(el('p', { class: 'helper' }, 'Roles, expertise, and contributions are recorded locally by this workspace. Researchers have not confirmed these details.'), bulkRoster(group));
  const members = peopleFor(group.member_ids);
  view.append(members.length ? el('div', { class: 'grid' }, members.map(p => memberEditor(group, p))) : empty('Your roster is ready to grow.', 'Paste your collaborators’ ORCID iDs above, or use Edit group & roster to add existing people.'));
}

function renderProjectOutputs(view, group) {
  const list = el('div', { class: 'stack' });
  const selected = new Set(group.selected_work_ids || []);
  const results = () => {
    const works = groupWorks(state, group.member_ids).filter(matches);
    const output = work => el('div', { class: 'project-output' }, workCard(work),
      el('div', { class: 'output-action' }, selected.has(work.id) ? tag('Selected for this project') : tag('Suggested · member output'),
        button(selected.has(work.id) ? 'Remove from project' : '+ Select for project', () => update('/api/groups/output', { id: group.id, work_id: work.id, selected: !selected.has(work.id) }, selected.has(work.id) ? 'Output removed from the project collection.' : 'Output selected for this project.'), 'quiet small', { 'aria-label': `${selected.has(work.id) ? 'Remove from' : 'Select for'} project: ${work.title}` })));
    const chosen = works.filter(w => selected.has(w.id));
    const suggested = works.filter(w => !selected.has(w.id));
    list.replaceChildren(el('h3', {}, `Project collection (${chosen.length})`), ...(chosen.length ? paged(`project-chosen:${group.id}`, chosen, output, results) : [el('p', { class: 'helper' }, 'Select relevant outputs below to build this project’s collection.')]),
      el('h3', { class: 'spaced' }, `Suggested member outputs (${suggested.length})`), ...(suggested.length ? paged(`project-suggested:${group.id}`, suggested, output, results) : [el('p', { class: 'helper' }, 'No additional member outputs match this view.')]));
  };
  view.append(el('p', { class: 'helper' }, 'Member outputs are suggestions. Selecting one records your local decision that it belongs to this project; it does not change ORCID or confirm attribution with the authors.'), toolbar('BUILD YOUR PROJECT COLLECTION', 'Search group outputs', results), list);
  results();
}

function renderRequests(view, group) {
  const draft = draftsFor(group).request;
  const input = (key, attrs = {}) => el('input', { class: 'input', value: draft[key] || '', oninput: event => { draft[key] = event.target.value; }, ...attrs });
  const title = input('title', { required: true, maxlength: '160' });
  const description = el('textarea', { class: 'input', rows: '3', maxlength: '2000', 'aria-label': 'Details', oninput: event => { draft.description = event.target.value; } }, draft.description || '');
  const owner = el('select', { class: 'input', 'aria-label': 'Owner', onchange: event => { draft.owner_id = event.target.value; } }, el('option', { value: '' }, 'Unassigned'), peopleFor(group.member_ids).map(p => el('option', { value: p.id }, p.name)));
  owner.value = group.member_ids.includes(draft.owner_id) ? draft.owner_id : '';
  const date = input('due_date', { type: 'date' });
  view.append(el('p', { class: 'helper' }, 'Track small tasks and collaboration needs. These requests stay in your local workspace; no messages or invitations are sent.'),
    el('form', { class: 'editor', onsubmit: async event => {
      event.preventDefault();
      if (await mutate('/api/groups/requests', { id: group.id, title: title.value.trim(), description: description.value.trim(), owner_id: owner.value || null, due_date: date.value }, 'Request added.')) { draftsFor(group).request = {}; render(); }
    } }, el('h3', {}, 'Create a request'), el('fieldset', { class: 'form-fields', disabled: bulkRunning },
      el('label', { class: 'field' }, 'What does the group need?', title), el('label', { class: 'field' }, 'Details', description),
      el('div', { class: 'grid' }, el('label', { class: 'field' }, 'Owner', owner), el('label', { class: 'field' }, 'Due date (optional)', date)),
      el('button', { type: 'submit', class: 'button accent', disabled: busy || bulkRunning }, 'Add request'))));
  const requests = group.requests || [];
  view.append(el('div', { class: 'stack' }, requests.length ? [...requests].sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved')).map(request => el('article', { class: 'work-card' },
    el('div', { class: 'card-top' }, el('h3', {}, request.title), tag(request.status)),
    el('p', { class: 'request-description' }, request.description),
    el('p', { class: 'helper' }, `Owner: ${state.people.find(p => p.id === request.owner_id)?.name || 'Unassigned'} · Due: ${request.due_date ? dateLabel(request.due_date) : 'No deadline'}`),
    button(request.status === 'resolved' ? 'Reopen request' : 'Mark resolved', () => update('/api/groups/requests/update', { id: group.id, request_id: request.id, status: request.status === 'resolved' ? 'open' : 'resolved' }), 'quiet small')))
    : empty('What could your collaborators help with?', 'Record a protocol review, an equipment need, or a reporting task.')));
}

function renderTeamPack(view, group) {
  const draft = draftsFor(group).pack;
  const scope = el('select', { class: 'input', 'aria-label': 'Output scope', onchange: event => { draft.scope = event.target.value; } }, el('option', { value: 'project' }, 'Selected project outputs'), el('option', { value: 'members' }, 'All outputs by chosen members'));
  scope.value = draft.scope || 'project';
  const date = key => el('input', { class: 'input', type: 'date', value: draft[key] || '', oninput: event => { draft[key] = event.target.value; } });
  const from = date('from'); const to = date('to');
  const members = peopleFor(group.member_ids).map(person => ({ person, input: el('input', { type: 'checkbox', checked: !draft.members || draft.members.includes(person.id), onchange: () => { draft.members = members.filter(m => m.input.checked).map(m => m.person.id); } }) }));
  const error = el('p', { class: 'inline-error', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'button accent', disabled: busy || bulkRunning }, '↓ Download team pack');
  const form = el('form', { class: 'editor', onsubmit: async event => {
    event.preventDefault(); error.textContent = '';
    const ids = members.filter(m => m.input.checked).map(m => m.person.id);
    if (!ids.length) { error.textContent = 'Choose at least one member.'; return; }
    if (from.value && to.value && from.value > to.value) { error.textContent = 'The end date must be on or after the start date.'; return; }
    const params = new URLSearchParams({ scope: scope.value, members: ids.join(','), from: from.value, to: to.value });
    submit.disabled = true; submit.textContent = 'Preparing team pack…';
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(group.id)}/export?${params}`, { headers: { 'X-Pilot-Request': '1' } });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Could not build the team pack.'); }
      const url = URL.createObjectURL(await response.blob());
      const link = el('a', { href: url, download: `${group.name.replace(/[^\w-]+/g, '-') || 'group'}-team-pack.zip` });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      guideMemory = { ...guideMemory, pack: true };
      remember('srp-network-guide', guideMemory);
      renderGuide();
      notice('Team pack downloaded with your selected scope and filters. It holds no contact tags, notes or follow-ups.');
    } catch (failure) { error.textContent = failure.message || 'Could not reach the server. Please try again.'; }
    finally { submit.disabled = busy || bulkRunning; submit.textContent = '↓ Download team pack'; }
  } }, el('h3', {}, 'Build a team pack'), el('p', { class: 'helper' }, `Download the roster, bibliography, member biosketches, and a manifest describing the selection. Your project collection contains ${(group.selected_work_ids || []).length} selected outputs and is the default scope. Your contact tags, notes and follow-ups are never included.`),
    el('fieldset', { class: 'form-fields', disabled: bulkRunning }, el('label', { class: 'field' }, 'Output scope', scope),
      el('fieldset', { class: 'roster' }, el('legend', {}, 'Include members'), members.map(({ person, input }) => el('label', { class: 'check-label' }, input, person.name))),
      el('div', { class: 'grid' }, el('label', { class: 'field' }, 'Published from (optional)', from), el('label', { class: 'field' }, 'Published through (optional)', to)),
      el('p', { class: 'helper' }, 'Date filters apply to outputs, including each biosketch. Outputs without publication dates are excluded when a date filter is used. Year-only and month-only dates are included when they overlap the chosen window.'), error, submit));
  view.append(form);
}

function renderGroups(view) {
  if (editorGroup !== undefined) view.append(groupEditor(editorGroup));
  if (selectedGroup) {
    const group = state.groups.find(g => g.id === selectedGroup);
    if (group) {
      view.append(button('← All groups', () => { editorGroup = undefined; location.hash = 'groups'; }, 'quiet back'),
        el('div', { class: 'group-title' }, el('div', {}, el('h2', {}, group.name), el('p', { class: 'helper' }, group.description)), el('div', { class: 'card-actions' }, document.documentElement.dataset.hosted === 'true' && el('a', { class: 'button quiet small', href: `/group/?from=${encodeURIComponent(group.id)}` }, 'Share & visualise →'), button('Edit group & roster', () => { editorGroup = group; render(); }, 'quiet small'))),
        el('p', { class: 'helper' }, `${group.member_ids.length} members · Locally curated group. Membership and project attribution have not been confirmed by researchers.`));
      const labels = [['roster', 'Roster'], ['outputs', 'Project outputs'], ['requests', 'Requests'], ['pack', 'Team pack']];
      const tabs = el('div', { class: 'group-tabs', role: 'tablist', 'aria-label': 'Group sections' }, labels.map(([id, label], index) => button(label, () => {
        groupTab = id; search = ''; render(); document.getElementById(`group-tab-${id}`)?.focus();
      }, groupTab === id ? '' : 'quiet', { id: `group-tab-${id}`, role: 'tab', 'aria-selected': String(groupTab === id), 'aria-controls': 'group-panel', tabindex: groupTab === id ? '0' : '-1', onkeydown: event => {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!offset && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? labels.length - 1 : (index + offset + labels.length) % labels.length;
        document.getElementById(`group-tab-${labels[next][0]}`)?.click();
      } })));
      const panel = el('section', { id: 'group-panel', role: 'tabpanel', 'aria-labelledby': `group-tab-${groupTab}`, tabindex: '0' });
      view.append(tabs, panel);
      ({ roster: renderRoster, outputs: renderProjectOutputs, requests: renderRequests, pack: renderTeamPack })[groupTab](panel, group);
      return;
    }
    selectedGroup = null;
  }
  view.append(el('div', { class: 'toolbar' }, el('span', { class: 'section-kicker' }, 'WORKING GROUPS & CONSORTIA'), button('+ New group', () => { editorGroup = null; render(); }, '')));
  if (!state.groups.length) {
    view.append(empty('Better, together.', 'Create a working group or consortium. Bring together a member roster, a deduplicated bibliography, and downloadable biosketches. A group is your own curated list: nobody is notified and membership is not confirmed.', el('div', { class: 'card-actions' }, button('Create your first group', () => { editorGroup = null; render(); }, 'accent'), !state.people.some(p => p.demo) && button('Try it with the labelled sample', offerSample, 'quiet'))));
    return;
  }
  view.append(el('div', { class: 'grid' }, state.groups.map(group => {
    const people = peopleFor(group.member_ids);
    return el('article', { class: 'group-card' }, el('div', { class: 'card-top' }, tag('Local working group'), people.length > 0 && people.every(p => p.demo) && tag('Demo', true)), el('h3', {}, group.name), el('p', {}, group.description), el('div', { class: 'avatars' }, people.slice(0, 5).map(p => avatar(p))), el('div', { class: 'work-count' }, `${people.length} members · ${(group.selected_work_ids || []).length} project outputs · ${groupWorks(state, group.member_ids).length} member outputs`), el('div', { class: 'card-actions' }, button('Open group →', () => { editorGroup = undefined; location.hash = `groups/${encodeURIComponent(group.id)}`; }, 'quiet small'), button('Edit', () => { editorGroup = group; render(); }, 'quiet small')));
  })));
}

// ---- Contacts: private tags, notes and follow-ups for people you meet ----

const emptyContact = { tags: [], met_on: '', notes: [], actions: [] };
const contactOf = id => state.contacts?.[id] || emptyContact;
export function allTags(contacts) {
  const counts = new Map();
  for (const contact of Object.values(contacts || {})) for (const t of contact.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
export function openActions(contacts, ids) {
  const wanted = new Set(ids);
  const list = [];
  for (const [personId, contact] of Object.entries(contacts || {})) {
    if (!wanted.has(personId)) continue;
    for (const action of contact.actions) if (action.status === 'open') list.push({ personId, action });
  }
  // Dated follow-ups first (soonest first), undated ones last.
  return list.sort((a, b) => (a.action.due_date || '9999').localeCompare(b.action.due_date || '9999') || a.action.created_at.localeCompare(b.action.created_at));
}
const today = () => new Date().toISOString().slice(0, 10);

function prefillMeeting(value) {
  history.replaceState(null, '', '#contacts');
  if (bulkRunning) return notice('An import is running. Click the bookmark on that ORCID page again once it finishes.', true);
  const draft = contactDrafts.meeting;
  // Keep the results of entries already in the list, so finished imports are not run again.
  const before = new Map((draft.bulk?.entries || []).map(e => [e.id, e]));
  const known = new Set(parseOrcidList(draft.text).entries.map(e => e.id));
  const added = parseOrcidList(value).entries.filter(e => !known.has(e.id));
  if (added.length) draft.text = [draft.text.trim(), ...added.map(e => e.id)].filter(Boolean).join('\n');
  draft.bulk = parseOrcidList(draft.text);
  draft.bulk.entries = draft.bulk.entries.map(e => before.get(e.id) || e);
  const valid = added.filter(e => e.valid).map(e => e.id);
  if (valid.length) notice(`Added ${valid.join(', ')} to “I just met people”. Name the context, then choose Import & tag. Nothing is imported until then.`);
  else notice(added.length ? 'That link held no valid ORCID iD. See the entry marked invalid below.' : 'That ORCID iD is already in the list below.', added.length > 0);
}

async function runMeeting() {
  const draft = contactDrafts.meeting;
  const tagName = draft.tag.trim();
  if (busy || bulkRunning || !draft.bulk || draft.bulk.overLimit) return;
  const pending = draft.bulk.entries.filter(e => e.valid && ['ready', 'error', 'cancelled'].includes(e.status));
  if (!tagName) return notice('Name the conference or context first, so these people can be found together later.', true);
  draft.cancel = false;
  bulkRunning = true;
  try {
    for (const entry of pending) {
      if (draft.cancel) { entry.status = 'cancelled'; entry.message = 'Not processed · ready to resume'; continue; }
      entry.status = 'loading'; entry.message = 'Reading public record…'; render();
      try {
        let person = state.people.find(p => p.orcid === entry.id && !p.demo);
        const reused = Boolean(person);
        if (!person) {
          await postState('/api/import', { orcid: entry.id });
          person = state.people.find(p => p.orcid === entry.id && !p.demo);
          if (!person) throw new Error('Import returned no researcher. Nobody was tagged.');
        }
        await postState('/api/contacts/tags', { person_ids: [person.id], add: [tagName], met_on: draft.date });
        entry.status = 'done';
        entry.message = `${person.name} · tagged “${tagName}”${reused ? ' · existing import reused' : ''}`;
      } catch (error) { entry.status = 'error'; entry.message = error.message || 'Could not reach the server. Retry this entry.'; }
      render();
    }
  } finally {
    bulkRunning = false;
    render();
    notice(draft.cancel ? 'Stopped after the current record. People already tagged are saved.' : 'Finished. Review the per-record results below.');
  }
}

function meetingForm() {
  const draft = contactDrafts.meeting;
  draft.date ||= today();
  const tags = allTags(state.contacts);
  const list = el('datalist', { id: 'known-tags' }, tags.map(([t]) => el('option', { value: t })));
  const tagInput = el('input', { class: 'input', list: 'known-tags', maxlength: '60', placeholder: 'e.g. FENS 2026', value: draft.tag, disabled: bulkRunning, oninput: e => { draft.tag = e.target.value; } });
  const date = el('input', { class: 'input', type: 'date', value: draft.date, disabled: bulkRunning, oninput: e => { draft.date = e.target.value; } });
  const text = el('textarea', { class: 'input', rows: '3', 'aria-label': 'ORCID list', placeholder: 'Paste ORCID iDs or profile links, one per line', disabled: bulkRunning, oninput: e => { draft.text = e.target.value; draft.bulk = null; results.replaceChildren(); } }, draft.text);
  const results = el('div', { class: 'bulk-results', 'aria-live': 'polite' });
  const refresh = () => {
    if (!draft.bulk) return;
    const entries = draft.bulk.entries;
    results.replaceChildren(...[
      el('p', { class: 'helper' }, `${entries.filter(e => e.valid).length} valid · ${entries.filter(e => !e.valid).length} invalid · duplicates removed`),
      draft.bulk.overLimit && el('p', { class: 'inline-error', role: 'alert' }, 'Use at most 50 unique entries per batch. No imports have started.'),
      el('ul', { class: 'bulk-list' }, entries.map(e => el('li', { class: `bulk-entry ${e.status}` }, el('strong', {}, e.id), el('span', {}, e.status === 'ready' && state.people.some(p => p.orcid === e.id && !p.demo) ? 'Existing import will be reused' : e.message)))),
      el('div', { class: 'card-actions' },
        button('Import & tag', runMeeting, 'accent', { disabled: busy || bulkRunning || draft.bulk.overLimit || !entries.some(e => ['ready', 'error', 'cancelled'].includes(e.status)) }),
        bulkRunning && button(draft.cancel ? 'Stopping…' : 'Stop after current record', () => { draft.cancel = true; refresh(); }, 'quiet', { disabled: draft.cancel }))].filter(Boolean));
  };
  refresh();
  return el('section', { class: 'editor' }, el('h3', {}, 'I just met people'),
    el('p', { class: 'helper' }, 'Tag everyone from one conference or context. Tags, notes and follow-ups stay in this browser; they are never part of a team pack and the people do not see them.'),
    list, el('label', { class: 'field' }, 'Conference or context', tagInput), el('label', { class: 'field' }, 'Date met', date),
    el('label', { class: 'field' }, 'ORCID iDs', text),
    button('Preview list', () => { draft.bulk = parseOrcidList(text.value); refresh(); }, 'quiet'), results,
    el('details', { class: 'bookmarklet' }, el('summary', {}, 'Add people straight from ORCID pages'),
      el('p', { class: 'helper' }, 'On a computer, drag this button to your bookmarks bar. On any ORCID record page, click the bookmark: that person is added to the list above. It reads only the iD in the page address and imports nothing until you choose Import & tag.'),
      el('a', { class: 'button quiet small', href: bookmarklet(`${location.origin}${location.pathname}`), onclick: e => { e.preventDefault(); notice('Drag this button to your bookmarks bar, then click the bookmark on an ORCID record page.'); } }, '+ Add to my network')));
}

function contactCard(person) {
  const contact = contactOf(person.id);
  const note = contactDrafts.notes;
  const act = contactDrafts.actions;
  const tagDraft = contactDrafts.tagInput;
  const act_ = act[person.id] ||= { title: '', due: '' };
  const open = contact.actions.filter(a => a.status === 'open');
  const done = contact.actions.filter(a => a.status === 'done');
  const noteBox = el('textarea', { class: 'input', rows: '2', maxlength: '2000', 'aria-label': `Note about ${person.name}`, placeholder: 'What did you talk about?', oninput: e => { note[person.id] = e.target.value; } }, note[person.id] || '');
  const tagBox = el('input', { class: 'input', list: 'known-tags', maxlength: '60', 'aria-label': `Add a tag to ${person.name}`, placeholder: 'Add tag', value: tagDraft[person.id] || '', oninput: e => { tagDraft[person.id] = e.target.value; } });
  const title = el('input', { class: 'input', maxlength: '200', 'aria-label': `Follow-up with ${person.name}`, placeholder: 'Follow-up, e.g. send the protocol', value: act_.title, oninput: e => { act_.title = e.target.value; } });
  const due = el('input', { class: 'input', type: 'date', 'aria-label': 'Due date', value: act_.due, oninput: e => { act_.due = e.target.value; } });
  const actionRow = a => el('li', { class: `bulk-entry ${a.status === 'done' ? 'done' : ''}` },
    el('span', {}, `${a.status === 'done' ? '✓ ' : ''}${a.title}`, a.due_date && el('em', { class: a.status === 'open' && a.due_date < today() ? 'inline-error' : '' }, ` · due ${a.due_date}${a.status === 'open' && a.due_date < today() ? ' (overdue)' : ''}`)),
    el('span', { class: 'card-actions' },
      button(a.status === 'done' ? 'Reopen' : 'Done', () => update('/api/contacts/actions/update', { person_id: person.id, action_id: a.id, status: a.status === 'done' ? 'open' : 'done' }), 'quiet small', { 'aria-label': `${a.status === 'done' ? 'Reopen' : 'Complete'}: ${a.title}` }),
      button('Delete', () => update('/api/contacts/delete', { person_id: person.id, kind: 'action', entry_id: a.id }), 'quiet small', { 'aria-label': `Delete follow-up: ${a.title}` })));
  return el('article', { class: 'group-card contact-card', id: `contact-${person.id}`, tabindex: '-1', 'aria-label': `Contact: ${person.name}` },
    el('div', { class: 'card-top' }, el('div', { class: 'people-line' }, avatar(person), el('h3', { class: 'contact-name' }, person.name)), person.demo && tag('Demo', true)),
    el('p', { class: 'helper' }, [person.affiliation, contact.met_on && `met ${dateLabel(contact.met_on)}`].filter(Boolean).join(' · ') || 'Imported public record'),
    el('p', { class: 'helper' }, person.demo ? 'Fictional sample person: no public ORCID record.' : `Public ORCID record ${person.orcid}, read ${dateLabel(person.last_checked)}. Your notes below are not part of it.`),
    el('div', { class: 'card-actions' }, exploreLink(person), person.orcid && externalLink('ORCID profile ↗', `https://orcid.org/${person.orcid}`), personGroupPicker(person, 'Add to group or tag')),
    el('div', { class: 'chips' }, contact.tags.map(t => el('span', { class: 'chip' }, t, ' ', button('×', () => update('/api/contacts/tags', { person_ids: [person.id], remove: [t] }), 'quiet small', { 'aria-label': `Remove tag ${t} from ${person.name}` })))),
    el('form', { class: 'card-actions', onsubmit: async e => { e.preventDefault(); const v = (tagDraft[person.id] || '').trim(); if (!v) return; if (await mutate('/api/contacts/tags', { person_ids: [person.id], add: [v] }, 'Tag added.')) { tagDraft[person.id] = ''; render(); } } }, tagBox, el('button', { type: 'submit', class: 'button quiet small', disabled: busy }, 'Add tag')),
    el('h4', {}, 'Follow-ups'),
    open.length || done.length ? el('ul', { class: 'bulk-list' }, [...open, ...done].map(actionRow)) : el('p', { class: 'helper' }, 'Nothing planned yet.'),
    el('form', { class: 'form-fields', onsubmit: async e => { e.preventDefault(); if (!act_.title.trim()) return; if (await mutate('/api/contacts/actions', { person_id: person.id, title: act_.title.trim(), due_date: act_.due }, 'Follow-up added.')) { contactDrafts.actions[person.id] = { title: '', due: '' }; render(); } } }, title, due, el('button', { type: 'submit', class: 'button quiet small', disabled: busy }, 'Add follow-up')),
    el('h4', {}, 'Notes'),
    contact.notes.length ? el('ul', { class: 'bulk-list' }, [...contact.notes].reverse().map(n => el('li', { class: 'bulk-entry' }, el('span', {}, n.text, el('em', {}, ` · ${dateLabel(n.created_at.slice(0, 10))}`)), button('Delete', () => update('/api/contacts/delete', { person_id: person.id, kind: 'note', entry_id: n.id }), 'quiet small', { 'aria-label': 'Delete this note' })))) : el('p', { class: 'helper' }, 'No notes yet.'),
    el('form', { class: 'form-fields', onsubmit: async e => { e.preventDefault(); const v = (note[person.id] || '').trim(); if (!v) return; if (await mutate('/api/contacts/notes', { person_id: person.id, text: v }, 'Note saved.')) { note[person.id] = ''; render(); } } }, noteBox, el('button', { type: 'submit', class: 'button quiet small', disabled: busy }, 'Add note')),
    el('div', { class: 'card-actions' }, button('Remove from contacts', () => removeContact(person), 'quiet small danger', { 'aria-label': `Remove ${person.name} from your contacts` })));
}

async function removeContact(person) {
  if (!confirm(`Remove ${person.name} from your contacts? Their tags, date met, notes and follow-ups are deleted. They stay in People, with their outputs and groups.`)) return;
  if (!await mutate('/api/contacts/remove', { person_id: person.id }, `${person.name} removed from your contacts. They are still in People.`)) return;
  for (const drafts of [contactDrafts.notes, contactDrafts.actions, contactDrafts.tagInput]) delete drafts[person.id];
  render();
  document.querySelector('#main').focus();
}

function renderContacts(view) {
  view.append(storageNote(true), meetingForm());
  const tags = allTags(state.contacts);
  if (activeTag && !tags.some(([t]) => t === activeTag)) activeTag = '';
  const everyone = state.people.filter(p => state.contacts?.[p.id]);
  const shown = everyone.filter(p => (!activeTag || contactOf(p.id).tags.includes(activeTag)) && `${p.name} ${p.affiliation}`.toLowerCase().includes(search.toLowerCase()));
  view.append(el('div', { class: 'toolbar' }, el('span', { class: 'section-kicker' }, 'CONTEXTS'),
    el('div', { class: 'chips' }, button(`All (${everyone.length})`, () => { activeTag = ''; render(); }, activeTag ? 'quiet small' : 'small', { 'aria-pressed': String(!activeTag) }),
      tags.map(([t, n]) => button(`${t} (${n})`, () => { activeTag = t; render(); }, activeTag === t ? 'small' : 'quiet small', { 'aria-pressed': String(activeTag === t) })))));
  if (activeTag) {
    const ids = shown.map(p => p.id);
    view.append(el('div', { class: 'card-actions' },
      button('Turn this context into a group', () => update('/api/groups', { name: activeTag, description: `People met: ${activeTag}`, member_ids: ids }, 'Group created from this context. Add roles and requests in Groups.'), 'quiet small', { disabled: !ids.length }),
      button('Remove this tag from everyone shown', () => { if (confirm(`Remove “${activeTag}” from ${ids.length} people? Their notes and follow-ups stay.`)) { const t = activeTag; update('/api/contacts/tags', { person_ids: ids, remove: [t] }, 'Tag removed.'); } }, 'quiet small', { disabled: !ids.length })));
  }
  const todo = openActions(state.contacts, shown.map(p => p.id));
  if (todo.length) {
    view.append(el('section', { class: 'editor' }, el('h3', {}, `Open follow-ups${activeTag ? ` · ${activeTag}` : ''} (${todo.length})`),
      el('ul', { class: 'bulk-list' }, todo.map(({ personId, action }) => el('li', { class: 'bulk-entry' },
        el('span', {}, el('strong', {}, state.people.find(p => p.id === personId)?.name || personId), ` · ${action.title}`, action.due_date && el('em', { class: action.due_date < today() ? 'inline-error' : '' }, ` · due ${action.due_date}${action.due_date < today() ? ' (overdue)' : ''}`)),
        button('Done', () => update('/api/contacts/actions/update', { person_id: personId, action_id: action.id, status: 'done' }), 'quiet small', { 'aria-label': `Complete: ${action.title}` }))))));
  }
  view.append(shown.length ? el('div', { class: 'grid' }, shown.map(contactCard)) : empty('No contacts here yet.', everyone.length ? 'Try another context or search.' : 'Paste the ORCID iDs of people you meet above, with the name of the conference, or tag someone from People with the + button. You can then add notes and follow-ups for each of them.', !everyone.length && nextSteps()));
}

function renderSaved(view) {
  const list = el('div', { class: 'stack' });
  const results = () => {
    const works = state.works.filter(w => w.saved && matches(w));
    list.replaceChildren(...(works.length ? paged('saved', works, w => workCard(w), results) : [empty(search ? 'No matching saved outputs.' : 'Keep the work that matters.', search ? 'Try another search.' : 'Save papers, datasets, and software from the feed or a researcher’s profile. Find them here whenever you need them.', !search && button('Explore your feed →', () => navigate('feed'), 'quiet'))]));
  };
  view.append(toolbar('YOUR READING LIST', 'Search saved research', results), list);
  results();
}

// ---- First-run guide, handoffs from Explore and the labelled sample (#56) ----

const hosted = () => document.documentElement.dataset.hosted === 'true';

// From a real record back to the same researcher in Explore. Explore waits for the visitor to press
// Explore before it reads anything from ORCID.
function exploreLink(person) {
  if (!hosted() || !person.orcid) return null;
  return el('a', { class: 'button quiet small', href: `/?orcid=${encodeURIComponent(person.orcid)}&from=${currentView === 'groups' ? 'groups' : currentView === 'people' ? 'people' : 'contacts'}`, 'aria-label': `Open ${person.name} in Explore` }, 'Open in Explore →');
}

// "What can I do next?" links for empty sections.
function nextSteps({ people = true } = {}) {
  return el('div', { class: 'next-steps' }, el('h3', {}, 'What can I do next?'),
    el('ul', {},
      people && el('li', {}, el('a', { href: '#people' }, 'Import someone by ORCID iD'), ' in People.'),
      hosted() && el('li', {}, el('a', { href: '/' }, 'Explore a public record'), ', then choose Save as contact or Add to group.'),
      !state.people.some(p => p.demo) && el('li', {}, button('Try it with the labelled sample', offerSample, 'quiet small'), ' Fictional people, labelled “Demo”, that you can remove again.')));
}

// Where the workspace lives and how to keep it, shown before anyone invests time in notes.
function storageNote(compact = false) {
  const backup = hosted() && document.querySelector('#export-workspace')
    && button('Download a backup now', () => document.querySelector('#export-workspace')?.click(), 'quiet small');
  const text = hosted()
    ? (compact
      ? 'Contacts, tags, notes and follow-ups are stored only in this browser. Clearing this site’s data, closing a private window, or switching browser or device loses them unless you keep a backup file.'
      : 'Everything in My Network is stored only in this browser: nothing is uploaded or synced. Clearing this site’s data, closing a private window, or switching browser or device loses it. Before you invest time in notes, keep a backup: Download my workspace (in the sidebar) saves a file you can bring back with Restore from file. The file is not encrypted.')
    : 'This local pilot stores everything in its workspace file on this computer. Copy that file to keep a backup before you rely on these notes.';
  return el('div', { class: `storage-note${compact ? ' compact' : ''}`, role: 'note' }, el('strong', {}, compact ? 'Stored in this browser. ' : 'Where your network lives. '), text, backup ? ' ' : '', backup || '');
}

function conceptsExplainer() {
  return el('details', { class: 'concepts' }, el('summary', {}, 'Follow, Contact, Group, Team: what’s the difference?'),
    el('dl', {},
      el('dt', {}, 'Follow'), el('dd', {}, 'See the outputs a refresh newly finds in their public ORCID record, in your Feed. Nothing is sent to them.'),
      el('dt', {}, 'Contact'), el('dd', {}, 'Your own record of someone you know: context tags, date met, private notes and follow-ups. It stays in this workspace and is never part of a team pack or a group link.'),
      el('dt', {}, 'Group'), el('dd', {}, 'A working group you curate: roster, local roles, project outputs and a team pack. Membership is your own note; the people listed are not notified and have not confirmed it.'),
      el('dt', {}, 'Team'), el('dd', {}, 'Membership each person confirms by signing in. That needs cloud Teams, which are not available on this site yet.')));
}

function guidePanel() {
  const steps = guideSteps(state, guideMemory.pack);
  const next = steps.find(step => !step.done);
  return el('section', { class: 'guide', 'aria-labelledby': 'guide-title', tabindex: '-1' },
    el('div', { class: 'guide-head' }, el('div', {}, el('div', { class: 'eyebrow' }, 'FIRST STEPS'), el('h2', { id: 'guide-title' }, 'Connect & Organize, step by step')),
      button('Hide guide', () => setGuide(false), 'quiet small', { 'aria-controls': 'guide' })),
    storageNote(),
    el('ol', { class: 'guide-steps' }, steps.map(step => el('li', { class: step.done ? 'done' : step === next ? 'next' : '' },
      el('span', { class: 'step-state' }, step.done ? '✓ Done' : step === next ? 'Next' : 'To do'), ' ',
      el('a', { href: step.href, 'aria-current': step === next ? 'step' : null }, step.label)))),
    !state.people.length && el('div', { class: 'card-actions' }, button('Use the labelled sample', offerSample, 'accent small'), el('a', { class: 'button quiet small', href: '#people' }, 'Import someone')),
    !next && el('p', { class: 'helper' }, 'All done. Your notes stay in this workspace; the team pack holds only the group’s roster, outputs and biosketches.'),
    conceptsExplainer());
}

function setGuide(open) {
  guideMemory = { ...guideMemory, hidden: !open };
  remember('srp-network-guide', guideMemory);
  render();
  // Keep keyboard focus with the guide when it opens, and on the toggle when it closes.
  (open ? document.querySelector('#guide .guide') : document.querySelector('#guide-toggle'))?.focus();
}

async function offerSample() {
  const message = sampleMessage(workspaceSummary(state));
  if (!message) return notice('The labelled sample is already in this workspace. Remove sample data takes it out again.');
  if (!confirm(message)) return notice('Nothing was added.');
  await update('/api/demo', {}, 'Sample workspace loaded. Every sample person, output and group is labelled Demo. Remove sample data takes it out again.');
}

async function removeSample() {
  const removal = sampleRemoval(state);
  const kept = removal.kept.map(g => `“${g.from}” holds your own members, requests or text, so it stays as “${g.to}”, without the sample people. Its name, description, and the roles, selected outputs and requests of your own members are kept.`);
  if (!confirm([`Remove the labelled sample from this workspace?\n\nThis removes ${plural(removal.people, 'sample person', 'sample people')}, their Demo outputs and anything you added to them (tags, notes, follow-ups, saved outputs)${removal.deleted ? `, and ${plural(removal.deleted, 'unchanged sample group')}` : ''}.`,
    ...kept, 'Your own researchers, contacts and groups stay; sample people are taken out of your own groups.'].join('\n\n'))) return;
  const done = removal.kept.length ? ` Kept as your own group: ${removal.kept.map(g => g.to).join(', ')}.` : '';
  const before = new Set(state.groups.map(g => g.id));
  const viewed = currentView === 'groups' && selectedGroup ? removal.kept.find(g => g.id === selectedGroup) : null;
  const viewingSample = currentView === 'groups' && selectedGroup && isSampleGroup({ id: selectedGroup });
  if (!await mutate('/api/demo/remove', {}, `Sample data removed. Your own records were not changed.${done}`)) return;
  // A kept group has a new address; follow it if it was open, rather than leave a stale URL.
  const moved = viewed && state.groups.find(g => !before.has(g.id) && g.name === viewed.to);
  if (moved) location.hash = `groups/${encodeURIComponent(moved.id)}`;
  else if (viewingSample) location.hash = 'groups';
  else render();
}

function readHandoff() {
  const route = handoffRoute(location.hash);
  if (!route) { handoff = null; return; }
  if (handoff && handoff.intent === route.intent && handoff.raw === route.raw) return;
  // focus: move keyboard focus to the panel's heading once it is first shown (arrival or hashchange).
  handoff = { ...route, status: 'idle', error: '', tag: '', met: '', note: '', groupId: '', groupChosen: false, groupName: '', focus: true };
}

function closeHandoff(hash, message = '') {
  handoff = null;
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  const route = groupRoute(hash);
  currentView = route.view; selectedGroup = route.id; groupTab = 'roster'; editorGroup = undefined; search = ''; activeTag = '';
  render();
  if (message) notice(message);
}

async function confirmHandoff() {
  const h = handoff;
  if (!h || busy || bulkRunning) return;
  const contact = h.intent === 'contact';
  const tagName = h.tag.trim();
  const note = h.note.trim();
  const newGroup = !contact && (!h.groupId || !state.groups.some(g => g.id === h.groupId));
  if (newGroup && !h.groupName.trim()) { h.error = 'Name the new group, or choose an existing one.'; h.status = 'error'; render(); document.querySelector('#handoff-group-name')?.focus(); return; }
  // started: once a save has begun, the panel keeps its form (and any error) until it is done or cancelled.
  busy = true; h.status = 'busy'; h.error = ''; h.started = true; render();
  let imported = false;
  try {
    let person = knownPerson(state, h.id);
    if (!person) {
      notice('Reading the public ORCID record. This can take a moment…');
      await postState('/api/import', { orcid: h.id, follow: false });
      person = knownPerson(state, h.id);
      if (!person) throw new Error('The import returned no researcher.');
      imported = true;
    }
    if (contact) {
      // Only a date the visitor entered is recorded; nothing is assumed from today's date.
      await postState('/api/contacts/tags', { person_ids: [person.id], add: tagName ? [tagName] : [], met_on: h.met || '' });
      if (note) await postState('/api/contacts/notes', { person_id: person.id, text: note });
      busy = false;
      const following = state.people.find(p => p.id === person.id)?.following;
      closeHandoff('#contacts', `${person.name} saved as a contact${imported ? ' from their public ORCID record' : ''}. `
        + (following ? 'You already follow them; that is unchanged.' : 'Not followed: choose Follow in People if you want their new outputs in your Feed.'));
      const card = document.getElementById(`contact-${person.id}`);
      card?.scrollIntoView({ block: 'center' });
      card?.focus();
      return;
    }
    let group = state.groups.find(g => g.id === h.groupId);
    let already = false;
    if (newGroup) {
      const before = new Set(state.groups.map(g => g.id));
      await postState('/api/groups', { name: h.groupName.trim().slice(0, 120), description: '', member_ids: [person.id] });
      group = state.groups.find(g => !before.has(g.id));
    } else if (group.member_ids.includes(person.id)) {
      already = true;
    } else {
      await postState('/api/groups/members/add', { id: group.id, member_ids: [person.id] });
      group = state.groups.find(g => g.id === h.groupId);
    }
    busy = false;
    closeHandoff(`#groups/${encodeURIComponent(group.id)}`, already ? `${person.name} is already in ${group.name}. Nothing changed.`
      : `${person.name} added to ${group.name}. This is your own roster: they are not notified and membership is not confirmed.`);
    document.querySelector('#main').focus();
  } catch (error) {
    busy = false;
    h.status = 'error';
    h.error = imported
      ? `The public record was stored, but the next step failed: ${error.message} Retry uses the stored record.`
      : `${error.message || 'Could not reach ORCID.'} Nothing was saved.`;
    notice('');
    render();
    document.querySelector('#handoff-error')?.focus();
  } finally {
    busy = false;
  }
}

function handoffPanel() {
  const h = handoff;
  const contact = h.intent === 'contact';
  const title = contact ? 'Save as contact' : 'Add to group';
  const cancel = button('Cancel', () => closeHandoff(contact ? '#contacts' : '#groups', 'Cancelled. Nothing was read or saved.'), 'quiet', { disabled: h.status === 'busy' });
  const wrap = (...children) => el('section', { class: 'handoff', id: 'handoff', 'aria-labelledby': 'handoff-title' },
    el('div', { class: 'eyebrow' }, 'FROM EXPLORE'), el('h2', { id: 'handoff-title', tabindex: '-1' }, title), ...children);
  if (!h.valid) {
    return wrap(el('p', { class: 'inline-error', role: 'alert' }, `“${h.raw}” is not a valid ORCID iD: it needs the form 0000-0000-0000-0000 and a correct check digit. Nothing was read or saved.`),
      el('div', { class: 'card-actions' }, button('Close', () => closeHandoff(contact ? '#contacts' : '#groups'), 'quiet')));
  }
  const person = knownPerson(state, h.id);
  const name = person ? `${person.name} (${h.id})` : h.id;
  if (contact && person && state.contacts?.[person.id] && !h.started) {
    return wrap(el('p', {}, `${name} is already one of your contacts. Nothing new was saved, so there is no duplicate.`),
      el('div', { class: 'card-actions' },
        button('Open their contact card', () => {
          closeHandoff('#contacts');
          const card = document.getElementById(`contact-${person.id}`);
          card?.scrollIntoView({ block: 'center' });
          card?.focus();
        }, 'accent'),
        exploreLink(person), cancel));
  }
  const source = person
    ? el('p', {}, `${name} is already in your network (public ORCID record read ${dateLabel(person.last_checked)}). This uses that stored record: no new ORCID request, and no duplicate.`)
    : el('p', {}, `This reads the public ORCID record of ${h.id} once, from the ORCID Public API, and stores it in this browser with its source and date. Nothing is read until you confirm.`);
  const fields = [];
  if (contact) {
    fields.push(el('label', { class: 'field' }, 'Conference or context (optional)',
      el('input', { class: 'input', id: 'handoff-tag', list: 'known-tags', maxlength: '60', placeholder: 'e.g. FENS 2026', value: h.tag, oninput: e => { h.tag = e.target.value; } })),
    el('datalist', { id: 'known-tags' }, allTags(state.contacts).map(([t]) => el('option', { value: t }))),
    el('label', { class: 'field' }, 'Date met (optional)',
      el('input', { class: 'input', id: 'handoff-met', type: 'date', value: h.met, oninput: e => { h.met = e.target.value; } })),
    el('label', { class: 'field' }, 'Private note (optional)',
      el('textarea', { class: 'input', id: 'handoff-note', rows: '2', maxlength: '2000', placeholder: 'What did you talk about?', oninput: e => { h.note = e.target.value; } }, h.note)));
  } else {
    const groups = state.groups;
    if (!h.groupChosen) h.groupId = defaultHandoffGroup(state, person);
    if (h.groupId && !groups.some(g => g.id === h.groupId)) h.groupId = '';
    const select = el('select', { class: 'input', id: 'handoff-group', onchange: e => { h.groupId = e.target.value; h.groupChosen = true; render(); document.querySelector('#handoff-group')?.focus(); } },
      groups.map(g => el('option', { value: g.id }, `${g.name}${isSampleGroup(g) ? ' (sample group)' : ''}${person && g.member_ids.includes(person.id) ? ' (already a member)' : ''}`)),
      el('option', { value: '' }, 'A new group…'));
    select.value = h.groupId;
    const already = person ? groups.filter(g => g.member_ids.includes(person.id)).map(g => g.name) : [];
    fields.push(el('label', { class: 'field' }, 'Group', select));
    if (already.length) fields.push(el('p', { class: 'helper' }, `Already a member of ${already.join(', ')}. Choosing one of those changes nothing.`));
    if (groups.some(g => g.id === h.groupId && isSampleGroup(g))) fields.push(el('p', { class: 'helper' }, 'This is the labelled sample group. A real researcher you add here is your own data: Remove sample data keeps the group for them.'));
    if (!h.groupId) fields.push(el('label', { class: 'field' }, 'New group name', el('input', { class: 'input', id: 'handoff-group-name', maxlength: '120', value: h.groupName, oninput: e => { h.groupName = e.target.value; } })));
  }
  const action = contact ? (person ? 'Save as contact' : 'Read record & save as contact') : (person ? 'Add to group' : 'Read record & add to group');
  return wrap(source,
    el('p', { class: 'helper' }, contact
      ? 'A contact is your private record: tags, notes and follow-ups stay in this workspace. Saving does not follow them or notify them.'
      : 'A group is your own curated roster: they are not notified, and membership is not confirmed by them.'),
    el('form', { class: 'form-fields', onsubmit: event => { event.preventDefault(); confirmHandoff(); } },
      el('fieldset', { class: 'form-fields', disabled: h.status === 'busy' }, ...fields),
      h.error && el('p', { class: 'inline-error', role: 'alert', id: 'handoff-error', tabindex: '-1' }, h.error),
      h.status === 'busy' && el('p', { class: 'helper', role: 'status' }, person ? 'Saving…' : 'Reading the public ORCID record…'),
      el('div', { class: 'card-actions' }, el('button', { type: 'submit', class: 'button accent', disabled: h.status === 'busy' }, h.status === 'error' ? `Retry: ${action}` : action), cancel)));
}

const headings = {
  feed: ['YOUR RESEARCH CIRCLE', 'The latest, together.', 'A quieter way to keep up with the people behind the research.'],
  people: ['PEOPLE, BEFORE METRICS', 'Follow your curiosity.', 'Connect public research records to the people whose work you care about.'],
  contacts: ['PEOPLE YOU MEET', 'Keep every conversation going.', 'Tag people by conference or context, note what you discussed, and track what you promised to do next. Private to this browser.'],
  groups: ['RESEARCH IS A TEAM SPORT', 'A shared place to work.', 'Bring your collaborators and their research outputs into one useful view.'],
  saved: ['GOOD WORK, KEPT CLOSE', 'Your next good read.', 'A personal collection of papers, datasets, and ideas worth returning to.']
};

// The guide (or a pending handoff) above the view. Redrawn on its own after a team-pack download,
// so focus stays on the download button.
function renderGuide() {
  const guide = document.querySelector('#guide');
  if (guide) {
    guide.replaceChildren(...[handoff ? handoffPanel() : !guideMemory.hidden && guidePanel()].filter(Boolean));
    const toggle = document.querySelector('#guide-toggle');
    if (toggle) {
      // The guide steps aside while a handoff waits for an answer; the toggle says so.
      toggle.setAttribute('aria-expanded', String(!guideMemory.hidden && !handoff));
      toggle.disabled = Boolean(handoff);
      toggle.title = handoff ? 'Answer or cancel the pending question first' : '';
    }
  }
}

function render() {
  if (!loaded) return;
  // Controls marked data-focus keep keyboard focus when the view is rebuilt around them.
  const focusKey = document.activeElement?.dataset?.focus;
  const nav = document.querySelector('#navigation');
  const followed = state.people.filter(p => p.following).length;
  nav.replaceChildren(...[
    ['feed', '◫', 'Feed', feedEntries(state).length], ['people', '◉', 'People', state.people.length],
    ['contacts', '☺', 'Contacts', Object.keys(state.contacts || {}).length], ['groups', '⌘', 'Groups', state.groups.length], ['saved', '▱', 'Saved', state.works.filter(w => w.saved).length]
  ].map(([id, icon, label, count]) => el('a', { class: `nav-link${currentView === id ? ' active' : ''}`, href: `#${id}`, 'aria-current': currentView === id ? 'page' : null }, el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), label, el('span', { class: 'nav-count' }, count))));
  const heading = headings[currentView];
  ['eyebrow', 'title', 'subtitle'].forEach((id, index) => { document.getElementById(id).textContent = heading[index]; });
  document.title = `${currentView[0].toUpperCase() + currentView.slice(1)} · My Network · ${document.querySelector('meta[name="application-name"]')?.content || 'Science Record Player'}`;
  const banner = document.querySelector('#demo-banner');
  banner.hidden = !state.people.some(p => p.demo);
  banner.replaceChildren(el('span', {}, 'Sample workspace: illustrative people, outputs and groups are labelled “Demo”. Your own imports stay separate. '),
    button('Remove sample data', removeSample, 'quiet small'));
  renderGuide();
  if (handoff?.focus) {
    handoff.focus = false;
    document.querySelector('#handoff-title')?.focus();
  }
  document.querySelector('#summary').replaceChildren(...[[followed, 'researchers followed'], [state.works.length, 'research outputs'], [state.groups.length, 'working groups']].map(([count, label]) => el('div', { class: 'stat' }, el('strong', {}, count), el('span', {}, label))));
  const view = document.querySelector('#view');
  view.replaceChildren();
  ({ feed: renderFeed, people: renderPeople, contacts: renderContacts, groups: renderGroups, saved: renderSaved })[currentView](view);
  if (focusKey) view.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
  if (bulkRunning && activeBulkGroup) {
    const draft = groupDrafts.get(activeBulkGroup);
    const node = document.querySelector('#notice');
    node.hidden = false; node.className = 'notice';
    node.replaceChildren(document.createTextNode(draft.cancel ? 'Stopping after the current record… ' : 'Importing public records one at a time… '),
      el('a', { href: `#groups/${encodeURIComponent(activeBulkGroup)}` }, 'View group'),
      button('Stop after current record', () => { draft.cancel = true; render(); }, 'quiet', { disabled: draft.cancel }));
  }
}

function navigate(view) {
  if (currentView === view) render();
  else { pendingCreateGroup = view === 'groups' && editorGroup === null; location.hash = view; }
}

async function initialize() {
  const route = groupRoute(location.hash);
  currentView = route.view; selectedGroup = route.id;
  const add = addRoute(location.hash);
  if (add) prefillMeeting(add);
  readHandoff();
  const memory = remembered('srp-network-guide', {});
  guideMemory = memory && typeof memory === 'object' ? memory : {};
  window.addEventListener('hashchange', () => {
    const route = groupRoute(location.hash);
    const add = addRoute(location.hash);
    if (add) prefillMeeting(add);
    readHandoff();
    currentView = route.view;
    selectedPerson = null;
    listLimits.clear();
    selectedGroup = route.id;
    groupTab = 'roster';
    editorGroup = pendingCreateGroup ? null : undefined;
    pendingCreateGroup = false;
    search = '';
    render();
  });
  document.querySelector('#demo').addEventListener('click', offerSample);
  document.querySelector('#guide-toggle')?.addEventListener('click', () => setGuide(Boolean(guideMemory.hidden)));
  try {
    const response = await fetch('/api/state', { headers: { 'X-Pilot-Request': '1' } });
    if (!response.ok) throw new Error('Could not load this workspace. Check that the local pilot server is running.');
    state = await response.json();
    const visit = nextVisit(remembered('network-feed-visit', null), new Date().toISOString());
    previousVisit = visit.previous;
    remember('network-feed-visit', visit);
    const dismissed = remembered('network-feed-dismissed', []);
    dismissedSuggestions = Array.isArray(dismissed) ? dismissed.filter(id => typeof id === 'string') : [];
    loaded = true;
    render();
  } catch (error) {
    notice(error.message, true);
    document.querySelector('#view').replaceChildren(empty('Your workspace is unavailable.', 'Reload this page to try again. When running the local pilot, check that its server is still running.', button('Reload page', () => location.reload(), '')));
  }
}

if (typeof document !== 'undefined') initialize();
