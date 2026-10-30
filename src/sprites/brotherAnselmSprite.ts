/**
 * Brother Anselm, the Barracks Mercenaries' healer, drawn on the human rig:
 * his look (`looks/humans/brotherAnselm.ts`) in his habit, sandals and the
 * hirelings' armband, his quarterstaff closed in his fists between each
 * cell's two layers. He is painted from the crawler's rows extended by his
 * own: the two-handed set's sweep and the bare-handed fall, the staff let go
 * as his palms meet the floor, are the crawler's, and the rows for a staff (resting on
 * it, walking with it, the channel, the brace, the flinch and the hurried
 * walk) are his alone, declared here beside his look.
 */

import { isKitRow, type MedicRow } from '../creatures/mercenaries/MercenaryKit';
import { walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import type { CardinalView } from './facingView';
import { prewarmFigureState } from './figure/figureFrameCache';
import { carriedGripOf } from './art/human/carry';
import { TILE_SCALE } from './art/human/figureScale';
import { humanFigureWithRows } from './art/human/appearance';
import {
  staffAmbleRow,
  staffBraceRow,
  staffChannelRow,
  staffFlinchRow,
  staffHurryRow,
  staffRestRow,
} from './art/human/staffRows';
import {
  extendedHumanRowBook,
  FRAME_H,
  FRAME_W,
  type HumanRowBook,
  type HumanRowDef,
  type HumanRowName,
  TILE_X,
  TILE_Y,
  type ViewRows,
} from './art/humanFigure';
import { outfitOf } from './garments/outfit';
import { HIRELING_ARMBAND } from './garments/human/hirelingArmband';
import { MONK_HABIT, MONK_SANDALS } from './garments/human/monkHabit';
import { ANSELM_QUARTERSTAFF } from './held/art/quarterstaffHeld';
import { BROTHER_ANSELM_LOOK } from './looks/humans/brotherAnselm';
import {
  type BipedHeldDraw,
  drawHumanFigureSelection,
  rowFrameAtTicks,
  rowLengthInTicks,
  viewRow,
} from './humanSprite';
import type { ViewedEyePlacement } from './eyePlacement';
import type { MercenaryArt } from './mercenaryArt';
import {
  ANSELM_DEATH_DURATION_MS,
  ANSELM_TILES_PER_WALK_CYCLE,
  ANSELM_WALK_FRAMES,
} from './brotherAnselmTiming';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

/** The rows he plays that the crawler never does, in sheet order after the crawler's. */
const ANSELM_OWN_ROW_NAMES = [
  'twohand_channel',
  'twohand_channel_side',
  'twohand_channel_away',
  'twohand_brace',
  'twohand_brace_side',
  'twohand_brace_away',
  'twohand_rest',
  'twohand_rest_side',
  'twohand_rest_away',
  'twohand_hurry',
  'twohand_hurry_side',
  'twohand_hurry_away',
  'twohand_amble',
  'twohand_amble_side',
  'twohand_amble_away',
  'twohand_flinch',
  'twohand_flinch_side',
  'twohand_flinch_away',
] as const;

type AnselmOwnRowName = (typeof ANSELM_OWN_ROW_NAMES)[number];

/** Every row his figure is painted in: the crawler's and his own. */
export type AnselmRowName = HumanRowName | AnselmOwnRowName;

const ANSELM_OWN_ROW_TABLE = {
  twohand_channel: staffChannelRow('front'),
  twohand_channel_side: staffChannelRow('side'),
  twohand_channel_away: staffChannelRow('back'),
  twohand_brace: staffBraceRow('front'),
  twohand_brace_side: staffBraceRow('side'),
  twohand_brace_away: staffBraceRow('back'),
  twohand_rest: staffRestRow('front'),
  twohand_rest_side: staffRestRow('side'),
  twohand_rest_away: staffRestRow('back'),
  twohand_hurry: staffHurryRow('front'),
  twohand_hurry_side: staffHurryRow('side'),
  twohand_hurry_away: staffHurryRow('back'),
  twohand_amble: staffAmbleRow('front'),
  twohand_amble_side: staffAmbleRow('side'),
  twohand_amble_away: staffAmbleRow('back'),
  twohand_flinch: staffFlinchRow('front'),
  twohand_flinch_side: staffFlinchRow('side'),
  twohand_flinch_away: staffFlinchRow('back'),
} satisfies Record<AnselmOwnRowName, HumanRowDef>;

/** The rows his figure is painted from. */
export const ANSELM_ROW_BOOK: HumanRowBook<AnselmRowName> = extendedHumanRowBook(
  'staff',
  ANSELM_OWN_ROW_NAMES,
  ANSELM_OWN_ROW_TABLE,
);

/** Every row he paints, under the name his kit asks for it by. */
export type AnselmRow =
  'idle' | 'walk' | 'flee' | 'staff_strike' | 'mend' | 'cower' | 'hurt' | 'death';

/**
 * The rig's rows each of his plays, per view. He falls the one way the rig
 * falls, edge-on, whichever way he faced; he walks with the staff as a
 * walking stick and flees with it clutched to his chest, both on the walk's
 * own legs, paced by the ground covered. He flinches from a blow behind his
 * staff: the rig's bare-handed flinch would carry the staff in one fist and
 * whip it round over his head.
 */
export const ANSELM_ROWS: Readonly<Record<AnselmRow, ViewRows<AnselmRowName>>> = {
  idle: { front: 'twohand_rest', side: 'twohand_rest_side', back: 'twohand_rest_away' },
  walk: { front: 'twohand_amble', side: 'twohand_amble_side', back: 'twohand_amble_away' },
  flee: { front: 'twohand_hurry', side: 'twohand_hurry_side', back: 'twohand_hurry_away' },
  staff_strike: {
    front: 'twohand_sweep',
    side: 'twohand_sweep_side',
    back: 'twohand_sweep_away',
  },
  mend: { front: 'twohand_channel', side: 'twohand_channel_side', back: 'twohand_channel_away' },
  cower: { front: 'twohand_brace', side: 'twohand_brace_side', back: 'twohand_brace_away' },
  hurt: { front: 'twohand_flinch', side: 'twohand_flinch_side', back: 'twohand_flinch_away' },
  death: { front: 'death_side', side: 'death_side', back: 'death_side' },
};

/** The row he paints for each row his kit asks for. */
const KIT_ROWS: Readonly<Record<MedicRow, AnselmRow>> = {
  idle: 'idle',
  walk: 'walk',
  flee: 'flee',
  staff_strike: 'staff_strike',
  mend: 'mend',
  cower: 'cower',
  hurt: 'hurt',
  death: 'death',
};

const DRAWN_VIEWS: readonly CardinalView[] = ['front', 'side', 'back'];

/** Every row he is drawn in, in any view. */
export const ANSELM_PLAYED_ROWS: readonly AnselmRowName[] = [
  ...new Set(
    Object.values(KIT_ROWS).flatMap((row) => DRAWN_VIEWS.map((view) => ANSELM_ROWS[row][view])),
  ),
];

/** His habit, sandals and armband over a body that wears nothing of its own. */
export const ANSELM_OUTFIT = outfitOf(BROTHER_ANSELM_LOOK, [
  MONK_HABIT,
  MONK_SANDALS,
  HIRELING_ARMBAND,
]);

/** His figure: the rig in his look and outfit, his fists closed round the staff's haft. */
export const BROTHER_ANSELM_FIGURE = humanFigureWithRows(
  ANSELM_ROW_BOOK,
  BROTHER_ANSELM_LOOK,
  ANSELM_OUTFIT,
  carriedGripOf(ANSELM_QUARTERSTAFF),
);

/** The staff has one picture. */
const STAFF_DRAW: BipedHeldDraw = { look: ANSELM_QUARTERSTAFF, phase: 0 };

const FULL_TURN = Math.PI * 2;

/** The cell drawn for a row on a frame of the kit's clock, or of its own. */
function frameOf(
  painted: AnselmRow,
  row: AnselmRowName,
  progress: number,
  walkFrame: number,
  clock: number,
): number {
  const meta = ANSELM_ROW_BOOK.table[row];
  const frames = meta.frameCount;
  switch (painted) {
    case 'idle':
    case 'cower':
      return rowFrameAtTicks(meta, clock % rowLengthInTicks(meta));
    case 'walk':
      return walkFrameIndex(walkFrame, frames);
    case 'flee':
      return walkFrameIndex(progress * FULL_TURN, frames);
    case 'staff_strike':
    case 'mend':
    case 'hurt':
    case 'death':
      return Math.min(frames - 1, Math.max(0, Math.floor(progress * frames)));
    default: {
      const unhandled: never = painted;
      return unhandled;
    }
  }
}

/**
 * The furthest his cell reaches past his own tile on any side, rounded up to
 * whole tiles: the staff swept out ahead of him, the top of the planted
 * pole. Either side counts as the right, since the profile is mirrored.
 */
const ANSELM_CULL_MARGIN_TILES = Math.ceil(
  Math.max(TILE_X, TILE_Y, FRAME_W - TILE_X - TILE_SCALE, FRAME_H - TILE_Y - TILE_SCALE) /
    TILE_SCALE,
);

/**
 * The top of his head above his tile's top edge, in tiles: measured off the
 * standing rows by `scripts/render-brother-anselm.ts`, which fails when a
 * redraw moves it.
 */
export const ANSELM_HEAD_LIFT_TILES = 0.92;

/**
 * Where his eyes are, in tiles from his tile's top-left: measured off the
 * standing rows by `scripts/render-brother-anselm.ts`.
 */
export const ANSELM_EYES: ViewedEyePlacement = {
  sideForward: 0.09,
  sideHeight: -0.67,
  sideSpacing: 0.05,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -0.67,
  frontSpacing: 0.09,
};

const MS_PER_SECOND = 1000;
const ANSELM_DEATH_TICKS = Math.round(
  (ANSELM_DEATH_DURATION_MS * WORLD_TICKS_PER_SECOND) / MS_PER_SECOND,
);

/** The rows walking away from the Barracks desk needs, in every view: he stands, then follows. */
const PREWARMED: readonly AnselmRow[] = ['idle', 'walk'];
/** The rows a fight needs, in the order it asks for them: the sweep, the channel, the flinch, the brace, the fall. */
const FIGHT_ROWS: readonly AnselmRow[] = ['staff_strike', 'mend', 'hurt', 'cower', 'death'];

function prewarmRows(rows: readonly AnselmRow[]): void {
  const names = new Set(rows.flatMap((row) => DRAWN_VIEWS.map((view) => ANSELM_ROWS[row][view])));
  for (const name of names) prewarmFigureState(BROTHER_ANSELM_FIGURE.def, name);
}

/**
 * Brother Anselm's painted figure. One-shot rows are drawn at the kit's
 * `progress` through them, so the staff lands and the heal flares on screen
 * on the tick the kit lands them; the stance and the brace run on the
 * hireling's own clock. His death row ends lying still, which a progress of
 * 1 selects, so the shell's hold-and-fade shows him where he fell.
 */
export const BROTHER_ANSELM_ART: MercenaryArt = {
  draw(ctx, sx, sy, tileSize, frame) {
    const { row, progress } = frame.state;
    const fallback: AnselmRow = frame.isMoving ? 'walk' : 'idle';
    const painted = isKitRow(KIT_ROWS, row) ? KIT_ROWS[row] : fallback;
    const name = viewRow(ANSELM_ROWS[painted], frame.facing.view);
    drawHumanFigureSelection(
      ctx,
      BROTHER_ANSELM_FIGURE,
      sx,
      sy,
      tileSize,
      {
        row: name,
        frame: frameOf(painted, name, progress, frame.walkFrame, frame.clock),
        flipX: ANSELM_ROW_BOOK.table[name].mirrorable && frame.facing.flipX,
      },
      STAFF_DRAW,
    );
  },
  cullMarginTiles: ANSELM_CULL_MARGIN_TILES,
  headLiftTiles: ANSELM_HEAD_LIFT_TILES,
  eyes: ANSELM_EYES,
  deathFrames: ANSELM_DEATH_TICKS,
  prewarm: () => prewarmRows(PREWARMED),
  prewarmForFight: () => prewarmRows(FIGHT_ROWS),
  gait: {
    radiansPerPixel: (tileSize) => FULL_TURN / (ANSELM_TILES_PER_WALK_CYCLE * tileSize),
    maxRadiansPerTick: FULL_TURN / ANSELM_WALK_FRAMES,
  },
};
