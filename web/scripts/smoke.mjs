// Headless smoke test: build, serve the build with `vite preview`, open every page in Chromium
// and fail on console errors, page errors or missing module headers. Screenshots go to
// snapshots/ so a person can compare them; nothing here diffs pixels.
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

async function checkPage(browser, n, expected) {
  // A fresh context per page: the app remembers the last page in localStorage.
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}?page=${n}`, { waitUntil: 'load' });
  await page.waitForTimeout(SETTLE_MS);

  const nums = await page.$$eval('.mod-head .num', (els) => els.map((e) => e.textContent.trim()));
  const missing = expected.filter((num) => !nums.includes(num));
  if (missing.length) errors.push(`missing module headers: ${missing.join(', ')}`);

  await page.screenshot({ path: join(SNAPSHOTS, `page-${n}.png`) });
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
  try {
    for (const [n, expected] of Object.entries(PAGES)) {
      const errors = await checkPage(browser, n, expected);
      if (errors.length) {
        failed++;
        console.log(`✗ page ${n}`);
        for (const e of errors) console.log(`    ${e}`);
      } else {
        console.log(`✓ page ${n}  modules ${expected[0]}–${expected.at(-1)}  → snapshots/page-${n}.png`);
      }
    }
  } finally {
    await browser.close();
    preview.kill();
  }
  if (failed) {
    console.log(`smoke: ${failed} of ${Object.keys(PAGES).length} pages failed`);
    process.exit(1);
  }
  console.log('smoke: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
