/**
 * Gate: every mob's health bar clears its solid art, and its aggro `!` clears
 * the art and the bar. The bar is isolated by diffing two health levels; the
 * mark by diffing `render` against `paintBodyAt`.
 *
 *   npx tsx scripts/gates-aggro-mark.ts --png=preview/aggro-mark.png
 */

import { createCanvas, type Canvas } from 'canvas';

import type { Mob } from '../src/creatures/Mob.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

await loadGameSpritesInNode();

/** The game's clock, held still, so two draws of one pose differ by the overlay alone. */
let clockMs = 0;
Object.defineProperty(performance, 'now', { value: () => clockMs, configurable: true });

const { TILE_SIZE } = await import('../src/core/constants.js');
const { HP_BAR_HEIGHT } = await import('../src/Player.js');
const { beginFigureFrame, figureRowInkPending } =
  await import('../src/sprites/figure/figureFrameCache.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { getMercenaryTemplate } = await import('../src/core/mercenaryTemplates.js');
const { BallOfSwine } = await import('../src/creatures/BallOfSwine.js');
const { BrindleGrub } = await import('../src/creatures/BrindleGrub.js');
const { Bugaboo } = await import('../src/creatures/Bugaboo.js');
const { CircusLemur } = await import('../src/creatures/CircusLemur.js');
const { CityElfCultist } = await import('../src/creatures/CityElfCultist.js');
const { Cockroach } = await import('../src/creatures/Cockroach.js');
const { Cow } = await import('../src/creatures/Cow.js');
const { DarkKnight } = await import('../src/creatures/DarkKnight.js');
const { EvilClown } = await import('../src/creatures/EvilClown.js');
const { FatClown } = await import('../src/creatures/FatClown.js');
const { FireFairy } = await import('../src/creatures/fairies/FireFairy.js');
const { Goblin } = await import('../src/creatures/Goblin.js');
const { GoblinArcher } = await import('../src/creatures/GoblinArcher.js');
const { GraveBull } = await import('../src/creatures/GraveBull.js');
const { GrotesqueSpider } = await import('../src/creatures/GrotesqueSpider.js');
const { HeatherTheBear } = await import('../src/creatures/HeatherTheBear.js');
const { Juicer } = await import('../src/creatures/Juicer.js');
const { KrakarenClone } = await import('../src/creatures/KrakarenClone.js');
const { KrakarenTentacle } = await import('../src/creatures/KrakarenTentacle.js');
const { Krasue } = await import('../src/creatures/Krasue.js');
const { Llama } = await import('../src/creatures/Llama.js');
const { MantisCrony } = await import('../src/creatures/MantisCrony.js');
const { Mantid } = await import('../src/creatures/Mantid.js');
const { Mercenary } = await import('../src/creatures/Mercenary.js');
const { MissQuill } = await import('../src/creatures/MissQuill.js');
const { MoldLion } = await import('../src/creatures/MoldLion.js');
const { Mongo } = await import('../src/creatures/Mongo.js');
const { Necromancer } = await import('../src/creatures/Necromancer.js');
const { RaisedRatkin } = await import('../src/creatures/RaisedRatkin.js');
const { Rat } = await import('../src/creatures/Rat.js');
const { RatkinSoldier } = await import('../src/creatures/RatkinSoldier.js');
const { Remex } = await import('../src/creatures/Remex.js');
const { RockGolem } = await import('../src/creatures/RockGolem.js');
const { RuinsGhoul } = await import('../src/creatures/RuinsGhoul.js');
const { Signet } = await import('../src/creatures/Signet.js');
const { SkeletonArcher } = await import('../src/creatures/SkeletonArcher.js');
const { SkeletonLord } = await import('../src/creatures/SkeletonLord.js');
const { SkeletonWarrior } = await import('../src/creatures/SkeletonWarrior.js');
const { SkyFowl } = await import('../src/creatures/SkyFowl.js');
const { SmallSpider } = await import('../src/creatures/SmallSpider.js');
const { StiltClown } = await import('../src/creatures/StiltClown.js');
const { TerrorTheClown } = await import('../src/creatures/TerrorTheClown.js');
const { TheHoarder } = await import('../src/creatures/TheHoarder.js');
const { TheLich } = await import('../src/creatures/TheLich.js');
const { Troglodyte } = await import('../src/creatures/Troglodyte.js');
const { Tuskling } = await import('../src/creatures/Tuskling.js');

// ── Layout ───────────────────────────────────────────────────────────────────

/** Room for the Krakaren's triple-scale mantle and a bar over it. */
const CELL_WIDTH_TILES = 8;
const CELL_HEIGHT_TILES = 9;
const SUBJECT_TILE_COL = 3.5;
const SUBJECT_TILE_ROW = 7;
const CELL_W = CELL_WIDTH_TILES * TILE_SIZE;
const CELL_H = CELL_HEIGHT_TILES * TILE_SIZE;
const SUBJECT_SX = SUBJECT_TILE_COL * TILE_SIZE;
const SUBJECT_SY = SUBJECT_TILE_ROW * TILE_SIZE;
const WORLD_TILE = 20;
const WORLD_X = WORLD_TILE * TILE_SIZE;
const WORLD_Y = WORLD_TILE * TILE_SIZE;
const TILE_LEFT = SUBJECT_SX;
const TILE_RIGHT = SUBJECT_SX + TILE_SIZE;

// ── Sampling ─────────────────────────────────────────────────────────────────

/** Idle loops run at 6–9 fps and none outlasts a couple of seconds. */
const IDLE_SAMPLE_STEP_MS = 120;
const IDLE_SAMPLE_SPAN_MS = 2400;
const WALK_FRAME_STEP = 0.75;
const WALK_FRAME_SPAN = 12;

/** Past the fade, so the bar is fully opaque. */
const BAR_SHOWING_FRAMES = 10_000;
/** Above the bar's colour thresholds, so only its right-hand columns change. */
const LOWERED_HP_FRACTION = 0.6;
const BAR_PROBE_LEFT = TILE_LEFT + Math.ceil(TILE_SIZE * LOWERED_HP_FRACTION) + 1;

/** Below this, a difference is edge antialiasing rather than overlay ink. */
const OVERLAY_INK_DIFF = 96;
/** A glow or spore cloud may wash under the overlays; only solid art may not. */
const SOLID_ART_ALPHA = 128;
const MIN_GAP_PX = 1;

const RGBA = 4;
const ALPHA = 3;
const OPAQUE = 255;

// ── Subjects ─────────────────────────────────────────────────────────────────

interface Subject {
  readonly label: string;
  readonly mob: Mob;
  readonly marked: boolean;
}

/** A fairy's mark keys off having a target rather than `isAggro`. */
function provoke(mob: Mob, label: string): Subject {
  Reflect.set(mob, 'isAggro', true);
  mob.currentTarget = mob;
  return { label, mob, marked: true };
}

function unmarked(mob: Mob, label: string): Subject {
  return { label, mob, marked: false };
}

function grubAt(stage: InstanceType<typeof BrindleGrub>['stage'], label: string): Subject {
  const grub = new BrindleGrub(WORLD_TILE, WORLD_TILE, TILE_SIZE);
  grub.stage = stage;
  return unmarked(grub, label);
}

/** A tentacle is built underground, where it draws only the floor breaking. */
function surfaced(tentacle: InstanceType<typeof KrakarenTentacle>): Mob {
  Reflect.set(tentacle, 'state', 'idle');
  return tentacle;
}

const MONGO_STAGE_LEVELS = [1, 5, 10] as const;

function subjects(): Subject[] {
  const at = [WORLD_TILE, WORLD_TILE, TILE_SIZE] as const;
  const owner = new CatPlayer(...at);
  const mercenaries = (
    [
      'sledge',
      'bomo',
      'dong_quixote',
      'splash_zone',
      'gluteus_maxx',
      'bucket_boy',
      'tumbledown',
    ] as const
  ).map((id) =>
    unmarked(
      new Mercenary(...at, owner, id, getMercenaryTemplate(id).name),
      `hireling ${getMercenaryTemplate(id).name}`,
    ),
  );
  const mongos = MONGO_STAGE_LEVELS.map((level) => {
    const probe = new Mongo(...at, owner, level, 1);
    return unmarked(new Mongo(...at, owner, level, probe.maxHp), `Mongo L${level}`);
  });
  return [
    provoke(new Rat(...at), 'rat'),
    provoke(new Goblin(...at, 'warhammer'), 'goblin (warhammer)'),
    provoke(new GoblinArcher(...at), 'goblin archer'),
    provoke(new SkeletonWarrior(...at), 'skeleton warrior'),
    provoke(new SkeletonArcher(...at), 'skeleton archer'),
    provoke(new SkeletonLord(...at), 'skeleton lord'),
    provoke(new TheLich(...at), 'the Lich'),
    provoke(new DarkKnight(...at), 'dark knight'),
    provoke(new RockGolem(...at), 'rock golem'),
    provoke(new Llama(...at), 'llama'),
    provoke(new Bugaboo(...at), 'bugaboo'),
    provoke(new MantisCrony(...at), 'mantis crony'),
    provoke(new Mantid(...at), 'mantid'),
    provoke(new GraveBull(...at), 'grave bull'),
    provoke(new RaisedRatkin(...at, 'shroud'), 'raised ratkin'),
    provoke(new FatClown(...at), 'fat clown'),
    provoke(new EvilClown(...at), 'evil clown'),
    provoke(new StiltClown(...at), 'stilt clown'),
    provoke(new TerrorTheClown(...at), 'Terror the Clown'),
    provoke(new Signet(...at, () => undefined), 'Signet'),
    provoke(new FireFairy(...at), 'fire fairy'),
    provoke(new CityElfCultist(...at), 'elf cultist'),
    provoke(new RuinsGhoul(...at), 'ruins ghoul'),
    provoke(new CircusLemur(...at), 'circus lemur'),
    provoke(new Krasue(...at), 'krasue'),
    provoke(new MoldLion(...at), 'mold lion'),
    provoke(new HeatherTheBear(...at), 'Heather the Bear'),
    unmarked(new RatkinSoldier(...at, 'sedge'), 'ratkin soldier'),
    unmarked(new Troglodyte(...at), 'troglodyte'),
    unmarked(new Cockroach(...at), 'cockroach'),
    grubAt(1, 'brindle grub'),
    grubAt(2, 'cow-tailed grub'),
    grubAt(3, 'brindled vespa'),
    unmarked(new Remex(...at), 'remex'),
    unmarked(new SkyFowl(...at), 'skyfowl'),
    unmarked(new Tuskling(...at), 'tuskling'),
    unmarked(new TheHoarder(...at), 'the Hoarder'),
    unmarked(new SmallSpider(...at), 'small spider'),
    unmarked(new GrotesqueSpider(...at), 'grotesque spider'),
    unmarked(new MissQuill(...at, () => undefined), 'Miss Quill'),
    unmarked(new Necromancer(...at), 'necromancer'),
    unmarked(new Juicer(...at), 'the Juicer'),
    unmarked(new BallOfSwine(...at), 'Ball of Swine'),
    unmarked(new KrakarenClone(...at), 'Krakaren'),
    unmarked(surfaced(new KrakarenTentacle(...at)), 'Krakaren tentacle'),
    unmarked(new Cow(...at, 'holstein', 'adult', () => 0), 'cow'),
    ...mongos,
    ...mercenaries,
  ];
}

// ── Drawing ──────────────────────────────────────────────────────────────────

interface Pose {
  readonly label: string;
  readonly ms: number;
  readonly moving: boolean;
  readonly walkFrame: number;
}

function poses(): Pose[] {
  const found: Pose[] = [];
  for (let ms = 0; ms < IDLE_SAMPLE_SPAN_MS; ms += IDLE_SAMPLE_STEP_MS) {
    found.push({ label: `idle @${ms}ms`, ms, moving: false, walkFrame: 0 });
  }
  for (let walkFrame = 0; walkFrame < WALK_FRAME_SPAN; walkFrame += WALK_FRAME_STEP) {
    found.push({ label: `walk frame ${walkFrame}`, ms: 0, moving: true, walkFrame });
  }
  return found;
}

type Chrome = 'body' | 'noBar' | 'bar' | 'barLowered';

function drawPose(subject: Subject, pose: Pose, chrome: Chrome): Canvas {
  const { mob } = subject;
  clockMs = pose.ms;
  Reflect.set(mob, 'isMoving', pose.moving);
  Reflect.set(mob, 'walkFrame', pose.walkFrame);
  mob.healthBarTimer = chrome === 'bar' || chrome === 'barLowered' ? BAR_SHOWING_FRAMES : 0;
  const fullHp = mob.maxHp;
  mob.hp = chrome === 'barLowered' ? Math.ceil(fullHp * LOWERED_HP_FRACTION) : fullHp;
  const canvas = createCanvas(CELL_W, CELL_H);
  const ctx = asGameContext(canvas.getContext('2d'));
  if (chrome === 'body') {
    mob.paintBodyAt(ctx, SUBJECT_SX, SUBJECT_SY, TILE_SIZE);
  } else {
    mob.render(ctx, WORLD_X - SUBJECT_SX, WORLD_Y - SUBJECT_SY, TILE_SIZE);
  }
  mob.hp = fullHp;
  mob.healthBarTimer = 0;
  return canvas;
}

function pixelsOf(canvas: Canvas): Uint8ClampedArray {
  return canvas.getContext('2d').getImageData(0, 0, CELL_W, CELL_H).data;
}

// ── Measurement ──────────────────────────────────────────────────────────────

function solidArtTop(canvas: Canvas): number {
  const data = pixelsOf(canvas);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      if (data[(y * CELL_W + x) * RGBA + ALPHA] > SOLID_ART_ALPHA) return y;
    }
  }
  return CELL_H;
}

