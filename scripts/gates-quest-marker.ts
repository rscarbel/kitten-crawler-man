/**
 * Gate and review sheet for the overhead quest `!`/`?`: its lowest pixel, at
 * the bottom of its bounce, must sit clear above the highest pixel its wearer
 * ever paints across the row it is standing in.
 *
 * Every subject is the real thing drawn through its own render method — a
 * `Townsperson`, a `QuestNPC`, a Briar Hollow `Villager` — so the anchor under
 * test is the one each call site actually computes, not a copy of it. The
 * marker is isolated by drawing the same subject at the same instant twice,
 * once with a marker and once without, and diffing: whatever changed is the
 * marker. The sprite's own top is read off the marker-free draw, sampled
 * across its idle loop so a bob or an ear flick at the loop's peak counts.
 *
 *   npx tsx scripts/gates-quest-marker.ts
 *   npx tsx scripts/gates-quest-marker.ts --png=preview/quest-marker.png
 */

import { createCanvas, type Canvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

await loadGameSpritesInNode();

/**
 * The game's clock, held still. Every sprite and the marker's bounce read
 * `performance.now()`, so pinning it is what lets two draws of one subject
 * differ by the marker alone.
 */
let clockMs = 0;
Object.defineProperty(performance, 'now', { value: () => clockMs, configurable: true });

const { TILE_SIZE } = await import('../src/core/constants.js');
const { EMPTY_ALPHA_CUTOFF } = await import('../src/core/spriteFrames.js');
const { beginFigureFrame, figureRowInkPending } =
  await import('../src/sprites/figure/figureFrameCache.js');
const { setQuestBeaconViewer } = await import('../src/sprites/questBeacon.js');
const { QuestNPC } = await import('../src/creatures/QuestNPC.js');
const { Townsperson } = await import('../src/creatures/Townsperson.js');
const { Shady } = await import('../src/creatures/Shady.js');
const { GumGum } = await import('../src/creatures/GumGum.js');
const { Signet } = await import('../src/creatures/Signet.js');
const { Cow } = await import('../src/creatures/Cow.js');
const { Rat } = await import('../src/creatures/Rat.js');
const { ShrineVermin } = await import('../src/creatures/ShrineVermin.js');
const { Mantid } = await import('../src/creatures/Mantid.js');
const { drawMantidSprite } = await import('../src/sprites/mantidSprite.js');
const { Villager } = await import('../src/systems/briarHollow/Villager.js');
const { VILLAGER_ROUTINES } = await import('../src/systems/briarHollow/villagerRoutines.js');
const { RecruiterNPC } = await import('../src/systems/briarHollow/RecruiterSystem.js');
const { FortuneTellerProp } = await import('../src/systems/TownPropSystem.js');
const { TOWN_CAST_LOOKS } = await import('../src/sprites/person/townCastLooks.js');
const { SKYFOWL_CIVILIAN_LOOKS } = await import('../src/sprites/art/skyfowl/cast.js');

// ── Layout ───────────────────────────────────────────────────────────────────

/** Each subject's cell, in tiles: room for a two-tile mantis and a marker over it. */
const CELL_WIDTH_TILES = 3;
const CELL_HEIGHT_TILES = 5;
/** Where the subject's own tile sits inside its cell, in tiles from the cell's top-left. */
const SUBJECT_TILE_COL = 1;
const SUBJECT_TILE_ROW = 3.5;
const CELL_W = CELL_WIDTH_TILES * TILE_SIZE;
const CELL_H = CELL_HEIGHT_TILES * TILE_SIZE;
/** The subject's tile in world tiles: far enough from the origin that nothing clamps it. */
const WORLD_TILE = 20;

// ── Sampling ─────────────────────────────────────────────────────────────────

/** Mirrors `drawQuestMarker`'s bounce: `sin(t * 3)`, so a full bounce every 2π/3 s. */
const MARKER_BOUNCE_RADIANS_PER_SECOND = 3;
const MS_PER_SECOND = 1000;
/** sin peaks at a quarter turn: the marker's lowest point. */
const QUARTER_TURN = Math.PI / 2;
const THREE_QUARTER_TURN = QUARTER_TURN + Math.PI;
const MARKER_LOWEST_MS = (QUARTER_TURN / MARKER_BOUNCE_RADIANS_PER_SECOND) * MS_PER_SECOND;
const MARKER_HIGHEST_MS = (THREE_QUARTER_TURN / MARKER_BOUNCE_RADIANS_PER_SECOND) * MS_PER_SECOND;
/**
 * The idle loops run at 6–9 fps and none is longer than a couple of seconds, so
 * a 40 ms step over four seconds lands on every frame of every one.
 */
const SPRITE_SAMPLE_STEP_MS = 40;
const SPRITE_SAMPLE_SPAN_MS = 4000;
/**
 * A channel difference past which a pixel counts as the glyph or its outline
 * rather than the soft glow around it. The glow is meant to wash over the
 * head; the letterform is what must not.
 */
const MARKER_INK_DIFF = 96;

/** The least clear air the gate accepts between the glyph and the head under it. */
const MIN_GAP_PX = 1;
/**
 * The most it accepts. A marker must read as worn by the NPC, not as a sign
 * floating over the street; any subject past this is being lifted by guesswork.
 */
const MAX_GAP_PX = 10;

const RGBA = 4;
const ALPHA = 3;

// ── Subjects ─────────────────────────────────────────────────────────────────

interface Subject {
  readonly label: string;
  /** Draws the subject with its tile's top-left at screen (`sx`, `sy`). */
  readonly draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, marked: boolean) => void;
}

