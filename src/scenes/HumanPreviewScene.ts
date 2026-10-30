/**
 * Localhost-only harness for the human crawler in motion. Reached via `?human` in
 * `devBootScene`; `?human=<row>` opens on that row, and `&look=<look id>` picks
 * which human in the registry is painted (the player's human by default).
 *
 * Two panes, both at the game's real timing:
 *
 * - **Row**: one row of the figure looped on the dungeon floor at 128, 64 and
 *   the in-game 32 px, paced exactly as the runtime paces it — a clock row at
 *   its own hold, a gait cycle by the ground base speed covers, a blow over the
 *   swing's own ticks. Click to step to the next row.
 * - **Live**: a real `HumanPlayer` ticked through a fixed script — stand, run,
 *   stop, strike, get hit, stand long enough to fidget — and drawn through the
 *   same selection `drawSelf` uses, so it shows the animator's hand-offs rather
 *   than any one row.
 *
 * The weapon picker lists every weapon he can hold, read off the item table:
 * picking one puts it in the live player's hand (and the script then draws
 * and stows it), shows it in the row pane, and jumps the row pane to the
 * first row its grip and weight play. A new weapon appears here with no edit.
 *
 * A contact sheet cannot show timing; this is where a floating stride or a
 * strobing cycle shows up.
 */