/** A channel weighted by its pixel's alpha, so a faint glow over empty cell does not read as ink. */
function premultiplied(data: Uint8ClampedArray, pixel: number, channel: number): number {
  if (channel === ALPHA) return data[pixel + ALPHA];
  return (data[pixel + channel] * data[pixel + ALPHA]) / OPAQUE;
}

function diffRows(a: Canvas, b: Canvas, left: number, right: number): number[] {
  const pa = pixelsOf(a);
  const pb = pixelsOf(b);
  const rows: number[] = [];
  for (let y = 0; y < CELL_H; y++) {
    rowScan: for (let x = left; x < right; x++) {
      const i = (y * CELL_W + x) * RGBA;
      for (let c = 0; c < RGBA; c++) {
        if (Math.abs(premultiplied(pa, i, c) - premultiplied(pb, i, c)) > OVERLAY_INK_DIFF) {
          rows.push(y);
          break rowScan;
        }
      }
    }
  }
  return rows;
}

const SETTLE_FRAME_LIMIT = 2000;

function settleRowMeasurements(): void {
  for (let frame = 0; frame < SETTLE_FRAME_LIMIT && figureRowInkPending() > 0; frame++) {
    beginFigureFrame();
  }
}

interface Span {
  readonly top: number;
  readonly bottom: number;
}

