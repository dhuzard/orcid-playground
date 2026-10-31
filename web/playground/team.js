// Private team workspaces: /team/ lists your teams and invitations, /team/#<id> is a team.
// Every read and write goes through firestore.rules; this page only presents what they allow.
import { config, current, signIn, signOut } from '/auth.js';
import * as cloud from '/cloud.js';
import { encodeGroup } from '/group-link.js';

const $ = selector => document.querySelector(selector);
const DISCLOSURE_VERSION = 'team-disclosure-v1';
const DISCLOSURE = [
  'The team stores your ORCID iD, your membership status and when you accepted this notice.',
  'Members can record roles, contributions, notes, requests and selected outputs about the team and its members. Only active members of this team can read them.',
  'Your public ORCID record is read live from ORCID and is not copied into the team.',
  'You can leave at any time, and you can delete anything recorded about you. Data is stored in Google Cloud Firestore in the EU.',
];
const KINDS = { role: 'Role', contribution: 'Contribution', output: 'Selected output', request: 'Request', note: 'Note' };
const names = new Map();

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
const button = (label, onclick, cls = 'quiet small') => el('button', { type: 'button', class: `button ${cls}`, onclick }, label);

function say(message, { error = false, busy = false } = {}) {
  $('#status').classList.toggle('error', error);
  $('#status').replaceChildren(message || '', busy ? el('span', { class: 'bar', 'aria-hidden': 'true' }) : '');
}

