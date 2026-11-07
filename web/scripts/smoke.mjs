// Headless smoke test: build, serve the build with `vite preview`, open every page in Chromium
// and fail on console errors, page errors or missing module headers: the built-in default
// document, the two-station example (?config=) and an old kiosk URL (legacy parameters, v0
// migration). Then switch pages 50 times and fail if the engine's GPU object count grew, and run
// a scripted service-panel session (step 08). Screenshots go to snapshots/ so a person can
// compare them; nothing here diffs pixels.
//
//   npm run smoke            (SMOKE_SKIP_BUILD=1 reuses an existing dist/)

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOTS = join(ROOT, 'snapshots');
const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}/`;
const SETTLE_MS = 4000;
const SWITCHES = 50;

// Module numbers per page, as listed in the README tables. Only the active page is mounted,
// so each page is checked for its own headers; together the five pages cover 01–27.
const PAGES = {
  1: ['01', '02', '03', '04', '05', '06', '07'],
  2: ['08', '09', '10', '11', '12', '13'],
  3: ['14', '15', '16', '17'],
  4: ['18', '19', '20', '21', '22'],
  5: ['23', '24', '25', '26', '27'],
};

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function build() {
  if (process.env.SMOKE_SKIP_BUILD) return;
  const r = spawnSync(npx, ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('vite build failed');
}

async function startPreview() {
  const proc = spawn(npx, ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  // Poll rather than parse vite's banner, whose format changes between versions.
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode != null) throw new Error(`vite preview exited:\n${log}`);
    try {
      if ((await fetch(BASE)).ok) return proc;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`vite preview did not come up on ${BASE}:\n${log}`);
}

// The two-station example document (public/examples/two-stations.json): its pages and their
// module numbers, plus checks that only make sense with several stations.
const TWO = '?config=/examples/two-stations.json';
const TWO_PAGES = {
  1: ['01', '02', '03', '04', '05', '06', '07', '08', '09'],
  2: ['10', '11', '12', '13'],
  3: ['14', '15', '16', '17', '18'],
  4: ['19', '20', '21', '22', '23'],
};

// An old kiosk URL from before the config document, served a stub JSON feed.
const LEGACY = '?source=/telemetry.json&station=edge-eu-2&hosts=48';
const telemetry = () =>
  JSON.stringify({
    timestamp: Date.now(),
    latency: 14 + Math.random() * 3,
    throughput: 320,
    errorRate: 0.002,
    saturation: 0.4,
    hosts: Array.from({ length: 48 }, (_, i) => ({ load: 0.3 + (i % 5) * 0.05, state: 'ok' })),
  });

const text = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));

async function checkPage(browser, query, expected, shot, extra) {
  // A fresh context per page: the app remembers the last page in localStorage.
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.route('**/telemetry.json', (r) => r.fulfill({ contentType: 'application/json', body: telemetry() }));

  await page.goto(`${BASE}${query}`, { waitUntil: 'load' });
  await page.waitForTimeout(SETTLE_MS);

  const nums = await text(page, '.mod-head .num');
  const missing = expected.filter((num) => !nums.includes(num));
  if (missing.length) errors.push(`missing module headers: ${missing.join(', ')}`);
  if (extra) errors.push(...(await extra(page)));

  await page.screenshot({ path: join(SNAPSHOTS, shot) });
  await context.close();
  return errors;
}

// Two stations: the header counts them, module headers name them, the merged log is there,
// and each station keeps its own almanac record in IndexedDB.
async function twoStationExtras(page) {
  const errors = [];
  const plates = await text(page, '.plate-val');
  if (!plates.includes('2 STATIONS')) errors.push(`station plate: ${plates.join(' | ')}`);
  const names = await text(page, '.mod-head .name');
  for (const want of ['· INFERENCE-01', '· SEARCH-01']) {
    if (!names.some((n) => n.endsWith(want))) errors.push(`no module header ending "${want}"`);
  }
  const metas = await text(page, '.mod-head .meta');
  if (!metas.includes('Teletype · all stations')) errors.push('merged event log missing');
  const keys = await page.evaluate(async () => {
    for (const s of window.__mars.stations()) s.almanac.save();
    await new Promise((r) => setTimeout(r, 300));
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('mars');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise((res) => {
      const q = db.transaction('almanac').objectStore('almanac').getAllKeys();
      q.onsuccess = () => res(q.result);
    });
  });
  for (const k of ['station:main:SIMULATED', 'station:search:SIMULATED']) {
    if (!keys.includes(k)) errors.push(`almanac record "${k}" missing (have ${keys.join(', ')})`);
  }
  return errors;
}

async function legacyExtras(page) {
  const errors = [];
  const plates = await text(page, '.plate-val');
  if (!plates.includes('EDGE-EU-2')) errors.push(`station plate: ${plates.join(' | ')}`);
  const serial = (await text(page, '.serial'))[0] ?? '';
  if (!/Source LIVE · 48 nodes/.test(serial)) errors.push(`footer: ${serial}`);
  const latest = await page.evaluate(() => window.__mars.stations()[0].store.latest?.throughput);
  if (latest !== 320) errors.push(`no samples from /telemetry.json (latest throughput ${latest})`);
  return errors;
}

// Mounting a page builds its instruments and allocates their GPU objects; leaving it must free
// them all. Starts and ends on page 1 (50 is a multiple of 5 pages), so the counts must match.
async function checkSwitching(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const stats = () => page.evaluate(() => window.__mars?.stats?.());

  await page.goto(`${BASE}?page=1`, { waitUntil: 'load' });
  await page.waitForTimeout(SETTLE_MS);
  const before = await stats();
  if (!before) return { errors: ['window.__mars.stats() is missing'] };
  let peak = before.textures;
  for (let i = 0; i < SWITCHES; i++) {
    await page.keyboard.press('ArrowRight');
    // long enough for every screen to render a frame and allocate its targets
    await page.waitForTimeout(150);
    peak = Math.max(peak, (await stats()).textures);
  }
  await page.waitForTimeout(1000);
  const after = await stats();
  await context.close();
  for (const k of Object.keys(before)) {
    if (after[k] !== before[k]) errors.push(`${k}: ${before[k]} before, ${after[k]} after ${SWITCHES} switches`);
  }
  return { errors, before, after, peak };
}

// The service panel (step 08), driven like a person would: open the housing on the two-station
// example, add a page, take a radar from the module bay, carry it three columns right by its
// label, rebind it to the second station, save the URL cartridge as local, close the housing and
// reload the same link. The saved copy must win over the link (step 08b), with its undo history;
// Revert to URL brings the file's version back. Then grow the document to 12 pages (the footer
// shows nine keys and a mark, [ wraps round), lock the device and check that E no longer opens it.
async function checkServicePanel(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const doc = () => page.evaluate(() => window.__mars.getDoc());
  const editing = async () => (await page.$('.service')) !== null;
  const expect = (ok, what) => ok || errors.push(what);

  await page.goto(`${BASE}${TWO}&page=1`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.keyboard.press('e');
  await page.waitForSelector('.service', { timeout: 5000 });
  expect(/not saved/i.test(await page.textContent('.cartridge')), 'URL cartridge not shown as "not saved"');
  await page.screenshot({ path: join(SNAPSHOTS, 'service-edit.png') });

  await page.click('.page-add');
  await page.click('.faceplate[data-type="radar"]');
  await page.waitForTimeout(800);
  let added = (await doc()).pages.at(-1);
  expect(added.name === 'PAGE 5', `new page is "${added.name}"`);
  const radar = added.panels.find((p) => p.type === 'radar');
  expect(radar && radar.x === 0 && radar.y === 0 && radar.station === 'main', `radar placed as ${JSON.stringify(radar)}`);

  // carry it by its label strip
  const head = await page.$('.slot[data-panel="radar"] .mod-head');
  const grid = await (await page.$('.service-grid')).boundingBox();
  const hb = await head.boundingBox();
  const col = grid.width / 12;
  await page.mouse.move(hb.x + 40, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + 40 + (3 * col * i) / 10, hb.y + hb.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const moved = (await doc()).pages.at(-1).panels.find((p) => p.id === 'radar');
  expect(moved.x === 3 && moved.y === 0, `radar after the drag at ${moved.x},${moved.y}, expected 3,0`);

  await page.click('.slot[data-panel="radar"] .mod-head');
  await page.click('.station-pick[data-station="search"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SNAPSHOTS, 'service-settings.png') });
  await page.click('.save-local');
  await page.waitForTimeout(200);
  expect(/local copy wins/i.test(await page.textContent('.cartridge')), 'cartridge not shown as a local copy after Save as local');
  await page.keyboard.press('Escape');
  expect(!(await editing()), 'Esc did not close the housing');

  await page.goto(`${BASE}${TWO}&page=5`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const back = (await doc()).pages.at(-1);
  const r = back.panels.find((p) => p.id === 'radar');
  expect(back.name === 'PAGE 5' && r && r.x === 3 && r.y === 0 && r.station === 'search', `after reload: ${JSON.stringify(back)}`);
  const origin = await page.evaluate(() => window.__mars.origin);
  expect(origin === 'url-local', `after reload the document came from "${origin}"`);
  expect(/local copy/i.test(await page.textContent('.hd .plate .cap')), 'header shows no local-copy marker');
  const names = await text(page, '.mod-head .name');
  expect(names.includes('Proximity · SEARCH-01'), `module headers after reload: ${names.join(' | ')}`);

  // the undo history came back with the copy: the last change was the rebinding
  await page.keyboard.press('e');
  await page.waitForSelector('.service', { timeout: 5000 });
  const radarStation = async () => (await doc()).pages.at(-1).panels.find((p) => p.id === 'radar')?.station;
  await page.keyboard.press('ControlOrMeta+z');
  expect((await radarStation()) === 'main', `undo after reload left the radar on "${await radarStation()}"`);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect((await radarStation()) === 'search', 'redo after reload did not rebind the radar');

  // Revert to URL: two presses, then the page reloads with the file's document
  await page.click('.revert-url');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('.revert-url')]);
  await page.waitForTimeout(1500);
  const reverted = await doc();
  const rOrigin = await page.evaluate(() => window.__mars.origin);
  expect(rOrigin === 'url' && !reverted.pages.some((p) => p.name === 'PAGE 5'), `after Revert to URL: origin "${rOrigin}", pages ${reverted.pages.map((p) => p.name).join(', ')}`);

  // more pages than keys
  await page.keyboard.press('e');
  await page.waitForSelector('.service', { timeout: 5000 });
  while ((await doc()).pages.length < 12) await page.click('.page-add');
  await page.keyboard.press('Escape');
  await page.keyboard.press('1');
  await page.waitForTimeout(200);
  const pageKeys = await page.$$eval('.ft .keys > .key', (ks) => ks.filter((k) => /^\d+$/.test(k.querySelector('kbd')?.textContent ?? '')).length);
  const marks = await page.$$eval('.ft .keymore', (ks) => ks.map((k) => k.textContent));
  expect(pageKeys === 9 && marks.join('') === '▸', `12 pages: ${pageKeys} page keys, marks "${marks.join('')}"`);
  await page.keyboard.press('[');
  await page.waitForTimeout(200);
  const plate = await page.$$eval('.hd .plate', (ps) => ps.find((p) => /^page/i.test(p.querySelector('.cap').textContent)).querySelector('.plate-val').textContent);
  expect(/^12 /.test(plate.trim()), `[ from page 1 shows "${plate.trim()}", expected page 12`);

  // lock it: E is ignored from then on
  await page.keyboard.press('e');
  await page.waitForSelector('.service', { timeout: 5000 });
  await page.click('.service .key:has-text("Lock")');
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  expect(!(await editing()), 'E opened a locked device');

  await context.close();
  return errors;
}

async function main() {
  build();
  mkdirSync(SNAPSHOTS, { recursive: true });
  const preview = await startPreview();
  // SwiftShader gives headless Chromium a software WebGL2 context on machines without a GPU.
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  let failed = 0;
  let checks = 0;
  try {
    const runs = [
      ...Object.entries(PAGES).map(([n, expected]) => ({ label: `page ${n}`, query: `?page=${n}`, expected, shot: `page-${n}.png` })),
      ...Object.entries(TWO_PAGES).map(([n, expected]) => ({
        label: `two stations page ${n}`,
        query: `${TWO}&page=${n}`,
        expected,
        shot: `two-stations-${n}.png`,
        extra: n === '1' ? twoStationExtras : null,
      })),
      { label: 'legacy URL', query: `${LEGACY}&page=1`, expected: PAGES[1], shot: 'legacy-url.png', extra: legacyExtras },
    ];
    for (const run of runs) {
      const errors = await checkPage(browser, run.query, run.expected, run.shot, run.extra);
      if (errors.length) {
        failed++;
        console.log(`✗ ${run.label}`);
        for (const e of errors) console.log(`    ${e}`);
      } else {
        console.log(`✓ ${run.label}  modules ${run.expected[0]}–${run.expected.at(-1)}  → snapshots/${run.shot}`);
      }
    }
    checks = runs.length + 1;
    const sw = await checkSwitching(browser);
    const fmt = (s) => (s ? Object.entries(s).map(([k, v]) => `${k} ${v}`).join(', ') : '-');
    if (sw.errors.length) {
      failed++;
      console.log(`✗ ${SWITCHES} page switches`);
      for (const e of sw.errors) console.log(`    ${e}`);
    } else {
      console.log(`✓ ${SWITCHES} page switches  GPU objects unchanged (${fmt(sw.after)}; peak textures ${sw.peak})`);
    }
    checks++;
    const service = await checkServicePanel(browser);
    if (service.length) {
      failed++;
      console.log('✗ service panel');
      for (const e of service) console.log(`    ${e}`);
    } else {
      console.log('✓ service panel  page added, radar placed, moved, rebound, saved, reloaded (copy wins, undo kept), reverted, 12 pages; locked E ignored  → snapshots/service-*.png');
    }
  } finally {
    await browser.close();
    preview.kill();
  }
  if (failed) {
    console.log(`smoke: ${failed} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log('smoke: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