interface PoseResult {
  readonly pose: Pose;
  readonly spriteTop: number;
  readonly bar: Span | null;
  readonly markBottomNoBar: number | null;
  readonly markBottomOverBar: number | null;
}

function spanOf(rows: readonly number[]): Span | null {
  if (rows.length === 0) return null;
  return { top: rows[0], bottom: rows[rows.length - 1] };
}

function measurePose(subject: Subject, pose: Pose): PoseResult {
  const body = drawPose(subject, pose, 'body');
  const withBar = drawPose(subject, pose, 'bar');
  const bar = spanOf(
    diffRows(withBar, drawPose(subject, pose, 'barLowered'), BAR_PROBE_LEFT, TILE_RIGHT),
  );
  let markBottomNoBar: number | null = null;
  let markBottomOverBar: number | null = null;
  if (subject.marked) {
    markBottomNoBar =
      spanOf(diffRows(drawPose(subject, pose, 'noBar'), body, TILE_LEFT, TILE_RIGHT))?.bottom ??
      null;
    const overBarRows = diffRows(withBar, body, TILE_LEFT, TILE_RIGHT).filter(
      (row) => bar === null || row < bar.top || row > bar.bottom,
    );
    markBottomOverBar = spanOf(overBarRows)?.bottom ?? null;
  }
  return { pose, spriteTop: solidArtTop(body), bar, markBottomNoBar, markBottomOverBar };
}

