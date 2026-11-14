// Browser checks for the guided first-run journeys and the Studio → Contacts → Groups handoffs (#56).
// Run by tests/test_onboarding.py against tests/e2e/onboarding_server.py.
// Usage: node tests/e2e/onboarding.e2e.cjs http://127.0.0.1:PORT
// Exit 0 = pass, 1 = a check failed, 77 = no usable browser (the pytest wrapper skips).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const zlib = require('node:zlib');

let chromium;
try { ({ chromium } = require('playwright')); } catch { process.exit(77); }
const BASE = process.argv[2].replace(/\/$/, '');
const SHIM = readFileSync(join(__dirname, 'engine-shim.js'), 'utf8');
const STORED = '0000-0003-4820-7951'; // the maintainer's stored profile (generated/biosketch.json)
const FIXTURE = '0000-0002-1825-0097';
const SECOND = '0000-0001-5109-3700';
const UNREACHABLE = '0000-0002-1111-1115';
const SLOW = '0000-0002-2222-2224';

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 667 };
const SMALL = { width: 320, height: 640 };

let workspaces = 0;

// One browser context = one browser profile: its own workspace, kept across reloads.
// ORCID and every other external host is blocked; the engine is the CPython test double.
async function context(browser, viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addCookies([{ name: 'srp-ws', value: `ws-${process.pid}-${++workspaces}`, url: BASE }]);
  const external = [];
  const engineCalls = [];
  await ctx.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.href.startsWith(BASE)) { external.push(url.href); return route.abort(); }
    if (url.pathname === '/engine-client.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: SHIM });
    if (url.pathname.startsWith('/pyodide/')) return route.abort();
    if (url.pathname === '/__engine') engineCalls.push(JSON.parse(request.postData() || '{}'));
    return route.continue();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const dialogs = [];
  // By default every confirmation is accepted; checks that need otherwise set page.answer.
  page.answer = null;
  page.on('dialog', dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    const accept = page.answer ? page.answer(dialog) : true;
    return accept ? dialog.accept() : dialog.dismiss();
  });
  const imports = () => engineCalls.filter(c => c.op === 'api' && c.args.target === '/api/import' && c.args.method === 'POST');
  return { ctx, page, external, dialogs, errors, imports, close: () => ctx.close() };
}

async function workspace(page) {
  return page.evaluate(async () => {
    const response = await fetch('/__engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'api', args: { method: 'GET', target: '/api/state' } }) });
    const reply = await response.json();
    return JSON.parse(JSON.parse(reply.result).body);
  });
}

const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const loaded = page => page.locator('#navigation a[aria-current="page"]').waitFor();
const text = (page, selector) => page.locator(selector).innerText();

async function openNetwork(page, path) {
  await page.goto(BASE + path);
  await loaded(page);
}

// A minimal ZIP reader (stored and deflated entries) for the team pack.
function unzip(buffer) {
  const files = {};
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  let at = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i += 1) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

async function download(page, click) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), body: readFileSync(path) };
}