import { HUMAN_CRAWLER_LOOKS } from '../characters/humanCrawlerLooks';
import type { HumanLook } from '../sprites/looks/humanLook';
import { DAVE_LOOK } from '../sprites/looks/humans/dave';
import { PLAYER_SPEED, TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import { progressFrameIndex, walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { HUMAN_SWING_FRAMES } from '../core/party/crawlerFormulas';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { worldText } from '../ui/world/worldText';
import { worldPlate, worldTint } from '../ui/world/worldShapes';
import type { WorldGesture } from '../ui/core/UiRoot';
import { PreviewScene, type PreviewControl } from './PreviewScene';
import { HUMAN_ROWS, type RowSpec } from '../sprites/art/humanFigure';
import {
  activeHumanSocketSource,
  type BipedHeldDraw,
  type BipedStowedDraw,
  drawHumanSelection,
  explosiveHeldDraw,
  type HumanRowSelection,
  isGaitCycle,
  motionSetOfRow,
  prewarmHumanSprite,
  rowFrameAtTicks,
  setHumanLook,
  rowLengthInTicks,
  rowTicksPerFrame,
  activeHumanLook,
} from '../sprites/humanSprite';
import {
  ITEM_DEF,
  isItemId,
  type ItemId,
  MAIN_HAND_KEY,
  weaponStatsOf,
  wearerAllows,
} from '../core/items/defs/ItemDefs';
import { HELD_VISUALS, stowedPlacementOfHeld } from '../sprites/held/heldVisuals';
import type { WeaponHeldVisualDef } from '../sprites/held/heldVisualDef';
import { type MotionSet, motionSetOf } from '../sprites/art/human/motionSets';
import { humanSocketsAt } from '../sprites/art/human/sockets';
import { gaitRadiansPerPx } from '../sprites/humanAnimator';
import { groundPxPerFrame } from '../sprites/art/human/probe';
import { previewInk } from '../ui/theme/previewInk';

const BG_COLOR = previewInk.human.backdrop;
/** The dungeon floor's tone, the colour every in-game judgement is made against. */
const FLOOR_COLOR = previewInk.floor.unlitConcrete;
/** The backdrop covers whatever the last scene left on the canvas. */
const OPAQUE = 1;
const SUBLABEL_COLOR = previewInk.human.sublabel;

const MARGIN = 40;
const LABEL_SIZE = 12;
const PANE_GAP = 60;
const CAPTION_GAP = 8;
/** Each square pane, in tiles: the figure stands over a tile and a half above its own, so the pane is that much taller than a tile. */
const PANE_SIZE_TILES = 2.2;
/** A one-shot rests this long on its last frame before it plays again. */
const ONE_SHOT_REST_TICKS = 30;

const REVIEW_TILE_SIZE = 128;
const HALF_REVIEW_TILE_SIZE = 64;
/** Review size first, the in-game tile last: only the last one is what a player sees. */
const ROW_TILE_SIZES: ReadonlyArray<number> = [REVIEW_TILE_SIZE, HALF_REVIEW_TILE_SIZE, TILE_SIZE];
const LIVE_TILE_SIZE = HALF_REVIEW_TILE_SIZE;

/** One step of the live pane's script: how long, and what the stick is doing. */
interface ScriptStep {
  readonly ticks: number;
  readonly label: string;
  readonly move?: { readonly x: number; readonly y: number };
  readonly strike?: boolean;
  readonly hit?: boolean;
  /** With a weapon picked, takes it out or puts it away as the step begins. */
  readonly holster?: 'draw' | 'stow';
}

/** Long enough for the guard to drop and the relaxed idle to come back. */
const GUARD_THEN_IDLE_SECONDS = 4;
/** Past the longest fidget delay plus a full idle loop, so a fidget always shows. */
const UNTIL_FIDGET_SECONDS = 14;
const SECONDS = WORLD_TICKS_PER_SECOND;
const LIVE_SCRIPT: ReadonlyArray<ScriptStep> = [
  { ticks: 1 * SECONDS, label: 'stowing', holster: 'stow' },
  { ticks: 1 * SECONDS, label: 'drawing', holster: 'draw' },
  { ticks: 2 * SECONDS, label: 'standing' },
  { ticks: 2 * SECONDS, label: 'running right', move: { x: 1, y: 0 } },
  { ticks: 1 * SECONDS, label: 'stopped' },
  { ticks: 1 * SECONDS, label: 'running left, striking', move: { x: -1, y: 0 }, strike: true },
  { ticks: 1 * SECONDS, label: 'running down', move: { x: 0, y: 1 } },
  { ticks: 1 * SECONDS, label: 'hit', hit: true },
  { ticks: GUARD_THEN_IDLE_SECONDS * SECONDS, label: 'guard, then idle' },
  { ticks: UNTIL_FIDGET_SECONDS * SECONDS, label: 'idle long enough to fidget' },
];

/** The frame a row shows `ticks` into playing it, paced the way the runtime paces it. */
function frameAt(row: RowSpec, ticks: number): number {
  if (isGaitCycle(row)) {
    const phase = ticks * PLAYER_SPEED * gaitRadiansPerPx(row.gait);
    return walkFrameIndex(phase, row.frameCount);
  }
  const isBlow = row.role === 'strike' || row.role === 'stomp';
  const hold = rowTicksPerFrame(row);
  if (row.kind === 'loop') return rowFrameAtTicks(row, ticks % rowLengthInTicks(row));
  // The run's start is paced by the ground he covers, like the cycle it leads into.
  const groundPaced = !isBlow && row.locomotion === 'travelling';
  const ticksPerFrame = groundPaced ? groundPxPerFrame(row) / PLAYER_SPEED : hold;
  const length = isBlow ? HUMAN_SWING_FRAMES : row.frameCount * ticksPerFrame;
  const withinPlay = ticks % (length + ONE_SHOT_REST_TICKS);
  const progress = Math.min(withinPlay / length, 1);
  return progressFrameIndex(progress, row.frameCount);
}

/** Every weapon item he can hold, in the item table's order, read off its definition. */
export function previewWeapons(): readonly ItemId[] {
  return Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => {
      const def = ITEM_DEF[id];
      return (
        weaponStatsOf(id) !== null && def.wearer !== undefined && wearerAllows(def.wearer, 'human')
      );
    });
}

function weaponLook(id: ItemId): WeaponHeldVisualDef | null {
  const weapon = weaponStatsOf(id);
  return weapon === null ? null : HELD_VISUALS[weapon.heldVisual];
}

function initialRowIndex(): number {
  const wanted = new URLSearchParams(window.location.search).get('human');
  const index = HUMAN_ROWS.findIndex((row) => row.name === wanted);
  return Math.max(0, index);
}

/** The looks the preview can paint, by the id `&look=` names: every human crawler look, and Dave. */
const PREVIEW_LOOKS: readonly HumanLook[] = [...Object.values(HUMAN_CRAWLER_LOOKS), DAVE_LOOK];

/**
 * The human `&look=` names, the human crawler's current look by default, made the look the human crawler
 * is painted as. Called from the scene's first field initializer, so every
 * player and prewarm the scene builds after it is built on that look.
 */
function selectPreviewLook(): HumanLook {
  const wanted = new URLSearchParams(window.location.search).get('look');
  const look = PREVIEW_LOOKS.find((candidate) => candidate.id === wanted) ?? activeHumanLook();
  setHumanLook(look);
  return look;
}

export class HumanPreviewScene extends PreviewScene {
  /** Who the preview paints: `&look=` names one of the human looks. */
  readonly look = selectPreviewLook();
  private rowIndex = initialRowIndex();
  private rowTicks = 0;
  private readonly live = new HumanPlayer(0, 0, TILE_SIZE);
  private scriptStep = 0;
  private stepTicks = 0;
  /** Bare hands first, then every weapon he can hold. */
  readonly weaponChoices: readonly (ItemId | null)[] = [null, ...previewWeapons()];
  private weaponIndex = 0;

  constructor() {
    super();
    for (const id of previewWeapons()) this.live.inventory.addItem(id, 1);
    prewarmHumanSprite();
  }

  /** The weapon picked, or null for bare hands. */
  get pickedWeapon(): ItemId | null {
    return this.weaponChoices[this.weaponIndex] ?? null;
  }

  /** The live player, for the preview's checks. */
  get livePlayer(): HumanPlayer {
    return this.live;
  }

  /** The row the row pane is showing. */
  get shownRow(): RowSpec {
    return HUMAN_ROWS[this.rowIndex];
  }

  /**
   * Picks the next weapon: puts it out in the live player's hand, starts the
   * live script over at its stow and draw, and turns the row pane to the
   * first row its grip and weight play.
   */
  nextWeapon(): void {
    this.weaponIndex = (this.weaponIndex + 1) % this.weaponChoices.length;
    const id = this.pickedWeapon;
    if (id === null) {
      this.live.inventory.equipment.unequip(MAIN_HAND_KEY);
      return;
    }
    this.live.drawWeapon(id);
    // Back to the script's first step, so a weapon just picked is stowed and
    // drawn straight away rather than whenever the lap next comes round.
    this.scriptStep = 0;
    this.stepTicks = 0;
    const look = weaponLook(id);
    const set: MotionSet = look === null ? 'unarmed' : motionSetOf(look);
    const first = HUMAN_ROWS.findIndex((row) => motionSetOfRow(row) === set);
    if (set !== 'unarmed' && first >= 0) {
      this.rowIndex = first;
      this.rowTicks = 0;
    }
  }

  private advanceRow(): void {
    this.rowIndex = (this.rowIndex + 1) % HUMAN_ROWS.length;
    this.rowTicks = 0;
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (gesture.tap) this.advanceRow();
  }

  protected previewTitle(): string {
    return `human preview — ?human&look=${PREVIEW_LOOKS.map((look) => look.id).join('|')}`;
  }

  protected previewCaptions(): readonly string[] {
    const row = HUMAN_ROWS[this.rowIndex];
    const frame = frameAt(row, this.rowTicks);
    return [
      `${this.look.id} — ${row.name} (${row.view}, ${row.kind}) — click for the next row`,
      `frame ${frame + 1} of ${row.frameCount}, at game timing`,
    ];
  }

  protected previewControls(): readonly PreviewControl[] {
    const id = this.pickedWeapon;
    return [
      {
        label: 'next row',
        onTap: () => {
          this.advanceRow();
        },
      },
      {
        id: 'weapon',
        label: `weapon: ${id === null ? 'bare hands' : ITEM_DEF[id].name}`,
        onTap: () => {
          this.nextWeapon();
        },
      },
    ];
  }

  update(): void {
    this.rowTicks++;
    this.tickLive();
  }

  private tickLive(): void {
    const step = LIVE_SCRIPT[this.scriptStep];
    const weapon = this.pickedWeapon;
    if (this.stepTicks === 0 && weapon !== null && step.holster === 'draw') {
      this.live.drawWeapon(weapon);
    }
    if (this.stepTicks === 0 && weapon !== null && step.holster === 'stow') this.live.stowWeapon();
    if (this.stepTicks === 0 && step.hit === true) {
      this.live.takeDamage(1, { kind: 'mob', mobType: 'preview' });
      // The script loops forever; a scratch per lap would eventually knock him out.
      this.live.hp = this.live.maxHp;
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
    if (step.strike === true && this.live.attackTimer === 0) this.live.triggerAttack();
    this.live.updateAttack();
    this.live.tickTimers();
    this.stepTicks++;
    if (this.stepTicks < step.ticks) return;
    this.stepTicks = 0;
    this.scriptStep = (this.scriptStep + 1) % LIVE_SCRIPT.length;
    // The live pane stays in view however far the script walks him.
    if (this.scriptStep === 0) {
      this.live.x = 0;
      this.live.y = 0;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    worldTint(ctx, BG_COLOR, OPAQUE);

    const row = HUMAN_ROWS[this.rowIndex];
    const frame = frameAt(row, this.rowTicks);
    const paneTop = this.headerBottom + MARGIN;

    let x = MARGIN;
    for (const size of ROW_TILE_SIZES) {
      const selection = { row: row.name, frame, flipX: false };
      this.drawPane(ctx, x, paneTop, size, `${size}px`, (left, top) => {
        drawHumanSelection(
          ctx,
          left,
          top,
          size,
          selection,
          this.rowHeld(selection),
          this.rowStowed(selection),
        );
      });
      x += size * PANE_SIZE_TILES + PANE_GAP;
    }

    const step = LIVE_SCRIPT[this.scriptStep];
    const live = this.live.spriteSelection();
    const liveCaption = `live: ${step.label} — ${live.row}[${live.frame}]`;
    this.drawPane(ctx, x, paneTop, LIVE_TILE_SIZE, liveCaption, (left, top) => {
      this.live.paintBodyAt(ctx, left, top, LIVE_TILE_SIZE);
    });
    this.renderChrome(ctx);
  }

  /**
   * What is in his fist on the row pane's cells: a stick of dynamite on the
   * rows that throw one, else the picked weapon where the row closes his fist
   * on one.
   */
  private rowHeld(selection: HumanRowSelection): BipedHeldDraw | null {
    const explosive = explosiveHeldDraw(HELD_VISUALS.prop_dynamite, selection);
    if (explosive !== null) return explosive;
    const id = this.pickedWeapon;
    const look = id === null ? null : weaponLook(id);
    return look === null ? null : { look, phase: 0 };
  }

  /** The picked weapon where it rests, on the row pane's cells of a draw or stow before his fist reaches it. */
  private rowStowed(selection: HumanRowSelection): BipedStowedDraw | null {
    const id = this.pickedWeapon;
    const look = id === null ? null : weaponLook(id);
    if (look === null || HUMAN_ROWS[this.rowIndex].holster === undefined) return null;
    const placement = stowedPlacementOfHeld(look);
    if (placement === 'none') return null;
    const frames = humanSocketsAt(activeHumanSocketSource(), selection.row, selection.frame);
    return frames.sockets.mainHand.grips === true ? null : { look, placement };
  }

  private drawPane(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    size: number,
    caption: string,
    paint: (tileLeft: number, tileTop: number) => void,
  ): void {
    const paneWidth = size * PANE_SIZE_TILES;
    const paneHeight = size * PANE_SIZE_TILES;
    worldPlate(ctx, { x: left, y: top, w: paneWidth, h: paneHeight }, { fill: FLOOR_COLOR });
    const tileLeft = left + (paneWidth - size) / 2;
    const tileTop = top + paneHeight - size;
    paint(tileLeft, tileTop);
    worldText(ctx, caption, {
      x: left,
      y: top + paneHeight + CAPTION_GAP,
      size: LABEL_SIZE,
      color: SUBLABEL_COLOR,
    });
  }
}
