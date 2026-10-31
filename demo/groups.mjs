// Renders the working-group demo from the web app's UI only: one long cut plus short square clips.
//   node demo/groups.mjs [site-dir]
// Part 1 uses the network app's labelled Demo workspace. Part 2 uses the Group view with synthetic
// ORCID records served in place of the live API (demo/synthetic.mjs); on screen they are marked "Demo".
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { OUT, RAW, SITE, caption, record, cut, square, concat, topic, titleCard, serveSite } from './lib.mjs';
import { serveSyntheticOrcid, demoPeople } from './synthetic.mjs';

const HOSTED = `https://${SITE}/`;
// Serve the locally built site under its public hostname, so the Embed snippet shows the real address.
const serveAs = (ctx, base) => ctx.route(`${HOSTED}**`, async (route) => {
  const res = await route.fetch({ url: base + route.request().url().slice(HOSTED.length) });
  await route.fulfill({ response: res });
});
const type = (loc, text) => loc.pressSequentially(text, { delay: 45 });
// Bring an element to the upper part of the viewport so the caption panel never covers it.
const top = (loc) => loc.evaluate(el => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -130); });

async function working(b, base) {
  const segs = [];
  const mp4 = await record(b, 'g-working', async (p, at) => {
    const seg = (id) => segs.push({ id, t: at() });
    await p.goto(`${base}network/`); await p.waitForTimeout(9000);
    await p.click('#demo'); await p.waitForTimeout(1200);
    segs.t0 = at(); seg('list');
    await p.click('a[href="#groups"]'); await p.waitForTimeout(700);
    await caption(p, 'WORKING GROUPS', 'A roster you curate.', 'Bring collaborators and consortia into one place. Everything is stored in this browser, and sample people are marked Demo.');
    await p.waitForTimeout(4800);
    await p.click('text=Open group'); await p.waitForTimeout(1200);
    seg('roster');
    await caption(p, 'ROSTER', 'Roles, expertise, contributions.', 'Recorded locally by you. Members have not confirmed them, and the app says so.');
    await p.waitForTimeout(3200);
    await top(p.getByLabel('Project role').first()); await p.waitForTimeout(500);
    await type(p.getByLabel('Project role').first(), 'Coordinator');
    await type(p.getByLabel('Expertise').first(), 'Open methods');
    await type(p.getByLabel('Contribution to this group').first(), 'Study design and data stewardship');
    await p.waitForTimeout(700);
    await p.locator('button:text-is("Save member details")').first().click(); await p.waitForTimeout(3200);
    seg('outputs'); await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('main button:text-is("Project outputs")'); await p.waitForTimeout(900); await top(p.locator('main h3').first());
    await caption(p, 'PROJECT OUTPUTS', 'Choose what belongs to the project.', 'Member outputs are only suggestions. Selecting one records your decision; it does not change ORCID or confirm authorship.');
    await p.waitForTimeout(4200);
    for (let i = 0; i < 2; i++) { await p.locator('button:text-is("+ Select for project")').first().click(); await p.waitForTimeout(1600); }
    await top(p.locator('main h3').first()); await p.waitForTimeout(3000);
    seg('requests'); await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('main button:text-is("Requests")'); await p.waitForTimeout(900); await top(p.locator('main h3').first());
    await caption(p, 'REQUESTS', 'Track small asks.', 'A title, an owner and a due date. Nothing is sent: no messages, no invitations.');
    await p.waitForTimeout(2600);
    await type(p.getByLabel('What does the group need?'), 'Collect ORCID iDs from all partners');
    await type(p.getByLabel('Details'), 'Needed before the consortium biosketch is drafted.');
    await p.getByLabel('Owner').selectOption({ label: 'Ada Rivera' }); await p.waitForTimeout(500);
    await p.click('button:text-is("Add request")'); await p.waitForTimeout(3600);
    seg('pack'); await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('main button:text-is("Team pack")'); await p.waitForTimeout(900); await top(p.locator('main h3').first());
    await caption(p, 'TEAM PACK', 'One download for the whole team.', 'Roster, merged bibliography, member biosketches and a manifest that describes exactly what was selected.');
    await p.waitForTimeout(4500);
    await p.selectOption('main select', { index: 1 }); await p.waitForTimeout(2200);
    await Promise.all([p.waitForEvent('download'), p.click('button:text-is("↓ Download team pack")')]); await p.waitForTimeout(3600);
    seg('end');
  });
  return { mp4, segs };
}

