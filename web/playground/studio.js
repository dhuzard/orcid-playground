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
    account.replaceChildren(el('span', {}, session.name || session.orcid), el('button', { class: 'button quiet small', type: 'button', onclick: () => { signOut(); session = null; renderAccount(clientId); if (outputs) render(); } }, 'Sign out'));
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
