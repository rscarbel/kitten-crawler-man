/**
 * Localhost-only harness for the cat crawler in motion. Reached via `?cat` in
 * `devBoot`; `?cat=<row>` opens on that row.
 *
 * Three panes, all at the game's real timing and all drawn through the same
 * selection her `drawSelf` uses:
 *
 * - **Row**: one row of her figure looped on the dungeon floor at 128, 64 and
 *   the in-game 32 px, paced by her own animator. Click to step to the next row.
 * - **Compass**: eight real `CatPlayer`s, one per 45° heading, all doing the
 *   same thing, so every facing view and its mirroring shows side by side —
 *   including the views she has no rows of her own for, labelled with the view
 *   they are drawn in.
 * - **Live**: a real `CatPlayer` ticked through a fixed script — stand, walk a
 *   full circle, stop, strike, cast, stand long enough for an idle break.
 *
 * The outfit control lists everything she can wear, read off the item table
 * and labelled with the garment each is drawn as, and puts it on every cat on
 * screen; the tool control hands them all a working tool, swung with her
 * two-paw chop or pick; the carry control puts a small thing in their jaws.
 * Her rows played only while holding something show in the row pane holding
 * the chosen tool or carried thing, or a basic axe, pick or the first
 * carriable thing where none is chosen.
 */

import { PAINTED_CATS, PLAYER_CAT, type PaintedCat } from '../characters/characterLooks';
import { TOWN_CATS } from '../systems/critters/TownCats';
import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import {
  catLookOf,
  ITEM_DEF,
  isItemId,
  wearerAllows,
  type ItemId,
} from '../core/items/defs/ItemDefs';
import {
  isToolTier,
  TOOL_TIER_BASIC,
  TOOL_TIERS,
  type ToolKind,
} from '../core/items/gathering/toolTiers';
import type { WorkingTool } from '../core/items/gathering/toolTiers';
import { WALK_FRAME_SPEED } from '../Player';
import { CatPlayer } from '../creatures/CatPlayer';
import { CAT_ROWS, type CatHold } from '../sprites/art/catFigure';
import { HELD_VISUALS, workingToolHeldVisual } from '../sprites/held/heldVisuals';
import type { HeldVisualDef } from '../sprites/held/heldVisualDef';
import {
  CatAnimator,
  CatAppearance,
  catCellFor,
  drawCatSprite,
  type CatOneShot,
  type CatOneShotState,
  type CatCell,
  type CatHeldDraw,
  type CatSpriteState,
  type CatState,
  CAT_WORK_SWING_OF_TOOL,
} from '../sprites/catSprite';
import { catRowViewOf } from '../sprites/catViews';
import { wornGarmentOf } from '../sprites/garments/garments';
import { catGarmentsWearing } from '../sprites/garments/itemLooks';
import { selectFacing, type FacingSelection, type FacingView } from '../sprites/facingView';
import { TICKS_PER_SECOND } from '../sprites/art/human/timing';
import { worldText } from '../ui/world/worldText';
import { worldPlate, worldTint } from '../ui/world/worldShapes';
import type { WorldGesture } from '../ui/core/UiRoot';
import { previewInk } from '../ui/theme/previewInk';
import { PreviewScene, type PreviewControl } from './PreviewScene';

const BG_COLOR = previewInk.cat.backdrop;
/** The dungeon floor's tone, the colour every in-game judgement is made against. */
const FLOOR_COLOR = previewInk.floor.unlitConcrete;
/** The backdrop covers whatever the last scene left on the canvas. */
const OPAQUE = 1;
const SUBLABEL_COLOR = previewInk.cat.sublabel;

const MARGIN = 40;
const LABEL_SIZE = 12;
const LABEL_LINE_HEIGHT = 15;
const PANE_GAP = 60;
const CAPTION_GAP = 8;
/** Each square pane, in tiles: her painted cell reaches well past her own tile. */
const PANE_SIZE_TILES = 2.2;
const COMPASS_PANE_TILES = 2;
const COMPASS_PANE_GAP = 20;
const CAPTION_LINES = 2;

