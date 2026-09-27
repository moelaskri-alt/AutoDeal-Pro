// Renders the application icon (SVG) to PNG files used by electron-builder (icon.png → .ico).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#274b78"/><stop offset="1" stop-color="#1e3a5f"/></linearGradient></defs>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#g)"/>
  <path d="M116 318 L150 232 Q158 212 180 212 L332 212 Q354 212 362 232 L396 318" fill="none" stroke="#fff" stroke-width="26" stroke-linejoin="round" stroke-linecap="round"/>
  <rect x="96" y="300" width="320" height="76" rx="26" fill="#fff"/>
  <circle cx="168" cy="382" r="34" fill="#1e3a5f" stroke="#fff" stroke-width="16"/>
  <circle cx="344" cy="382" r="34" fill="#1e3a5f" stroke="#fff" stroke-width="16"/>
  <rect x="226" y="322" width="60" height="18" rx="9" fill="#10b981"/>
  <text x="256" y="168" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="92" fill="#fff" letter-spacing="4">AD</text>
</svg>`;
fs.mkdirSync('build-resources', { recursive: true });
fs.writeFileSync('build-resources/icon.svg', svg);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const size of [512, 256]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: size === 512 ? 'build-resources/icon.png' : `build-resources/icon-${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