const WORLD_X = WORLD_TILE * TILE_SIZE;
const WORLD_Y = WORLD_TILE * TILE_SIZE;
const TILE_POINT = { x: WORLD_TILE, y: WORLD_TILE };

/** The camera that puts the world tile at (`sx`, `sy`) on screen. */
function cameraFor(sx: number, sy: number): { camX: number; camY: number } {
  return { camX: WORLD_X - sx, camY: WORLD_Y - sy };
}

/**
 * One seed per look, so every face the town can wear gets checked: the cast
 * is a closed set, and a hat or a crest that pokes above the rest is exactly
 * the look a hand-picked sample would miss.
 */
function everyCitizenSubject(): Subject[] {
  const found = new Map<string, Subject>();
  const wanted = TOWN_CAST_LOOKS.length + SKYFOWL_CIVILIAN_LOOKS.length;
  const roles = [...new Set(TOWN_CAST_LOOKS.flatMap((look) => look.roles))];
  const SEED_SEARCH_LIMIT = 20000;
  for (let seed = 1; seed < SEED_SEARCH_LIMIT && found.size < wanted; seed++) {
    for (const species of ['human', 'skyfowl'] as const) {
      for (const role of roles) {
        const person = new Townsperson({
          x: WORLD_X,
          y: WORLD_Y,
          role,
          species,
          seed,
          speed: 0,
          wander: {
            pickTarget: () => ({ x: WORLD_X, y: WORLD_Y }),
            arriveDist: 1,
            pauseMin: 1,
            pauseMax: 2,
          },
          initialFacing: 'down',
        });
        const key = `${species}:${person.figure.look.id}`;
        if (found.has(key)) continue;
        found.set(key, {
          label: key,
          draw(ctx, sx, sy, marked) {
            person.markerType = marked ? 'exclamation' : 'none';
            const { camX, camY } = cameraFor(sx, sy);
            person.render(ctx, camX, camY, TILE_SIZE);
          },
        });
      }
    }
  }
  return [...found.values()];
}

function mobSubject(
  label: string,
  mob: { render(ctx: CanvasRenderingContext2D, camX: number, camY: number, ts: number): void },
  setMarked: (marked: boolean) => void,
  after?: (ctx: CanvasRenderingContext2D, camX: number, camY: number) => void,
): Subject {
  return {
    label,
    draw(ctx, sx, sy, marked) {
      setMarked(marked);
      const { camX, camY } = cameraFor(sx, sy);
      mob.render(ctx, camX, camY, TILE_SIZE);
      after?.(ctx, camX, camY);
    },
  };
}