const REVIEW_TILE_SIZE = 128;
const HALF_REVIEW_TILE_SIZE = 64;
/** Review size first, the in-game tile last: only the last one is what a player sees. */
const ROW_TILE_SIZES: ReadonlyArray<number> = [REVIEW_TILE_SIZE, HALF_REVIEW_TILE_SIZE, TILE_SIZE];
const COMPASS_TILE_SIZE = HALF_REVIEW_TILE_SIZE;
const LIVE_TILE_SIZE = HALF_REVIEW_TILE_SIZE;

/** A one-shot rests this long on its last frame before it plays again. */
const ONE_SHOT_REST_TICKS = 30;
/** A resting one-shot is shown at the end of its play. */
const RESTING_PROGRESS = 1;
/** How often the compass cats repeat a swipe, cast or work swing: past the longest of the three. */
const COMPASS_ACTION_REPEAT_TICKS = 60;
const FULL_TURN = Math.PI * 2;

/** One 45° heading, clockwise from east in screen space (y down). */
interface Heading {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

const DIAGONAL = Math.SQRT1_2;
const COMPASS: ReadonlyArray<Heading> = [
  { label: 'E', x: 1, y: 0 },
  { label: 'SE', x: DIAGONAL, y: DIAGONAL },
  { label: 'S', x: 0, y: 1 },
  { label: 'SW', x: -DIAGONAL, y: DIAGONAL },
  { label: 'W', x: -1, y: 0 },
  { label: 'NW', x: -DIAGONAL, y: -DIAGONAL },
  { label: 'N', x: 0, y: -1 },
  { label: 'NE', x: DIAGONAL, y: -DIAGONAL },
];

/** How the row pane makes her animator and selection reach a row. */
type RowDrive =
  | { readonly kind: 'walk'; readonly carrying?: boolean; readonly scampering?: boolean }
  | {
      readonly kind: 'idle';
      readonly carrying?: boolean;
      readonly sitting?: boolean;
      readonly talking?: boolean;
    }
  | { readonly kind: 'oneShot'; readonly action: CatOneShot }
  | { readonly kind: 'knockedOut' };

const WALK: RowDrive = { kind: 'walk' };
const IDLE: RowDrive = { kind: 'idle' };
const SWIPE: RowDrive = { kind: 'oneShot', action: 'swipe' };
const CAST: RowDrive = { kind: 'oneShot', action: 'cast' };
const KNOCKED_OUT: RowDrive = { kind: 'knockedOut' };
const CHOP: RowDrive = { kind: 'oneShot', action: 'chop' };
const MINE: RowDrive = { kind: 'oneShot', action: 'mine' };
const CARRY_WALK: RowDrive = { kind: 'walk', carrying: true };
const CARRY_IDLE: RowDrive = { kind: 'idle', carrying: true };
const THROW: RowDrive = { kind: 'oneShot', action: 'throw' };
const SCAMPER: RowDrive = { kind: 'walk', scampering: true };
const HOP_UP: RowDrive = { kind: 'oneShot', action: 'hop_up' };
const HOP_DOWN: RowDrive = { kind: 'oneShot', action: 'hop_down' };
const SQUEEZE: RowDrive = { kind: 'oneShot', action: 'squeeze' };
const TALK: RowDrive = { kind: 'idle', talking: true };

/** Exhaustive over her rows, so a row added to the figure cannot go unreachable here. */
const ROW_DRIVES: Readonly<Record<CatState, RowDrive>> = {
  walk: WALK,
  walk_side: WALK,
  walk_side_west: WALK,
  walk_away: WALK,
  idle: IDLE,
  idle_side: IDLE,
  idle_side_west: IDLE,
  idle_away: IDLE,
  sit: { kind: 'idle', sitting: true },
  scamper_side: SCAMPER,
  scamper_side_west: SCAMPER,
  look_around: { kind: 'oneShot', action: 'look_around' },
  groom_paw: { kind: 'oneShot', action: 'groom_paw' },
  groom_flank: { kind: 'oneShot', action: 'groom_flank' },
  swipe: SWIPE,
  swipe_side: SWIPE,
  swipe_side_west: SWIPE,
  swipe_away: SWIPE,
  cast: CAST,
  cast_side: CAST,
  cast_side_west: CAST,
  cast_away: CAST,
  knocked_out: KNOCKED_OUT,
  knocked_out_west: KNOCKED_OUT,
  dance: { kind: 'oneShot', action: 'dance' },
  chop: CHOP,
  chop_side: CHOP,
  chop_side_west: CHOP,
  chop_away: CHOP,
  mine: MINE,
  mine_side: MINE,
  mine_side_west: MINE,
  mine_away: MINE,
  carry_walk: CARRY_WALK,
  carry_walk_side: CARRY_WALK,
  carry_walk_side_west: CARRY_WALK,
  carry_walk_away: CARRY_WALK,
  carry_idle: CARRY_IDLE,
  carry_idle_side: CARRY_IDLE,
  carry_idle_side_west: CARRY_IDLE,
  carry_idle_away: CARRY_IDLE,
  throw: THROW,
  throw_side: THROW,
  throw_side_west: THROW,
  throw_away: THROW,
  hop_up: HOP_UP,
  hop_up_side: HOP_UP,
  hop_up_side_west: HOP_UP,
  hop_up_away: HOP_UP,
  hop_down: HOP_DOWN,
  hop_down_side: HOP_DOWN,
  hop_down_side_west: HOP_DOWN,
  hop_down_away: HOP_DOWN,
  squeeze: SQUEEZE,
  squeeze_side: SQUEEZE,
  squeeze_side_west: SQUEEZE,
  squeeze_away: SQUEEZE,
  talk: TALK,
  talk_side: TALK,
  talk_side_west: TALK,
  talk_away: TALK,
  paw_bat: { kind: 'oneShot', action: 'paw_bat' },
  sniff: { kind: 'oneShot', action: 'sniff' },
  latch_paw: { kind: 'oneShot', action: 'latch_paw' },
  channel: { kind: 'oneShot', action: 'channel' },
};

function isCatState(name: string): name is CatState {
  return Object.prototype.hasOwnProperty.call(ROW_DRIVES, name);
}

interface PreviewRow {
  readonly state: CatState;
  readonly view: FacingView;
  readonly facesWest: boolean;
  readonly frameCount: number;
  readonly hold: CatHold | null;
}

const PREVIEW_ROWS: ReadonlyArray<PreviewRow> = CAT_ROWS.flatMap((row) =>
  isCatState(row.name)
    ? [
        {
          state: row.name,
          view: row.view,
          facesWest: row.facesWest,
          frameCount: row.frameCount,
          hold: row.hold ?? null,
        },
      ]
    : [],
);

/** One row looped through a private animator, so a one-shot runs at its in-game length. */
class RowPlayback {
  private readonly animator: CatAnimator;
  private walkFrame = 0;
  private restTicks = 0;