function clearRows(overlayBottom: number, belowTop: number): number {
  return belowTop - (overlayBottom + 1);
}

function poseFailures(subject: Subject, result: PoseResult): Map<string, string> {
  const failures = new Map<string, string>();
  if (result.bar === null) {
    failures.set('no health bar drawn', '');
  } else {
    const barGap = clearRows(result.bar.bottom, result.spriteTop);
    if (barGap < MIN_GAP_PX)
      failures.set('the health bar overlaps the art', `${MIN_GAP_PX - barGap}px`);
    const barRows = result.bar.bottom - result.bar.top + 1;
    if (barRows > HP_BAR_HEIGHT) {
      failures.set(`the health bar smears past ${HP_BAR_HEIGHT} rows`, `${barRows} rows`);
    }
  }
  if (!subject.marked) return failures;
  if (result.markBottomNoBar === null) {
    failures.set('no aggro mark drawn', '');
  } else {
    const markGap = clearRows(result.markBottomNoBar, result.spriteTop);
    if (markGap < MIN_GAP_PX)
      failures.set('the mark overlaps the art', `${MIN_GAP_PX - markGap}px`);
  }
  if (result.bar !== null && result.markBottomOverBar !== null) {
    const stackGap = clearRows(result.markBottomOverBar, result.bar.top);
    if (stackGap < MIN_GAP_PX) {
      failures.set('the mark overlaps the health bar', `${MIN_GAP_PX - stackGap}px`);
    }
  }
  return failures;
}

