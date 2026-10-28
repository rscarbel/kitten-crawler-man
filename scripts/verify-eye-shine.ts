/**
 * Gate: every creature's eye-shine sits on its head.
 *
 *   npm run verify:eye-shine
 *   npx tsx scripts/verify-eye-shine.ts --png=preview/eye-shine.png
 *
 * In the dungeon's dark a hostile shows two glints where `Mob.eyeShineAnchor`
 * says its eyes are. Each creature declares that through `Mob.eyePlacement`,
 * which is abstract so a new creature cannot compile without deciding. This
 * gate holds each decision to the art: every concrete `Mob` subclass under
 * `src/creatures/` is found by scanning the modules, so a new creature fails
 * here until it is given a subject below, and every subject is drawn facing
 * each way and its glints judged against the body it actually painted.
 *
 * Every subject is drawn at twelve facings: the four compass points, four
 * leaning a little off straight up or down, and four diagonals.
 * - Wherever its art shows its face, the glints are shown, inside the body's
 *   box, within {@link HEAD_SHARE_OF_LENGTH} of its head end (its top, or for
 *   a crawler drawn from above the end it leads with), inside the head end's
 *   width in an upright profile, and on painted body rather than air.
 * - Showing its back, none are shown; art turned to its facing never does.
 * - A subject declared eyeless shows none whichever way it faces.
 * - Two mirrored facings that draw the identical body put the glints in the
 *   same place: a face-on view its painter never flips must not have eyes
 *   that lean with the facing.
 *
 * The checks run against deliberately wrong creatures they must catch, so a
 * check that has stopped being able to fail turns the gate red. `--png` writes
 * a contact sheet of every subject with its glints and a tenth-of-a-tile grid
 * from its tile's top-left, which is also how a new placement is measured.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, type Canvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import type { EyePlacement } from '../src/sprites/eyePlacement.js';

await loadGameSpritesInNode();

/** The clock idle loops are drawn at, held still so two facings of one pose can be compared. */
const FROZEN_CLOCK_MS = 1000;
Object.defineProperty(performance, 'now', { value: () => FROZEN_CLOCK_MS, configurable: true });