  constructor(
    readonly row: PreviewRow,
    appearance: CatAppearance,
  ) {
    this.animator = new CatAnimator(appearance);
    this.playOneShot();
  }

  private get drive(): RowDrive {
    return ROW_DRIVES[this.row.state];
  }

  private playOneShot(): void {
    const drive = this.drive;
    if (drive.kind === 'oneShot') this.animator.play(drive.action);
  }

  tick(): void {
    const drive = this.drive;
    if (drive.kind === 'walk') this.walkFrame = (this.walkFrame + WALK_FRAME_SPEED) % FULL_TURN;
    if (drive.kind !== 'oneShot') return;
    if (this.animator.current !== null) {
      this.animator.tick(false, false);
      return;
    }
    this.restTicks++;
    if (this.restTicks < ONE_SHOT_REST_TICKS) return;
    this.restTicks = 0;
    this.playOneShot();
  }

  spriteState(): CatSpriteState {
    const drive = this.drive;
    const facing: FacingSelection = { view: this.row.view, flipX: this.row.facesWest };
    return {
      facing,
      walkFrame: this.walkFrame,
      isMoving: drive.kind === 'walk',
      isKnockedOut: drive.kind === 'knockedOut',
      oneShot: drive.kind === 'oneShot' ? this.oneShotState(drive.action) : null,
      carrying: drive.kind !== 'oneShot' && drive.kind !== 'knockedOut' && drive.carrying === true,
      sitting: drive.kind === 'idle' && drive.sitting === true,
      talking: drive.kind === 'idle' && drive.talking === true,
      scampering: drive.kind === 'walk' && drive.scampering === true,
    };
  }

