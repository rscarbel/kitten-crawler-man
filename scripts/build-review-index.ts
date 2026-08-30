/**
 * One page that shows every review image the harnesses have produced.
 *
 * The refactor's human review happens at the end, from the contact sheets in
 * `preview/` — and by then there are dozens of them, which is not something
 * anyone scans as a directory listing. This gathers them into a single local
 * page grouped by figure, with the parity comparisons called out first because
 * those are the ones that answer "does it still look like what shipped".
 *
 *   npm run review:index      → preview/index.html
 *
 * The page references the PNGs relatively rather than embedding them, so it
 * stays small and always shows whatever the last harness run produced.
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PREVIEW_DIR } from './previewOut.js';

/** Images whose name marks them as a shipped-versus-painted comparison. */
const PARITY_SUFFIX = '-parity.png';

/** Suffixes a harness appends to a figure's own name, longest first. */
const HARNESS_SUFFIXES = [
  '-parity.png',
  '-review.png',
  '-sheet.png',
  '-parts.png',
  '-gore.png',
  '-hazards.png',
  '.png',
];

interface ReviewImage {
  readonly file: string;
  readonly isParity: boolean;
}

/** The figure a review image belongs to, derived from its filename. */
function figureOf(file: string): string {
  for (const suffix of HARNESS_SUFFIXES) {
    if (file.endsWith(suffix)) {
      // Both separators appear across the harnesses (`dark-knight-review.png`
      // against `dark_knight-parity.png`), and they name the same figure.
      return file.slice(0, file.length - suffix.length).replace(/[-_]/g, ' ');
    }
  }
  return file;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const files = readdirSync(resolve(PREVIEW_DIR))
  .filter((file) => file.endsWith('.png'))
  .sort();

const byFigure = new Map<string, ReviewImage[]>();
for (const file of files) {
  const figure = figureOf(file);
  const images = byFigure.get(figure) ?? [];
  images.push({ file, isParity: file.endsWith(PARITY_SUFFIX) });
  byFigure.set(figure, images);
}

const figures = [...byFigure.keys()].sort();
const parityCount = files.filter((file) => file.endsWith(PARITY_SUFFIX)).length;

const sections = figures
  .map((figure) => {
    const images = byFigure.get(figure) ?? [];
    // Parity first: it is the one image that answers whether the painted figure
    // still matches the sheet it replaced.
    const ordered = [...images].sort(
      (a, b) => Number(b.isParity) - Number(a.isParity) || a.file.localeCompare(b.file),
    );
    const tiles = ordered
      .map(
        (image) =>
          `<figure class="${image.isParity ? 'parity' : ''}">` +
          `<a href="${encodeURI(image.file)}" target="_blank" rel="noreferrer">` +
          `<img src="${encodeURI(image.file)}" loading="lazy" alt="${escapeHtml(image.file)}"></a>` +
          `<figcaption>${escapeHtml(image.file)}` +
          `${image.isParity ? ' <b>shipped | painted</b>' : ''}</figcaption></figure>`,
      )
      .join('\n');
    return `<section><h2>${escapeHtml(figure)}</h2><div class="row">\n${tiles}\n</div></section>`;
  })
  .join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<title>Procedural sprite review</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #14161c; color: #e6e8ee;
         font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { color: #98a0b3; margin: 0 0 24px; }
  h2 { font-size: 15px; margin: 28px 0 8px; color: #9ecbff; text-transform: capitalize; }
  .row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  figure { margin: 0; max-width: 100%; }
  figure.parity { outline: 1px solid #3d5a80; outline-offset: 6px; }
  img { max-width: 620px; max-height: 420px; background: #23262f;
        image-rendering: pixelated; display: block; }
  figcaption { color: #8b93a7; font-size: 11px; margin-top: 6px; word-break: break-all; }
  figure.parity figcaption b { color: #9ecbff; font-weight: 600; }
  nav { margin-bottom: 20px; }
  nav a { color: #9ecbff; margin-right: 12px; font-size: 12px; }
</style>
<h1>Procedural sprite review</h1>
<p class="lede">${files.length} images across ${figures.length} figures, ${parityCount} of them
shipped-versus-painted comparisons (outlined). Click any image for full size.
Regenerate with <code>npm run review:index</code>.</p>
<nav>${figures.map((f) => `<a href="#${encodeURIComponent(f)}">${escapeHtml(f)}</a>`).join('')}</nav>
${sections}
`;

const out = resolve(PREVIEW_DIR, 'index.html');
writeFileSync(out, html);
console.log(
  `Wrote ${out} — ${files.length} images, ${figures.length} figures, ${parityCount} parity.`,
);