const { TILE_SIZE } = await import('../src/core/constants.js');
const { Mob } = await import('../src/creatures/Mob.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { getMercenaryTemplate, MERCENARY_TEMPLATE_IDS } =
  await import('../src/core/party/mercenaryTemplates.js');
const { SOLDIER_IDS } = await import('../src/core/quests/villagerIds.js');
const { BallOfSwine } = await import('../src/creatures/BallOfSwine.js');
const { BrindleGrub } = await import('../src/creatures/BrindleGrub.js');
const { Bugaboo } = await import('../src/creatures/Bugaboo.js');
const { Lemur } = await import('../src/creatures/Lemur.js');
const { CityElfCultist } = await import('../src/creatures/CityElfCultist.js');
const { Cockroach } = await import('../src/creatures/Cockroach.js');
const { Cow } = await import('../src/creatures/Cow.js');
const { AttackCow } = await import('../src/creatures/AttackCow.js');
const { DarkKnight } = await import('../src/creatures/DarkKnight.js');
const { EvilClown } = await import('../src/creatures/EvilClown.js');
const { FatClown } = await import('../src/creatures/FatClown.js');
const { FireFairy } = await import('../src/creatures/fairies/FireFairy.js');
const { HealingFairy } = await import('../src/creatures/fairies/HealingFairy.js');
const { IceFairy } = await import('../src/creatures/fairies/IceFairy.js');
const { NecroFairy } = await import('../src/creatures/fairies/NecroFairy.js');
const { ShieldFairy } = await import('../src/creatures/fairies/ShieldFairy.js');
const { Goblin } = await import('../src/creatures/Goblin.js');
const { BathroomGoblin } = await import('../src/creatures/BathroomGoblin.js');
const { PrisonGoblin } = await import('../src/creatures/PrisonGoblin.js');
const { PrisonerGoblin } = await import('../src/creatures/PrisonerGoblin.js');
const { PrisonCellDoor } = await import('../src/creatures/PrisonCellDoor.js');
const { GoblinArcher } = await import('../src/creatures/GoblinArcher.js');
const { GoblinDynamiter } = await import('../src/creatures/GoblinDynamiter.js');
const { GoblinBombardier } = await import('../src/creatures/GoblinBombardier.js');
const { GraveBull } = await import('../src/creatures/GraveBull.js');
const { GrotesqueSpider } = await import('../src/creatures/GrotesqueSpider.js');
const { Baggi } = await import('../src/creatures/Baggi.js');
const { DireBear } = await import('../src/creatures/DireBear.js');
const { BigRooster } = await import('../src/creatures/BigRooster.js');
const { KrakarenClone } = await import('../src/creatures/KrakarenClone.js');
const { KrakarenTentacle } = await import('../src/creatures/KrakarenTentacle.js');
const { Krasue } = await import('../src/creatures/Krasue.js');
const { LittleRooster } = await import('../src/creatures/LittleRooster.js');
const { Llama } = await import('../src/creatures/Llama.js');
const { Mantid } = await import('../src/creatures/Mantid.js');
const { MantisCrony } = await import('../src/creatures/MantisCrony.js');
const { MazeBellTarget } = await import('../src/creatures/MazeBellTarget.js');
const { MazeBlockTarget } = await import('../src/creatures/MazeBlockTarget.js');
const { MazeMirrorTarget } = await import('../src/creatures/MazeMirrorTarget.js');
const { Mercenary } = await import('../src/creatures/Mercenary.js');
const { MissQuill } = await import('../src/creatures/MissQuill.js');
const { Lion } = await import('../src/creatures/Lion.js');
const { Deinonychus } = await import('../src/creatures/Deinonychus.js');
const { Necromancer } = await import('../src/creatures/Necromancer.js');
const { RaisedRatkin } = await import('../src/creatures/RaisedRatkin.js');
const { Rat } = await import('../src/creatures/Rat.js');
const { RatkinSoldier } = await import('../src/creatures/RatkinSoldier.js');
const { Remex } = await import('../src/creatures/Remex.js');
const { RockGolem } = await import('../src/creatures/RockGolem.js');
const { RockGolemBoss } = await import('../src/creatures/RockGolemBoss.js');
const { RuinsGhoul } = await import('../src/creatures/RuinsGhoul.js');
const { Shady } = await import('../src/creatures/Shady.js');
const { ShrineVermin } = await import('../src/creatures/ShrineVermin.js');
const { SkeletonArcher } = await import('../src/creatures/SkeletonArcher.js');
const { SkeletonLord } = await import('../src/creatures/SkeletonLord.js');
const { SkeletonWarrior } = await import('../src/creatures/SkeletonWarrior.js');
const { Hawkfolk, HAWKFOLK_TOUGH_FAMILY } = await import('../src/creatures/Hawkfolk.js');
const { SlightlyBentRooster } = await import('../src/creatures/SlightlyBentRooster.js');
const { SmallSpider } = await import('../src/creatures/SmallSpider.js');
const { SpiderEgg } = await import('../src/creatures/SpiderEgg.js');
const { SpiderHatchling } = await import('../src/creatures/SpiderHatchling.js');
const { TallClown } = await import('../src/creatures/TallClown.js');
const { MassiveClown } = await import('../src/creatures/MassiveClown.js');
const { TrashGremlin } = await import('../src/creatures/TrashGremlin.js');
const { TheLich } = await import('../src/creatures/TheLich.js');
const { Troglodyte } = await import('../src/creatures/Troglodyte.js');
const { Tuskling } = await import('../src/creatures/Tuskling.js');
const { TutorialGoblin } = await import('../src/creatures/TutorialGoblin.js');
const { useDevPlayerIdentity } = await import('../src/dev/devPlayerIdentity.js');
useDevPlayerIdentity();

type MobInstance = InstanceType<typeof Mob>;

// ── Subjects ─────────────────────────────────────────────────────────────────

/**
 * Where a creature's head is on the body it draws, which is what its glints
 * are judged against:
 * - `upright`: at the top, whichever way it faces.
 * - `fromAbove`: a crawler drawn from above, leading with its head the way it
 *   faces, so head down the screen facing the camera.
 * - `profileOnly`: a long body drawn only in profile, head at the end it faces;
 *   facing the camera it shows its rightward profile.
 * - `faceMidBody`: a pillar with its face set halfway up, under a crown.
 * - `turnsToFace`: drawn from above and turned to any facing, head always on
 *   show at the end it faces.
 */
type HeadEnd = 'upright' | 'fromAbove' | 'profileOnly' | 'faceMidBody' | 'turnsToFace';

/** One creature in one state, and whether it should show eyes at all. */
interface Subject {
  readonly label: string;
  readonly mob: MobInstance;
  readonly eyeless: boolean;
  readonly headEnd: HeadEnd;
}

const SUBJECT_TILE = 6;
const at = [SUBJECT_TILE, SUBJECT_TILE, TILE_SIZE] as const;

function eyed(label: string, mob: MobInstance, headEnd: HeadEnd = 'upright'): Subject {
  return { label, mob, eyeless: false, headEnd };
}

function eyeless(label: string, mob: MobInstance): Subject {
  return { label, mob, eyeless: true, headEnd: 'upright' };
}

const GOBLIN_WEAPONS = ['sword', 'axe', 'mace', 'warhammer'] as const;
const RAISED_RATKIN_LOOKS = ['smock', 'jack', 'shroud'] as const;
const COW_AGES = ['adult', 'calf'] as const;
/** The Deinonychus levels at which his figure changes stage. */
const DEINONYCHUS_FIRST_STAGE_LEVEL = 1;
const DEINONYCHUS_SECOND_STAGE_LEVEL = 5;
const DEINONYCHUS_THIRD_STAGE_LEVEL = 10;
const DEINONYCHUS_STAGE_LEVELS = [
  DEINONYCHUS_FIRST_STAGE_LEVEL,
  DEINONYCHUS_SECOND_STAGE_LEVEL,
  DEINONYCHUS_THIRD_STAGE_LEVEL,
] as const;
const MERCENARY_IDS = MERCENARY_TEMPLATE_IDS;
const MAZE_BLOCK_KINDS = ['sandbag', 'brace', 'release_ring', 'capstan'] as const;
const MAZE_MIRROR_KINDS = ['pivot_mirror', 'swivel_mirror'] as const;
const BRINDLED_VESPA_STAGE = 3;
const BROOD_BOUNDS_TILES = 8;
const NECROMANCER_FACE_HEIGHT = -1.3;
const NEGATIVE_EYE_SPACING = 0.08;
const NEGATIVE_FRONT_ACROSS = -0.07;
const TILE_MIDDLE = 0.5;

function grubAt(stage: InstanceType<typeof BrindleGrub>['stage']): MobInstance {
  const grub = new BrindleGrub(...at);
  grub.stage = stage;
  return grub;
}

function risingSkeleton(): MobInstance {
  const skeleton = new SkeletonWarrior(...at);
  skeleton.beginRising();
  return skeleton;
}

function bugabooBreakingIn(): MobInstance {
  const bugaboo = new Bugaboo(...at);
  bugaboo.isBreakingIn = true;
  return bugaboo;
}

/** A tentacle is built underground, where it draws only the floor breaking. */
function surfacedTentacle(): MobInstance {
  const tentacle = new KrakarenTentacle(...at);
  Reflect.set(tentacle, 'state', 'idle');
  return tentacle;
}

function mazeMirror(kind: (typeof MAZE_MIRROR_KINDS)[number]): MobInstance {
  return new MazeMirrorTarget(TILE_SIZE, {
    id: kind,
    kind,
    tile: { x: SUBJECT_TILE, y: SUBJECT_TILE },
    cycle: ['NE', 'SE'],
    initialIndex: 0,
  });
}

/** The floor the attack cow is built for; her look is the same on every floor. */
const ATTACK_COW_EYE_FLOOR = 3;

/**
 * How to build every concrete creature, keyed by its class name, in each
 * state that draws it differently. A class found under `src/creatures/`
 * without an entry here fails the gate.
 */
const SUBJECTS: Readonly<Record<string, () => readonly Subject[]>> = {
  AttackCow: () => [
    eyed('attack cow', new AttackCow(...at, new CatPlayer(...at), ATTACK_COW_EYE_FLOOR, null)),
  ],
  Baggi: () => [eyed('Baggi', new Baggi(...at))],
  BallOfSwine: () => [eyeless('Ball of Swine', new BallOfSwine(...at))],
  BrindleGrub: () => [
    eyeless('brindle grub', grubAt(1)),
    eyeless('cow-tailed grub', grubAt(2)),
    eyed('brindled vespa', grubAt(BRINDLED_VESPA_STAGE)),
  ],
  Bugaboo: () => [
    eyed('bugaboo', new Bugaboo(...at)),
    eyeless('bugaboo breaking in', bugabooBreakingIn()),
  ],
  Lemur: () => [eyed('lemur', new Lemur(...at), 'profileOnly')],
  CityElfCultist: () => [eyed('elf cultist', new CityElfCultist(...at))],
  Cockroach: () => [eyed('cockroach', new Cockroach(...at), 'fromAbove')],
  Cow: () => COW_AGES.map((age) => eyed(`cow ${age}`, new Cow(...at, 'holstein', age, () => 0))),
  DarkKnight: () => [eyed('dark knight', new DarkKnight(...at))],
  EvilClown: () => [eyed('evil clown', new EvilClown(...at))],
  FatClown: () => [eyed('fat clown', new FatClown(...at))],
  FireFairy: () => [eyed('fire fairy', new FireFairy(...at))],
  HealingFairy: () => [eyed('healing fairy', new HealingFairy(...at))],
  IceFairy: () => [eyed('ice fairy', new IceFairy(...at))],
  NecroFairy: () => [eyed('necro fairy', new NecroFairy(...at))],
  ShieldFairy: () => [eyed('shield fairy', new ShieldFairy(...at))],
  Goblin: () => GOBLIN_WEAPONS.map((weapon) => eyed(`goblin ${weapon}`, new Goblin(...at, weapon))),
  BathroomGoblin: () => [
    eyed('bathroom goblin in line', new BathroomGoblin(...at, 'queue', 1, 'sword')),
    eyed('bathroom goblin with a bow', new BathroomGoblin(...at, 'queue', 1, 'bow')),
    eyed('bathroom plumber', new BathroomGoblin(...at, 'plumber', 1, 'sword')),
  ],
  PrisonGoblin: () => [
    eyed('prison gate guard', new PrisonGoblin(...at, 'gateGuard', 1)),
    eyed('prison patrol guard', new PrisonGoblin(...at, 'patrol', 1)),
  ],
  PrisonerGoblin: () => [eyed('goblin prisoner', new PrisonerGoblin(...at, 1))],
  PrisonCellDoor: () => [eyeless('prison cell door', new PrisonCellDoor(...at, 'across'))],
  GoblinArcher: () => [eyed('goblin archer', new GoblinArcher(...at))],
  GoblinDynamiter: () => [eyed('dynamite goblin', new GoblinDynamiter(...at))],
  GoblinBombardier: () => [eyed('black powder goblin', new GoblinBombardier(...at))],
  GraveBull: () => [eyed('grave bull', new GraveBull(...at))],
  GrotesqueSpider: () => [eyed('grotesque spider', new GrotesqueSpider(...at), 'turnsToFace')],
  DireBear: () => [eyed('dire bear', new DireBear(...at))],
  BigRooster: () => [eyed('Big Rooster', new BigRooster(...at))],
  KrakarenClone: () => [eyeless('Krakaren', new KrakarenClone(...at))],
  KrakarenTentacle: () => [
    eyeless('Krakaren tentacle buried', new KrakarenTentacle(...at)),
    eyeless('Krakaren tentacle', surfacedTentacle()),
  ],
  Krasue: () => [eyed('krasue', new Krasue(...at))],
  LittleRooster: () => [eyed('Little Rooster', new LittleRooster(...at))],
  Llama: () => [eyed('llama', new Llama(...at))],
  Mantid: () => [eyed('mantid', new Mantid(...at))],
  MantisCrony: () => [eyed('mantis crony', new MantisCrony(...at))],
  MazeBellTarget: () => [eyeless('maze bell', new MazeBellTarget(...at, 'bell'))],
  MazeBlockTarget: () =>
    MAZE_BLOCK_KINDS.map((kind) =>
      eyeless(`maze ${kind}`, new MazeBlockTarget(...at, kind, 'east')),
    ),
  MazeMirrorTarget: () =>
    MAZE_MIRROR_KINDS.map((kind) => eyeless(`maze ${kind}`, mazeMirror(kind))),
  Mercenary: () => {
    const owner = new CatPlayer(...at);
    return MERCENARY_IDS.map((id) =>
      eyed(`hireling ${id}`, new Mercenary(...at, owner, id, getMercenaryTemplate(id).name)),
    );
  },
  MissQuill: () => [eyed('Miss Quill', new MissQuill(...at, () => undefined))],
  Lion: () => [eyed('lion', new Lion(...at))],
  Deinonychus: () => {
    const owner = new CatPlayer(...at);
    return DEINONYCHUS_STAGE_LEVELS.map((level) => {
      const probe = new Deinonychus(...at, owner, level, 1);
      return eyed(`Deinonychus L${level}`, new Deinonychus(...at, owner, level, probe.maxHp));
    });
  },
  Necromancer: () => [eyed('necromancer', new Necromancer(...at, Math.random))],
  RaisedRatkin: () =>
    RAISED_RATKIN_LOOKS.map((look) => eyed(`raised ratkin ${look}`, new RaisedRatkin(...at, look))),
  Rat: () => [eyed('rat', new Rat(...at))],
  RatkinSoldier: () =>
    SOLDIER_IDS.map((id) => eyed(`ratkin soldier ${id}`, new RatkinSoldier(...at, id))),
  Remex: () => [eyed('remex', new Remex(...at), 'faceMidBody')],
  RockGolem: () => [eyed('rock golem', new RockGolem(...at))],
  RockGolemBoss: () => [eyed('rock golem boss', new RockGolemBoss(...at))],
  RuinsGhoul: () => [eyed('ruins ghoul', new RuinsGhoul(...at))],
  Shady: () => [eyed('Shady', new Shady(...at))],
  ShrineVermin: () => [eyed('shrine vermin', new ShrineVermin(...at))],
  SkeletonArcher: () => [eyed('skeleton archer', new SkeletonArcher(...at))],
  SkeletonLord: () => [eyed('skeleton lord', new SkeletonLord(...at))],
  SkeletonWarrior: () => [
    eyed('skeleton warrior', new SkeletonWarrior(...at)),
    eyeless('skeleton warrior rising', risingSkeleton()),
  ],
  Hawkfolk: () => [eyed('hawkfolk', new Hawkfolk(...at, HAWKFOLK_TOUGH_FAMILY.canonical))],
  SlightlyBentRooster: () => [eyed('Slightly Bent Rooster', new SlightlyBentRooster(...at))],
  SmallSpider: () => [eyed('small spider', new SmallSpider(...at), 'turnsToFace')],
  SpiderEgg: () => [eyeless('spider egg', new SpiderEgg(...at))],
  SpiderHatchling: () => [
    eyed(
      'spider hatchling',
      new SpiderHatchling(...at, {
        x: 0,
        y: 0,
        w: BROOD_BOUNDS_TILES * TILE_SIZE,
        h: BROOD_BOUNDS_TILES * TILE_SIZE,
      }),
      'turnsToFace',
    ),
  ],
  TallClown: () => [eyed('tall clown', new TallClown(...at))],
  MassiveClown: () => [eyed('Massive Clown', new MassiveClown(...at))],
  TrashGremlin: () => [eyed('the Trash Gremlin', new TrashGremlin(...at))],
  TheLich: () => [eyed('the Lich', new TheLich(...at))],
  Troglodyte: () => [eyed('troglodyte', new Troglodyte(...at))],
  Tuskling: () => [eyed('tuskling', new Tuskling(...at))],
  TutorialGoblin: () => [eyed('tutorial goblin', new TutorialGoblin(...at))],
};

// ── Discovery ────────────────────────────────────────────────────────────────

const CREATURES_DIR = resolve('src/creatures');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Every concrete `Mob` subclass exported from a module under `src/creatures/`. */
async function concreteCreatureClasses(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(CREATURES_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (!/\bextends\b/.test(source)) continue;
    const abstractNames = new Set(
      [...source.matchAll(/abstract class (\w+)/g)].map((match) => match[1]),
    );
    const imported: unknown = await import(pathToFileURL(file).href);
    if (typeof imported !== 'object' || imported === null) continue;
    const module: object = imported;
    for (const [name, value] of Object.entries(module)) {
      if (typeof value !== 'function' || value === Mob) continue;
      if (!Object.prototype.isPrototypeOf.call(Mob, value)) continue;
      if (abstractNames.has(name)) continue;
      found.set(name, relative(process.cwd(), file));
    }
  }
  return found;
}

// ── Measuring ────────────────────────────────────────────────────────────────

interface Facing {
  readonly x: number;
  readonly y: number;
  readonly name: string;
}

/** How far off straight a near-vertical facing leans: it still picks the face-on or back view. */
const LEAN = 0.3;
/** A diagonal facing, a hair past 45° so the axis it picks is never a tie. */
const DIAGONAL_ACROSS = 0.7;
const DIAGONAL_ALONG = 0.71;

const FACINGS: readonly Facing[] = [
  { x: 1, y: 0, name: 'right' },
  { x: -1, y: 0, name: 'left' },
  { x: 0, y: 1, name: 'toward' },
  { x: 0, y: -1, name: 'away' },
  { x: LEAN, y: 1, name: 'toward-right' },
  { x: -LEAN, y: 1, name: 'toward-left' },
  { x: LEAN, y: -1, name: 'away-right' },
  { x: -LEAN, y: -1, name: 'away-left' },
  { x: DIAGONAL_ACROSS, y: DIAGONAL_ALONG, name: 'down-right' },
  { x: -DIAGONAL_ACROSS, y: DIAGONAL_ALONG, name: 'down-left' },
  { x: DIAGONAL_ACROSS, y: -DIAGONAL_ALONG, name: 'up-right' },
  { x: -DIAGONAL_ACROSS, y: -DIAGONAL_ALONG, name: 'up-left' },
];

/**
 * Facings that mirror each other. Where a creature draws the same body for
 * both — a face-on view its painter never flips — its glints must not move
 * either, however its placement says it leans.
 */
const MIRROR_PAIRS: readonly (readonly [string, string])[] = [
  ['right', 'left'],
  ['toward-right', 'toward-left'],
  ['down-right', 'down-left'],
];
/** How far apart, in sheet pixels, two glints on an identical drawing may land. */
const SAME_DRAWING_GLINT_SLACK_PX = 0.5;

function isSideView(facing: Facing): boolean {
  return Math.abs(facing.x) >= Math.abs(facing.y);
}

function isAwayView(facing: Facing): boolean {
  return facing.y < 0 && !isSideView(facing);
}

/** Pixels per world pixel the subject is drawn at, so a small head spans enough pixels to find. */
const DRAW_SCALE = 3;
/** Tiles of canvas round the subject's tile, for art that reaches past it: the tallest is near three tiles. */
const MARGIN_TILES = 3;
const CANVAS_TILES = 1 + MARGIN_TILES * 2;
const CANVAS_PX = CANVAS_TILES * TILE_SIZE * DRAW_SCALE;
const RGBA = 4;
const ALPHA = 3;
/** Alpha above which a pixel is the creature's body rather than a soft shadow or glow. */
const BODY_ALPHA = 160;
/** How far from the head end of the drawn body the eyes may sit, as a share of its length. */
const HEAD_SHARE_OF_LENGTH = 0.45;
/**
 * How far from its leading end a crawler drawn from above may carry its eyes:
 * its legs and antennae splay out past its head, so its box runs further.
 */
const FROM_ABOVE_HEAD_SHARE = 0.55;
/** How far down a `faceMidBody` pillar its face may sit, as a share of its height. */
const MID_BODY_FACE_SHARE = 0.55;
/**
 * The top share of the drawn body whose width a profile's eyes are judged
 * against: the head end, above a weapon or a bow held out in front.
 */
const HEAD_ROWS_SHARE = 0.3;
/** How far outside a profile's head end the eyes may sit, as a share of its width. */
const PROFILE_BACK_SLACK = 0.05;
/** How near painted body the glints must be, in tiles: on a face, not in the air beside it. */
const ON_BODY_REACH_TILES = 0.12;

interface Drawn {
  readonly canvas: Canvas;
  readonly data: Uint8ClampedArray;
  readonly camX: number;
  readonly camY: number;
}

function draw(mob: MobInstance, facing: Facing): Drawn {
  mob.facingX = facing.x;
  mob.facingY = facing.y;
  mob.isMoving = false;
  const canvas = createCanvas(CANVAS_PX, CANVAS_PX);
  const ctx = canvas.getContext('2d');
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  const camX = mob.x - MARGIN_TILES * TILE_SIZE;
  const camY = mob.y - MARGIN_TILES * TILE_SIZE;
  mob.paintBodyAt(asGameContext(ctx), mob.x - camX, mob.y - camY, TILE_SIZE);
  return { canvas, data: ctx.getImageData(0, 0, CANVAS_PX, CANVAS_PX).data, camX, camY };
}

function isBody(drawn: Drawn, px: number, py: number): boolean {
  if (px < 0 || py < 0 || px >= CANVAS_PX || py >= CANVAS_PX) return false;
  return drawn.data[(py * CANVAS_PX + px) * RGBA + ALPHA] >= BODY_ALPHA;
}

interface BodyBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly headLeft: number;
  readonly headRight: number;
}