async function view(b, base) {
  const segs = [];
  const ids = demoPeople.map(x => x.orcid);
  const mp4 = await record(b, 'g-view', async (p, at) => {
    const seg = (id) => segs.push({ id, t: at() });
    await p.goto(`${HOSTED}group/`); await p.waitForTimeout(14000);
    segs.t0 = at(); seg('compose');
    await caption(p, 'GROUP VIEW', 'A group from nothing but public ORCID iDs.', 'Paste up to 50 iDs. The group lives in a shareable link; nothing is stored on a server.');
    await p.waitForTimeout(3600);
    await top(p.locator('#compose-name')); await p.waitForTimeout(600);
    await type(p.locator('#compose-name'), 'Open Science Circle (Demo)');
    await p.locator('#compose-ids').fill(ids.slice(0, 2).join('\n')); await p.waitForTimeout(700);
    await p.locator('#compose-ids').pressSequentially('\n' + ids[2] + '\n' + ids[3], { delay: 25 }); await p.waitForTimeout(900);
    await p.click('text=Preview the link'); await p.waitForTimeout(1600);
    await p.click('#load'); await p.waitForSelector('#tabs button', { timeout: 60000 }); await p.waitForTimeout(1200);
    seg('graph'); await top(p.locator('#tabs'));
    await caption(p, 'COLLABORATION GRAPH', 'Linked only by shared DOIs.', 'A line appears only when both public records assert the same DOI. It shows co-asserted outputs, not proven collaboration.');
    await p.waitForTimeout(4200);
    await p.locator('line.edge').first().click({ force: true }); await p.waitForTimeout(3800);
    seg('shared'); await p.click('[data-tab="Shared outputs"]'); await top(p.locator('#tabs')); await p.waitForTimeout(500);
    await caption(p, 'SHARED OUTPUTS', 'Every link cites its evidence.', 'Outputs asserted by more than one member, with the DOI that connects them.');
    await p.waitForTimeout(5000);
    seg('health'); await p.click('[data-tab="Record health"]'); await top(p.locator('#tabs')); await p.waitForTimeout(500);
    await caption(p, 'RECORD HEALTH', 'See what the group should fix, together.', 'The most common issues across all members, and exactly how to fix each in ORCID.');
    await p.waitForTimeout(4200); await p.mouse.wheel(0, 340); await p.waitForTimeout(3600);
    seg('team'); await p.click('[data-tab="Team biosketch"]'); await top(p.locator('#tabs')); await p.waitForTimeout(500);
    await caption(p, 'TEAM BIOSKETCH', 'A draft team document in a funder format.', 'Members, joint outputs and each funder template, built only from asserted fields. Roles and contributions are yours to add.');
    await p.waitForTimeout(4200); await p.mouse.wheel(0, 300); await p.waitForTimeout(3000);
    await p.selectOption('#panel select', { index: 1 }).catch(() => {}); await top(p.locator('#tabs')); await p.waitForTimeout(3600);
    seg('wrapped'); await p.click('[data-tab="Wrapped"]'); await top(p.locator('#tabs')); await p.waitForTimeout(500);
    await caption(p, 'GROUP WRAPPED', 'The group\'s year in review.', 'Outputs merged by DOI, so a joint paper counts once. Every figure is read from the records.');
    await p.waitForTimeout(5200);
    seg('deck'); await p.click('[data-tab="Card deck"]'); await top(p.locator('#tabs')); await p.waitForTimeout(500);
    await caption(p, 'CARD DECK', 'A printable card for every member.', 'Each card is built only from that member\'s own record. Print the deck for a lab door or a conference table.');
    await p.waitForTimeout(5200);
    seg('embed'); await p.click('[data-tab="Embed"]'); await top(p.locator('#tabs')); await p.waitForTimeout(500);
    await caption(p, 'EMBED', 'Put the group on your lab website.', 'Download a snapshot and add two lines of HTML. The widget reads only that file.');
    await p.waitForTimeout(5800);
    seg('end');
  }, async (ctx) => { await serveSyntheticOrcid(ctx); await serveAs(ctx, base); });
  return { mp4, segs };
}

const site = await serveSite();
const browser = await chromium.launch();
try {
  const intro = await titleCard(browser, 'g-intro', `<h1>Working groups,<br><em>without the admin.</em></h1>
    <p>Curate a roster, pick the project's outputs, and see who has published together, from public ORCID records alone.</p>
    <div><span class="pill">locally curated</span><span class="pill">linked by shared DOIs</span><span class="pill">no server</span></div>`, 5.5);
  const outro = await titleCard(browser, 'g-outro', `<h1>Membership is yours to curate.<br><em>Never presented as verified.</em></h1>
    <p>Open source · stored in your browser · public ORCID data only.</p>
    <div><span class="pill">${SITE}</span><span class="pill">github.com/dhuzard/orcid-playground</span></div>`, 5);
  const w = await working(browser, site.base), v = await view(browser, site.base);
  const all = (t, id = 'end') => cut(t.mp4, t.segs.t0 + 0.1, t.segs.find(s => s.id === id).t - 0.05, resolve(RAW, `${t === w ? 'w' : 'v'}-all.mp4`));
  concat([intro, all(w), all(v), outro], resolve(OUT, 'groups-full-demo.mp4'));
  const W_ = (a, z, n) => topic(w.mp4, w.segs, a, z, n), V_ = (a, z, n) => topic(v.mp4, v.segs, a, z, n);
  const clips = {
    'groups-clip-1-roster-and-roles': W_('roster', 'outputs', 'gw1'),
    'groups-clip-2-project-outputs-and-requests': W_('outputs', 'pack', 'gw2'),
    'groups-clip-3-team-pack': W_('pack', 'end', 'gw3'),
    'groups-clip-4-group-from-orcid-ids': V_('compose', 'shared', 'gv1'),
    'groups-clip-5-record-health-and-team-biosketch': V_('health', 'wrapped', 'gv2'),
    'groups-clip-6-wrapped-cards-embed': V_('wrapped', 'end', 'gv3'),
  };
  for (const [name, src] of Object.entries(clips)) square(src, resolve(OUT, `${name}.mp4`));
} finally { await browser.close(); site.stop(); }