function tightestGap(result: PoseResult): number {
  const gaps: number[] = [];
  if (result.bar !== null) {
    gaps.push(clearRows(result.bar.bottom, result.spriteTop));
    if (result.markBottomOverBar !== null) {
      gaps.push(clearRows(result.markBottomOverBar, result.bar.top));
    }
  }
  if (result.markBottomNoBar !== null) {
    gaps.push(clearRows(result.markBottomNoBar, result.spriteTop));
  }
  return gaps.length === 0 ? -Infinity : Math.min(...gaps);
}

interface Measured {
  readonly subject: Subject;
  readonly worst: PoseResult;
  readonly failures: readonly string[];
}

function measure(subject: Subject): Measured {
  const allPoses = poses();
  const failures: string[] = [];
  // An unmeasured row's stand-in line is what a mob's first frame on screen draws.
  const cold = measurePose(subject, allPoses[0]);
  for (const [kind, by] of poseFailures(subject, cold)) {
    failures.push(`before its row is measured, ${kind} ${by}`);
  }
  for (const pose of allPoses) drawPose(subject, pose, 'bar');
  settleRowMeasurements();
  let worst = measurePose(subject, allPoses[0]);
  const firstMiss = new Map<string, { by: string; pose: string; poses: number }>();
  for (const pose of allPoses) {
    const result = measurePose(subject, pose);
    for (const [kind, by] of poseFailures(subject, result)) {
      const seen = firstMiss.get(kind);
      if (seen === undefined) firstMiss.set(kind, { by, pose: pose.label, poses: 1 });
      else seen.poses++;
    }
    if (tightestGap(result) < tightestGap(worst)) worst = result;
  }
  for (const [kind, miss] of firstMiss) {
    failures.push(`${kind} ${miss.by} (${miss.pose}; ${miss.poses} of ${allPoses.length} poses)`);
  }
  return { subject, worst, failures };
}

