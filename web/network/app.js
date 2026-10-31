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
const contactDrafts = { meeting: { tag: '', date: '', text: '', bulk: null }, notes: {}, actions: {}, tagInput: {} };
const groupDrafts = new Map();

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
  const [view, encodedId] = hash.replace(/^#/, '').split('/');
  let id = null;
  try { id = view === 'groups' && encodedId ? decodeURIComponent(encodedId) : null; } catch { /* Invalid URL stays at the groups list. */ }
  return { view: ['feed', 'people', 'contacts', 'groups', 'saved'].includes(view) ? view : 'feed', id };
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

function personGroupPicker(person) {
  const panelId = `person-groups-${person.id}`;
  const triggerId = `person-groups-trigger-${person.id}`;
  const panel = el('div', { class: 'person-groups-panel', id: panelId, hidden: true });
  const trigger = button('+', () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
  }, 'quiet small person-groups-trigger', {
    id: triggerId, 'aria-label': `Add ${person.name} to a group`,
    title: 'Add to a group', 'aria-expanded': 'false', 'aria-controls': panelId,
  });
  panel.append(el('p', { class: 'person-groups-heading' }, 'Add to an existing group'));
  if (state.groups.length) {
    for (const group of state.groups) {
      const included = group.member_ids.includes(person.id);
      panel.append(el('div', { class: 'person-group-option' },
        el('span', {}, group.name),
        included ? el('span', { class: 'person-group-added' }, '✓ Added') :
          button('Add', async () => {
            const current = state.groups.find(item => item.id === group.id);
            if (!current || busy) return;
            if (await mutate('/api/groups/members/add', {
              id: current.id, member_ids: [person.id],
            }, `${person.name} added to ${current.name}.`)) {
              render();
              const nextTrigger = document.getElementById(triggerId);
              if (nextTrigger) {
                nextTrigger.click();
                nextTrigger.focus();
              }
            }
          }, 'quiet small', { 'aria-label': `Add ${person.name} to ${group.name}` })));
    }
  } else {
    panel.append(el('p', { class: 'helper' }, 'No groups yet. Create one to start your roster.'),
      button('Create a group →', () => { editorGroup = null; navigate('groups'); }, 'quiet small'));
  }
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
    results.replaceChildren(
      el('p', { class: 'helper' }, `${entries.filter(e => e.valid).length} valid · ${entries.filter(e => !e.valid).length} invalid · duplicates removed`),
      draft.bulk.overLimit && el('p', { class: 'inline-error', role: 'alert' }, 'Use at most 50 unique entries per batch. No imports have started.'),
      el('ul', { class: 'bulk-list' }, entries.map(entry => el('li', { class: `bulk-entry ${entry.status}` }, el('strong', {}, entry.id), el('span', {}, entry.status === 'ready' && state.people.some(p => p.orcid === entry.id && !p.demo) ? 'Existing import will be reused' : entry.message)))),
      el('div', { class: 'card-actions' },
        button('Import & add to group', () => runBulk(group), 'accent', { disabled: busy || bulkRunning || draft.bulk.overLimit || !entries.some(e => ['ready', 'cancelled'].includes(e.status)) }),
        entries.some(e => e.status === 'error') && button('Retry failed entries', () => runBulk(group, true), 'quiet', { disabled: busy || bulkRunning || draft.bulk.overLimit }),
        bulkRunning && button(draft.cancel ? 'Stopping after this record…' : 'Stop after current record', () => { draft.cancel = true; refresh(); }, 'quiet', { disabled: draft.cancel }))
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
    person.orcid && externalLink(person.orcid, `https://orcid.org/${person.orcid}`),
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
    list.replaceChildren(el('h3', {}, `Project collection (${chosen.length})`), ...(chosen.length ? chosen.map(output) : [el('p', { class: 'helper' }, 'Select relevant outputs below to build this project’s collection.')]),
      el('h3', { class: 'spaced' }, `Suggested member outputs (${suggested.length})`), ...(suggested.length ? suggested.map(output) : [el('p', { class: 'helper' }, 'No additional member outputs match this view.')]));
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
      notice('Team pack downloaded with your selected scope and filters.');
    } catch (failure) { error.textContent = failure.message || 'Could not reach the server. Please try again.'; }
    finally { submit.disabled = busy || bulkRunning; submit.textContent = '↓ Download team pack'; }
  } }, el('h3', {}, 'Build a team pack'), el('p', { class: 'helper' }, `Download the roster, bibliography, member biosketches, and a manifest describing the selection. Your project collection contains ${(group.selected_work_ids || []).length} selected outputs and is the default scope.`),
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
    view.append(empty('Better, together.', 'Create a working group or consortium. Bring together a member roster, a deduplicated bibliography, and downloadable biosketches.', button('Create your first group', () => { editorGroup = null; render(); }, 'accent')));
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
    results.replaceChildren(
      el('p', { class: 'helper' }, `${entries.filter(e => e.valid).length} valid · ${entries.filter(e => !e.valid).length} invalid · duplicates removed`),
      draft.bulk.overLimit && el('p', { class: 'inline-error', role: 'alert' }, 'Use at most 50 unique entries per batch. No imports have started.'),
      el('ul', { class: 'bulk-list' }, entries.map(e => el('li', { class: `bulk-entry ${e.status}` }, el('strong', {}, e.id), el('span', {}, e.status === 'ready' && state.people.some(p => p.orcid === e.id && !p.demo) ? 'Existing import will be reused' : e.message)))),
      el('div', { class: 'card-actions' },
        button('Import & tag', runMeeting, 'accent', { disabled: busy || bulkRunning || draft.bulk.overLimit || !entries.some(e => ['ready', 'error', 'cancelled'].includes(e.status)) }),
        bulkRunning && button(draft.cancel ? 'Stopping…' : 'Stop after current record', () => { draft.cancel = true; refresh(); }, 'quiet', { disabled: draft.cancel })));
  };
  refresh();
  return el('section', { class: 'editor' }, el('h3', {}, 'I just met people'),
    el('p', { class: 'helper' }, 'Tag everyone from one conference or context. Tags, notes and follow-ups stay in this browser; they are never part of a team pack and the people do not see them.'),
    list, el('label', { class: 'field' }, 'Conference or context', tagInput), el('label', { class: 'field' }, 'Date met', date),
    el('label', { class: 'field' }, 'ORCID iDs', text),
    button('Preview list', () => { draft.bulk = parseOrcidList(text.value); refresh(); }, 'quiet'), results);
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
  return el('article', { class: 'group-card' },
    el('div', { class: 'card-top' }, el('div', { class: 'people-line' }, avatar(person), el('strong', {}, person.name)), person.demo && tag('Demo', true)),
    el('p', { class: 'helper' }, [person.affiliation, contact.met_on && `met ${dateLabel(contact.met_on)}`].filter(Boolean).join(' · ') || 'Imported public record'),
    el('div', { class: 'chips' }, contact.tags.map(t => el('span', { class: 'chip' }, t, ' ', button('×', () => update('/api/contacts/tags', { person_ids: [person.id], remove: [t] }), 'quiet small', { 'aria-label': `Remove tag ${t} from ${person.name}` })))),
    el('form', { class: 'card-actions', onsubmit: async e => { e.preventDefault(); const v = (tagDraft[person.id] || '').trim(); if (!v) return; if (await mutate('/api/contacts/tags', { person_ids: [person.id], add: [v] }, 'Tag added.')) { tagDraft[person.id] = ''; render(); } } }, tagBox, el('button', { type: 'submit', class: 'button quiet small', disabled: busy }, 'Add tag')),
    el('h4', {}, 'Follow-ups'),
    open.length || done.length ? el('ul', { class: 'bulk-list' }, [...open, ...done].map(actionRow)) : el('p', { class: 'helper' }, 'Nothing planned yet.'),
    el('form', { class: 'form-fields', onsubmit: async e => { e.preventDefault(); if (!act_.title.trim()) return; if (await mutate('/api/contacts/actions', { person_id: person.id, title: act_.title.trim(), due_date: act_.due }, 'Follow-up added.')) { contactDrafts.actions[person.id] = { title: '', due: '' }; render(); } } }, title, due, el('button', { type: 'submit', class: 'button quiet small', disabled: busy }, 'Add follow-up')),
    el('h4', {}, 'Notes'),
    contact.notes.length ? el('ul', { class: 'bulk-list' }, [...contact.notes].reverse().map(n => el('li', { class: 'bulk-entry' }, el('span', {}, n.text, el('em', {}, ` · ${dateLabel(n.created_at.slice(0, 10))}`)), button('Delete', () => update('/api/contacts/delete', { person_id: person.id, kind: 'note', entry_id: n.id }), 'quiet small', { 'aria-label': 'Delete this note' })))) : el('p', { class: 'helper' }, 'No notes yet.'),
    el('form', { class: 'form-fields', onsubmit: async e => { e.preventDefault(); const v = (note[person.id] || '').trim(); if (!v) return; if (await mutate('/api/contacts/notes', { person_id: person.id, text: v }, 'Note saved.')) { note[person.id] = ''; render(); } } }, noteBox, el('button', { type: 'submit', class: 'button quiet small', disabled: busy }, 'Add note')));
}

