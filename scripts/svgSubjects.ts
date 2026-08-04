/**
 * Everything `render-svg.ts` knows how to export, and nothing about how the
 * export works.
 *
 * A subject is one character; a view is one pose of it. Adding a character is a
 * single entry: import its draw function and describe the poses worth having as
 * standalone art. The recorder handles the rest.
 *
 * Two calling conventions exist in the codebase and both are supported. Runtime
 * sprites under `src/sprites/` paint into a tile — `(ctx, sx, sy, size, …)` —
 * and take the DOM context. The offline art modules under `scripts/` paint in
 * their own unit space and take node-canvas's context. Each view picks whichever
 * of `targets.dom` / `targets.node` its function is typed against.
 */

import type { CanvasRenderingContext2D as NodeCanvasContext } from 'canvas';

/** Tile edge the figures are drawn against; the SVG auto-crops, so it only sets precision. */
export const SUBJECT_UNIT = 100;

/** Poses that read as "standing still" for sprites whose gait is frame-driven. */
const STILL_FRAME = 0;
const WALK_FRAME = 1.2;
/** Mid-swing of a telegraphed attack, where the pose is most legible. */
const ATTACK_MIDPOINT = 0.5;
const FACING_RIGHT = 1;
const FACING_LEFT = -1;
const FACING_TOWARD_CAMERA = 1;
const FACING_AWAY = -1;
/** An arbitrary but fixed seed, so a re-export of a seeded character is identical. */
const REPEATABLE_SEED = 1;

export interface SvgTargets {
  /** For draw functions typed against the browser's `CanvasRenderingContext2D`. */
  readonly dom: CanvasRenderingContext2D;
  /** For draw functions typed against node-canvas's context. */
  readonly node: NodeCanvasContext;
  /** The tile edge, in SVG units, the figure should be sized against. */
  readonly unit: number;
}

export interface SvgView {
  readonly name: string;
  readonly paint: (targets: SvgTargets) => void;
}

export interface SvgSubject {
  readonly name: string;
  /**
   * Loaded on demand so listing subjects does not import every sprite module.
   * `frame` only matters to sheet-driven subjects, whose poses are a function of
   * the animation frame; the rest ignore it.
   */
  readonly views: (frame: number) => Promise<readonly SvgView[]>;
}

/**
 * The offline art modules paint in a unit-tall space with the feet near the
 * origin, so they need the tile scale applied before the figure exists.
 */
function inUnitSpace(targets: SvgTargets, paint: (ctx: NodeCanvasContext) => void): void {
  targets.node.save();
  targets.node.scale(targets.unit, targets.unit);
  paint(targets.node);
  targets.node.restore();
}

/**
 * Turns a sprite-sheet row table into views — one per row, so every animation
 * the sheet bakes is also exportable as vector art.
 */
function sheetViews<Pose>(
  rows: ReadonlyArray<{
    readonly name: string;
    readonly view: 'front' | 'side' | 'back';
    readonly pose: (frame: number) => Pose;
  }>,
  painters: Record<'front' | 'side' | 'back', (ctx: NodeCanvasContext, pose: Pose) => void>,
  frame: number,
): readonly SvgView[] {
  return rows.map((row) => ({
    name: row.name,
    paint: (targets) => inUnitSpace(targets, (ctx) => painters[row.view](ctx, row.pose(frame))),
  }));
}