/** The box round the drawn body, in canvas pixels, or null when nothing was drawn. */
function bodyBox(drawn: Drawn): BodyBox | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < CANVAS_PX; y++) {
    for (let x = 0; x < CANVAS_PX; x++) {
      if (!isBody(drawn, x, y)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (left > right) return null;
  const headBottom = top + (bottom - top) * HEAD_ROWS_SHARE;
  let headLeft = Infinity;
  let headRight = -Infinity;
  for (let y = top; y <= headBottom; y++) {
    for (let x = left; x <= right; x++) {
      if (!isBody(drawn, x, y)) continue;
      headLeft = Math.min(headLeft, x);
      headRight = Math.max(headRight, x);
    }
  }
  return { left, top, right, bottom, headLeft, headRight };
}

function nearBody(drawn: Drawn, px: number, py: number): boolean {
  const reach = Math.ceil(ON_BODY_REACH_TILES * TILE_SIZE * DRAW_SCALE);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > reach * reach) continue;
      if (isBody(drawn, Math.round(px) + dx, Math.round(py) + dy)) return true;
    }
  }
  return false;
}

interface Glints {
  readonly x: number;
  readonly y: number;
  readonly spacing: number;
}

/** The subject's glints in canvas pixels, or null when it shows none. */
function glintsOn(drawn: Drawn, mob: MobInstance): Glints | null {
  const eyes = { x: 0, y: 0, spacingPx: 0 };
  if (!mob.eyeShineAnchor(eyes)) return null;
  return {
    x: (eyes.x - drawn.camX) * DRAW_SCALE,
    y: (eyes.y - drawn.camY) * DRAW_SCALE,
    spacing: eyes.spacingPx * DRAW_SCALE,
  };
}

