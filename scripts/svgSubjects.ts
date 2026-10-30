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

/** Either context the recorder answers to; both hand back the same recorder. */
type SubjectContext = NodeCanvasContext | CanvasRenderingContext2D;

/** For art modules under `src/`, which are typed against the browser's context. */
function domContextOf(targets: SvgTargets): CanvasRenderingContext2D {
  return targets.dom;
}

/**
 * The offline art modules paint in a unit-tall space with the feet near the
 * origin, so they need the tile scale applied before the figure exists.
 */
function inUnitSpace<C extends SubjectContext>(
  ctx: C,
  unit: number,
  paint: (ctx: C) => void,
): void {
  ctx.save();
  ctx.scale(unit, unit);
  paint(ctx);
  ctx.restore();
}

/**
 * Turns a sprite-sheet row table into views — one per row, so every animation
 * the sheet bakes is also exportable as vector art.
 *
 * `contextOf` picks which of the two context types the row's painters are typed
 * against; a figure whose art has moved into `src/sprites/art/` takes the DOM
 * one, and everything still under `scripts/` takes node-canvas's.
 */
function sheetViews<Pose, C extends SubjectContext>(
  rows: ReadonlyArray<{
    readonly name: string;
    readonly view: 'front' | 'side' | 'back';
    readonly pose: (frame: number) => Pose;
  }>,
  painters: Record<'front' | 'side' | 'back', (ctx: C, pose: Pose) => void>,
  frame: number,
  contextOf: (targets: SvgTargets) => C,
): readonly SvgView[] {
  return rows.map((row) => ({
    name: row.name,
    paint: (targets) =>
      inUnitSpace(contextOf(targets), targets.unit, (ctx) =>
        painters[row.view](ctx, row.pose(frame)),
      ),
  }));
}

