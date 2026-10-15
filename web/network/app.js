const emptyState = () => ({ people: [], works: [], events: [], groups: [] });
let state = emptyState();
let currentView = 'feed';
let selectedPerson = null;
let selectedGroup = null;
let editorGroup = undefined;
let search = '';
let busy = false;
let loaded = false;

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

export function feedEntries(data) {
  const following = new Set(data.people.filter(p => p.following).map(p => p.id));
  const works = new Map(data.works.map(w => [w.id, w]));
  const entries = new Map();
  for (const event of data.events) {
    if (!event.people_ids.some(id => following.has(id))) continue;
    const work = works.get(event.work_id);
    if (!work) continue;
    const previous = entries.get(work.id);
    if (!previous || event.observed_at > previous.event.observed_at) entries.set(work.id, { work, event });
  }
  return [...entries.values()].sort((a, b) => b.event.observed_at.localeCompare(a.event.observed_at));
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

const button = (label, action, variant = 'quiet', attrs = {}) => el('button', { type: 'button', class: `button ${variant}`, onclick: action, disabled: busy, ...attrs }, label);
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
  if (busy) return false;
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

function workCard(work, event = null) {
  const people = peopleFor(work.people_ids);
  const following = people.filter(p => p.following);
  const url = work.doi ? `https://doi.org/${work.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}` : work.url;
  return el('article', { class: 'work-card' },
    el('div', { class: 'card-top' },
      el('div', { class: 'people-line' }, el('div', { class: 'avatars' }, people.slice(0, 3).map(p => avatar(p))),
        el('span', {}, people.map(p => p.name).join(' · ') || 'Research output')),
      work.demo && tag('Demo', true)),
    tag((work.type || 'Research output').replaceAll('-', ' ')),
    el('h3', {}, externalLink(work.title || 'Untitled output', url)),
    el('div', { class: 'work-meta' }, el('span', {}, `Publication date: ${dateLabel(work.date)}`), event && el('span', {}, `• Observed ${dateLabel(event.observed_at)}`)),
    event && el('p', { class: 'helper' }, work.demo ? 'Illustrative update from the sample workspace.' : 'Newly found in a public ORCID record. This may be an older publication.'),
    following.length > 1 && el('p', { class: 'helper' }, `${following.length} researchers you follow share this output. Shown once.`),
    el('div', { class: 'work-bottom' },
      el('div', { class: 'work-meta' }, work.demo ? el('span', {}, 'Source: sample data') : people.filter(p => p.orcid).map(p => externalLink(`ORCID: ${p.name} ↗`, `https://orcid.org/${p.orcid}`))),
      button(work.saved ? '✓ Saved' : '+ Save', () => update('/api/save', { id: work.id, saved: !work.saved }, work.saved ? 'Removed from your reading list.' : 'Saved to your reading list.'), 'quiet small', { 'aria-pressed': String(work.saved), 'aria-label': `${work.saved ? 'Unsave' : 'Save'} ${work.title}` })));
}

function sidePanels() {
  const followed = state.people.filter(p => p.following).slice(0, 4);
  return el('div', { class: 'stack' },
    el('aside', { class: 'panel' }, el('div', { class: 'eyebrow' }, 'MAKE YOUR CIRCLE'), el('h3', { class: 'panel-title' }, 'Good research starts with people.'), el('p', {}, 'Paste an ORCID iD or profile link to follow their public research record.'), importForm(true), el('p', {}, 'Updates are checked only when you choose Refresh. No background polling.')),
    el('aside', { class: 'panel' }, el('h3', {}, 'In your circle'), followed.length ? el('div', { class: 'small-list' }, followed.map(p => el('div', { class: 'small-person' }, avatar(p), el('div', {}, el('strong', {}, p.name), el('span', {}, p.affiliation || (p.demo ? 'Sample researcher' : 'Imported public record')))))) : el('p', {}, 'Follow your first researcher to start a circle.'), button('Explore people →', () => navigate('people'), 'quiet small')),
    el('aside', { class: 'panel' }, el('h3', {}, 'Less admin. More discovery.'), el('p', {}, 'Bring a working group together and download its member roster, bibliography, and biosketches in one team pack.'), button('Create a group →', () => { editorGroup = null; navigate('groups'); }, 'quiet small')));
}

function renderFeed(view) {
  const list = el('div', { class: 'stack' });
  function results() {
    const all = feedEntries(state);
    const entries = all.filter(({ work }) => matches(work));
    list.replaceChildren(...(entries.length ? entries.map(({ work, event }) => workCard(work, event)) : [empty(search ? 'No matching updates.' : 'You’re all caught up.', search ? 'Try another title or researcher name.' : 'The first ORCID import creates a baseline, so older papers do not flood your feed. Refresh a researcher in People to discover newly added works. You can browse all imported works there now.', !search && button('Browse people →', () => navigate('people'), 'quiet'))]));
  }
  view.append(toolbar('RESEARCH, WITHOUT THE NOISE', 'Search updates or researchers', results), el('div', { class: 'feed-layout' }, list, sidePanels()));
  results();
}

function personCard(person) {
  return el('article', { class: 'person-card' },
    el('div', { class: 'person-head' }, avatar(person, true), el('div', {}, el('h3', {}, person.name), el('p', {}, person.affiliation || 'Affiliation not provided'))),
    tag(person.demo ? 'Demo' : 'Imported · not connected', person.demo),
    person.headline && el('p', {}, person.headline),
    el('div', { class: 'keywords' }, person.keywords.slice(0, 5).map(word => tag(word))),
    el('div', { class: 'card-actions' }, person.orcid && externalLink('ORCID profile ↗', `https://orcid.org/${person.orcid}`), button(person.following ? '✓ Following' : '+ Follow', () => update('/api/follow', { id: person.id, following: !person.following }), 'quiet small', { 'aria-pressed': String(person.following), 'aria-label': `${person.following ? 'Unfollow' : 'Follow'} ${person.name}` }), button(`${person.work_count} outputs →`, () => { selectedPerson = person.id; search = ''; render(); }, 'quiet small')),
    el('div', { class: 'checked' }, `Last checked: ${dateLabel(person.last_checked)}`),
    !person.demo && el('div', { class: 'card-actions' }, button('Refresh public record ↻', () => update('/api/import', { orcid: person.orcid }, 'Public record refreshed. Newly observed additions appear in your feed when you follow this researcher.'), 'quiet small')));
}

function renderPeople(view) {
  if (selectedPerson) {
    const person = state.people.find(p => p.id === selectedPerson);
    if (person) {
      view.append(button('← All people', () => { selectedPerson = null; search = ''; render(); }, 'quiet back'), personCard(person));
      const list = el('div', { class: 'stack spaced' });
      const results = () => {
        const works = groupWorks(state, [person.id]).filter(matches);
        list.replaceChildren(...(works.length ? works.map(w => workCard(w)) : [empty('No outputs to show.', search ? 'Try a different search.' : 'This imported record has no public outputs available.')]));
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
    list.replaceChildren(...(people.length ? people.map(personCard) : [empty(search ? 'No researchers found.' : 'Start with someone you know.', search ? 'Try a name, affiliation, keyword, or ORCID iD.' : 'Import a collaborator’s ORCID record above, or explore the sample workspace.')]));
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
  el('div', { class: 'card-actions' }, el('button', { type: 'submit', class: 'button', disabled: busy }, group ? 'Save group' : 'Create group'), button('Cancel', () => { editorGroup = undefined; render(); })));
}

function exportLink(group) {
  return el('a', { class: 'button accent', href: `/api/groups/${encodeURIComponent(group.id)}/export`, download: '' }, '↓ Download team pack');
}

function renderGroups(view) {
  if (editorGroup !== undefined) view.append(groupEditor(editorGroup));
  if (selectedGroup) {
    const group = state.groups.find(g => g.id === selectedGroup);
    if (group) {
      view.append(button('← All groups', () => { selectedGroup = null; editorGroup = undefined; search = ''; render(); }, 'quiet back'),
        el('div', { class: 'group-title' }, el('div', {}, el('h2', {}, group.name), el('p', { class: 'helper' }, group.description)), exportLink(group)),
        el('p', { class: 'helper' }, 'Locally curated, unconfirmed membership. This bibliography contains member outputs; inclusion does not assert that an output belongs to this project.'),
        button('Edit group & roster', () => { editorGroup = group; render(); }, 'quiet small'),
        el('div', { class: 'group-members' }, peopleFor(group.member_ids).map(p => el('span', { class: 'member-pill' }, p.name, p.demo ? ' · Demo' : ''))));
      const list = el('div', { class: 'stack' });
      const results = () => {
        const works = groupWorks(state, group.member_ids).filter(matches);
        list.replaceChildren(...(works.length ? works.map(w => workCard(w)) : [empty('A shared library starts here.', search ? 'No outputs match this search.' : 'Add members with public outputs to build the group bibliography.')]));
      };
      view.append(toolbar('MEMBER OUTPUTS · SHARED WORKS APPEAR ONCE', 'Search group outputs', results), list);
      results();
      return;
    }
    selectedGroup = null;
  }
  view.append(el('div', { class: 'toolbar' }, el('span', { class: 'section-kicker' }, 'WORKING GROUPS & CONSORTIA'), button('+ New group', () => { editorGroup = null; render(); }, '')));
  if (!state.groups.length) {
    view.append(empty('Better, together.', 'Create a working group or consortium. Bring together a member roster, a deduplicated bibliography, and downloadable biosketches.', button('Create your first group', () => { editorGroup = null; render(); }, 'accent')));
    return;
  }
  view.append(el('div', { class: 'grid' }, state.groups.map(group => {
    const people = peopleFor(group.member_ids);
    return el('article', { class: 'group-card' }, el('div', { class: 'card-top' }, tag('Local working group'), people.length > 0 && people.every(p => p.demo) && tag('Demo', true)), el('h3', {}, group.name), el('p', {}, group.description), el('div', { class: 'avatars' }, people.slice(0, 5).map(p => avatar(p))), el('div', { class: 'work-count' }, `${people.length} members · ${groupWorks(state, group.member_ids).length} unique outputs`), el('div', { class: 'card-actions' }, button('Open group →', () => { selectedGroup = group.id; editorGroup = undefined; search = ''; render(); }, 'quiet small'), button('Edit', () => { editorGroup = group; render(); }, 'quiet small')));
  })));
}

function renderSaved(view) {
  const list = el('div', { class: 'stack' });
  const results = () => {
    const works = state.works.filter(w => w.saved && matches(w));
    list.replaceChildren(...(works.length ? works.map(w => workCard(w)) : [empty(search ? 'No matching saved outputs.' : 'Keep the work that matters.', search ? 'Try another search.' : 'Save papers, datasets, and software from the feed or a researcher’s profile. Find them here whenever you need them.', !search && button('Explore your feed →', () => navigate('feed'), 'quiet'))]));
  };
  view.append(toolbar('YOUR READING LIST', 'Search saved research', results), list);
  results();
}

const headings = {
  feed: ['YOUR RESEARCH CIRCLE', 'The latest, together.', 'A quieter way to keep up with the people behind the research.'],
  people: ['PEOPLE, BEFORE METRICS', 'Follow your curiosity.', 'Connect public research records to the people whose work you care about.'],
  groups: ['RESEARCH IS A TEAM SPORT', 'A shared place to work.', 'Bring your collaborators and their research outputs into one useful view.'],
  saved: ['GOOD WORK, KEPT CLOSE', 'Your next good read.', 'A personal collection of papers, datasets, and ideas worth returning to.']
};

function render() {
  if (!loaded) return;
  const nav = document.querySelector('#navigation');
  const followed = state.people.filter(p => p.following).length;
  nav.replaceChildren(...[
    ['feed', '◫', 'Feed', feedEntries(state).length], ['people', '◉', 'People', state.people.length],
    ['groups', '⌘', 'Groups', state.groups.length], ['saved', '▱', 'Saved', state.works.filter(w => w.saved).length]
  ].map(([id, icon, label, count]) => el('a', { class: `nav-link${currentView === id ? ' active' : ''}`, href: `#${id}`, 'aria-current': currentView === id ? 'page' : null }, el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), label, el('span', { class: 'nav-count' }, count))));
  const heading = headings[currentView];
  ['eyebrow', 'title', 'subtitle'].forEach((id, index) => { document.getElementById(id).textContent = heading[index]; });
  document.title = `${currentView[0].toUpperCase() + currentView.slice(1)} · ORCID Network pilot`;
  document.querySelector('#demo-banner').hidden = !state.people.some(p => p.demo);
  document.querySelector('#summary').replaceChildren(...[[followed, 'researchers followed'], [state.works.length, 'research outputs'], [state.groups.length, 'working groups']].map(([count, label]) => el('div', { class: 'stat' }, el('strong', {}, count), el('span', {}, label))));
  const view = document.querySelector('#view');
  view.replaceChildren();
  ({ feed: renderFeed, people: renderPeople, groups: renderGroups, saved: renderSaved })[currentView](view);
}

function navigate(view) {
  if (currentView === view) render();
  else location.hash = view;
}

async function initialize() {
  currentView = headings[location.hash.slice(1)] ? location.hash.slice(1) : 'feed';
  window.addEventListener('hashchange', () => {
    currentView = headings[location.hash.slice(1)] ? location.hash.slice(1) : 'feed';
    selectedPerson = null;
    selectedGroup = null;
    search = '';
    render();
  });
  document.querySelector('#demo').addEventListener('click', () => update('/api/demo', {}, 'Sample workspace loaded. All sample people and updates are labeled Demo.'));
  try {
    const response = await fetch('/api/state', { headers: { 'X-Pilot-Request': '1' } });
    if (!response.ok) throw new Error('Could not load this workspace. Check that the local pilot server is running.');
    state = await response.json();
    loaded = true;
    render();
  } catch (error) {
    notice(error.message, true);
    document.querySelector('#view').replaceChildren(empty('Your workspace is unavailable.', 'Check the local server, then reload this page.', button('Reload page', () => location.reload(), '')));
  }
}

if (typeof document !== 'undefined') initialize();