  /** The one-shot in flight, or held on its last frame while it rests before replaying. */
  private oneShotState(action: CatOneShot): CatOneShotState {
    return this.animator.current ?? { action, progress: RESTING_PROGRESS };
  }
}

/** Every cat the preview can paint: the registry's cats, then the town's. */
const PREVIEW_CATS: readonly PaintedCat[] = [
  ...PAINTED_CATS,
  ...Object.values(TOWN_CATS).map((cat) => ({ displayName: cat.displayName, look: cat.look })),
];

/** The cat `&look=` names, the player's cat by default. */
function selectPreviewCat(): PaintedCat {
  const wanted = new URLSearchParams(window.location.search).get('look');
  return PREVIEW_CATS.find((candidate) => candidate.look.id === wanted) ?? PLAYER_CAT;
}

function initialRowIndex(): number {
  const wanted = new URLSearchParams(window.location.search).get('cat');
  const index = PREVIEW_ROWS.findIndex((row) => row.state === wanted);
  return Math.max(0, index);
}

/** A set of gear to put on her, by item. */
interface Outfit {
  readonly label: string;
  readonly items: readonly ItemId[];
}

/** What an item shows as on her: the garment it is drawn as, or that it shows nothing. */
function lookLabel(id: ItemId): string {
  const def = ITEM_DEF[id];
  if (def.type === 'weapon') return 'held';
  const look = catLookOf(def);
  return look?.kind === 'garment' ? wornGarmentOf('cat', look.garment).name : 'no look';
}

/** Splits items into outfits in which no two share an equipment slot, in item order. */
function slotCompatibleSets(items: readonly ItemId[]): ItemId[][] {
  const sets: { readonly items: ItemId[]; readonly slots: Set<string> }[] = [];
  for (const id of items) {
    const def = ITEM_DEF[id];
    const slot = `${def.equipSlot ?? ''}:${def.equipSubSlot ?? ''}`;
    const home = sets.find((set) => !set.slots.has(slot));
    if (home === undefined) sets.push({ items: [id], slots: new Set([slot]) });
    else {
      home.items.push(id);
      home.slots.add(slot);
    }
  }
  return sets.map((set) => set.items);
}

/**
 * Bare, then each thing she can wear or hold on its own, labelled with the
 * garment it is drawn as, then every garment she has in as few outfits as
 * hold them (two in one equipment slot cannot be worn together), then all of it.
 * Read off the item table, so new gear appears here without an edit.
 */
function catOutfits(): readonly Outfit[] {
  const wearable = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => {
      const wearer = ITEM_DEF[id].wearer;
      return wearer !== undefined && wearerAllows(wearer, 'cat');
    });
  const dressed = wearable.filter((id) => catGarmentsWearing([id]).length > 0);
  const garmentSets = slotCompatibleSets(dressed);
  return [
    { label: 'bare', items: [] },
    ...wearable.map((id) => ({ label: `${ITEM_DEF[id].name} → ${lookLabel(id)}`, items: [id] })),
    ...garmentSets.map((items, index) => ({
      label: `every garment ${index + 1}/${garmentSets.length}`,
      items,
    })),
    { label: 'everything', items: wearable },
  ];
}

interface ToolOption {
  readonly label: string;
  readonly tool: WorkingTool | null;
}

const TOOL_KINDS: readonly ToolKind[] = ['axe', 'pickaxe'];