// WCAG relative-luminance contrast of an element's text against its nearest opaque background.
async function contrast(page, selector) {
  return page.locator(selector).first().evaluate(node => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    let back = node;
    while (back && (rgb(getComputedStyle(back).backgroundColor)[3] === 0 || getComputedStyle(back).backgroundColor === 'transparent')) back = back.parentElement;
    const fg = lum(rgb(getComputedStyle(node).color));
    const bg = lum(rgb(getComputedStyle(back || document.body).backgroundColor));
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
}

// Explore & Play: stored demo profile → card / heatmap / Record check → export → optional handoff.
async function exploreJourney(browser, viewport) {
  const { page, external, errors, imports, close } = await context(browser, viewport);
  await page.goto(BASE + '/');
  const guide = page.locator('#explore-guide');
  assert.equal(await guide.locator('h2').innerText(), 'Explore & Play, step by step');
  await guide.locator('[data-sample-guide]').click();
  await page.locator('#result:not([hidden])').waitFor();
  assert.equal(await text(page, '#r-orcid'), `ORCID ${STORED}`);
  assert.match(await text(page, '#r-provenance'), /stored copy of the public ORCID record/);
  // "What can I do next?" opens an output and focuses its tab.
  await page.locator('[data-goto="Trading card"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'Trading card');
  const card = await download(page, () => page.locator('#panel a[download]').first().click());
  assert.equal(card.name, `${STORED}-card.svg`);
  assert.match(card.body.toString('utf8'), /^<svg|<\?xml/);
  await page.locator('[data-goto="Heatmap"]').click();
  await page.locator('#panel img[alt^="Publication heatmap"]').waitFor();
  await page.locator('[data-goto="Record check"]').click();
  assert.match(await text(page, '#panel'), /Score \d+% \(grade/);
  const report = await download(page, () => page.locator('#panel a[download]').click());
  assert.equal(report.name, `${STORED}-record-check.txt`);
  // Keep the researcher: three distinct handoffs, each carrying the iD and asking first.
  assert.equal(await page.getAttribute('#to-contact', 'href'), `/network/#contacts?save=${STORED}`);
  assert.equal(await page.getAttribute('#to-group', 'href'), `/network/#groups?add=${STORED}`);
  assert.equal(await page.getAttribute('#to-network', 'href'), `/network/?import=${STORED}`);
  await page.locator('.keep details summary').click();
  assert.match(await text(page, '.keep details'), /Team[\s\S]*not available on this site yet/);
  assert.ok(await noHorizontalScroll(page), `${viewport.width}: Studio scrolls sideways`);
  for (const box of await page.locator('.keep .button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()))) {
    assert.ok(box.left >= 0 && box.right <= viewport.width && box.height >= 32, `${viewport.width}: handoff button ${JSON.stringify(box)}`);
  }
  assert.equal(imports().length, 0, 'nothing reaches My Network before the visitor confirms there');
  assert.deepEqual(external, [], 'the stored profile is read from this site, not ORCID');
  assert.deepEqual(errors, []);
  return { page, close, imports, errors };
}

const checks = {
  async exploreAndSaveAsContactDesktop(browser) {
    const { page, close, imports, errors } = await exploreJourney(browser, DESKTOP);
    // Save as contact → My Network shows a confirmation, prefilled, nothing read yet.
    await Promise.all([page.waitForURL(`${BASE}/network/#contacts?save=${STORED}`), page.click('#to-contact')]);
    const panel = page.locator('#handoff');
    await panel.waitFor();
    assert.equal(await panel.locator('h2').innerText(), 'Save as contact');
    assert.match(await panel.innerText(), new RegExp(`reads the public ORCID record of ${STORED} once`));
    assert.match(await panel.innerText(), /does not follow them or notify them/);
    assert.equal(imports().length, 0);
    assert.equal((await workspace(page)).people.length, 0);
    // Keyboard: the heading has focus on arrival; then context → date met → note → confirm → cancel.
    await page.waitForFunction(() => document.activeElement?.id === 'handoff-title');
    await page.locator('#handoff-tag').focus();
    await page.keyboard.type('FENS 2026');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'handoff-met');
    // A date input has a stop per date part; leave it empty and move on.
    await page.locator('#handoff-note').focus();
    await page.keyboard.type('Ask about the imaging protocol');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Read record & save as contact');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    const card = page.locator(`#contact-${STORED}`);
    await card.waitFor();
    await page.waitForFunction(id => document.activeElement?.id === `contact-${id}`, STORED);
    assert.equal(page.url(), `${BASE}/network/#contacts`);
    assert.match(await text(page, '#notice'), /saved as a contact from their public ORCID record\. Not followed/);
    let state = await workspace(page);
    assert.equal(imports().length, 1);
    assert.equal(state.people.length, 1);
    assert.equal(state.people[0].following, false, 'Save as contact is not Follow');
    assert.deepEqual(state.contacts[STORED].tags, ['FENS 2026']);
    assert.equal(state.contacts[STORED].met_on, '', 'no meeting date is assumed');
    assert.deepEqual(state.contacts[STORED].notes.map(n => n.text), ['Ask about the imaging protocol']);
    assert.match(await card.innerText(), new RegExp(`Public ORCID record ${STORED}, read`));

    // Duplicate save: offers the existing record, imports nothing, changes nothing.
    await openNetwork(page, `/network/#contacts?save=${STORED}`);
    assert.match(await text(page, '#handoff'), /already one of your contacts\. Nothing new was saved, so there is no duplicate/);
    await page.getByRole('button', { name: 'Open their contact card' }).click();
    await page.waitForFunction(id => document.activeElement?.id === `contact-${id}`, STORED);
    state = await workspace(page);
    assert.equal(imports().length, 1, 'a duplicate save reads nothing from ORCID');
    assert.equal(state.people.length, 1);
    assert.equal(state.contacts[STORED].notes.length, 1);

    // Browser refresh: the contact, its tag and note are still there.
    await page.reload();
    await card.waitFor();
    assert.match(await card.innerText(), /Ask about the imaging protocol/);
    assert.match(await card.innerText(), /FENS 2026/);

    // Network → Studio: the contact links to the same record in Explore, and back.
    await Promise.all([page.waitForURL(`${BASE}/?orcid=${STORED}&from=contacts`), card.getByRole('link', { name: /Open .* in Explore/ }).click()]);
    assert.equal(await page.inputValue('#orcid'), STORED);
    await page.locator('#status a', { hasText: 'Back to My Network' }).waitFor();
    assert.equal(await page.locator('#result').isHidden(), true, 'Explore waits for the visitor before reading');
    await page.click('#lookup button[type=submit]');
    await page.locator('#result:not([hidden])').waitFor();
    assert.equal(await text(page, '#r-orcid'), `ORCID ${STORED}`);
    // The way back survives a refresh of the result (Copilot review of #66).
    assert.equal(page.url(), `${BASE}/?orcid=${STORED}&from=contacts`);
    await page.reload();
    await page.locator('#status a', { hasText: 'Back to My Network' }).waitFor();
    await page.click('#lookup button[type=submit]');
    await page.locator('#result:not([hidden])').waitFor();
    await Promise.all([page.waitForURL(`${BASE}/network/#contacts`), page.locator('#r-back a').click()]);
    await card.waitFor();

    // Add to group from Explore: a new group, with the existing record reused.
    await openNetwork(page, `/network/#groups?add=${STORED}`);
    assert.equal(await text(page, '#handoff h2'), 'Add to group');
    assert.match(await text(page, '#handoff'), /already in your network .* no new ORCID request, and no duplicate/);
    await page.fill('#handoff-group-name', 'Imaging working group');
    await page.getByRole('button', { name: 'Add to group', exact: true }).click();
    await page.waitForURL(/\/network\/#groups\/[\w-]+$/);
    assert.match(await text(page, '#notice'), /they are not notified and membership is not confirmed/);
    state = await workspace(page);
    const group = state.groups.find(g => g.name === 'Imaging working group');
    assert.deepEqual(group.member_ids, [STORED]);
    assert.equal(state.people.length, 1);
    assert.equal(imports().length, 1);
    // Adding again is a no-op that says so.
    await openNetwork(page, `/network/#groups?add=${STORED}`);
    assert.match(await text(page, '#handoff'), /Already a member of Imaging working group\. Choosing one of those changes nothing/);
    assert.equal(await page.locator('#handoff-group option:checked').innerText(), 'A new group…', 'suggests a group they are not in yet');
    await page.selectOption('#handoff-group', group.id);
    assert.match(await page.locator('#handoff-group option:checked').innerText(), /already a member/);
    await page.getByRole('button', { name: 'Add to group', exact: true }).click();
    await page.waitForURL(/\/network\/#groups\/[\w-]+$/);
    assert.match(await text(page, '#notice'), /already in Imaging working group\. Nothing changed/);
    assert.deepEqual((await workspace(page)).groups.find(g => g.id === group.id).member_ids, [STORED]);

    // Public Group View: the link holds the group name and public iDs only, no private annotations.
    await Promise.all([page.waitForURL(/\/group\/#v1\./), page.getByRole('link', { name: /Share & visualise/ }).click()]);
    const shared = JSON.parse(Buffer.from(new URL(page.url()).hash.slice(4), 'base64url').toString('utf8'));
    assert.deepEqual(shared, { n: 'Imaging working group', m: [STORED] });
    const body = await page.locator('body').innerText();
    for (const secret of ['imaging protocol', 'FENS 2026']) assert.ok(!body.includes(secret), `Group View shows "${secret}"`);

    // Follow after Save as contact really follows: the import keeps the earlier "not followed",
    // so the confirmed Follow sets it explicitly (Copilot review of #66).
    assert.equal((await workspace(page)).people[0].following, false);
    await page.goto(`${BASE}/network/?import=${STORED}`);
    await loaded(page);
    await page.waitForFunction(async id => {
      const r = await fetch('/__engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'api', args: { method: 'GET', target: '/api/state' } }) });
      return JSON.parse(JSON.parse((await r.json()).result).body).people.find(p => p.id === id)?.following === true;
    }, STORED);
    // Saving a followed researcher as a contact says the follow is unchanged, not "Not followed".
    await page.goto(`${BASE}/network/?import=${SECOND}`);
    await loaded(page);
    await page.locator('.person-card', { hasText: 'Second Fixture Researcher' }).waitFor();
    await openNetwork(page, `/network/#contacts?save=${SECOND}`);
    await page.getByRole('button', { name: 'Save as contact', exact: true }).click();
    await page.locator(`#contact-${SECOND}`).waitFor();
    assert.match(await text(page, '#notice'), /You already follow them; that is unchanged/);

    // Choosing "A new group…" sticks even when one of your own groups would be the default.
    await openNetwork(page, `/network/#groups?add=${SECOND}`);
    assert.equal(await page.locator('#handoff-group option:checked').innerText(), 'Imaging working group');
    await page.selectOption('#handoff-group', '');
    await page.locator('#handoff-group-name').waitFor();
    assert.equal(await page.locator('#handoff-group option:checked').innerText(), 'A new group…');
    await page.fill('#handoff-group-name', 'Second group');
    await page.getByRole('button', { name: 'Add to group', exact: true }).click();
    await page.waitForURL(/\/network\/#groups\/[\w-]+$/);
    assert.deepEqual((await workspace(page)).groups.find(g => g.name === 'Second group').member_ids, [SECOND]);
    assert.deepEqual(errors, []);
    await close();
  },

  async exploreOnPhones(browser) {
    for (const viewport of [PHONE, SMALL]) {
      const { page, close } = await exploreJourney(browser, viewport);
      await Promise.all([page.waitForURL(`${BASE}/network/#groups?add=${STORED}`), page.click('#to-group')]);
      await page.locator('#handoff').waitFor();
      assert.ok(await noHorizontalScroll(page), `${viewport.width}: handoff scrolls sideways`);
      assert.equal(await page.locator('#handoff-group-name').isVisible(), true, 'with no group yet, a new group is offered');
      await close();
    }
  },

  // Connect & Organize: labelled sample → person → context tag + note → follow-up → group → output → team pack.
  async connectJourney(browser) {
    for (const viewport of [DESKTOP, SMALL]) {
      const { page, dialogs, errors, external, close } = await context(browser, viewport);
      await openNetwork(page, '/network/#contacts');
      const guide = page.locator('#guide .guide');
      assert.equal(await guide.locator('h2').innerText(), 'Connect & Organize, step by step');
      assert.match(await guide.innerText(), /stored only in this browser[\s\S]*Download my workspace[\s\S]*Restore from file/);
      assert.equal(await page.locator('#demo-banner').isVisible(), false, 'no sample banner without sample data');
      assert.match(await text(page, '.storage-note.compact'), /stored only in this browser/);
      assert.equal(await guide.locator('li.next a').innerText(), 'Add a person: import an ORCID iD, or use the labelled sample');
      assert.ok(await noHorizontalScroll(page), `${viewport.width}: empty network scrolls sideways`);
      assert.ok(await contrast(page, '.storage-note') >= 4.5, 'storage note contrast');
      assert.ok(await contrast(page, '#guide .step-state') >= 4.5, 'guide step contrast');
      // Empty state with next steps.
      assert.match(await text(page, '.empty'), /What can I do next\?/);

      await guide.getByRole('button', { name: 'Use the labelled sample' }).click();
      await page.locator('#demo-banner:not([hidden])').waitFor();
      assert.match(dialogs.at(-1).message, /labelled sample[\s\S]*labelled “Demo”/);
      assert.match(await text(page, '#demo-banner'), /labelled “Demo”/);

      // Person → contact with a conference tag, from the People card.
      await openNetwork(page, '/network/#people');
      const ada = page.locator('.person-card', { hasText: 'Ada Rivera' });
      await ada.getByRole('button', { name: 'Add Ada Rivera to a group or tag' }).click();
      await ada.getByLabel('New tag for Ada Rivera').fill('FENS 2026');
      await ada.getByRole('button', { name: 'Add tag' }).click();
      await page.locator('#notice', { hasText: 'tagged “FENS 2026”' }).waitFor();

      // Private note and an explicit follow-up, in Contacts.
      await openNetwork(page, '/network/#contacts');
      const card = page.locator('#contact-demo-ada');
      await card.getByLabel('Note about Ada Rivera').fill('Discussed the shared atlas privately');
      await card.getByRole('button', { name: 'Add note' }).click();
      await page.locator('#notice', { hasText: 'Note saved.' }).waitFor();
      await card.getByLabel('Follow-up with Ada Rivera').fill('Send the staining protocol');
      await card.getByLabel('Due date').fill('2030-01-15');
      await card.getByRole('button', { name: 'Add follow-up' }).click();
      await page.locator('#notice', { hasText: 'Follow-up added.' }).waitFor();
      assert.match(await text(page, '#contact-demo-ada'), /Send the staining protocol · due 2030-01-15/);

      // A local group from that contact, then a curated project output.
      await openNetwork(page, '/network/#groups');
      await page.getByRole('button', { name: '+ New group' }).click();
      await page.getByLabel('Group name').fill('Atlas working group');
      await page.locator('.editor .check-label', { hasText: 'Ada Rivera' }).locator('input').check();
      await page.getByRole('button', { name: 'Create group' }).click();
      await page.locator('.group-card', { hasText: 'Atlas working group' }).getByRole('button', { name: 'Open group →' }).click();
      await page.getByRole('tab', { name: 'Project outputs' }).click();
      await page.getByRole('button', { name: /^Select for project: / }).first().click();
      await page.locator('#notice', { hasText: 'Output selected for this project.' }).waitFor();

      // Team pack: roster, outputs and biosketches, without the contact's private annotations.
      await page.getByRole('tab', { name: 'Team pack' }).click();
      assert.match(await text(page, '#group-panel'), /contact tags, notes and follow-ups are never included/);
      const pack = await download(page, () => page.getByRole('button', { name: '↓ Download team pack' }).click());
      assert.match(pack.name, /^Atlas-working-group-team-pack\.zip$/);
      const files = unzip(pack.body);
      const everything = Object.values(files).join('\n');
      assert.ok(Object.keys(files).length >= 3, Object.keys(files).join(', '));
      assert.match(everything, /Ada Rivera/);
      for (const secret of ['shared atlas privately', 'staining protocol', 'FENS 2026']) assert.ok(!everything.includes(secret), `team pack holds "${secret}"`);
      // The last guide step shows Done straight after the download, without a reload, and focus stays put.
      await page.locator('#guide .guide-steps li.done', { hasText: 'Download the group’s team pack' }).waitFor();
      assert.equal(await page.locator('#guide .guide-steps li.done').count(), 7);
      assert.match(await page.evaluate(() => document.activeElement?.textContent || ''), /Download team pack/);

      // The guide reflects every step, and survives a refresh.
      await page.reload();
      await loaded(page);
      assert.equal(await page.locator('#guide .guide-steps li.done').count(), 7, await text(page, '#guide'));
      assert.ok(await noHorizontalScroll(page), `${viewport.width}: group view scrolls sideways`);
      // The guide can be hidden and brought back.
      await page.getByRole('button', { name: 'Hide guide' }).click();
      assert.equal(await page.locator('#guide .guide').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'guide-toggle');
      await page.reload();
      await loaded(page);
      assert.equal(await page.locator('#guide .guide').count(), 0, 'hiding the guide is remembered');
      await page.click('#guide-toggle');
      await page.locator('#guide .guide').waitFor();
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await close();
    }
  },

  async sampleNeverOverwritesARealWorkspace(browser) {
    const { page, dialogs, close } = await context(browser, DESKTOP);
    await openNetwork(page, `/network/#contacts?save=${FIXTURE}`);
    await page.fill('#handoff-note', 'A real private note');
    await page.getByRole('button', { name: 'Read record & save as contact' }).click();
    await page.locator(`#contact-${FIXTURE}`).waitFor();
    const before = await workspace(page);

    // Declining changes nothing.
    page.answer = () => false;
    await page.click('#demo');
    assert.match(dialogs.at(-1).message, /already holds your own network: 1 researcher, 1 contact and 0 groups[\s\S]*Nothing of yours is replaced/);
    await page.locator('#notice', { hasText: 'Nothing was added.' }).waitFor();
    assert.deepEqual(await workspace(page), before);
    // The ?sample=1 link asks the same question, with the counts, before anything is added.
    await page.goto(`${BASE}/network/?sample=1#groups`);
    await loaded(page);
    assert.match(dialogs.at(-1).message, /labelled sample[\s\S]*1 researcher, 1 contact and 0 groups/);
    assert.deepEqual(await workspace(page), before);

    // Accepting adds the labelled sample next to the real contact.
    page.answer = null;
    await page.click('#demo');
    await page.locator('#demo-banner:not([hidden])').waitFor();
    let state = await workspace(page);
    assert.equal(state.people.filter(p => !p.demo).length, 1);
    assert.ok(state.people.filter(p => p.demo).every(p => p.orcid === null));
    assert.deepEqual(state.contacts[FIXTURE], before.contacts[FIXTURE], 'real contact untouched');
    await openNetwork(page, '/network/#people');
    assert.equal(await page.locator('.person-card .chip.demo', { hasText: 'Demo' }).count(), 3);
    // A second ?sample=1 is a no-op: no question, nothing added twice.
    const asked = dialogs.length;
    await page.goto(`${BASE}/network/?sample=1#groups`);
    await loaded(page);
    assert.equal(dialogs.length, asked);
    assert.equal((await workspace(page)).people.length, 4);

    // Removing the sample takes out the sample only.
    await page.locator('#demo-banner').getByRole('button', { name: 'Remove sample data' }).click();
    assert.match(dialogs.at(-1).message, /3 sample people[\s\S]*Your own researchers, contacts and groups stay/);
    await page.locator('#demo-banner').waitFor({ state: 'hidden' });
    state = await workspace(page);
    assert.deepEqual(state.people.map(p => p.id), [FIXTURE]);
    assert.deepEqual(state.contacts[FIXTURE], before.contacts[FIXTURE]);
    assert.equal(state.groups.length, 0);
    await close();
  },

  async invalidCancelledAndInterruptedImports(browser) {
    const { page, dialogs, imports, close } = await context(browser, SMALL);
    // Invalid iD: explained, nothing read.
    await openNetwork(page, '/network/#contacts?save=0000-0002-1825-0098');
    assert.match(await text(page, '#handoff [role=alert]'), /is not a valid ORCID iD[\s\S]*Nothing was read or saved/);
    assert.ok(await noHorizontalScroll(page));
    await page.getByRole('button', { name: 'Close' }).click();
    assert.equal(page.url(), `${BASE}/network/#contacts`);
    assert.equal(imports().length, 0);

    // Cancelled before confirming.
    await openNetwork(page, `/network/#groups?add=${FIXTURE}`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.locator('#notice', { hasText: 'Cancelled. Nothing was read or saved.' }).waitFor();
    assert.equal(page.url(), `${BASE}/network/#groups`);
    assert.equal(imports().length, 0);

    // The Follow link's question, dismissed: nothing is imported.
    page.answer = () => false;
    await page.goto(`${BASE}/network/?import=${FIXTURE}`);
    await loaded(page);
    assert.match(dialogs.at(-1).message, /does not save them as a contact/);
    assert.equal(imports().length, 0);
    page.answer = null;

    // The contact is saved but the optional note fails: the form, the error and the draft stay,
    // and Retry finishes the job without a duplicate (Copilot review of #66).
    await page.route('**/__engine', route => (route.request().postData() || '').includes('/api/contacts/notes')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Storage is full.' }) })
      : route.fallback());
    await openNetwork(page, `/network/#contacts?save=${FIXTURE}`);
    await page.fill('#handoff-note', 'Keep this note');
    await page.getByRole('button', { name: 'Read record & save as contact' }).click();
    await page.locator('#handoff-error').waitFor();
    assert.match(await text(page, '#handoff-error'), /public record was stored, but the next step failed: Storage is full\. Retry uses the stored record/);
    assert.equal(await page.inputValue('#handoff-note'), 'Keep this note');
    await page.unroute('**/__engine');
    // The contact card already shows below the panel (the contact was saved), so wait for the panel to finish.
    await Promise.all([page.waitForURL(`${BASE}/network/#contacts`), page.getByRole('button', { name: /^Retry/ }).click()]);
    let saved = await workspace(page);
    assert.deepEqual(saved.contacts[FIXTURE].notes.map(n => n.text), ['Keep this note']);
    assert.equal(saved.people.length, 1);
    const removed = await page.evaluate(async id => {
      const r = await fetch('/__engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'api', args: { method: 'POST', target: '/api/people/remove', body: JSON.stringify({ id }) } }) });
      return JSON.parse((await r.json()).result).status;
    }, FIXTURE);
    assert.equal(removed, 200);

    // ORCID unreachable: a plain error, nothing saved, Retry offered.
    await openNetwork(page, `/network/#contacts?save=${UNREACHABLE}`);
    await page.fill('#handoff-note', 'Should not be stored');
    await page.getByRole('button', { name: 'Read record & save as contact' }).click();
    await page.locator('#handoff-error').waitFor();
    assert.match(await text(page, '#handoff-error'), /Could not reach the ORCID API[\s\S]*Nothing was saved/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'handoff-error');
    assert.equal(await page.inputValue('#handoff-note'), 'Should not be stored', 'the draft survives the failure');
    assert.match(await page.locator('#handoff button[type=submit]').innerText(), /^Retry/);
    assert.equal((await workspace(page)).people.length, 0);

    // Interrupted: a reload while the record is being read never leaves a half-saved contact.
    // The test server stops a slow read when the page that asked for it goes away, as the in-page
    // Pyodide engine does, so the outcome is deterministic: nothing is stored.
    await openNetwork(page, `/network/#contacts?save=${SLOW}`);
    await page.fill('#handoff-note', 'Interrupted note');
    await page.getByRole('button', { name: 'Read record & save as contact' }).click();
    await page.locator('#handoff [role=status]', { hasText: 'Reading the public ORCID record' }).waitFor();
    await page.reload();
    await loaded(page);
    await page.locator('#handoff').waitFor();
    assert.equal(await text(page, '#handoff h2'), 'Save as contact', 'the question is asked again');
    await page.waitForTimeout(3500); // longer than the slow read would have taken
    const state = await workspace(page);
    assert.deepEqual(state.people, [], 'the interrupted read stored nothing');
    assert.deepEqual(state.contacts, {});
    // A draft is kept after an error (above), not across a reload: the reloaded form starts empty.
    assert.equal(await page.inputValue('#handoff-note'), '');
    const reads = imports().length;
    await Promise.all([page.waitForURL(`${BASE}/network/#contacts`), page.getByRole('button', { name: 'Read record & save as contact' }).click()]);
    const after = await workspace(page);
    assert.equal(imports().length, reads + 1, 'confirming again reads the record exactly once');
    assert.equal(after.people.length, 1);
    assert.deepEqual(after.contacts[SLOW].notes, []);
    await close();
  },

  // Review of #66: a real researcher added to the sample group is the user's own data.
  async sampleGroupIsNeverTheDefaultAndKeepsRealMembers(browser) {
    const { page, dialogs, close } = await context(browser, DESKTOP);
    await openNetwork(page, '/network/#groups');
    await page.click('#demo');
    await page.locator('#demo-banner:not([hidden])').waitFor();
    // Arriving at a handoff moves keyboard focus to its heading; the Guide toggle steps aside.
    await openNetwork(page, `/network/#groups?add=${FIXTURE}`);
    await page.waitForFunction(() => document.activeElement?.id === 'handoff-title');
    assert.equal(await page.isDisabled('#guide-toggle'), true);
    // With only the sample group present, the default is a new group, never the sample one.
    assert.equal(await page.locator('#handoff-group option:checked').innerText(), 'A new group…');
    assert.match(await page.locator('#handoff-group option[value="demo-open-science"]').innerText(), /\(sample group\)/);
    // Choosing the sample group explicitly is allowed, and explained.
    await page.selectOption('#handoff-group', 'demo-open-science');
    assert.match(await text(page, '#handoff'), /This is the labelled sample group/);
    await page.getByRole('button', { name: 'Read record & add to group' }).click();
    await page.waitForURL(/\/network\/#groups\/demo-open-science$/);
    assert.equal(await page.isDisabled('#guide-toggle'), false);
    // A local role for the real member, then Remove sample data.
    const editor = page.locator('.member-editor', { hasText: 'Josiah Carberry' });
    await editor.getByLabel('Project role').fill('Imaging lead');
    await editor.getByRole('button', { name: 'Save member details' }).click();
    await page.locator('#notice', { hasText: 'Local details saved' }).waitFor();
    await page.locator('#demo-banner').getByRole('button', { name: 'Remove sample data' }).click();
    assert.match(dialogs.at(-1).message, /“Open Science Circle · Demo” holds your own members, requests or text, so it stays as “Open Science Circle”/);
    await page.locator('#demo-banner').waitFor({ state: 'hidden' });
    // The page follows the kept group to its new address instead of leaving a stale URL.
    await page.waitForURL(/\/network\/#groups\/(?!demo-)[\w-]+$/);
    await page.locator('.group-title h2', { hasText: 'Open Science Circle' }).waitFor();
    await page.locator('#notice', { hasText: 'Kept as your own group: Open Science Circle' }).waitFor();
    const state = await workspace(page);
    assert.equal(state.groups.length, 1);
    assert.equal(state.groups[0].name, 'Open Science Circle');
    assert.deepEqual(state.groups[0].member_ids, [FIXTURE]);
    assert.equal(state.groups[0].member_details[FIXTURE].role, 'Imaging lead');
    await close();
  },

  async studioInvalidIdAndEmptyNetworkSections(browser) {
    const { page, imports, close } = await context(browser, PHONE);
    await page.goto(BASE + '/');
    await page.fill('#orcid', 'not-an-orcid');
    await page.click('#lookup button[type=submit]');
    await page.waitForSelector('#status.error');
    assert.match(await text(page, '#status'), /ORCID/);
    assert.equal(await page.locator('#result').isHidden(), true);
    for (const hash of ['#feed', '#people', '#groups', '#contacts']) {
      await openNetwork(page, `/network/${hash}`);
      assert.match(await text(page, '#view'), /What can I do next\?|Try it with the labelled sample/, hash);
      assert.ok(await noHorizontalScroll(page), hash);
    }
    assert.equal(imports().length, 0);
    await close();
  },
};

(async () => {
  let browser;
  try { browser = await chromium.launch(); } catch (error) { console.error(error.message); process.exit(77); }
  let failed = 0;
  const only = process.env.SRP_ONLY;
  for (const [name, check] of Object.entries(checks)) {
    if (only && name !== only) continue;
    try { await check(browser); console.log(`ok - ${name}`); } catch (error) { failed += 1; console.log(`not ok - ${name}\n${error.stack}`); }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