/**
 * How far the glints sit from the end of the body the head is at, as a share
 * of the body's length along that axis; see {@link HeadEnd}.
 */
function headDepthShare(headEnd: HeadEnd, box: BodyBox, glints: Glints, facing: Facing): number {
  const height = box.bottom - box.top;
  const width = box.right - box.left;
  const fromTop = (glints.y - box.top) / height;
  const fromRight = (box.right - glints.x) / width;
  const fromLeft = (glints.x - box.left) / width;
  if (headEnd === 'upright' || headEnd === 'faceMidBody') return fromTop;
  if (headEnd === 'turnsToFace') return leadingDepthShare(box, glints, facing);
  if (isSideView(facing) || headEnd === 'profileOnly') return facing.x < 0 ? fromLeft : fromRight;
  return (box.bottom - glints.y) / height;
}

/** How far behind the box's leading edge the glints sit, along the facing itself. */
function leadingDepthShare(box: BodyBox, glints: Glints, facing: Facing): number {
  const length = Math.hypot(facing.x, facing.y);
  const along = (x: number, y: number): number => (x * facing.x + y * facing.y) / length;
  const corners = [
    along(box.left, box.top),
    along(box.right, box.top),
    along(box.left, box.bottom),
    along(box.right, box.bottom),
  ];
  const lead = Math.max(...corners);
  const trail = Math.min(...corners);
  return (lead - along(glints.x, glints.y)) / (lead - trail);
}