// ── Review sheet ─────────────────────────────────────────────────────────────

const SHEET_COLUMNS = 8;
const SHEET_ZOOM = 1.5;
const LABEL_H = 16;
const BACKDROP = '#3a3833';
const FLOOR = '#5d574e';
const SPRITE_TOP_LINE = 'rgba(80,220,255,0.9)';
const BAR_BOTTOM_LINE = 'rgba(255,220,60,0.9)';
const MARK_BOTTOM_LINE = 'rgba(255,70,70,0.9)';
const LABEL_COLOR = '#ece6da';
const FAIL_LABEL_COLOR = '#ff8a7a';
const LABEL_FONT = '11px sans-serif';
const LABEL_INSET_PX = 2;
const LABEL_BASELINE_LIFT_PX = 4;

function renderSheet(results: readonly Measured[]): Canvas {
  const cellW = CELL_W * SHEET_ZOOM;
  const cellH = CELL_H * SHEET_ZOOM;
  const rows = Math.ceil(results.length / SHEET_COLUMNS);
  const columns = Math.min(SHEET_COLUMNS, results.length);
  const sheet = createCanvas(cellW * columns, (cellH + LABEL_H) * rows);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.imageSmoothingEnabled = false;
  const lineAt = (x: number, y: number, row: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y + row * SHEET_ZOOM, cellW, 1);
  };
  results.forEach((result, index) => {
    const x = (index % SHEET_COLUMNS) * cellW;
    const y = Math.floor(index / SHEET_COLUMNS) * (cellH + LABEL_H);
    const cell = createCanvas(CELL_W, CELL_H);
    const cellCtx = cell.getContext('2d');
    cellCtx.fillStyle = FLOOR;
    cellCtx.fillRect(0, 0, CELL_W, CELL_H);
    cellCtx.drawImage(drawPose(result.subject, result.worst.pose, 'bar'), 0, 0);
    ctx.drawImage(cell, x, y, cellW, cellH);
    const { worst } = result;
    lineAt(x, y, worst.spriteTop, SPRITE_TOP_LINE);
    if (worst.bar !== null) lineAt(x, y, worst.bar.bottom + 1, BAR_BOTTOM_LINE);
    if (worst.markBottomOverBar !== null) {
      lineAt(x, y, worst.markBottomOverBar + 1, MARK_BOTTOM_LINE);
    }
    ctx.fillStyle = result.failures.length > 0 ? FAIL_LABEL_COLOR : LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(
      result.subject.label,
      x + LABEL_INSET_PX,
      y + cellH + LABEL_H - LABEL_BASELINE_LIFT_PX,
    );
  });
  return sheet;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const results = subjects().map(measure);

const REPORT_LABEL_WIDTH = 22;
const REPORT_NUMBER_WIDTH = 3;
const pad = (value: number | null | undefined): string =>
  String(value ?? '-').padStart(REPORT_NUMBER_WIDTH);
const failures: string[] = [];
for (const result of results) {
  const { worst } = result;
  const label = result.subject.label.padEnd(REPORT_LABEL_WIDTH);
  console.log(
    `${label} art top ${pad(worst.spriteTop)}  bar ${pad(worst.bar?.top)}–${pad(worst.bar?.bottom)}` +
      `  mark bottom ${pad(worst.markBottomOverBar)} (no bar ${pad(worst.markBottomNoBar)})` +
      `  tightest gap ${tightestGap(worst)}  (${worst.pose.label})`,
  );
  for (const failure of result.failures) failures.push(`${result.subject.label}: ${failure}`);
}

const pngFlag = process.argv.find((arg) => arg.startsWith('--png='));
if (pngFlag !== undefined) {
  const requested = pngFlag.slice('--png='.length);
  const out = requested.length > 0 ? requested : `${PREVIEW_DIR}/aggro-mark.png`;
  console.log(`sheet: ${writePreviewPng(out, renderSheet(results).toBuffer('image/png'))}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} overhead failure(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `\nAll ${results.length} mobs hang their health bar and aggro mark clear of their art.`,
);
