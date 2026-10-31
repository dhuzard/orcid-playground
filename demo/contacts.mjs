// Renders the Contacts demo from the web app's UI only: one cut plus short square clips.
//   node demo/contacts.mjs [site-dir]
// Contacts import people by ORCID iD, so the four fictional "(Demo)" researchers of demo/synthetic.mjs are
// served in place of the live API. Tags, notes and follow-ups are typed live; nothing is pre-filled.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { OUT, RAW, SITE, caption, record, cut, square, concat, topic, titleCard, serveSite } from './lib.mjs';
import { serveSyntheticOrcid, demoPeople } from './synthetic.mjs';

const type = (loc, text) => loc.pressSequentially(text, { delay: 45 });
const top = (loc) => loc.evaluate(el => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -130); });
const ids = demoPeople.slice(0, 3).map(x => x.orcid);

async function take(b, base) {
  const segs = [];
  const mp4 = await record(b, 'c-take', async (p, at) => {
    const seg = (id) => segs.push({ id, t: at() });
    await p.goto(`${base}network/#contacts`); await p.waitForTimeout(9000);
    segs.t0 = at(); seg('meet');
    await caption(p, 'CONTACTS', 'People you meet, kept in context.', 'Tag everyone from one conference or meeting. Everything stays private, in this browser. The people never see it.');
    await p.waitForTimeout(4600);
    await top(p.getByLabel('Conference or context')); await p.waitForTimeout(500);
    await type(p.getByLabel('Conference or context'), 'FENS 2026 (Demo)'); await p.waitForTimeout(500);
    await p.getByLabel('ORCID list').fill(ids.slice(0, 1).join('\n')); await p.getByLabel('ORCID list').pressSequentially('\n' + ids.slice(1).join('\n'), { delay: 25 });
    await p.waitForTimeout(800); await p.click('button:text-is("Preview list")'); await p.waitForTimeout(1800);
    await p.click('button:text-is("Import & tag")'); await p.waitForSelector('#notice:has-text("Finished")', { timeout: 60000 });
    await p.waitForTimeout(2600);
    await p.getByLabel('ORCID list').evaluate(el => { el.closest('.editor').scrollIntoView({ block: 'start' }); window.scrollBy(0, 330); });
    await caption(p, 'IMPORT & TAG', 'Paste iDs, name the context.', 'Public records are read one at a time on your request. Each result is listed, and people you already imported are reused.');
    await p.waitForTimeout(4600);
    seg('notes');
    await p.locator('.card-actions input[aria-label^="Add a tag to Ada"]').first().evaluate(el => { el.closest('article, .card, section, div.card')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -130); }).catch(() => {});
    await caption(p, 'TAGS, NOTES, FOLLOW-UPS', 'Remember what you talked about.', 'Add a tag, a note and a follow-up with a due date to any person. Notes are yours alone.');
    await p.waitForTimeout(3000);
    const ada = (re) => p.getByLabel(re).first();
    await top(ada(/Add a tag to Ada/)); await p.waitForTimeout(400);
    await type(ada(/Add a tag to Ada/), 'wants to collaborate'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
    await type(ada(/Note about Ada/), 'Interested in sharing home-cage data. Met at the poster session.');
    await p.locator('button:text-is("Add note")').first().click(); await p.waitForTimeout(1500);
    await type(ada(/Follow-up with Ada/), 'Send the metadata checklist');
    await p.locator('input[aria-label="Due date"]').first().fill('2026-11-14'); await p.waitForTimeout(500);
    await p.locator('button:text-is("Add follow-up")').first().click(); await p.waitForTimeout(2600);
    await top(p.getByLabel(/Follow-up with Sam/)); await p.waitForTimeout(500);
    await type(p.getByLabel(/Follow-up with Sam/), 'Intro to the data steward');
    await p.getByLabel(/Follow-up with Sam/).locator('xpath=ancestor::form[1]').locator('input[type=date]').fill('2026-11-05').catch(() => {});
    await p.locator('button:text-is("Add follow-up")').nth(1).click(); await p.waitForTimeout(2600);
    seg('todo'); await p.evaluate(() => window.scrollTo(0, 0));
    await top(p.locator('h3:has-text("Open follow-ups")')); await p.waitForTimeout(500);
    await caption(p, 'OPEN FOLLOW-UPS', 'Never lose a promise.', 'Everything you owe people, soonest first, with overdue items flagged. Tick one off when it is done.');
    await p.waitForTimeout(5000);
    await p.locator('.bulk-entry button:text-is("Done")').first().click(); await p.waitForTimeout(3200);
    seg('context'); await p.evaluate(() => window.scrollTo(0, 0));
    await top(p.locator('.toolbar:has-text("CONTEXTS")')); await p.waitForTimeout(500);
    await caption(p, 'CONTEXTS', 'Find everyone from one event.', 'Filter by conference or context, then turn that context into a working group when a conversation becomes a project.');
    await p.waitForTimeout(3600);
    await p.locator('.toolbar .chips button:has-text("FENS 2026")').click(); await p.waitForTimeout(2400);
    await p.click('button:text-is("Turn this context into a group")'); await p.waitForTimeout(3800);
    seg('end');
  }, serveSyntheticOrcid);
  return { mp4, segs };
}

const site = await serveSite();
const browser = await chromium.launch();
try {
  const intro = await titleCard(browser, 'c-intro', `<h1>Everyone you meet,<br><em>in context.</em></h1>
    <p>Tag people by conference, note what you discussed, and track what you promised. Private to your browser.</p>
    <div><span class="pill">private notes</span><span class="pill">follow-ups</span><span class="pill">never shared</span></div>`, 5.5);
  const outro = await titleCard(browser, 'c-outro', `<h1>Your notes are yours.<br><em>Never in a team pack.</em></h1>
    <p>Open source · stored in your browser · public ORCID data only.</p>
    <div><span class="pill">${SITE}</span><span class="pill">github.com/dhuzard/orcid-playground</span></div>`, 5);
  const t = await take(browser, site.base);
  const all = cut(t.mp4, t.segs.t0 + 0.1, t.segs.find(s => s.id === 'end').t - 0.05, resolve(RAW, 'c-all.mp4'));
  concat([intro, all, outro], resolve(OUT, 'contacts-full-demo.mp4'));
  const T = (a, z, n) => topic(t.mp4, t.segs, a, z, n);
  const clips = {
    'contacts-clip-1-import-and-tag': T('meet', 'notes', 'cc1'),
    'contacts-clip-2-notes-and-follow-ups': T('notes', 'todo', 'cc2'),
    'contacts-clip-3-open-follow-ups': T('todo', 'context', 'cc3'),
    'contacts-clip-4-context-to-group': T('context', 'end', 'cc4'),
  };
  for (const [name, src] of Object.entries(clips)) square(src, resolve(OUT, `${name}.mp4`));
} finally { await browser.close(); site.stop(); }