function namedSubjects(): Subject[] {
  const mother = new QuestNPC(WORLD_TILE, WORLD_TILE, 'gate');
  const shady = new Shady(WORLD_TILE, WORLD_TILE, TILE_SIZE);
  const gumGum = new GumGum(WORLD_TILE, WORLD_TILE, TILE_SIZE);
  const signet = new Signet(WORLD_TILE, WORLD_TILE, TILE_SIZE, () => undefined);
  const cow = new Cow(WORLD_TILE, WORLD_TILE, TILE_SIZE, 'holstein', 'adult', () => 0);
  const calf = new Cow(WORLD_TILE, WORLD_TILE, TILE_SIZE, 'jersey', 'calf', () => 0);
  const vermin = new ShrineVermin(WORLD_TILE, WORLD_TILE, TILE_SIZE);
  const plainRat = new Rat(WORLD_TILE, WORLD_TILE, TILE_SIZE);
  const mantid = new Mantid(WORLD_TILE, WORLD_TILE, TILE_SIZE);
  Reflect.set(mantid, 'state', 'rage_pause');
  const villager = new Villager(
    'bramblewick',
    VILLAGER_ROUTINES.bramblewick,
    'Bramblewick',
    'gate',
    TILE_POINT,
    TILE_POINT,
    TILE_POINT,
    0,
  );
  villager.state = 'strolling';
  const recruiter = new RecruiterNPC(TILE_POINT);
  const seer = new FortuneTellerProp(TILE_POINT);

  return [
    mobSubject('goblin mother', mother, (m) => (mother.markerType = m ? 'exclamation' : 'none')),
    mobSubject(
      'Shady',
      shady,
      (m) => (shady.markerType = m ? 'exclamation' : 'none'),
      (ctx, camX, camY) => shady.renderMarker(ctx, camX, camY, TILE_SIZE),
    ),
    mobSubject('GumGum', gumGum, (m) => (gumGum.markerType = m ? 'exclamation' : 'none')),
    mobSubject('Signet', signet, (m) => (signet.markerType = m ? 'exclamation' : 'none')),
    mobSubject('cow', cow, (m) => (cow.questMarker = m ? 'exclamation' : 'none')),
    mobSubject('calf', calf, (m) => (calf.questMarker = m ? 'exclamation' : 'none')),
    {
      label: 'shrine vermin',
      draw(ctx, sx, sy, marked) {
        const { camX, camY } = cameraFor(sx, sy);
        (marked ? vermin : plainRat).render(ctx, camX, camY, TILE_SIZE);
      },
    },
    {
      label: 'mantid (rage)',
      draw(ctx, sx, sy, marked) {
        if (!marked) {
          drawMantidSprite(ctx, 'mantid', sx, sy, TILE_SIZE, { isRaging: true });
          return;
        }
        const { camX, camY } = cameraFor(sx, sy);
        mantid.render(ctx, camX, camY, TILE_SIZE);
      },
    },
    {
      label: 'ratkin villager',
      draw(ctx, sx, sy, marked) {
        villager.marker = marked ? 'exclamation' : 'none';
        const { camX, camY } = cameraFor(sx, sy);
        villager.render(ctx, camX, camY, TILE_SIZE);
      },
    },
    {
      label: 'recruiter',
      draw(ctx, sx, sy, marked) {
        recruiter.marker = marked ? 'exclamation' : 'none';
        const { camX, camY } = cameraFor(sx, sy);
        recruiter.render(ctx, camX, camY, TILE_SIZE);
      },
    },
    {
      label: 'fortune teller',
      draw(ctx, sx, sy, marked) {
        seer.markerState = marked ? 'exclamation' : 'none';
        const { camX, camY } = cameraFor(sx, sy);
        seer.render(ctx, camX, camY, TILE_SIZE);
      },
    },
  ];
}

// ── Measurement ──────────────────────────────────────────────────────────────

const SUBJECT_SX = SUBJECT_TILE_COL * TILE_SIZE;
const SUBJECT_SY = SUBJECT_TILE_ROW * TILE_SIZE;

function drawAt(subject: Subject, ms: number, marked: boolean): Canvas {
  clockMs = ms;
  // The beacon fades out at the viewer's feet, so standing the viewer on the
  // subject keeps the column of light out of the diff.
  setQuestBeaconViewer(WORLD_X, WORLD_Y);
  const canvas = createCanvas(CELL_W, CELL_H);
  subject.draw(asGameContext(canvas.getContext('2d')), SUBJECT_SX, SUBJECT_SY, marked);
  return canvas;
}

