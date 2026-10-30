// Group view: a shareable link of public ORCID iDs, rendered live in the browser.
import { call } from '/engine-client.js';
import { decodeGroup, encodeGroup, parseIds, MAX_MEMBERS } from '/group-link.js';

const $ = selector => document.querySelector(selector);
const SVG = 'http://www.w3.org/2000/svg';
let group = null;
let bios = new Map();
let failures = new Map();
let result = null;
let membersJson = '[]';
let objectUrls = [];

function el(tag, attrs = {}, ...children) {
  const node = tag.startsWith('svg:') ? document.createElementNS(SVG, tag.slice(4)) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

function say(message, { busy = false, error = false } = {}) {
  $('#status').classList.toggle('error', error);
  $('#status').replaceChildren(message, busy ? el('span', { class: 'bar', 'aria-hidden': 'true' }) : '');
}

const show = id => ['#compose', '#preview', '#view'].forEach(s => { $(s).hidden = s !== id; });
const nameOf = orcid => bios.get(orcid)?.person?.name || orcid;
const doiLink = doi => el('a', { href: `https://doi.org/${doi}`, target: '_blank', rel: 'noopener noreferrer' }, doi);

function download(label, text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  objectUrls.push(url);
  return el('a', { class: 'button quiet small', href: url, download: filename }, `↓ ${label}`);
}

// ---- Compose and preview -------------------------------------------------

$('#compose-form').addEventListener('submit', event => {
  event.preventDefault();
  const { ids, invalid } = parseIds($('#compose-ids').value);
  if (invalid.length) return say(`Not valid ORCID iDs: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`, { error: true });
  if (!ids.length) return say('Add at least one ORCID iD.', { error: true });
  if (ids.length > MAX_MEMBERS) return say(`A group link holds at most ${MAX_MEMBERS} members.`, { error: true });
  location.hash = encodeGroup({ name: $('#compose-name').value || 'Shared group', members: ids });
});

function preview() {
  $('#title').textContent = group.name;
  $('#lede').textContent = 'A group link. Read the members’ public ORCID records to see who has published together.';
  $('#group-name').textContent = group.name;
  $('#member-count').textContent = String(group.members.length);
  $('#members').replaceChildren(...group.members.map(id => el('li', {},
    el('a', { href: `https://orcid.org/${id}`, target: '_blank', rel: 'noopener noreferrer' }, bios.get(id)?.person?.name || id),
    bios.has(id) ? el('span', { class: 'muted' }, ` ${id}`) : '',
    failures.has(id) ? el('span', { class: 'error-text' }, ` Could not read: ${failures.get(id)}`) : '')));
  show('#preview');
}

$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    say('Link copied. It contains only the group name and the iDs listed.');
  } catch {
    say('Copy the address from your browser’s address bar.');
  }
});

// ---- Reading records -----------------------------------------------------

async function readMembers(ids) {
  $('#load').disabled = true;
  let done = 0;
  for (const id of ids) {
    say(`Reading public records: ${done} of ${ids.length}. The first visit also loads the Python engine (about 15 MB, then cached).`, { busy: true });
    try {
      bios.set(id, JSON.parse(await call('member', { orcid: id })));
      failures.delete(id);
    } catch (error) {
      failures.set(id, error.message);
    }
    done += 1;
  }
  $('#load').disabled = false;
  const ordered = group.members.filter(id => bios.has(id)).map(id => bios.get(id));
  if (!ordered.length) {
    preview();
    $('#load').textContent = 'Try again';
    return say('None of the records could be read; the reason is shown next to each iD.', { error: true });
  }
  try {
    membersJson = JSON.stringify(ordered);
    result = JSON.parse(await call('group', { name: group.name, bios: membersJson }));
  } catch (error) {
    return say(`Could not build the group view: ${error.message}`, { error: true });
  }
  preview();
  render();
  $('#load').textContent = failures.size ? `Retry ${failures.size} failed` : 'Read again';
  say(failures.size ? `${failures.size} record(s) could not be read; they are left out below.` : '', { error: failures.size > 0 });
}