const TOOL_OPTIONS: readonly ToolOption[] = [
  { label: 'none', tool: null },
  ...TOOL_KINDS.flatMap((kind) =>
    TOOL_TIERS[kind].flatMap((def, tier) =>
      isToolTier(tier) ? [{ label: def.name, tool: { kind, tier } }] : [],
    ),
  ),
  { label: 'scythe', tool: { kind: 'scythe', tier: TOOL_TIER_BASIC } },
];

interface CarryOption {
  readonly label: string;
  readonly look: HeldVisualDef | null;
}

/** Nothing, then every look made to be carried in her jaws. */
const CARRY_OPTIONS: readonly CarryOption[] = [
  { label: 'none', look: null },
  ...Object.values(HELD_VISUALS)
    .filter((look) => look.archetype === 'mouthCarry')
    .map((look) => ({ label: look.name, look })),
];

const FIRST_CARRIED: HeldVisualDef | null =
  CARRY_OPTIONS.find((option) => option.look !== null)?.look ?? null;

/** What the row pane holds in her jaws on her throw. */
const ROW_PANE_THROWN: HeldVisualDef = HELD_VISUALS.prop_dynamite;

/** What the row pane holds on a row she plays only while holding something, when nothing chosen fits it. */
const ROW_PANE_TOOL: Readonly<Record<'chop' | 'mine', WorkingTool>> = {
  chop: { kind: 'axe', tier: TOOL_TIER_BASIC },
  mine: { kind: 'pickaxe', tier: TOOL_TIER_BASIC },
};

const COMPASS_ACTIONS = ['idle', 'walk', 'swipe', 'cast', 'work'] as const;
type CompassAction = (typeof COMPASS_ACTIONS)[number];
type RepeatedAction = 'strike' | 'cast' | 'work';

/** The one-shot each compass action keeps replaying, or null for a held state. */
const REPEATED_ACTION: Readonly<Record<CompassAction, RepeatedAction | null>> = {
  idle: null,
  walk: null,
  swipe: 'strike',
  cast: 'cast',
  work: 'work',
};

/** One step of the live pane's script: how long, what the stick is doing, and what she does as it starts. */
interface ScriptStep {
  readonly ticks: number;
  readonly label: string;
  readonly move?: Heading;
  readonly action?: 'strike' | 'cast';
}

/** Long enough on each heading of her circle for the turn to settle into its row. */
const HEADING_TICKS = 30;
/** Past the longest idle-break delay, so a break always shows. */
const UNTIL_IDLE_BREAK_SECONDS = 12;
const SECONDS = TICKS_PER_SECOND;
const LIVE_SCRIPT: ReadonlyArray<ScriptStep> = [
  { ticks: 2 * SECONDS, label: 'standing' },
  ...COMPASS.map((heading) => ({
    ticks: HEADING_TICKS,
    label: `walking ${heading.label}`,
    move: heading,
  })),
  { ticks: 1 * SECONDS, label: 'stopped' },
  { ticks: 1 * SECONDS, label: 'striking', action: 'strike' },
  { ticks: 1 * SECONDS, label: 'casting', action: 'cast' },
  { ticks: UNTIL_IDLE_BREAK_SECONDS * SECONDS, label: 'idle long enough for a break' },
];

/** Her circle is a regular octagon, one side per heading. */
const CIRCLE_SIDE_PX = HEADING_TICKS * PLAYER_SPEED;
const OCTAGON_HALF_ANGLE = Math.PI / COMPASS.length;
const CIRCLE_APOTHEM_PX = CIRCLE_SIDE_PX / (2 * Math.tan(OCTAGON_HALF_ANGLE));
const CIRCLE_RADIUS_PX = CIRCLE_SIDE_PX / (2 * Math.sin(OCTAGON_HALF_ANGLE));
const LIVE_PANE_PX = 2 * CIRCLE_RADIUS_PX + LIVE_TILE_SIZE * PANE_SIZE_TILES;

/** Swipe, cast or work swing once, whatever she was doing; the bolt is dropped, since only her pose is on show. */
function playAction(cat: CatPlayer, action: RepeatedAction, hasTool: boolean): void {
  if (action === 'cast') {
    cat.resetCombatState();
    cat.triggerMissile();
    cat.clearAirborneAttacks();
    return;
  }
  if (action === 'work' || hasTool) {
    cat.playWorkSwing();
    return;
  }
  cat.triggerAttack();
}