function headShareAllowed(headEnd: HeadEnd): number {
  if (headEnd === 'faceMidBody') return MID_BODY_FACE_SHARE;
  if (headEnd === 'fromAbove' || headEnd === 'turnsToFace') return FROM_ABOVE_HEAD_SHARE;
  return HEAD_SHARE_OF_LENGTH;
}

/** What is wrong with a subject's glints at one facing, or null when nothing is. */
function glintError(
  subject: Subject,
  drawn: Drawn,
  glints: Glints | null,
  facing: Facing,
): string | null {
  const away = isAwayView(facing) && subject.headEnd !== 'turnsToFace';
  if (subject.eyeless) return glints === null ? null : 'eyes shown on a creature declared eyeless';
  if (away) return glints === null ? null : 'eyes shown while facing away';
  if (glints === null) return 'no eyes while facing the camera';
  const box = bodyBox(drawn);
  if (box === null) return 'nothing drawn';
  if (glints.x < box.left || glints.x > box.right || glints.y < box.top || glints.y > box.bottom) {
    return 'eyes off the body';
  }
  if (headDepthShare(subject.headEnd, box, glints, facing) > headShareAllowed(subject.headEnd)) {
    return 'eyes far from the head end of the body';
  }
  if (subject.headEnd === 'upright' && isSideView(facing)) {
    const slack = (box.headRight - box.headLeft) * PROFILE_BACK_SLACK;
    if (glints.x < box.headLeft - slack || glints.x > box.headRight + slack) {
      return 'eyes beside the head end, not on it';
    }
  }
  if (!nearBody(drawn, glints.x, glints.y)) return 'eyes in empty air, not on painted body';
  return null;
}

