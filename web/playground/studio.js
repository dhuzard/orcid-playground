// Studio: one public ORCID record, every output the package can make.
import { call } from '/engine-client.js';
import { config, signIn, signOut, current, completeSignIn } from '/auth.js';

const $ = selector => document.querySelector(selector);
const status = $('#status');
let outputs = null;
let objectUrls = [];
let session = null;
let fromStoredCopy = false;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

function say(message, { busy = false, error = false } = {}) {
  status.classList.toggle('error', error);
  status.replaceChildren(message, busy ? el('span', { class: 'bar', 'aria-hidden': 'true' }) : '');
}

function blobUrl(text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  objectUrls.push(url);
  return url;
}

function download(label, text, filename, type) {
  return el('a', { class: 'button quiet small', href: blobUrl(text, type), download: filename }, `↓ ${label}`);
}

const slug = () => (outputs?.biosketch?.person?.orcid || 'orcid');
const json = value => JSON.stringify(value, null, 2);

const TABS = {
  Profile() {
    // The web component renders the biosketch JSON with its own escaping; it loads from a local blob URL.
    return [el('orcid-biosketch', { src: blobUrl(json(outputs.biosketch), 'application/json'), bio: 'true', works: 'all', search: 'true', provenance: 'true' })];
  },
  'Trading card'() {
    return [el('div', { class: 'tools' }, download('SVG', outputs.card_svg, `${slug()}-card.svg`, 'image/svg+xml')),
      el('div', { class: 'art' }, el('img', { src: blobUrl(outputs.card_svg, 'image/svg+xml'), alt: 'Trading card built from the record', width: 320, height: 440 }))];
  },
  Heatmap() {
    return [el('div', { class: 'tools' }, download('SVG', outputs.heatmap_svg, `${slug()}-heatmap.svg`, 'image/svg+xml')),
      el('div', { class: 'art' }, el('img', { src: blobUrl(outputs.heatmap_svg, 'image/svg+xml'), alt: 'Publication heatmap by year and month' }))];
  },
  Wrapped() {
    return [el('div', { class: 'tools' }, download('Text', outputs.wrapped_text, `${slug()}-wrapped.txt`, 'text/plain'), download('JSON', json(outputs.wrapped), `${slug()}-wrapped.json`, 'application/json')),
      el('pre', { class: 'terminal' }, outputs.wrapped_text)];
  },
  Fortune() {
    const quote = el('blockquote', {}, outputs.fortune);
    let seed = 1;
    const again = el('button', { class: 'button quiet small', type: 'button', onclick: async () => {
      again.disabled = true;
      try { quote.textContent = await call('fortune', { biosketch: json(outputs.biosketch), seed: seed++ }); } finally { again.disabled = false; }
    } }, '↻ Another one');
    return [quote, el('div', { class: 'tools' }, again, el('span', { class: 'muted' }, 'Drawn from the record’s own titles.'))];
  },
  'Record check'() {
    const findings = outputs.lint.findings || [];
    return [el('p', {}, `Score ${outputs.lint.percentage}% (grade ${outputs.lint.grade}). Each finding says what to fix in ORCID itself.`),
      findings.length ? el('ul', { class: 'findings' }, findings.map(f => el('li', {}, el('b', {}, `${f.severity === 'error' ? '✗' : '!'} ${f.message}`), el('span', { class: 'muted' }, f.fix || '')))) : el('p', {}, 'No findings.'),
      el('div', { class: 'tools' }, download('Report', outputs.lint_text, `${slug()}-record-check.txt`, 'text/plain'))];
  },
  'Funder biosketch'() {
    const names = Object.keys(outputs.templates);
    const view = el('pre', {});
    const tools = el('div', { class: 'tools' });
    const show = name => {
      view.textContent = outputs.templates[name];
      tools.replaceChildren(picker, download('Markdown', outputs.templates[name], `${slug()}-${name}.md`, 'text/markdown'));
    };
    const picker = el('select', { 'aria-label': 'Funder template', onchange: e => show(e.target.value) }, names.map(n => el('option', { value: n }, n.toUpperCase())));
    show(names[0]);
    return [el('p', { class: 'muted' }, 'Pre-filled from asserted fields only. Review and complete before submitting.'), tools, view];
  },
  'Citations & data'() {
    const items = [
      ['BibTeX', 'For LaTeX and reference managers.', outputs.bibtex, 'bib', 'application/x-bibtex'],
      ['RIS', 'For Zotero, EndNote and Mendeley.', outputs.ris, 'ris', 'application/x-research-info-systems'],
      ['CSL JSON', 'For citation processors.', json(outputs.csl), 'csl.json', 'application/json'],
      ['Biosketch JSON', 'The structured profile with per-field provenance.', json(outputs.biosketch), 'biosketch.json', 'application/json'],
      ['Schema.org JSON-LD', 'For embedding in a web page.', json(outputs.jsonld), 'jsonld', 'application/ld+json'],
      ['Markdown', 'A readable biosketch.', outputs.markdown, 'md', 'text/markdown'],
    ];
    return [el('div', { class: 'downloads' }, items.map(([title, about, text, ext, type]) => el('article', {}, el('h3', {}, title), el('p', {}, about), download(title, text, `${slug()}.${ext}`, type))))];
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

// Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
function tabKeys(event) {
  const tabs = [...$('#tabs').children];
  const index = tabs.indexOf(document.activeElement);
  const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
  if (index < 0 || target === undefined) return;
  event.preventDefault();
  const next = tabs[(target + tabs.length) % tabs.length];
  next.focus();
  showTab(next.dataset.tab);
}

// ---- "Me": the signed-in visitor's own corner, read from this browser only ----

const MY_CHECK = 'orcid-playground-my-check';

function rememberMyCheck() {
  const orcid = outputs?.biosketch?.person?.orcid;
  if (!session || orcid !== session.orcid) return;
  try {
    localStorage.setItem(MY_CHECK, JSON.stringify({ orcid, grade: outputs.lint.grade, percentage: outputs.lint.percentage, checked_at: new Date().toISOString() }));
  } catch { /* Storage unavailable: the grade shows while this record is open. */ }
}

function myCheck() {
  try {
    const saved = JSON.parse(localStorage.getItem(MY_CHECK));
    return saved?.orcid === session?.orcid ? saved : null;
  } catch { return null; }
}

async function workspace(method, target, body) {
  const reply = JSON.parse(await call('api', { method, target, body: body === undefined ? null : JSON.stringify(body) }));
  const data = JSON.parse(reply.body);
  if (reply.status !== 200) throw new Error(data.error);
  return data;
}

let meBusy = false;
let meState = null;
async function followMe() {
  if (meBusy) return;
  meBusy = true;
  renderMe(meState, 'Reading your public ORCID record into your network…');
  let message = 'Your record is in your network and followed.';
  try {
    await workspace('POST', '/api/import', { orcid: session.orcid });
    meState = await workspace('POST', '/api/follow', { id: session.orcid, following: true });
  } catch (error) {
    message = `Could not follow your record: ${error.message}`;
  }
  meBusy = false;
  renderMe(meState, message);
}

function renderMe(state, message = '') {
  const panel = $('#me');
  meState = state;
  if (!session) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }
  const check = myCheck();
  const me = state?.people.find(p => p.id === session.orcid);
  const groups = state ? state.groups.filter(g => g.member_ids.includes(session.orcid)) : [];
  const card = (title, ...children) => el('article', {}, el('h3', {}, title), ...children);
  const button = (label, onclick, kind = 'quiet') => el('button', { class: `button ${kind} small`, type: 'button', disabled: meBusy, onclick }, label);
  panel.replaceChildren(
    el('div', { class: 'eyebrow' }, 'ME · IN THIS BROWSER'),
    el('h2', { id: 'me-title' }, session.name || session.orcid),
    el('p', { class: 'muted small' }, `Signed in as ORCID ${session.orcid} for this tab.`),
    el('div', { class: 'me-grid' },
      card('My record check',
        check ? el('div', { class: 'grade' }, check.grade, el('small', {}, `${check.percentage}%`)) : el('p', { class: 'muted' }, 'Not checked in this browser yet.'),
        check ? el('p', { class: 'muted small' }, `Checked ${new Date(check.checked_at).toLocaleString()}.`) : '',
        button(check ? 'Open my record again' : 'Open my record', () => explore(session.orcid), 'accent')),
      card('My network',
        el('p', { class: 'muted small' }, !state ? 'Reading the research network stored in this browser…'
          : me?.following ? `You are in your network and followed. Last read from ORCID ${me.last_checked ? new Date(me.last_checked).toLocaleString() : 'at an unknown time'}.`
            : me ? 'You are in your network but not followed.' : 'Your record is not in your network yet. Following reads your public ORCID record once.'),
        state ? button(me?.following ? 'Read my record again' : 'Follow me in my network', followMe, me?.following ? 'quiet' : 'accent') : '',
        state ? el('a', { href: '/network/#people' }, 'Open the research network →') : ''),
      card('Groups I’m in',
        !state ? el('p', { class: 'muted small' }, '…')
          : groups.length ? el('ul', { class: 'me-groups' }, groups.map(group => el('li', {},
            el('a', { href: `/network/#groups/${encodeURIComponent(group.id)}` }, group.name),
            group.member_details?.[session.orcid]?.role ? el('span', { class: 'muted' }, ` · ${group.member_details[session.orcid].role}`) : '')))
            : el('p', { class: 'muted small' }, 'No group in your network lists your iD.'))),
    message ? el('p', { class: 'status', role: 'status' }, message) : '',
    el('p', { class: 'muted small' }, 'Read from this browser only; nothing here is sent anywhere. Groups and roles are what your own network records: the other members have not confirmed them.'));
  panel.hidden = false;
}

async function refreshMe() {
  renderMe(null);
  if (!session) return;
  try {
    renderMe(await workspace('GET', '/api/state'));
  } catch (error) {
    renderMe(null, `Could not read your network: ${error.message}`);
  }
}

function render() {
  const { person, provenance } = outputs.biosketch;
  $('#r-orcid').textContent = `ORCID ${person.orcid}`;
  $('#r-name').replaceChildren(person.name || 'Unnamed record', session?.orcid === person.orcid ? el('span', { class: 'you' }, 'You, signed in') : '');
  $('#r-headline').textContent = person.headline || '';
  $('#r-grade').replaceChildren(outputs.lint.grade, el('small', {}, `${outputs.lint.percentage}%`));
  $('#on-orcid').href = `https://orcid.org/${person.orcid}`;
  $('#to-network').href = `/network/?import=${encodeURIComponent(person.orcid)}`;
  const source = fromStoredCopy ? `a stored copy of the public ORCID record (synchronized ${provenance?.generated_at})` : 'the public ORCID record, read just now';
  $('#r-provenance').textContent = `Generated in your browser from ${source}. Outputs re-express asserted fields only and do not verify identity, authorship or affiliations.`;
  if (session?.orcid === person.orcid) {
    rememberMyCheck();
    renderMe(meState);
  }
  $('#tabs').replaceChildren(...Object.keys(TABS).map((name, i) => el('button', { type: 'button', role: 'tab', id: `tab-${i}`, 'aria-controls': 'panel', 'data-tab': name, onclick: () => showTab(name) }, name)));
  $('#result').hidden = false;
  showTab('Profile');
}

let loading = false;
async function load(op, args, label) {
  if (loading) return;
  loading = true;
  document.querySelectorAll('#lookup button, .try button').forEach(b => { b.disabled = true; });
  say(`${label} The first visit also downloads the Python engine (about 10 MB), then it is cached.`, { busy: true });
  try {
    outputs = JSON.parse(await call(op, args));
    fromStoredCopy = op === 'sample';
    render();
    say('');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    say(error.message, { error: true });
  } finally {
    loading = false;
    document.querySelectorAll('#lookup button, .try button').forEach(b => { b.disabled = false; });
  }
}

function explore(orcid) {
  $('#orcid').value = orcid;
  history.replaceState(null, '', `?orcid=${encodeURIComponent(orcid)}`);
  load('profile', { orcid }, `Reading the public ORCID record for ${orcid}…`);
}

$('#tabs').addEventListener('keydown', tabKeys);
$('#lookup').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('#orcid').value.trim();
  if (!value) return say('Enter an ORCID iD, like 0000-0002-1825-0097.', { error: true });
  explore(value);
});
document.querySelectorAll('[data-orcid]').forEach(b => b.addEventListener('click', () => explore(b.dataset.orcid)));
$('[data-sample]').addEventListener('click', async () => {
  try {
    const response = await fetch('/generated/biosketch.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    load('sample', { biosketch: await response.text() }, 'Loading the stored sample profile…');
  } catch (error) {
    say(`Could not load the stored sample (${error.message}).`, { error: true });
  }
});

function renderAccount(clientId) {
  const account = $('#account');
  const mine = $('#mine');
  if (session) {
    account.replaceChildren(el('span', {}, session.name || session.orcid), el('button', { class: 'button quiet small', type: 'button', onclick: () => { signOut(); session = null; renderAccount(clientId); renderMe(null); if (outputs) render(); } }, 'Sign out'));
    mine.replaceChildren(el('button', { type: 'button', class: 'chip me', onclick: () => explore(session.orcid) }, 'My record'));
  } else {
    account.replaceChildren(clientId ? el('button', { class: 'button small', type: 'button', onclick: () => signIn(clientId) }, 'Sign in with ORCID') : '');
    mine.replaceChildren();
  }
}

(async () => {
  const { orcid_client_id: clientId } = await config();
  try {
    const before = current();
    session = clientId ? await completeSignIn(clientId) : null;
    renderAccount(clientId);
    refreshMe();
    if (session && !before) return explore(session.orcid);
  } catch (error) {
    renderAccount(clientId);
    say(error.message, { error: true });
  }
  const requested = new URLSearchParams(location.search).get('orcid');
  if (requested) {
    $('#orcid').value = requested;
    $('#lookup button').focus();
    say(`Press Explore to read the public ORCID record for ${requested}.`);
  }
})();