function tickCat(cat: CatPlayer): void {
  cat.updateAttack();
  cat.tickTimers();
}

export class CatPreviewScene extends PreviewScene {
  /** Who she is painted as; the first field, so every cat below is made in it. */
  private readonly cat = selectPreviewCat();
  /** The row pane's own cat, at the crawler's tier so every row of the figure can be shown. */
  readonly rowAppearance = new CatAppearance('crawler', this.cat.look);
  private rowIndex = initialRowIndex();
  private playback = new RowPlayback(PREVIEW_ROWS[this.rowIndex], this.rowAppearance);
  private readonly live = new CatPlayer(0, 0, TILE_SIZE, this.cat.look);
  private readonly compass: readonly CatPlayer[] = COMPASS.map(
    () => new CatPlayer(0, 0, TILE_SIZE, this.cat.look),
  );
  private readonly outfits = catOutfits();
  private outfitIndex = 0;
  private toolIndex = 0;
  private carryIndex = 0;
  private compassActionIndex = 0;
  private compassTicks = 0;
  private scriptStep = 0;
  private stepTicks = 0;

  constructor() {
    super();
    this.rowAppearance.prewarm();
    this.compass.forEach((cat, index) => {
      cat.facingX = COMPASS[index].x;
      cat.facingY = COMPASS[index].y;
    });
    const everything = this.outfits[this.outfits.length - 1].items;
    for (const cat of this.cats) {
      for (const id of everything) cat.inventory.addItem(id, 1);
    }
  }

  private get cats(): readonly CatPlayer[] {
    return [this.live, ...this.compass];
  }

  /** The outfit every cat on screen has on. */
  get outfit(): Outfit {
    return this.outfits[this.outfitIndex];
  }

  /** The tool every cat on screen is working with. */
  get toolOption(): ToolOption {
    return TOOL_OPTIONS[this.toolIndex];
  }

  /** What every cat on screen carries in her jaws. */
  get carryOption(): CarryOption {
    return CARRY_OPTIONS[this.carryIndex];
  }

  /** Every carried thing the picker steps through, in order. */
  get carryChoices(): readonly CarryOption[] {
    return CARRY_OPTIONS;
  }

  /** What the row pane draws her holding on its row, or null on a row that holds nothing. */
  get rowHeld(): CatHeldDraw | null {
    const hold = this.playback.row.hold;
    if (hold === null) return null;
    if (hold === 'carry') {
      const look = this.carryOption.look ?? FIRST_CARRIED;
      return look === null ? null : { look, phase: 0, hold };
    }
    if (hold === 'throw') return { look: ROW_PANE_THROWN, phase: 0, hold };
    const chosen = this.toolOption.tool;
    const chosenSwing = chosen === null ? null : CAT_WORK_SWING_OF_TOOL[chosen.kind];
    const tool = chosen !== null && chosenSwing === hold ? chosen : ROW_PANE_TOOL[hold];
    const look = workingToolHeldVisual(tool);
    return look === null ? null : { look, phase: 0, hold };
  }

  /** What the compass cats are all doing. */
  get compassAction(): CompassAction {
    return COMPASS_ACTIONS[this.compassActionIndex];
  }

  /** The cell the row pane draws this frame. */
  get rowCell(): CatCell {
    return catCellFor(this.playback.spriteState());
  }

  get previewRow(): PreviewRow {
    return this.playback.row;
  }

  /** Every outfit the picker steps through, in order. */
  get outfitChoices(): readonly Outfit[] {
    return this.outfits;
  }

  /** Every tool the picker steps through, in order. */
  get toolChoices(): readonly ToolOption[] {
    return TOOL_OPTIONS;
  }

  /** The facing each compass cat is drawn in, heading by heading. */
  compassFacings(): readonly FacingSelection[] {
    return this.compass.map((cat) => selectFacing(cat.facingX, cat.facingY));
  }