// ── Contact sheet ────────────────────────────────────────────────────────────

const LABEL_HEIGHT = 18;
/** Where a cell's label sits: inset from the cell's left edge, and up from the label band's bottom. */
const LABEL_INSET_X = 4;
const LABEL_BASELINE_LIFT = 5;
const BACKDROP = '#3b3b40';
const TILE_GUIDE = 'rgba(120,220,255,0.7)';
const GRID_TENTH = 'rgba(255,255,255,0.08)';
const GRID_HALF = 'rgba(255,255,255,0.22)';
const GLINT = 'rgba(255,40,40,0.95)';
const FAIL_TINT = 'rgba(255,0,0,0.18)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
const GRID_STEPS_PER_TILE = 10;
const HALF_TILE_STEPS = 5;
const GLINT_RADIUS = 2;
const HALF = 0.5;

interface Cell {
  readonly label: string;
  readonly facing: string;
  readonly error: string | null;
  readonly drawn: Drawn;
  readonly glints: Glints | null;
  readonly failed: boolean;
}

function writeSheet(path: string, rows: readonly (readonly Cell[])[]): void {
  const rowHeight = CANVAS_PX + LABEL_HEIGHT;
  const sheet = createCanvas(CANVAS_PX * FACINGS.length, rowHeight * rows.length);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const tilePx = TILE_SIZE * DRAW_SCALE;
  const tileOrigin = MARGIN_TILES * tilePx;
  rows.forEach((row, rowIndex) => {
    const top = rowIndex * rowHeight;
    row.forEach((cell, column) => {
      const left = column * CANVAS_PX;
      ctx.save();
      ctx.translate(left, top + LABEL_HEIGHT);
      if (cell.failed) {
        ctx.fillStyle = FAIL_TINT;
        ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
      }
      for (let step = 0; step <= CANVAS_TILES * GRID_STEPS_PER_TILE; step++) {
        const offset = (step * tilePx) / GRID_STEPS_PER_TILE;
        ctx.strokeStyle = step % HALF_TILE_STEPS === 0 ? GRID_HALF : GRID_TENTH;
        ctx.beginPath();
        ctx.moveTo(offset, 0);
        ctx.lineTo(offset, CANVAS_PX);
        ctx.moveTo(0, offset);
        ctx.lineTo(CANVAS_PX, offset);
        ctx.stroke();
      }
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(tileOrigin, tileOrigin, tilePx, tilePx);
      ctx.drawImage(cell.drawn.canvas, 0, 0);
      const glints = cell.glints;
      if (glints !== null) {
        ctx.fillStyle = GLINT;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(glints.x + side * glints.spacing * HALF, glints.y, GLINT_RADIUS, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = LABEL_FONT;
      ctx.fillText(
        `${cell.label} ${FACINGS[column].name}`,
        left + LABEL_INSET_X,
        top + LABEL_HEIGHT - LABEL_BASELINE_LIFT,
      );
    });
  });
  console.log(`contact sheet: ${writePreviewPng(path, sheet.toBuffer('image/png'))}`);
}

// ── Run ──────────────────────────────────────────────────────────────────────

const failures: string[] = [];

function checkOne(subject: Subject, facing: Facing): Cell {
  let error: string | null;
  let drawn: Drawn;
  let glints: Glints | null = null;
  try {
    drawn = draw(subject.mob, facing);
    glints = glintsOn(drawn, subject.mob);
    error = glintError(subject, drawn, glints, facing);
  } catch (thrown) {
    drawn = {
      canvas: createCanvas(CANVAS_PX, CANVAS_PX),
      data: new Uint8ClampedArray(),
      camX: 0,
      camY: 0,
    };
    error = `threw: ${String(thrown)}`;
  }
  return {
    label: subject.label,
    facing: facing.name,
    drawn,
    glints,
    failed: error !== null,
    error,
  };
}

function sameDrawing(a: Drawn, b: Drawn): boolean {
  if (a.data.length !== b.data.length) return false;
  return a.data.every((value, index) => value === b.data[index]);
}

/** Pairs of mirrored facings that draw one body yet put the glints in two places. */
function mirrorErrors(cells: readonly Cell[]): string[] {
  const errors: string[] = [];
  for (const [first, second] of MIRROR_PAIRS) {
    const a = cells.find((cell) => cell.facing === first);
    const b = cells.find((cell) => cell.facing === second);
    if (a === undefined || b === undefined || !sameDrawing(a.drawn, b.drawn)) continue;
    const moved =
      a.glints === null || b.glints === null
        ? a.glints !== b.glints
        : Math.abs(a.glints.x - b.glints.x) > SAME_DRAWING_GLINT_SLACK_PX ||
          Math.abs(a.glints.y - b.glints.y) > SAME_DRAWING_GLINT_SLACK_PX;
    if (moved) errors.push(`facing ${first} and ${second} draw the same body but move its eyes`);
  }
  return errors;
}

function check(subject: Subject): Cell[] {
  const cells = FACINGS.map((facing) => checkOne(subject, facing));
  for (const cell of cells) {
    if (cell.error !== null) failures.push(`${subject.label} facing ${cell.facing}: ${cell.error}`);
  }
  for (const error of mirrorErrors(cells)) failures.push(`${subject.label}: ${error}`);
  return cells;
}

/** A skeleton handed eyes a third of the way down its tile: by its shins, under a skull nearly a tile higher. */
class ShinHighEyesSkeleton extends SkeletonWarrior {
  protected override get standingEyePlacement() {
    return {
      sideForward: 0,
      sideHeight: 0.3,
      sideSpacing: 0.06,
      frontMirrors: false,
      frontAcross: 0,
      frontHeight: 0.3,
      frontSpacing: 0.16,
    };
  }
}

/** A necromancer whose eyes lean with its facing although its face-on view never flips. */
class MirroredEyesNecromancer extends Necromancer {
  protected override get eyePlacement(): EyePlacement {
    return {
      sideForward: 0,
      sideHeight: NECROMANCER_FACE_HEIGHT,
      sideSpacing: NEGATIVE_EYE_SPACING,
      frontMirrors: true,
      frontAcross: NEGATIVE_FRONT_ACROSS,
      frontHeight: NECROMANCER_FACE_HEIGHT,
      frontSpacing: NEGATIVE_EYE_SPACING,
    };
  }
}

/** A spider given fixed views, so its eyes stay put while its body turns. */
class FixedViewSpider extends SmallSpider {
  protected override get eyePlacement(): EyePlacement {
    return {
      sideForward: 0,
      sideHeight: TILE_MIDDLE,
      sideSpacing: NEGATIVE_EYE_SPACING,
      frontMirrors: false,
      frontAcross: 0,
      frontHeight: TILE_MIDDLE,
      frontSpacing: NEGATIVE_EYE_SPACING,
    };
  }
}

function negativeTests(): void {
  const mirrored = eyed(
    'negative: mirrored necromancer',
    new MirroredEyesNecromancer(...at, Math.random),
  );
  if (mirrorErrors(FACINGS.map((facing) => checkOne(mirrored, facing))).length === 0) {
    failures.push('negative test: eyes leaning on a face-on view that never flips went unnoticed');
  }
  const fixed = eyed('negative: fixed-view spider', new FixedViewSpider(...at), 'turnsToFace');
  if (
    FACINGS.every((facing) => {
      const drawn = draw(fixed.mob, facing);
      return glintError(fixed, drawn, glintsOn(drawn, fixed.mob), facing) === null;
    })
  ) {
    failures.push("negative test: a turning spider's eyes left behind went unnoticed");
  }
  const shinHigh = eyed('negative: shin-high skeleton', new ShinHighEyesSkeleton(...at));
  if (
    FACINGS.every(
      (facing) =>
        glintError(
          shinHigh,
          draw(shinHigh.mob, facing),
          glintsOn(draw(shinHigh.mob, facing), shinHigh.mob),
          facing,
        ) === null,
    )
  ) {
    failures.push("negative test: eyes by a skeleton's shins went unnoticed");
  }
  const goblin = eyeless('negative: goblin declared eyeless', new Goblin(...at, 'mace'));
  const toward = FACINGS[2];
  const drawn = draw(goblin.mob, toward);
  if (glintError(goblin, drawn, glintsOn(drawn, goblin.mob), toward) === null) {
    failures.push('negative test: eyes on a creature declared eyeless went unnoticed');
  }
}

const classes = await concreteCreatureClasses();
for (const [name, file] of classes) {
  if (!(name in SUBJECTS)) failures.push(`${name} (${file}) has no subject in this gate`);
}
for (const name of Object.keys(SUBJECTS)) {
  if (!classes.has(name))
    failures.push(`subject ${name} names no concrete creature under src/creatures/`);
}

const only = (process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) ?? '')
  .split(',')
  .filter((name) => name.length > 0);
const rows: Cell[][] = [];
let subjectCount = 0;
for (const [name, build] of Object.entries(SUBJECTS)) {
  if (only.length > 0 && !only.includes(name)) continue;
  let subjects: readonly Subject[];
  try {
    subjects = build();
  } catch (thrown) {
    failures.push(`${name} could not be built: ${String(thrown)}`);
    continue;
  }
  for (const subject of subjects) {
    rows.push(check(subject));
    subjectCount++;
  }
}
try {
  negativeTests();
} catch (thrown) {
  failures.push(`negative tests threw: ${String(thrown)}`);
}

/** Rows per sheet: a whole roster in one image is past what a canvas or a reviewer can take. */
const ROWS_PER_SHEET = 6;

const pngFlag = process.argv.find((arg) => arg.startsWith('--png='));
if (pngFlag !== undefined) {
  const base = (pngFlag.slice('--png='.length) || `${PREVIEW_DIR}/eye-shine.png`).replace(
    /\.png$/,
    '',
  );
  for (let first = 0; first < rows.length; first += ROWS_PER_SHEET) {
    const page = first / ROWS_PER_SHEET;
    writeSheet(`${base}-${page}.png`, rows.slice(first, first + ROWS_PER_SHEET));
  }
}

console.log(`${classes.size} creature classes, ${subjectCount} subjects checked`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`FAIL ${failure}`);
  process.exit(1);
}
console.log("eye-shine: every creature's eyes sit on its head");