export const SUBJECTS: readonly SvgSubject[] = [
  {
    name: 'signet',
    views: async () => {
      const { drawSignetSprite } = await import('../src/sprites/signetSprite.js');
      const pose = {
        walkFrame: STILL_FRAME,
        isMoving: false,
        summonProgress: 0,
        castProgress: 0,
        facingX: FACING_RIGHT,
      };
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawSignetSprite(dom, 0, 0, unit, { ...pose, facingAway: false }),
        },
        {
          name: 'back',
          paint: ({ dom, unit }) =>
            drawSignetSprite(dom, 0, 0, unit, { ...pose, facingAway: true }),
        },
        {
          name: 'walk',
          paint: ({ dom, unit }) =>
            drawSignetSprite(dom, 0, 0, unit, {
              ...pose,
              facingAway: false,
              walkFrame: WALK_FRAME,
              isMoving: true,
            }),
        },
        {
          name: 'cast',
          paint: ({ dom, unit }) =>
            drawSignetSprite(dom, 0, 0, unit, {
              ...pose,
              facingAway: false,
              castProgress: ATTACK_MIDPOINT,
            }),
        },
        {
          name: 'summon',
          paint: ({ dom, unit }) =>
            drawSignetSprite(dom, 0, 0, unit, {
              ...pose,
              facingAway: false,
              summonProgress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
  {
    name: 'carl',
    views: async (frame) => {
      const { drawCarlFront, drawCarlBack, drawCarlSide } = await import('./carlArt.js');
      const { ROWS } = await import('./generate-human-sprite.js');
      return sheetViews(
        ROWS,
        { front: drawCarlFront, back: drawCarlBack, side: drawCarlSide },
        frame,
      );
    },
  },
  {
    name: 'donut',
    views: async (frame) => {
      const { drawCatFront, drawCatBack, drawCatSide } = await import('./catArt.js');
      const { ROWS } = await import('./generate-cat-sprite.js');
      return sheetViews(ROWS, { front: drawCatFront, back: drawCatBack, side: drawCatSide }, frame);
    },
  },
  {
    name: 'bopca',
    views: async () => {
      const { drawBopcaSprite, bopcaPaletteForSeed } =
        await import('../src/sprites/bopcaSprite.js');
      const options = {
        animFrames: STILL_FRAME,
        lookX: 0,
        lookY: 0,
        palette: bopcaPaletteForSeed(REPEATABLE_SEED),
        blinking: false,
      };
      return [
        {
          name: 'idle',
          paint: ({ dom, unit }) =>
            drawBopcaSprite(dom, unit / 2, unit, unit, { ...options, state: 'idle' }),
        },
        {
          name: 'cooking',
          paint: ({ dom, unit }) =>
            drawBopcaSprite(dom, unit / 2, unit, unit, { ...options, state: 'cooking' }),
        },
      ];
    },
  },
  {
    name: 'grotesque-spider',
    views: async () => {
      const { drawGrotesqueSpiderSprite } = await import('../src/sprites/grotesqueSpiderSprite.js');
      const time = 0;
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderSprite(dom, 0, 0, unit, time, 0, FACING_TOWARD_CAMERA),
        },
        {
          name: 'back',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderSprite(dom, 0, 0, unit, time, 0, FACING_AWAY),
        },
        {
          name: 'side',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderSprite(dom, 0, 0, unit, time, FACING_RIGHT, 0),
        },
        {
          name: 'slam',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderSprite(
              dom,
              0,
              0,
              unit,
              time,
              FACING_RIGHT,
              0,
              'attack_slam',
              ATTACK_MIDPOINT,
            ),
        },
      ];
    },
  },
  {
    name: 'hoarder',
    views: async () => {
      const { drawHoarderSprite } = await import('../src/sprites/hoarderSprite.js');
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawHoarderSprite(
              dom,
              0,
              0,
              unit,
              0,
              FACING_TOWARD_CAMERA,
              STILL_FRAME,
              false,
              false,
              0,
            ),
        },
        {
          name: 'back',
          paint: ({ dom, unit }) =>
            drawHoarderSprite(dom, 0, 0, unit, 0, FACING_AWAY, STILL_FRAME, false, false, 0),
        },
        {
          name: 'side',
          paint: ({ dom, unit }) =>
            drawHoarderSprite(dom, 0, 0, unit, FACING_RIGHT, 0, STILL_FRAME, false, false, 0),
        },
        {
          name: 'vomit-windup',
          paint: ({ dom, unit }) =>
            drawHoarderSprite(
              dom,
              0,
              0,
              unit,
              0,
              FACING_TOWARD_CAMERA,
              STILL_FRAME,
              false,
              true,
              ATTACK_MIDPOINT,
            ),
        },
      ];
    },
  },
  {
    name: 'juicer',
    views: async () => {
      const { drawJuicerSprite } = await import('../src/sprites/juicerSprite.js');
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawJuicerSprite(
              dom,
              0,
              0,
              unit,
              STILL_FRAME,
              false,
              0,
              0,
              FACING_TOWARD_CAMERA,
              false,
              false,
            ),
        },
        {
          name: 'side',
          paint: ({ dom, unit }) =>
            drawJuicerSprite(dom, 0, 0, unit, STILL_FRAME, false, 0, FACING_RIGHT, 0, false, false),
        },
        {
          name: 'enraged',
          paint: ({ dom, unit }) =>
            drawJuicerSprite(
              dom,
              0,
              0,
              unit,
              STILL_FRAME,
              false,
              0,
              0,
              FACING_TOWARD_CAMERA,
              true,
              false,
            ),
        },
        {
          name: 'throw',
          paint: ({ dom, unit }) =>
            drawJuicerSprite(
              dom,
              0,
              0,
              unit,
              STILL_FRAME,
              false,
              ATTACK_MIDPOINT,
              FACING_RIGHT,
              0,
              false,
              true,
            ),
        },
      ];
    },
  },
  {
    name: 'ringmaster-grimaldi',
    views: async () => {
      const { drawRingmasterGrimaldiSprite } =
        await import('../src/sprites/ringmasterGrimaldiSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawRingmasterGrimaldiSprite(dom, 0, 0, unit) },
        {
          name: 'attack',
          paint: ({ dom, unit }) =>
            drawRingmasterGrimaldiSprite(dom, 0, 0, unit, 0, false, false, ATTACK_MIDPOINT),
        },
        {
          name: 'invulnerable',
          paint: ({ dom, unit }) => drawRingmasterGrimaldiSprite(dom, 0, 0, unit, 0, true),
        },
      ];
    },
  },
  {
    name: 'circus-lemur',
    views: async () => {
      const { drawCircusLemurSprite } = await import('../src/sprites/circusLemurSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawCircusLemurSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) => drawCircusLemurSprite(dom, 0, 0, unit, WALK_FRAME, true),
        },
        {
          name: 'throw',
          paint: ({ dom, unit }) =>
            drawCircusLemurSprite(
              dom,
              0,
              0,
              unit,
              STILL_FRAME,
              false,
              0,
              FACING_RIGHT,
              ATTACK_MIDPOINT,
            ),
        },
      ];
    },
  },
  {
    name: 'mold-lion',
    views: async () => {
      const { drawMoldLionSprite } = await import('../src/sprites/moldLionSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawMoldLionSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) => drawMoldLionSprite(dom, 0, 0, unit, WALK_FRAME, true),
        },
        {
          name: 'attack',
          paint: ({ dom, unit }) =>
            drawMoldLionSprite(dom, 0, 0, unit, STILL_FRAME, false, ATTACK_MIDPOINT),
        },
      ];
    },
  },
  {
    name: 'incubus',
    views: async () => {
      const { drawIncubusSprite } = await import('../src/sprites/incubusSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawIncubusSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) => drawIncubusSprite(dom, 0, 0, unit, WALK_FRAME, true),
        },
        {
          name: 'facing-left',
          paint: ({ dom, unit }) =>
            drawIncubusSprite(dom, 0, 0, unit, STILL_FRAME, false, FACING_LEFT),
        },
      ];
    },
  },
  {
    name: 'krasue',
    views: async () => {
      const { drawKrasueSprite } = await import('../src/sprites/krasueSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawKrasueSprite(dom, 0, 0, unit) },
        {
          name: 'aggressive',
          paint: ({ dom, unit }) => drawKrasueSprite(dom, 0, 0, unit, 0, true),
        },
        {
          name: 'attack',
          paint: ({ dom, unit }) =>
            drawKrasueSprite(dom, 0, 0, unit, 0, true, FACING_RIGHT, ATTACK_MIDPOINT),
        },
      ];
    },
  },
  {
    name: 'heather-bear',
    views: async () => {
      const { drawHeatherBearSprite } = await import('../src/sprites/heatherBearSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawHeatherBearSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) => drawHeatherBearSprite(dom, 0, 0, unit, WALK_FRAME, true),
        },
        {
          name: 'attack',
          paint: ({ dom, unit }) =>
            drawHeatherBearSprite(dom, 0, 0, unit, STILL_FRAME, false, ATTACK_MIDPOINT),
        },
      ];
    },
  },
  {
    name: 'gum-gum',
    views: async () => {
      const { drawGumGumSprite, drawGumGumCorpse } = await import('../src/sprites/gumGumSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawGumGumSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) => drawGumGumSprite(dom, 0, 0, unit, WALK_FRAME, true),
        },
        { name: 'corpse', paint: ({ dom, unit }) => drawGumGumCorpse(dom, 0, 0, unit) },
      ];
    },
  },
  {
    name: 'city-elf-cultist',
    views: async () => {
      const { drawCityElfCultistSprite } = await import('../src/sprites/cityElfCultistSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawCityElfCultistSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) => drawCityElfCultistSprite(dom, 0, 0, unit, WALK_FRAME, true),
        },
        {
          name: 'cast',
          paint: ({ dom, unit }) =>
            drawCityElfCultistSprite(dom, 0, 0, unit, STILL_FRAME, false, ATTACK_MIDPOINT),
        },
      ];
    },
  },
  {
    name: 'ink-marauder',
    views: async () => {
      const { drawInkMarauderSprite, INK_EMERGE_FRAMES } =
        await import('../src/sprites/inkMarauderSprite.js');
      const pose = {
        // A freshly summoned marauder is scaled almost to nothing behind the
        // emerge swirl; the settled form only exists once the swirl is over.
        age: INK_EMERGE_FRAMES,
        lifeFraction: 1,
        attackProgress: 0,
        facingX: FACING_RIGHT,
        walkFrame: STILL_FRAME,
        isMoving: false,
        swimBlend: 0,
      };
      return [
        {
          name: 'ogre',
          paint: ({ dom, unit }) =>
            drawInkMarauderSprite(dom, 0, 0, unit, { ...pose, form: 'ogre' }),
        },
        {
          name: 'shark',
          paint: ({ dom, unit }) =>
            drawInkMarauderSprite(dom, 0, 0, unit, { ...pose, form: 'shark', swimBlend: 1 }),
        },
        {
          name: 'ogre-attack',
          paint: ({ dom, unit }) =>
            drawInkMarauderSprite(dom, 0, 0, unit, {
              ...pose,
              form: 'ogre',
              attackProgress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
  {
    name: 'ball-of-swine',
    views: async () => {
      const { drawBallOfSwineSprite, ballOfSwinePortrait } = await import(
        '../src/sprites/ballOfSwineSprite.js'
      );
      const still = ballOfSwinePortrait();
      return [
        {
          name: 'rolling',
          paint: ({ dom, unit }) => drawBallOfSwineSprite(dom, 0, 0, unit, still),
        },
        {
          name: 'wallowing',
          paint: ({ dom, unit }) =>
            drawBallOfSwineSprite(dom, 0, 0, unit, { ...still, pose: 'wallow' }),
        },
        {
          name: 'bursting',
          paint: ({ dom, unit }) =>
            drawBallOfSwineSprite(dom, 0, 0, unit, {
              ...still,
              pose: 'burst',
              progress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
  {
    name: 'fat-clown',
    views: async () => {
      const { drawFatClownSprite } = await import('../src/sprites/fatClownSprite.js');
      return [
        {
          name: 'idle',
          paint: ({ dom, unit }) =>
            drawFatClownSprite(dom, 0, 0, unit, FACING_RIGHT, {
              kind: 'idle',
              phaseOffsetSeconds: 0,
            }),
        },
        {
          name: 'walk',
          paint: ({ dom, unit }) =>
            drawFatClownSprite(dom, 0, 0, unit, FACING_RIGHT, { kind: 'walk', cycle: WALK_FRAME }),
        },
        {
          name: 'slam',
          paint: ({ dom, unit }) =>
            drawFatClownSprite(dom, 0, 0, unit, FACING_RIGHT, {
              kind: 'slam',
              progress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
  {
    name: 'bugaboo',
    views: async (frame) => {
      const { drawBugabooFront, drawBugabooBack, drawBugabooSide } =
        await import('./bugabooArt.js');
      const { ROWS } = await import('./generate-bugaboo-sprite.js');
      return sheetViews(
        ROWS,
        { front: drawBugabooFront, back: drawBugabooBack, side: drawBugabooSide },
        frame,
      );
    },
  },
  {
    name: 'llama',
    views: async () => {
      const { drawLlamaSprite } = await import('../src/sprites/llamaSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawLlamaSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) =>
            drawLlamaSprite(dom, 0, 0, unit, { walkFrame: WALK_FRAME, isMoving: true }),
        },
        {
          name: 'spit',
          paint: ({ dom, unit }) =>
            drawLlamaSprite(dom, 0, 0, unit, {
              walkFrame: STILL_FRAME,
              spitProgress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
];

export function findSubject(name: string): SvgSubject | undefined {
  return SUBJECTS.find((subject) => subject.name === name);
}