function pixelsOf(canvas: Canvas): Uint8ClampedArray {
  return canvas.getContext('2d').getImageData(0, 0, CELL_W, CELL_H).data;
}

/** The highest row holding any ink, or `CELL_H` for an empty cell. */
function inkTop(canvas: Canvas): number {
  const data = pixelsOf(canvas);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      if (data[(y * CELL_W + x) * RGBA + ALPHA] > EMPTY_ALPHA_CUTOFF) return y;
    }
  }
  return CELL_H;
}

const OPAQUE = 255;

/**
 * A channel weighted by its pixel's alpha. The readback is unpremultiplied, so
 * a barely-there wisp of glow over empty cell reads as full gold; weighting it
 * is what lets the diff tell the glow from the glyph.
 */
function premultiplied(data: Uint8ClampedArray, pixel: number, channel: number): number {
  if (channel === ALPHA) return data[pixel + ALPHA];
  return (data[pixel + channel] * data[pixel + ALPHA]) / OPAQUE;
}

/** The first and last rows where two draws differ, or null when they are identical. */
function diffRows(changed: Canvas, plain: Canvas): { top: number; bottom: number } | null {
  const a = pixelsOf(changed);
  const b = pixelsOf(plain);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const i = (y * CELL_W + x) * RGBA;
      let differs = false;
      for (let c = 0; c < RGBA && !differs; c++) {
        differs = Math.abs(premultiplied(a, i, c) - premultiplied(b, i, c)) > MARKER_INK_DIFF;
      }
      if (!differs) continue;
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return top < 0 ? null : { top, bottom };
}

/** The lowest row of marker ink at the bottom of the bounce, or -1 when none was drawn. */
function markerBottomOf(subject: Subject): number {
  const rows = diffRows(
    drawAt(subject, MARKER_LOWEST_MS, true),
    drawAt(subject, MARKER_LOWEST_MS, false),
  );
  return rows === null ? -1 : rows.bottom;
}

/**
 * Game frames the harness will tick to let queued row measurements land. Each
 * frame measures what the prewarm budget allows; far more than any row needs.
 */
const SETTLE_FRAME_LIMIT = 2000;

/** Ticks the figure cache's frame until every queued row measurement has landed. */
function settleRowMeasurements(): void {
  for (let frame = 0; frame < SETTLE_FRAME_LIMIT && figureRowInkPending() > 0; frame++) {
    beginFigureFrame();
  }
}

interface Measured {
  readonly subject: Subject;
  readonly spriteTop: number;
  /** Where the marker sits on the first frame, before its row has been measured. */
  readonly coldMarkerBottom: number;
  readonly markerBottom: number;
}

function measure(subject: Subject): Measured {
  const coldMarkerBottom = markerBottomOf(subject);
  settleRowMeasurements();
  let spriteTop = CELL_H;
  for (let ms = 0; ms < SPRITE_SAMPLE_SPAN_MS; ms += SPRITE_SAMPLE_STEP_MS) {
    spriteTop = Math.min(spriteTop, inkTop(drawAt(subject, ms, false)));
  }
  return { subject, spriteTop, coldMarkerBottom, markerBottom: markerBottomOf(subject) };
}

// ── Review sheet ─────────────────────────────────────────────────────────────

const SHEET_ZOOM = 3;
const LABEL_H = 18;
const BACKDROP = '#3a3833';
const FLOOR = '#5d574e';
const SPRITE_TOP_LINE = 'rgba(80,220,255,0.9)';
const MARKER_BOTTOM_LINE = 'rgba(255,70,70,0.9)';
const LABEL_COLOR = '#ece6da';
const LABEL_FONT = '11px sans-serif';
const LABEL_INSET_PX = 2;
const LABEL_BASELINE_LIFT_PX = 5;

/** Subjects per row of the sheet, so it stays legible at a glance. */
const SHEET_COLUMNS = 8;
/** Only the top of each cell holds anything worth reviewing: the head and the marker over it. */
const CROP_TOP_TILES = 1;
const CROP_HEIGHT_TILES = 3.5;

