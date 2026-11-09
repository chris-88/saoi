// Seeks the real SVG in Chromium. Usage: node render.mjs <outDir> <fps> [scale]  or  node render.mjs <outDir> times 1.2,3.4
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const [out, a, b] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const svg = readFileSync(new URL('./saoi-to-face.svg', import.meta.url), 'utf8');
const { DUR } = JSON.parse(readFileSync(new URL('./timeline.json', import.meta.url)));
const list = a === 'times' ? b.split(',').map(Number) : Array.from({ length: Math.ceil(DUR * +a) + 1 }, (_, i) => Math.min(DUR, i / +a));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 270 }, deviceScaleFactor: a === 'times' ? 1 : +(b ?? 1.5) });
await page.setContent(`<!doctype html><style>html,body{margin:0;background:#fff}svg{display:block;width:480px;height:270px}</style>${svg}`);
let i = 0;
for (const s of list) {
  await page.evaluate((ms) => document.getAnimations().forEach((x) => { x.pause(); x.currentTime = Math.min(ms, x.effect.getComputedTiming().endTime - 0.01); }), s * 1000);
  await page.screenshot({ path: `${out}/${String(i++).padStart(4, '0')}.png` });
}
await browser.close();
console.log('frames', list.length, 'of', DUR);