  private advanceRow(): void {
    this.rowIndex = (this.rowIndex + 1) % PREVIEW_ROWS.length;
    this.playback = new RowPlayback(PREVIEW_ROWS[this.rowIndex], this.rowAppearance);
  }

  private nextOutfit(): void {
    const previous = this.outfit;
    this.outfitIndex = (this.outfitIndex + 1) % this.outfits.length;
    for (const cat of this.cats) {
      // A preview steps through outfits; a cursed piece's binding is play, not dress-up.
      cat.gear.releaseBinds();
      for (const id of previous.items) cat.inventory.unequipById(id);
      for (const id of this.outfit.items) cat.inventory.equipByItemId(id);
    }
    this.rowAppearance.dress(catGarmentsWearing(this.outfit.items));
  }

  private nextTool(): void {
    this.toolIndex = (this.toolIndex + 1) % TOOL_OPTIONS.length;
    for (const cat of this.cats) cat.setWorkingTool(this.toolOption.tool);
  }

  private nextCarry(): void {
    this.carryIndex = (this.carryIndex + 1) % CARRY_OPTIONS.length;
    for (const cat of this.cats) cat.setMouthCarry(this.carryOption.look);
  }

  private nextCompassAction(): void {
    this.compassActionIndex = (this.compassActionIndex + 1) % COMPASS_ACTIONS.length;
    this.compassTicks = 0;
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (gesture.tap) this.advanceRow();
  }

  protected previewTitle(): string {
    return `cat preview — ?cat&look=${PREVIEW_CATS.map((cat) => cat.look.id).join('|')}`;
  }

  protected previewCaptions(): readonly string[] {
    const { row } = this.playback;
    const cell = this.rowCell;
    return [
      `${this.cat.displayName} — ${row.state} (${row.view}${row.facesWest ? ', facing west' : ''}) — click for the next row`,
      `frame ${cell.frame + 1} of ${row.frameCount}, at game timing`,
    ];
  }

  protected previewControls(): readonly PreviewControl[] {
    return [
      { id: 'row', label: 'next row', onTap: () => this.advanceRow() },
      { id: 'outfit', label: `outfit: ${this.outfit.label}`, onTap: () => this.nextOutfit() },
      { id: 'tool', label: `tool: ${this.toolOption.label}`, onTap: () => this.nextTool() },
      { id: 'carry', label: `carry: ${this.carryOption.label}`, onTap: () => this.nextCarry() },
      {
        id: 'compass',
        label: `compass: ${this.compassAction}`,
        onTap: () => this.nextCompassAction(),
      },
    ];
  }

  update(): void {
    this.playback.tick();
    this.tickCompass();
    this.tickLive();
  }

  private tickCompass(): void {
    const action = this.compassAction;
    const repeated = REPEATED_ACTION[action];
    const due = this.compassTicks % COMPASS_ACTION_REPEAT_TICKS === 0;
    const hasTool = this.toolOption.tool !== null;
    for (const cat of this.compass) {
      cat.isMoving = action === 'walk';
      if (repeated !== null && due) playAction(cat, repeated, hasTool);
      tickCat(cat);
    }
    this.compassTicks++;
  }