export const SUBJECTS: readonly SvgSubject[] = [
  {
    name: 'angel',
    views: async () => {
      const { ANGEL_FIGURE, ANGEL_BIG_MOVE_FRAMES } =
        await import('../src/sprites/art/angelFigure.js');
      const paintRow =
        (routine: string, frame: number) =>
        ({ dom, unit }: SvgTargets): void => {
          dom.save();
          dom.scale(unit / ANGEL_FIGURE.tileScale, unit / ANGEL_FIGURE.tileScale);
          ANGEL_FIGURE.paintFrame(dom, routine, frame);
          dom.restore();
        };
      const [swingApex, squatLow] = ANGEL_BIG_MOVE_FRAMES.swing_squat;
      const [archPeak, hairWhip] = ANGEL_BIG_MOVE_FRAMES.arch_flip_look;
      return [
        { name: 'home', paint: paintRow('roll_wave', STILL_FRAME) },
        { name: 'swing', paint: paintRow('swing_squat', swingApex) },
        { name: 'squat', paint: paintRow('swing_squat', squatLow) },
        { name: 'arch', paint: paintRow('arch_flip_look', archPeak) },
        { name: 'hair-flip', paint: paintRow('arch_flip_look', hairWhip) },
      ];
    },
  },
  {
    // The one raster exception: the human figure's outline, cast shadows and bounce rim are
    // pixel morphology — the silhouette dilated and eroded by whole-pixel blits
    // and `destination-out` compositing on a fixed-density layer — with no path
    // for the recorder to capture. His export is that finished layer embedded
    // as an `<image>` at the layer's own resolution, not scalable art.
    name: 'human',
    views: async (frame) => {
      const { drawBipedFront, drawBipedBack, drawBipedSide } =
        await import('../src/sprites/art/biped/figure.js');
      const { VIEWS } = await import('../src/sprites/art/biped/rig.js');
      const { HUMAN_ROWS, undressedHumanPainting, paintedPose } =
        await import('../src/sprites/art/humanFigure.js');
      const { playerLookAxes } = await import('../src/sprites/looks/humanLook.js');
      const { activeHumanLook } = await import('../src/sprites/humanSprite.js');
      const painting = undressedHumanPainting(activeHumanLook());
      const { look, itemHandle } = painting;
      const painters = { front: drawBipedFront, back: drawBipedBack, side: drawBipedSide };
      return HUMAN_ROWS.map((row) => ({
        name: row.name,
        paint: (targets: SvgTargets) =>
          inUnitSpace(domContextOf(targets), targets.unit, (ctx) => {
            const axes = playerLookAxes(look, VIEWS[row.view].profile);
            ctx.scale(axes.x, axes.y);
            painters[row.view](ctx, paintedPose(painting, row, frame), {
              look,
              itemHandle,
            });
          }),
      }));
    },
  },
  {
    name: 'cat',
    views: async (frame) => {
      const { CAT_ROWS, PLAYER_CAT_LOOK, catGarmentContext, paintCatPose } =
        await import('../src/sprites/art/catFigure.js');
      const { BARE_CAT_OUTFIT, dressCat } =
        await import('../src/sprites/garments/cat/catDressing.js');
      return CAT_ROWS.filter((row) => !row.facesWest).map((row) => ({
        name: row.name,
        paint: (targets: SvgTargets) =>
          inUnitSpace(domContextOf(targets), targets.unit, (ctx) => {
            const pose = row.pose(frame, PLAYER_CAT_LOOK);
            const dressing = dressCat(BARE_CAT_OUTFIT, catGarmentContext(row, frame, pose));
            paintCatPose(ctx, PLAYER_CAT_LOOK, row, pose, dressing);
          }),
      }));
    },
  },
  {
    name: 'dwarf-cook',
    views: async () => {
      const { drawDwarfCookSprite, dwarfCookPaletteForSeed } =
        await import('../src/sprites/dwarfCookSprite.js');
      const options = {
        animFrames: STILL_FRAME,
        lookX: 0,
        lookY: 0,
        palette: dwarfCookPaletteForSeed(REPEATABLE_SEED),
        blinking: false,
      };
      return [
        {
          name: 'idle',
          paint: ({ dom, unit }) =>
            drawDwarfCookSprite(dom, unit / 2, unit, unit, { ...options, state: 'idle' }),
        },
        {
          name: 'cooking',
          paint: ({ dom, unit }) =>
            drawDwarfCookSprite(dom, unit / 2, unit, unit, { ...options, state: 'cooking' }),
        },
      ];
    },
  },
  {
    name: 'grotesque-spider',
    views: async () => {
      const { drawGrotesqueSpiderPoseSprite } =
        await import('../src/sprites/grotesqueSpiderSprite.js');
      const { strikeFrame } = await import('../src/creatures/grotesqueSpiderTimeline.js');
      // She is painted once, from above, facing +Y; every view is that one
      // orientation, as the fight rotates it rather than redrawing it.
      return [
        {
          name: 'idle',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderPoseSprite(dom, 0, 0, unit, { kind: 'idle', time: STILL_FRAME }),
        },
        {
          name: 'walk',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderPoseSprite(dom, 0, 0, unit, {
              kind: 'walk',
              distancePx: WALK_FRAME * unit,
            }),
        },
        {
          name: 'slam',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderPoseSprite(dom, 0, 0, unit, {
              kind: 'attack',
              attack: 'slam',
              attackFrame: strikeFrame('slam'),
            }),
        },
        {
          name: 'screech',
          paint: ({ dom, unit }) =>
            drawGrotesqueSpiderPoseSprite(dom, 0, 0, unit, {
              kind: 'attack',
              attack: 'screech',
              attackFrame: strikeFrame('screech'),
            }),
        },
      ];
    },
  },
  {
    name: 'trash_gremlin',
    views: async () => {
      const { drawTrashGremlinSprite } = await import('../src/sprites/trashGremlinSprite.js');
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawTrashGremlinSprite(dom, 0, 0, unit, {
              facingX: 0,
              facingY: FACING_TOWARD_CAMERA,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'back',
          paint: ({ dom, unit }) =>
            drawTrashGremlinSprite(dom, 0, 0, unit, {
              facingX: 0,
              facingY: FACING_AWAY,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'side',
          paint: ({ dom, unit }) =>
            drawTrashGremlinSprite(dom, 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'vomit',
          paint: ({ dom, unit }) =>
            drawTrashGremlinSprite(dom, 0, 0, unit, {
              facingX: 0,
              facingY: FACING_TOWARD_CAMERA,
              vomitProgress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
  {
    name: 'big_rooster',
    views: async () => {
      const { drawRoosterSprite } = await import('../src/sprites/roosterSprite.js');
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: 0,
              facingY: FACING_TOWARD_CAMERA,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'back',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: 0,
              facingY: FACING_AWAY,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'side',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'enraged',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: 0,
              facingY: FACING_TOWARD_CAMERA,
              idleFrame: STILL_FRAME,
              isEnraged: true,
            }),
        },
        {
          name: 'throw',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              throwProgress: ATTACK_MIDPOINT,
              heldDumbbell: true,
            }),
        },
        {
          name: 'punch',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              punchProgress: ATTACK_MIDPOINT,
            }),
        },
        {
          name: 'club_swing',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              clubProgress: ATTACK_MIDPOINT,
              heldDumbbell: true,
            }),
        },
        {
          name: 'slam',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              slamProgress: ATTACK_MIDPOINT,
            }),
        },
        {
          name: 'crow',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: 0,
              facingY: FACING_TOWARD_CAMERA,
              crowProgress: ATTACK_MIDPOINT,
            }),
        },
        {
          name: 'sprint',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'big', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              isSprinting: true,
            }),
        },
      ];
    },
  },
  {
    name: 'little_rooster',
    views: async () => {
      const { drawRoosterSprite } = await import('../src/sprites/roosterSprite.js');
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'little', 0, 0, unit, {
              facingX: 0,
              facingY: FACING_TOWARD_CAMERA,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'side',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'little', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'peck',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'little', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              peckProgress: ATTACK_MIDPOINT,
            }),
        },
        {
          name: 'punch',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'little', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              punchProgress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
  {
    name: 'slightly_bent_rooster',
    views: async () => {
      const { drawRoosterSprite } = await import('../src/sprites/roosterSprite.js');
      return [
        {
          name: 'front',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'bent', 0, 0, unit, {
              facingX: 0,
              facingY: FACING_TOWARD_CAMERA,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'side',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'bent', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              idleFrame: STILL_FRAME,
            }),
        },
        {
          name: 'peck',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'bent', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              peckProgress: ATTACK_MIDPOINT,
            }),
        },
        {
          name: 'punch',
          paint: ({ dom, unit }) =>
            drawRoosterSprite(dom, 'bent', 0, 0, unit, {
              facingX: FACING_RIGHT,
              facingY: 0,
              punchProgress: ATTACK_MIDPOINT,
            }),
        },
      ];
    },
  },
  {
    name: 'lemur',
    views: async (frame) => {
      const { LEMUR_FIGURE, LEMUR_ROWS } = await import('../src/sprites/art/lemurFigure.js');
      return LEMUR_ROWS.map((row): SvgView => ({
        name: row.name,
        paint: ({ dom, unit }) =>
          inUnitSpace(dom, unit / LEMUR_FIGURE.tileScale, (ctx) =>
            LEMUR_FIGURE.paintFrame(ctx, row.name, frame % row.frameCount),
          ),
      }));
    },
  },
  {
    name: 'lion',
    views: async () => {
      const { drawLionSprite } = await import('../src/sprites/lionSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawLionSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) => drawLionSprite(dom, 0, 0, unit, WALK_FRAME, true),
        },
        {
          name: 'attack',
          paint: ({ dom, unit }) =>
            drawLionSprite(dom, 0, 0, unit, STILL_FRAME, false, ATTACK_MIDPOINT),
        },
      ];
    },
  },
  {
    // Painted on the biped rig, so the same raster exception as the human applies.
    name: 'demon_liaison',
    views: async (frame) => {
      const {
        DEMON_LIAISON_FIGURE,
        DEMON_LIAISON_ROLES,
        DEMON_LIAISON_VIEWS,
        demonLiaisonStateName,
      } = await import('../src/sprites/art/demonLiaisonFigure.js');
      return DEMON_LIAISON_ROLES.flatMap((role) =>
        DEMON_LIAISON_VIEWS.map((view): SvgView => {
          const state = demonLiaisonStateName(role, view);
          return {
            name: state,
            paint: ({ dom, unit }) =>
              inUnitSpace(dom, unit / DEMON_LIAISON_FIGURE.tileScale, (ctx) =>
                DEMON_LIAISON_FIGURE.paintFrame(ctx, state, frame),
              ),
          };
        }),
      );
    },
  },
  {
    name: 'raveling',
    views: async () => {
      const { paintRavelingSprite } = await import('../src/sprites/ravelingSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => paintRavelingSprite(dom, 0, 0, unit) },
        {
          name: 'aggressive',
          paint: ({ dom, unit }) => paintRavelingSprite(dom, 0, 0, unit, 0, true),
        },
        {
          name: 'attack',
          paint: ({ dom, unit }) =>
            paintRavelingSprite(dom, 0, 0, unit, 0, true, FACING_RIGHT, ATTACK_MIDPOINT),
        },
      ];
    },
  },
  {
    name: 'dire-bear',
    views: async (frame) => {
      const { drawDireBear } = await import('../src/sprites/art/direBearArt.js');
      const { DIRE_BEAR_ROWS } = await import('../src/sprites/art/direBearFigure.js');
      return DIRE_BEAR_ROWS.map((row): SvgView => ({
        name: row.name,
        paint: ({ dom, unit }) =>
          inUnitSpace(dom, unit, (ctx) => drawDireBear(ctx, row.pose(frame))),
      }));
    },
  },
  {
    name: 'baggi',
    views: async () => {
      const { drawBaggiSprite } = await import('../src/sprites/baggiSprite.js');
      const at = { facingX: 0, facingY: 1, walkPhase: 0, timeSeconds: 0 };
      return [
        {
          name: 'idle',
          paint: ({ dom, unit }) => {
            drawBaggiSprite(dom, 0, 0, unit, { ...at, role: 'idle' });
          },
        },
        {
          name: 'walk',
          paint: ({ dom, unit }) => {
            drawBaggiSprite(dom, 0, 0, unit, {
              ...at,
              role: 'walk',
              facingX: 1,
              facingY: 0,
              walkPhase: WALK_FRAME,
            });
          },
        },
      ];
    },
  },
  {
    // Painted on the biped rig, so the same raster exception as the human applies.
    name: 'elf',
    views: async (frame) => {
      const { ELF_FIGURE, ELF_ROLES, ELF_VIEWS, elfStateName } =
        await import('../src/sprites/art/elfFigure.js');
      return ELF_ROLES.flatMap((role) =>
        ELF_VIEWS.map((view): SvgView => {
          const state = elfStateName(role, view);
          return {
            name: state,
            paint: ({ dom, unit }) =>
              inUnitSpace(dom, unit / ELF_FIGURE.tileScale, (ctx) =>
                ELF_FIGURE.paintFrame(ctx, state, frame),
              ),
          };
        }),
      );
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
    name: 'fuzzy_nightmare',
    views: async (frame) => {
      const { drawFuzzyNightmareFront, drawFuzzyNightmareBack, drawFuzzyNightmareSide } =
        await import('../src/sprites/art/fuzzyNightmareArt.js');
      const { FUZZY_NIGHTMARE_ROWS } = await import('../src/sprites/art/fuzzyNightmareFigure.js');
      return sheetViews(
        FUZZY_NIGHTMARE_ROWS,
        {
          front: drawFuzzyNightmareFront,
          back: drawFuzzyNightmareBack,
          side: drawFuzzyNightmareSide,
        },
        frame,
        domContextOf,
      );
    },
  },
  {
    name: 'acid-llama',
    views: async () => {
      const { drawAcidLlamaSprite } = await import('../src/sprites/acidLlamaSprite.js');
      return [
        { name: 'idle', paint: ({ dom, unit }) => drawAcidLlamaSprite(dom, 0, 0, unit) },
        {
          name: 'walk',
          paint: ({ dom, unit }) =>
            drawAcidLlamaSprite(dom, 0, 0, unit, { walkFrame: WALK_FRAME, isMoving: true }),
        },
        {
          name: 'spit',
          paint: ({ dom, unit }) =>
            drawAcidLlamaSprite(dom, 0, 0, unit, {
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