async function guarded(label, task) {
  say(label, { busy: true });
  try {
    await task();
    if ($('#status .bar')) say('');
  } catch (error) {
    say(error.message, { error: true });
  }
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

// Public names, read live from ORCID; never stored in the team.
async function nameOf(orcid) {
  if (names.has(orcid)) return names.get(orcid);
  let name = orcid;
  try {
    const person = await (await fetch(`https://pub.orcid.org/v3.0/${orcid}/person`, { headers: { Accept: 'application/json' } })).json();
    name = [person?.name?.['given-names']?.value, person?.name?.['family-name']?.value].filter(Boolean).join(' ') || orcid;
  } catch { /* keep the iD */ }
  names.set(orcid, name);
  return name;
}
const orcidLink = (orcid, label) => el('a', { href: `https://orcid.org/${orcid}`, target: '_blank', rel: 'noopener noreferrer' }, label || orcid);

// ---- Sign-in -------------------------------------------------------------

async function renderAccount() {
  const me = cloud.session();
  const { orcid_client_id: clientId } = await config();
  $('#account').replaceChildren(me
    ? el('span', {}, me.name || me.orcid, ' ', button('Sign out', () => { cloud.signOutCloud(); signOut(); location.reload(); }))
    : clientId ? button('Sign in with ORCID', () => signIn(clientId, location.pathname + location.hash), 'small') : '');
  return me;
}

function signInPrompt() {
  const signedInOnlyHere = current();
  return [el('div', { class: 'result' },
    el('h2', {}, 'Sign in to open your teams'),
    el('p', {}, signedInOnlyHere
      ? 'Your ORCID sign-in in this tab is not connected to team workspaces yet. Sign in again; ORCID usually remembers you, so it takes one click.'
      : 'Team pages are private. Sign in with your ORCID iD to see the teams you belong to and the invitations addressed to you.'),
    el('p', { class: 'muted' }, 'Knowing a team link or someone’s ORCID iD never grants access: only an invitation to your own iD that you accept does.'))];
}

// ---- Team list and invitations ------------------------------------------

function disclosureBox(onAccept, label) {
  const tick = el('input', { type: 'checkbox', id: 'disclosure-ok' });
  return el('div', { class: 'disclosure' },
    el('b', {}, 'Before you join'),
    el('ul', {}, DISCLOSURE.map(line => el('li', {}, line))),
    el('label', { for: 'disclosure-ok' }, tick, ' I have read this and agree to join'),
    el('div', { class: 'result-actions' }, button(label, () => tick.checked ? onAccept() : say('Tick the box to confirm you have read the notice.', { error: true }), 'accent small')));
}

async function renderList(me) {
  $('#title').textContent = 'Your teams';
  const memberships = await cloud.findAll('members', 'orcid', me.orcid);
  const teams = memberships.filter(m => m.status === 'active');
  const invites = memberships.filter(m => m.status === 'invited');
  const teamId = m => m.path.split('/')[1];

  const invitations = invites.length ? el('section', { class: 'result' }, el('h2', {}, 'Invitations'),
    ...invites.map(invite => el('article', { class: 'invite' },
      el('h3', {}, invite.teamName),
      el('p', { class: 'muted' }, 'Invited by ', orcidLink(invite.invitedBy), ` on ${String(invite.invitedAt).slice(0, 10)}.`),
      disclosureBox(() => guarded('Joining…', async () => {
        await cloud.commit([{ set: invite.path, data: { status: 'active', disclosure: { version: DISCLOSURE_VERSION, acceptedAt: new Date() } }, mask: ['status', 'disclosure'], mustExist: true }]);
        location.hash = teamId(invite);
      }), 'Accept and join'),
      button('Decline', () => guarded('Declining…', async () => { await cloud.remove(invite.path); route(); }))))) : '';

  const list = el('section', { class: 'result' }, el('h2', {}, 'Teams'),
    teams.length ? el('ul', { class: 'outputs' }, teams.map(m => el('li', {}, el('a', { href: `#${teamId(m)}` }, m.teamName)))) : el('p', { class: 'muted' }, 'You are not in a team yet.'));

  const name = el('input', { maxlength: 120, required: true, placeholder: 'Example: WellFAIR working group' });
  const description = el('input', { maxlength: 500, placeholder: 'What the team works on (optional)' });
  const create = el('section', { class: 'result' }, el('h2', {}, 'Create a team'),
    el('form', { class: 'stack', onsubmit: event => event.preventDefault() },
      el('label', {}, 'Team name', name), el('label', {}, 'Description', description)),
    disclosureBox(() => guarded('Creating the team…', async () => {
      if (!name.value.trim()) throw new Error('Give the team a name.');
      const id = randomId();
      const now = new Date();
      await cloud.commit([
        { set: `teams/${id}`, mustNotExist: true, data: { name: name.value.trim(), description: description.value.trim(), createdBy: me.orcid, createdAt: now, coordinators: [me.orcid] } },
        { set: `teams/${id}/members/${me.orcid}`, mustNotExist: true, data: { orcid: me.orcid, teamName: name.value.trim(), status: 'active', invitedBy: me.orcid, invitedAt: now, disclosure: { version: DISCLOSURE_VERSION, acceptedAt: now } } },
      ]);
      location.hash = id;
    }), 'Create team'));

  $('#view').replaceChildren(invitations, list, create);
}

// ---- One team ------------------------------------------------------------

async function renderTeam(me, id) {
  const team = await cloud.get(`teams/${id}`).catch(() => null);
  if (!team) {
    const leftover = await cloud.get(`teams/${id}/members/${me.orcid}`).catch(() => null);
    $('#title').textContent = 'Team not available';
    $('#view').replaceChildren(el('div', { class: 'result' },
      el('p', {}, leftover ? 'This team was deleted.' : 'This team does not exist, or you are not one of its active members.'),
      leftover ? button('Remove it from my list', () => guarded('Removing…', async () => { await cloud.remove(`teams/${id}/members/${me.orcid}`); location.hash = ''; })) : '',
      el('p', {}, el('a', { href: '#' }, '← Your teams'))));
    return;
  }
  const [members, entries] = await Promise.all([cloud.list(`teams/${id}/members`), cloud.list(`teams/${id}/entries`)]);
  await Promise.all(members.map(m => nameOf(m.orcid)));
  const coordinator = team.coordinators.includes(me.orcid);
  const active = members.filter(m => m.status === 'active');
  $('#title').textContent = team.name;
  $('#lede').textContent = team.description || 'A private team workspace.';

  const header = el('div', { class: 'result-actions' },
    el('a', { class: 'button quiet small', href: '#' }, '← Your teams'),
    el('a', { class: 'button quiet small', href: `/group/${encodeGroup({ name: team.name, members: active.map(m => m.orcid) })}` }, 'Public group view →'),
    !coordinator && button('Leave team', () => leave(me, id, entries)),
    coordinator && button('Delete team', () => deleteTeam(me, id, members, entries)));

  // Members
  const memberRows = members.map(m => el('li', {},
    orcidLink(m.orcid, names.get(m.orcid)), ' ',
    el('span', { class: 'muted' }, team.coordinators.includes(m.orcid) ? 'coordinator' : m.status === 'invited' ? 'invited, not yet accepted' : 'member'),
    coordinator && m.orcid !== me.orcid && el('span', { class: 'row-actions' },
      m.status === 'active' && !team.coordinators.includes(m.orcid) && button('Make coordinator', () => guarded('Updating…', async () => {
        await cloud.commit([{ set: `teams/${id}`, data: { coordinators: [...team.coordinators, m.orcid] }, mask: ['coordinators'], mustExist: true }]); route();
      })),
      team.coordinators.includes(m.orcid) && button('Remove coordinator role', () => guarded('Updating…', async () => {
        await cloud.commit([{ set: `teams/${id}`, data: { coordinators: team.coordinators.filter(c => c !== m.orcid) }, mask: ['coordinators'], mustExist: true }]); route();
      })),
      !team.coordinators.includes(m.orcid) && button(m.status === 'invited' ? 'Withdraw invitation' : 'Remove', () => {
        if (confirm(`Remove ${names.get(m.orcid)} from ${team.name}? Their access ends immediately.`)) guarded('Removing…', async () => { await cloud.remove(`teams/${id}/members/${m.orcid}`); route(); });
      }))));
  const inviteInput = el('input', { placeholder: '0000-0002-1825-0097', 'aria-label': 'ORCID iD to invite' });
  const invite = coordinator && el('form', { class: 'lookup', onsubmit: event => {
    event.preventDefault();
    const orcid = inviteInput.value.trim().replace(/^https?:\/\/(www\.)?orcid\.org\//i, '').toUpperCase();
    if (!ORCID_PATTERN.test(orcid)) return say('Enter an ORCID iD like 0000-0002-1825-0097.', { error: true });
    guarded('Inviting…', async () => {
      await cloud.commit([{ set: `teams/${id}/members/${orcid}`, mustNotExist: true, data: { orcid, teamName: team.name, status: 'invited', invitedBy: me.orcid, invitedAt: new Date(), disclosure: null } }]);
      await route();
      // After the refresh, so the instruction stays on screen.
      say(`Invited. Ask them to sign in at ${location.origin}/team/ with their ORCID iD to accept.`);
    });
  } }, inviteInput, el('button', { type: 'submit', class: 'button accent' }, 'Invite'));
  const membersSection = el('section', { class: 'result' }, el('h2', {}, `Members (${active.length})`),
    el('ul', { class: 'member-list' }, memberRows), invite,
    coordinator && el('p', { class: 'muted small' }, 'An invitation only works for the person who owns that ORCID iD: they must sign in with it and accept the notice.'));

  // Entries
  const byKind = Object.keys(KINDS).map(kind => [kind, entries.filter(e => e.kind === kind)]).filter(([, list]) => list.length);
  const canDelete = e => e.author === me.orcid || e.subject === me.orcid || coordinator;
  const entryList = byKind.length ? byKind.map(([kind, list]) => el('div', {}, el('h3', {}, KINDS[kind]), el('ul', { class: 'outputs' }, list.map(e => el('li', {},
    e.subject && e.subject !== 'team' ? el('b', {}, `${names.get(e.subject) || e.subject}: `) : '', e.text,
    el('div', { class: 'muted small' }, `Recorded by ${names.get(e.author) || e.author} on ${String(e.createdAt).slice(0, 10)}`,
      canDelete(e) ? [' · ', el('a', { href: '#', onclick: event => { event.preventDefault(); guarded('Deleting…', async () => { await cloud.remove(`teams/${id}/entries/${e.id}`); route(); }); } }, 'delete')] : '')))))) : el('p', { class: 'muted' }, 'Nothing recorded yet.');
  const kind = el('select', { 'aria-label': 'Kind' }, Object.entries(KINDS).map(([k, label]) => el('option', { value: k }, label)));
  const subject = el('select', { 'aria-label': 'About' }, el('option', { value: 'team' }, 'The team'), active.map(m => el('option', { value: m.orcid }, names.get(m.orcid))));
  const text = el('textarea', { rows: 3, maxlength: 5000, placeholder: 'Example: leads work package 2; data curation' });
  const add = el('form', { class: 'stack', onsubmit: event => {
    event.preventDefault();
    if (!text.value.trim()) return;
    guarded('Saving…', async () => {
      const now = new Date();
      await cloud.commit([{ set: `teams/${id}/entries/${randomId()}`, mustNotExist: true, data: { kind: kind.value, subject: subject.value, text: text.value.trim(), author: me.orcid, createdAt: now, updatedAt: now } }]);
      route();
    });
  } }, el('div', { class: 'tools' }, kind, subject), text, el('button', { type: 'submit', class: 'button accent small' }, 'Add to the team'));
  const entriesSection = el('section', { class: 'result' }, el('h2', {}, 'Team notes'),
    el('p', { class: 'muted' }, 'Roles, contributions, selected outputs, requests and notes. Visible to active members only; labelled as recorded in this team, never as ORCID assertions.'),
    entryList, add);

  $('#view').replaceChildren(header, membersSection, entriesSection);
}

async function leave(me, id, entries) {
  const mine = entries.filter(e => e.author === me.orcid || e.subject === me.orcid);
  const wipe = mine.length && confirm(`Also delete the ${mine.length} note(s) you wrote or that are about you? Cancel keeps them for the team.`);
  if (!confirm('Leave this team? You lose access immediately; a coordinator can invite you again.')) return;
  await guarded('Leaving…', async () => {
    await cloud.commit([...(wipe ? mine.map(e => ({ remove: `teams/${id}/entries/${e.id}` })) : []), { remove: `teams/${id}/members/${me.orcid}` }]);
    location.hash = '';
  });
}

async function deleteTeam(me, id, members, entries) {
  if (prompt('Delete the team and everything recorded in it, for everyone? Type DELETE to confirm.') !== 'DELETE') return;
  await guarded('Deleting the team…', async () => {
    const team = await cloud.get(`teams/${id}`);
    await cloud.commit([
      ...entries.map(e => ({ remove: `teams/${id}/entries/${e.id}` })),
      ...members.filter(m => !team.coordinators.includes(m.orcid)).map(m => ({ remove: `teams/${id}/members/${m.orcid}` })),
      { remove: `teams/${id}` },
    ]);
    await cloud.remove(`teams/${id}/members/${me.orcid}`);
    location.hash = '';
  });
}

// ---- Routing -------------------------------------------------------------

async function route() {
  const me = await renderAccount();
  if (!(await cloud.available())) {
    $('#view').replaceChildren(el('div', { class: 'result' }, el('p', {}, 'Team workspaces are not enabled on this site yet.')));
    return;
  }
  if (!me) {
    $('#view').replaceChildren(...signInPrompt());
    return;
  }
  const id = location.hash.slice(1);
  await guarded('Loading…', () => (id && /^[a-z0-9]{10,40}$/.test(id) ? renderTeam(me, id) : renderList(me)));
}

window.addEventListener('hashchange', route);
route();