  private tickLive(): void {
    const step = LIVE_SCRIPT[this.scriptStep];
    if (this.stepTicks === 0 && step.action !== undefined) {
      playAction(this.live, step.action, this.toolOption.tool !== null);
    }
    if (step.move !== undefined) {
      this.live.isMoving = true;
      this.live.facingX = step.move.x;
      this.live.facingY = step.move.y;
      this.live.x += step.move.x * PLAYER_SPEED;
      this.live.y += step.move.y * PLAYER_SPEED;
    } else {
      this.live.isMoving = false;
    }
    tickCat(this.live);
    this.stepTicks++;
    if (this.stepTicks < step.ticks) return;
    this.stepTicks = 0;
    this.scriptStep = (this.scriptStep + 1) % LIVE_SCRIPT.length;
    // The circle closes on itself; snapping back keeps rounding from walking her out of the pane.
    if (this.scriptStep === 0) {
      this.live.x = 0;
      this.live.y = 0;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    worldTint(ctx, BG_COLOR, OPAQUE);

    const paneTop = this.headerBottom + MARGIN;
    const state = this.playback.spriteState();
    const cell = catCellFor(state);

    let x = MARGIN;
    for (const size of ROW_TILE_SIZES) {
      const paneWidth = size * PANE_SIZE_TILES;
      const caption = `${size}px — ${cell.state}[${cell.frame}]`;
      const tile = this.drawPane(ctx, x, paneTop, paneWidth, size, [caption]);
      drawCatSprite(ctx, this.rowAppearance, tile.x, tile.y, size, cell, state, this.rowHeld);
      x += paneWidth + PANE_GAP;
    }

    this.drawLivePane(ctx, x, paneTop);

    const captionBlock = CAPTION_GAP + CAPTION_LINES * LABEL_LINE_HEIGHT;
    const firstRowHeight = Math.max(REVIEW_TILE_SIZE * PANE_SIZE_TILES, LIVE_PANE_PX);
    this.drawCompass(ctx, paneTop + firstRowHeight + captionBlock + MARGIN);
    this.renderChrome(ctx);
  }

  private drawLivePane(ctx: CanvasRenderingContext2D, left: number, top: number): void {
    const step = LIVE_SCRIPT[this.scriptStep];
    const facing = selectFacing(this.live.facingX, this.live.facingY);
    const caption = `live: ${step.label} — ${facing.view}`;
    worldPlate(ctx, { x: left, y: top, w: LIVE_PANE_PX, h: LIVE_PANE_PX }, { fill: FLOOR_COLOR });
    this.drawCaption(ctx, left, top + LIVE_PANE_PX, [caption]);
    const circleCentreX = left + LIVE_PANE_PX / 2;
    const circleCentreY = top + LIVE_PANE_PX / 2;
    const startX = circleCentreX - CIRCLE_SIDE_PX / 2;
    const startY = circleCentreY - CIRCLE_APOTHEM_PX;
    const tileX = startX + this.live.x - LIVE_TILE_SIZE / 2;
    const tileY = startY + this.live.y - LIVE_TILE_SIZE / 2;
    this.live.paintBodyAt(ctx, tileX, tileY, LIVE_TILE_SIZE);
  }

  private drawCompass(ctx: CanvasRenderingContext2D, top: number): void {
    const paneWidth = COMPASS_TILE_SIZE * COMPASS_PANE_TILES;
    const facings = this.compassFacings();
    this.compass.forEach((cat, index) => {
      const left = MARGIN + index * (paneWidth + COMPASS_PANE_GAP);
      const facing = facings[index];
      const rowView = catRowViewOf(facing.view);
      const drawnAs = rowView === facing.view ? 'own rows' : `as ${rowView}`;
      const westward = facing.flipX ? ', facing west' : '';
      const caption = [`${COMPASS[index].label} ${facing.view}`, `${drawnAs}${westward}`];
      const tile = this.drawPane(ctx, left, top, paneWidth, COMPASS_TILE_SIZE, caption);
      cat.paintBodyAt(ctx, tile.x, tile.y, COMPASS_TILE_SIZE);
    });
  }

  /** A floor pane with its caption under it; returns where the tile it frames starts. */
  private drawPane(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    paneSide: number,
    size: number,
    caption: readonly string[],
  ): { readonly x: number; readonly y: number } {
    worldPlate(ctx, { x: left, y: top, w: paneSide, h: paneSide }, { fill: FLOOR_COLOR });
    this.drawCaption(ctx, left, top + paneSide, caption);
    return { x: left + (paneSide - size) / 2, y: top + paneSide - size };
  }

  private drawCaption(
    ctx: CanvasRenderingContext2D,
    left: number,
    bottom: number,
    lines: readonly string[],
  ): void {
    lines.forEach((line, index) => {
      worldText(ctx, line, {
        x: left,
        y: bottom + CAPTION_GAP + index * LABEL_LINE_HEIGHT,
        size: LABEL_SIZE,
        color: SUBLABEL_COLOR,
      });
    });
  }
}