$('#load').addEventListener('click', () => readMembers(failures.size ? [...failures.keys()] : group.members));

// ---- Group outputs -------------------------------------------------------

function graphSvg(graph, onSelect) {
  const size = 560;
  const centre = size / 2;
  const radius = graph.nodes.length > 1 ? centre - 90 : 0;
  const position = new Map(graph.nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / graph.nodes.length - Math.PI / 2;
    return [node.orcid, { x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle) }];
  }));
  const svg = el('svg:svg', { viewBox: `0 0 ${size} ${size}`, class: 'graph', role: 'img', 'aria-label': `Collaboration graph: ${graph.edges.length} links between ${graph.nodes.length} members` });
  for (const edge of graph.edges) {
    const a = position.get(edge.source);
    const b = position.get(edge.target);
    const line = el('svg:line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'edge', 'stroke-width': 1.5 + Math.log2(edge.outputs.length) * 2, tabindex: 0, role: 'button',
      'aria-label': `${nameOf(edge.source)} and ${nameOf(edge.target)}: ${edge.outputs.length} shared DOIs`,
      onclick: () => onSelect(edge), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(edge); } } });
    line.append(el('svg:title', {}, `${edge.outputs.length} shared DOI(s)`));
    svg.append(line);
  }
  for (const node of graph.nodes) {
    const { x, y } = position.get(node.orcid);
    const label = nameOf(node.orcid);
    svg.append(el('svg:g', { class: node.linked ? 'node' : 'node unlinked' },
      el('svg:circle', { cx: x, cy: y, r: 7 + Math.sqrt(node.doi_count) * 1.6 }),
      el('svg:text', { x, y: y + (y < centre ? -16 : 26), 'text-anchor': 'middle' }, label.length > 22 ? `${label.slice(0, 21)}…` : label)));
  }
  return svg;
}

