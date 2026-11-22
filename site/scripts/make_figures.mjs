#!/usr/bin/env node
// Renders the README figures and the site's social card from the built site (run `pnpm build` first):
//   ../docs/figures/{teaser,layers,explorer,og}.png  and  public/og.png, public/img/teaser.png
// Uses Playwright's Chromium (playwright-core; set CHROMIUM_PATH to use another Chromium build).
//   node scripts/make_figures.mjs [teaser layers explorer og]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { cleanPng } from './png.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(SITE, '../docs/figures');
const FIGS = {
  teaser: { url: '?figure=teaser', w: 1200, h: 660, dpr: 2 },
  layers: { url: '?figure=layers', w: 1200, h: 640, dpr: 2 },
  og: { url: '?figure=og', w: 1200, h: 630, dpr: 1 },
  explorer: { url: '?theme=light&lang=en#ST36_L', w: 1200, h: 750, dpr: 2 },
};
const want = process.argv.slice(2).filter((a) => a in FIGS);
const names = want.length ? want : Object.keys(FIGS);

await fs.access(path.join(SITE, 'dist/index.html')).catch(() => { console.error('make_figures: run `pnpm build` first'); process.exit(1); });
const server = await preview({ root: SITE, preview: { port: 4362, strictPort: false, open: false }, logLevel: 'error' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
await fs.mkdir(OUT, { recursive: true });
try {
  for (const n of names) {
    const f = FIGS[n];
    const ctx = await browser.newContext({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: f.dpr, colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`  ${n}: ${e.message}`));
    await page.goto(base + f.url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.acu361fig?.ready || window.acu361?.ready, null, { timeout: 120000 });
    await page.waitForTimeout(n === 'explorer' ? 2500 : 500);
    const raw = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: f.w, height: f.h } });
    const { png, splits } = cleanPng(raw);
    await fs.writeFile(path.join(OUT, `${n}.png`), png);
    console.log(`  ${n}.png  ${f.w * f.dpr}x${f.h * f.dpr}  ${(png.length / 1024).toFixed(0)} KB  (${splits} IDAT splits)`);
    if (n === 'og') await fs.writeFile(path.join(SITE, 'public/og.png'), png);
    if (n === 'teaser') { await fs.mkdir(path.join(SITE, 'public/img'), { recursive: true }); await fs.writeFile(path.join(SITE, 'public/img/teaser.png'), png); }
    await ctx.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log('make_figures: done; run `pnpm build` again to ship og.png and the fallback image');
