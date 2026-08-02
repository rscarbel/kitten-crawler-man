/**
 * Exports any character in the game as scalable vector art.
 *
 * The art is code — every character is a `draw…` function full of canvas calls
 * — so the vector original already exists and is only discarded when the canvas
 * rasterises it. This replays the real draw function against
 * {@link SvgRecorder} and writes the paths out as SVG, which means an exported
 * figure can never drift from what the game renders: there is no second copy of
 * the art to keep in step.
 *
 *   npx tsx scripts/render-svg.ts --list
 *   npx tsx scripts/render-svg.ts --subject=signet
 *   npx tsx scripts/render-svg.ts --subject=signet --view=front --out=signet.svg
 *   npx tsx scripts/render-svg.ts --subject=donut --view=walk --frame=3
 *   npx tsx scripts/render-svg.ts --all --out-dir=svg
 *
 * With no `--view` every view of the subject is written; with `--all`, every
 * view of every subject.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { SvgRecorder, asDomContext, asNodeCanvasContext } from './svgCanvas.js';
import type { Box } from './svgCanvas.js';
import { SUBJECTS, SUBJECT_UNIT, findSubject } from './svgSubjects.js';
import type { SvgSubject, SvgView } from './svgSubjects.js';

/** Breathing room around the figure, as a fraction of its longest side. */
const MARGIN_FRACTION = 0.02;
const DEFAULT_HEIGHT_PX = 900;
const DEFAULT_OUT_DIR = 'svg';
const DEFAULT_FRAME = 0;

interface Options {
  subject: string | null;
  view: string | null;
  frame: number;
  out: string | null;
  outDir: string;
  heightPx: number;
  background: string | null;
  all: boolean;
  list: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    subject: null,
    view: null,
    frame: DEFAULT_FRAME,
    out: null,
    outDir: DEFAULT_OUT_DIR,
    heightPx: DEFAULT_HEIGHT_PX,
    background: null,
    all: false,
    list: false,
  };

  for (const arg of argv) {
    const [flag, rawValue] = arg.split('=', 2);
    const value = rawValue ?? '';
    if (flag === '--subject') options.subject = value;
    else if (flag === '--view') options.view = value;
    else if (flag === '--frame') options.frame = Number(value);
    else if (flag === '--out') options.out = value;
    else if (flag === '--out-dir') options.outDir = value;
    else if (flag === '--height') options.heightPx = Number(value);
    else if (flag === '--background') options.background = value;
    else if (flag === '--all') options.all = true;
    else if (flag === '--list') options.list = true;
    else throw new Error(`unknown option: ${arg}`);
  }

  return options;
}

/**
 * Paints one view and returns the finished document. The two contexts are
 * different views of the same recorder, so a subject may use either without the
 * caller caring which convention its draw function follows.
 */
function renderView(subjectName: string, view: SvgView, options: Options): string {
  const recorder = new SvgRecorder();
  view.paint({
    dom: asDomContext(recorder),
    node: asNodeCanvasContext(recorder),
    unit: SUBJECT_UNIT,
  });

  const painted = recorder.paintedBounds;
  if (painted.minX > painted.maxX) {
    throw new Error(`${subjectName}/${view.name} painted nothing`);
  }

  const viewBox = withMargin(painted);
  const width = viewBox.maxX - viewBox.minX;
  const height = viewBox.maxY - viewBox.minY;

  for (const warning of recorder.warnings) {
    console.warn(`  ! ${subjectName}/${view.name}: ${warning}`);
  }

  return recorder.toSvg({
    viewBox,
    pixelHeight: options.heightPx,
    pixelWidth: Math.round((width / height) * options.heightPx),
    title: `${subjectName} — ${view.name}`,
    background: options.background ?? undefined,
  });
}

function withMargin(box: Box): Box {
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY) * MARGIN_FRACTION;
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
  };
}

function write(path: string, svg: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg);
  console.log(`wrote ${path} (${svg.length} bytes)`);
}

async function selectViews(subject: SvgSubject, options: Options): Promise<readonly SvgView[]> {
  const views = await subject.views(options.frame);
  if (options.view === null) return views;

  const wanted = views.find((view) => view.name === options.view);
  if (wanted === undefined) {
    const names = views.map((view) => view.name).join(', ');
    throw new Error(`${subject.name} has no view "${options.view}". Available: ${names}`);
  }
  return [wanted];
}

/**
 * Returns false when a view could not be exported. Sweeping every subject must
 * not be hostage to one character whose art the recorder cannot reach — the
 * failure is reported and the sweep goes on.
 */
async function renderSubject(
  subject: SvgSubject,
  options: Options,
  continueOnError: boolean,
): Promise<boolean> {
  const views = await selectViews(subject, options);
  const namesSingleFile = options.out !== null && views.length === 1;
  let allSucceeded = true;

  for (const view of views) {
    const path = namesSingleFile
      ? String(options.out)
      : join(options.outDir, `${subject.name}-${view.name}.svg`);
    try {
      write(path, renderView(subject.name, view, options));
    } catch (error) {
      if (!continueOnError) throw error;
      allSucceeded = false;
      console.warn(`  ! skipped ${subject.name}/${view.name}: ${describe(error)}`);
    }
  }

  return allSucceeded;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listSubjects(): Promise<void> {
  for (const subject of SUBJECTS) {
    const views = await subject.views(DEFAULT_FRAME);
    console.log(`${subject.name}: ${views.map((view) => view.name).join(', ')}`);
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.list) {
  await listSubjects();
} else if (options.all || options.subject !== null) {
  // Some characters are composites that blit baked sheets — market props, the
  // Hoarder's sacks — and those blits are silently skipped on an unloaded key,
  // so the sheets have to be in memory before anything is painted.
  await loadGameSpritesInNode();

  if (options.all) {
    let allSucceeded = true;
    for (const subject of SUBJECTS) {
      allSucceeded = (await renderSubject(subject, options, true)) && allSucceeded;
    }
    if (!allSucceeded) process.exitCode = 1;
  } else {
    const subject = findSubject(String(options.subject));
    if (subject === undefined) {
      const names = SUBJECTS.map((entry) => entry.name).join(', ');
      throw new Error(`unknown subject "${options.subject}". Available: ${names}`);
    }
    await renderSubject(subject, options, false);
  }
} else {
  console.log('usage: npx tsx scripts/render-svg.ts --subject=<name> [--view=<name>] [--out=file]');
  console.log('       npx tsx scripts/render-svg.ts --list');
  console.log('       npx tsx scripts/render-svg.ts --all [--out-dir=svg]');
}