function graphPanel() {
  const { graph } = result;
  const detail = el('div', { class: 'edge-detail', 'aria-live': 'polite' }, el('p', { class: 'muted' }, graph.edges.length ? 'Select a line to see the DOIs both records assert.' : 'No two members’ records assert the same DOI yet.'));
  const select = edge => detail.replaceChildren(
    el('h3', {}, `${nameOf(edge.source)} & ${nameOf(edge.target)}`),
    el('ul', { class: 'outputs' }, edge.outputs.map(o => el('li', {}, el('b', {}, o.title || 'Untitled'), ` ${o.year || ''} · `, doiLink(o.doi)))));
  const unlinked = graph.nodes.filter(n => !n.linked);
  return [
    el('p', { class: 'muted' }, graph.basis, ' Larger circles assert more DOIs; thicker lines share more.'),
    el('div', { class: 'graph-wrap' }, graphSvg(graph, select), detail),
    unlinked.length ? el('p', { class: 'muted' }, `Not linked: ${unlinked.map(n => `${nameOf(n.orcid)} (${n.doi_count} DOI${n.doi_count === 1 ? '' : 's'})`).join(', ')}. This may mean their records list outputs without DOIs.`) : '',
    el('table', { class: 'pairs' }, el('caption', {}, 'Links as a table'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Members'), el('th', { scope: 'col' }, 'Shared DOIs'))),
      el('tbody', {}, graph.edges.map(e => el('tr', {}, el('td', {}, `${nameOf(e.source)} & ${nameOf(e.target)}`), el('td', {}, String(e.outputs.length)))))),
  ];
}

const TABS = {
  'Collaboration graph': graphPanel,
  'Shared outputs'() {
    const shared = result.graph.shared_outputs;
    if (!shared.length) return [el('p', {}, 'No output is asserted by more than one member.')];
    return [el('ul', { class: 'outputs' }, shared.map(o => el('li', {}, el('b', {}, o.title || 'Untitled'), ` ${o.year || ''} · `, doiLink(o.doi),
      el('div', { class: 'muted' }, `Asserted by ${o.members.map(nameOf).join(', ')}`))))];
  },
  'Record health'() {
    const { health } = result;
    const total = health.members.length;
    return [
      el('div', { class: 'health-head' }, el('div', { class: 'grade' }, health.grade, el('small', {}, `${health.score}%`)),
        el('p', {}, health.basis, ' Fixes below are listed by how many members they affect.')),
      el('div', { class: 'tools' }, download('Report for members (Markdown)', result.health_markdown, 'record-health.md', 'text/markdown')),
      el('h3', {}, 'Most common issues'),
      health.issues.length ? el('ul', { class: 'findings' }, health.issues.map(issue => el('li', {},
        el('b', {}, `${issue.label} `, el('span', { class: 'muted' }, `· ${issue.members.length} of ${total} members · ${issue.severity}`)),
        el('div', {}, issue.fix),
        el('div', { class: 'muted' }, issue.members.map(m => m.name).join(', '))))) : el('p', {}, 'No issues found.'),
      el('h3', {}, 'By member'),
      ...health.members.map(member => el('details', { class: 'member-health' },
        el('summary', {}, el('b', {}, member.name), ` ${member.percentage}% · grade ${member.grade} · ${member.findings.length} finding${member.findings.length === 1 ? '' : 's'}`),
        member.findings.length ? el('ul', {}, member.findings.map(f => el('li', {}, f.message, el('div', { class: 'muted' }, `Fix: ${f.fix || ''}`)))) : el('p', {}, 'No issues found.'),
        el('a', { href: `https://orcid.org/${member.orcid}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open this ORCID record ↗'))),
    ];
  },
  'Team biosketch'() {
    const view = el('pre', {}, 'Choose a format.');
    const tools = el('div', { class: 'tools' });
    const picker = el('select', { 'aria-label': 'Funder format' }, result.templates.map(n => el('option', { value: n }, n.toUpperCase())));
    const build = async () => {
      picker.disabled = true;
      view.textContent = 'Building…';
      try {
        const text = await call('team', { name: group.name, bios: membersJson, template: picker.value });
        // Blob URLs are released on the next tab switch; revoking here could break
        // a tab the visitor opened while this document was still building.
        view.textContent = text;
        tools.replaceChildren(picker, download('Markdown', text, `team-biosketch-${picker.value}.md`, 'text/markdown'));
      } catch (error) {
        view.textContent = `Could not build the document: ${error.message}`;
      } finally {
        picker.disabled = false;
      }
    };
    picker.addEventListener('change', build);
    tools.append(picker);
    build();
    return [el('p', { class: 'muted' }, 'A draft team document: a summary, the outputs whose DOI appears in several members’ records, then each member’s funder template. Roles and contributions are not in the link; add them before use.'), tools, view];
  },
  Heatmap() {
    const url = URL.createObjectURL(new Blob([result.heatmap_svg], { type: 'image/svg+xml' }));
    objectUrls.push(url);
    return [el('div', { class: 'tools' }, download('SVG', result.heatmap_svg, 'group-heatmap.svg', 'image/svg+xml')),
      el('p', { class: 'muted' }, 'All members’ outputs, merged by DOI.'),
      el('div', { class: 'art' }, el('img', { src: url, alt: 'Publication heatmap for the whole group' }))];
  },
  Bibliography() {
    const works = result.bibliography;
    return [el('div', { class: 'tools' }, download('BibTeX', result.bibtex, 'group.bib', 'application/x-bibtex'), el('span', { class: 'muted' }, `${works.length} outputs, merged by DOI.`)),
      el('ul', { class: 'outputs' }, works.slice(0, 200).map(w => el('li', {}, el('b', {}, w.title || 'Untitled'), ` ${String(w.publication_date || '').slice(0, 4)}`,
        w.identifiers?.doi ? [' · ', doiLink(String(w.identifiers.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))] : '',
        el('div', { class: 'muted' }, `Asserted by ${w.asserted_by.map(nameOf).join(', ')}`)))),
      works.length > 200 ? el('p', { class: 'muted' }, 'Showing the 200 newest; the BibTeX file has every output.') : ''];
  },
};

function showTab(name) {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  for (const button of $('#tabs').children) {
    const selected = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected) $('#panel').setAttribute('aria-labelledby', button.id);
  }
  $('#panel').replaceChildren(...TABS[name]());
}

$('#tabs').addEventListener('keydown', event => {
  const tabs = [...$('#tabs').children];
  const index = tabs.indexOf(document.activeElement);
  const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
  if (index < 0 || target === undefined) return;
  event.preventDefault();
  const next = tabs[(target + tabs.length) % tabs.length];
  next.focus();
  showTab(next.dataset.tab);
});

function render() {
  const { graph, bibliography } = result;
  const stat = (value, label) => el('div', {}, el('b', {}, String(value)), el('span', {}, label));
  $('#stats').replaceChildren(stat(graph.nodes.length, 'members read'), stat(bibliography.length, 'outputs'),
    stat(graph.shared_outputs.length, 'shared DOIs'), stat(graph.edges.length, 'links'));
  $('#tabs').replaceChildren(...Object.keys(TABS).map((name, i) => el('button', { type: 'button', role: 'tab', id: `tab-${i}`, 'aria-controls': 'panel', 'data-tab': name, onclick: () => showTab(name) }, name)));
  $('#provenance').textContent = `Built in your browser from ${graph.nodes.length} public ORCID records read at ${new Date().toLocaleString()}. Group membership comes from the link and is not confirmed by the people listed.`;
  $('#view').hidden = false;
  showTab('Collaboration graph');
}

// ---- Copy into the visitor's own research network -------------------------

async function api(path, body) {
  const reply = JSON.parse(await call('api', { method: 'POST', target: path, body: JSON.stringify(body) }));
  if (reply.status !== 200) throw new Error(JSON.parse(reply.body).error);
}

$('#adopt').addEventListener('click', async () => {
  const ids = group.members.filter(id => bios.has(id));
  if (!confirm(`Add “${group.name}” and its ${ids.length} public records to the research network stored in this browser?`)) return;
  $('#adopt').disabled = true;
  try {
    for (const [i, id] of ids.entries()) {
      say(`Adding to your network: ${i} of ${ids.length}…`, { busy: true });
      await api('/api/import', { orcid: id });
    }
    await api('/api/groups', { name: group.name.slice(0, 120), description: 'Imported from a shared group link; membership not confirmed by the people listed.', member_ids: ids });
    say('');
    location.assign('/network/#groups');
  } catch (error) {
    say(`Could not add the group: ${error.message}`, { error: true });
  } finally {
    $('#adopt').disabled = false;
  }
});

// ---- Routing -------------------------------------------------------------

// The network app links here with ?from=<group id>: build the link from that group's real iDs.
async function fromWorkspace(groupId) {
  say('Reading the group from your research network…', { busy: true });
  const state = JSON.parse(JSON.parse(await call('api', { method: 'GET', target: '/api/state' })).body);
  const source = state.groups.find(g => g.id === groupId);
  if (!source) throw new Error('That group is not in this browser’s research network.');
  const people = source.member_ids.map(id => state.people.find(p => p.id === id)).filter(Boolean);
  const members = people.filter(p => p.orcid).map(p => p.orcid);
  const skipped = people.length - members.length;
  if (!members.length) throw new Error('This group has no members with a public ORCID iD (sample people are not shared).');
  history.replaceState(null, '', `/group/${encodeGroup({ name: source.name, members })}`);
  say(skipped ? `${skipped} sample member(s) without an ORCID iD were left out.` : '');
}

async function route() {
  bios = new Map();
  failures = new Map();
  result = null;
  $('#view').hidden = true;
  $('#load').textContent = 'Read the public records';
  try {
    const from = new URLSearchParams(location.search).get('from');
    if (from) await fromWorkspace(from);
    if (!location.hash) {
      show('#compose');
      return;
    }
    group = decodeGroup(location.hash);
    preview();
  } catch (error) {
    show('#compose');
    say(error.message, { error: true });
  }
}

window.addEventListener('hashchange', route);
route();