function renderContacts(view) {
  view.append(meetingForm());
  const tags = allTags(state.contacts);
  if (activeTag && !tags.some(([t]) => t === activeTag)) activeTag = '';
  const everyone = state.people.filter(p => !p.demo || state.contacts?.[p.id]);
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
  view.append(shown.length ? el('div', { class: 'grid' }, shown.map(contactCard)) : empty('No contacts here yet.', everyone.length ? 'Try another context or search.' : 'Paste the ORCID iDs of people you meet above, with the name of the conference. You can then add notes and follow-ups for each of them.'));
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
  contacts: ['PEOPLE YOU MEET', 'Keep every conversation going.', 'Tag people by conference or context, note what you discussed, and track what you promised to do next. Private to this browser.'],
  groups: ['RESEARCH IS A TEAM SPORT', 'A shared place to work.', 'Bring your collaborators and their research outputs into one useful view.'],
  saved: ['GOOD WORK, KEPT CLOSE', 'Your next good read.', 'A personal collection of papers, datasets, and ideas worth returning to.']
};

function render() {
  if (!loaded) return;
  const nav = document.querySelector('#navigation');
  const followed = state.people.filter(p => p.following).length;
  nav.replaceChildren(...[
    ['feed', '◫', 'Feed', feedEntries(state).length], ['people', '◉', 'People', state.people.length],
    ['contacts', '☺', 'Contacts', Object.keys(state.contacts || {}).length], ['groups', '⌘', 'Groups', state.groups.length], ['saved', '▱', 'Saved', state.works.filter(w => w.saved).length]
  ].map(([id, icon, label, count]) => el('a', { class: `nav-link${currentView === id ? ' active' : ''}`, href: `#${id}`, 'aria-current': currentView === id ? 'page' : null }, el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), label, el('span', { class: 'nav-count' }, count))));
  const heading = headings[currentView];
  ['eyebrow', 'title', 'subtitle'].forEach((id, index) => { document.getElementById(id).textContent = heading[index]; });
  document.title = `${currentView[0].toUpperCase() + currentView.slice(1)} · ORCID Network pilot`;
  document.querySelector('#demo-banner').hidden = !state.people.some(p => p.demo);
  document.querySelector('#summary').replaceChildren(...[[followed, 'researchers followed'], [state.works.length, 'research outputs'], [state.groups.length, 'working groups']].map(([count, label]) => el('div', { class: 'stat' }, el('strong', {}, count), el('span', {}, label))));
  const view = document.querySelector('#view');
  view.replaceChildren();
  ({ feed: renderFeed, people: renderPeople, contacts: renderContacts, groups: renderGroups, saved: renderSaved })[currentView](view);
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
  window.addEventListener('hashchange', () => {
    const route = groupRoute(location.hash);
    currentView = route.view;
    selectedPerson = null;
    selectedGroup = route.id;
    groupTab = 'roster';
    editorGroup = pendingCreateGroup ? null : undefined;
    pendingCreateGroup = false;
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
    document.querySelector('#view').replaceChildren(empty('Your workspace is unavailable.', 'Reload this page to try again. When running the local pilot, check that its server is still running.', button('Reload page', () => location.reload(), '')));
  }
}

if (typeof document !== 'undefined') initialize();