function renderSheet(results: readonly Measured[]): Canvas {
  const cropTop = CROP_TOP_TILES * TILE_SIZE;
  const cropH = CROP_HEIGHT_TILES * TILE_SIZE;
  const cellW = CELL_W * SHEET_ZOOM;
  const cellH = cropH * SHEET_ZOOM;
  const phases = [MARKER_HIGHEST_MS, MARKER_LOWEST_MS];
  const pairW = cellW * phases.length;
  const rows = Math.ceil(results.length / SHEET_COLUMNS);
  const columns = Math.min(SHEET_COLUMNS, results.length);
  const sheet = createCanvas(pairW * columns, (cellH + LABEL_H) * rows);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.imageSmoothingEnabled = false;
  results.forEach((result, index) => {
    const baseX = (index % SHEET_COLUMNS) * pairW;
    const y = Math.floor(index / SHEET_COLUMNS) * (cellH + LABEL_H);
    phases.forEach((ms, phase) => {
      const x = baseX + phase * cellW;
      const cell = createCanvas(CELL_W, CELL_H);
      const cellCtx = cell.getContext('2d');
      cellCtx.fillStyle = FLOOR;
      cellCtx.fillRect(0, 0, CELL_W, CELL_H);
      cellCtx.drawImage(drawAt(result.subject, ms, true), 0, 0);
      ctx.drawImage(cell, 0, cropTop, CELL_W, cropH, x, y, cellW, cellH);
      ctx.fillStyle = SPRITE_TOP_LINE;
      ctx.fillRect(x, y + (result.spriteTop - cropTop) * SHEET_ZOOM, cellW, 1);
      ctx.fillStyle = MARKER_BOTTOM_LINE;
      ctx.fillRect(x, y + (result.markerBottom + 1 - cropTop) * SHEET_ZOOM, cellW, 1);
    });
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(
      result.subject.label,
      baseX + LABEL_INSET_PX,
      y + cellH + LABEL_H - LABEL_BASELINE_LIFT_PX,
    );
  });
  return sheet;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const lineup = namedSubjects();
const citizens = everyCitizenSubject();
const results = [...lineup, ...citizens].map(measure);

const REPORT_LABEL_WIDTH = 36;
const REPORT_NUMBER_WIDTH = 3;
const failures: string[] = [];
for (const result of results) {
  const gap = result.spriteTop - (result.markerBottom + 1);
  const label = result.subject.label.padEnd(REPORT_LABEL_WIDTH);
  const top = String(result.spriteTop).padStart(REPORT_NUMBER_WIDTH);
  const bottom = String(result.markerBottom).padStart(REPORT_NUMBER_WIDTH);
  const line = `${label} sprite top ${top}  marker bottom ${bottom}  gap ${gap}`;
  console.log(line);
  if (result.markerBottom < 0) failures.push(`${result.subject.label}: no marker drawn`);
  else if (gap < MIN_GAP_PX)
    failures.push(`${result.subject.label}: marker overlaps the head by ${MIN_GAP_PX - gap}px`);
  else if (gap > MAX_GAP_PX)
    failures.push(`${result.subject.label}: marker floats ${gap}px above the head`);
  const coldGap = result.spriteTop - (result.coldMarkerBottom + 1);
  if (result.coldMarkerBottom >= 0 && coldGap < MIN_GAP_PX) {
    failures.push(
      `${result.subject.label}: before its row is measured the marker overlaps the head by ` +
        `${MIN_GAP_PX - coldGap}px`,
    );
  }
}

// ── Bubbles over a marked villager ───────────────────────────────────────────

const BARK_LINE = 'The well has gone sour again, and nobody will listen.';

/**
 * A villager wearing a marker and saying something at once: their bark or
 * their "…" is drawn in a pass after every body, and must stand clear above
 * the marker at the top of its bounce rather than across it.
 */
function bubbleClearsMarker(bubble: 'bark' | 'hush'): string | null {
  const speaker = new Villager(
    'bramblewick',
    VILLAGER_ROUTINES.bramblewick,
    'Bramblewick',
    'gate',
    TILE_POINT,
    TILE_POINT,
    TILE_POINT,
    0,
  );
  speaker.state = 'strolling';
  const draw = (marked: boolean, speaking: boolean): Subject => ({
    label: `villager ${bubble}`,
    draw(ctx, sx, sy) {
      speaker.marker = marked ? 'exclamation' : 'none';
      speaker.bark.clear();
      speaker.hushed = false;
      if (speaking && bubble === 'bark') speaker.bark.say(BARK_LINE);
      if (speaking && bubble === 'hush') speaker.hushed = true;
      const { camX, camY } = cameraFor(sx, sy);
      speaker.render(ctx, camX, camY, TILE_SIZE);
      speaker.renderBark(ctx, camX, camY, TILE_SIZE);
    },
  });
  drawAt(draw(true, false), MARKER_HIGHEST_MS, true);
  settleRowMeasurements();
  const marker = diffRows(
    drawAt(draw(true, false), MARKER_HIGHEST_MS, true),
    drawAt(draw(false, false), MARKER_HIGHEST_MS, true),
  );
  const speech = diffRows(
    drawAt(draw(true, true), MARKER_HIGHEST_MS, true),
    drawAt(draw(true, false), MARKER_HIGHEST_MS, true),
  );
  if (marker === null) return `villager ${bubble}: no marker drawn`;
  if (speech === null) return `villager ${bubble}: no bubble drawn`;
  console.log(
    `villager ${bubble.padEnd(REPORT_LABEL_WIDTH - 'villager '.length)} bubble bottom ` +
      `${speech.bottom}  marker top ${marker.top}`,
  );
  if (speech.bottom < marker.top) return null;
  return `villager ${bubble}: the bubble reaches ${speech.bottom - marker.top + 1}px into the marker`;
}

// ── A taller row the marker has not measured yet ─────────────────────────────

/** Where the petting crawler stands: one tile to the cow's side, so it turns side-on. */
const PETTER_OFFSET_TILES = 2;

/**
 * Switches a marked cow from a measured row into one taller and never
 * measured — a pet starts its happy row, whose head toss stands above the idle
 * — and checks the marker on that first frame sits no lower than it does once
 * the row is measured. A stand-in that can be lower than the truth dips the
 * glyph into the head for as long as the measurement takes to land.
 */
function unmeasuredRowStandsInHigh(): string | null {
  const cow = new Cow(WORLD_TILE, WORLD_TILE, TILE_SIZE, 'holstein', 'adult', () => 0);
  const subject: Subject = {
    label: 'cow pet',
    draw(ctx, sx, sy, marked) {
      cow.questMarker = marked ? 'exclamation' : 'none';
      const { camX, camY } = cameraFor(sx, sy);
      cow.render(ctx, camX, camY, TILE_SIZE);
    },
  };
  drawAt(subject, MARKER_LOWEST_MS, true);
  settleRowMeasurements();
  cow.pet({ x: WORLD_X + PETTER_OFFSET_TILES * TILE_SIZE, y: WORLD_Y });
  const coldBottom = markerBottomOf(subject);
  settleRowMeasurements();
  const settledBottom = markerBottomOf(subject);
  console.log(
    `${'cow idle → happy'.padEnd(REPORT_LABEL_WIDTH)} cold marker bottom ${coldBottom}  ` +
      `measured ${settledBottom}`,
  );
  if (coldBottom < 0 || settledBottom < 0) return 'cow idle → happy: no marker drawn';
  if (coldBottom <= settledBottom) return null;
  return (
    `cow idle → happy: before the happy row is measured the marker sits ` +
    `${coldBottom - settledBottom}px lower than it should`
  );
}

const standInFailure = unmeasuredRowStandsInHigh();
if (standInFailure !== null) failures.push(standInFailure);

for (const bubble of ['bark', 'hush'] as const) {
  const failure = bubbleClearsMarker(bubble);
  if (failure !== null) failures.push(failure);
}

const pngFlag = process.argv.find((arg) => arg.startsWith('--png='));
const pngPath =
  pngFlag === undefined ? `${PREVIEW_DIR}/quest-marker.png` : pngFlag.slice('--png='.length);
/** Every named subject, and a sample of the crowd: its looks differ by a pixel or two. */
const CITIZEN_SAMPLE_STRIDE = 6;
const representative = results
  .slice(0, lineup.length)
  .concat(results.slice(lineup.length).filter((_, i) => i % CITIZEN_SAMPLE_STRIDE === 0));
console.log(
  `sheet: ${writePreviewPng(pngPath, renderSheet(representative).toBuffer('image/png'))}`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} quest-marker failure(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`\nquest marker clears the head on all ${results.length} subjects`);
