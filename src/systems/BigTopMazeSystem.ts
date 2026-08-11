/**
 * BigTopMazeSystem — the finale of "The Show Must Go On", inside the tent.
 *
 * Not a fight. The human and the cat come in through two flaps into two sealed
 * halves of a trap maze, each walks their own corridors of flame vents, and each
 * runs into doors only the other one can open: a counterweight behind a grate
 * that wants the cat's missile, a load-bearing brace through the wall that wants
 * the human's swing. The halves meet at the tent pole, where what is left of
 * Redstone Grimaldi is wrapped around it — and the answer there is a health
 * potion poured over him, not a weapon.
 *
 * Fire costs no health here. A crawler caught by a vent passes out, and both of
 * them wake up at their own flap with every door they had already opened still
 * open — so the price of a mistimed corridor is the corridor, paid in the only
 * currency a timing puzzle can charge without making itself unfinishable.
 *
 * Owned by `BuildingInteriorScene`, which supplies the roster. All state is
 * scene-local and rebuilt from scratch on every entry: the maze holds nothing
 * across the door, so leaving mid-run and coming back starts it over.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { GroundHazardSource } from './GroundHazardSource';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CircusQuestProgress } from '../core/CircusQuestProgress';
import { keybindings } from '../core/Keybindings';
import { platform } from '../core/Platform';
import { GrimaldiVine } from '../creatures/GrimaldiVine';
import { MazeBlockTarget } from '../creatures/MazeBlockTarget';
import { QuestDialog } from '../ui/QuestDialog';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawText } from '../ui/TextBox';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import {
  drawFlameVentColumn,
  drawFlameVentGrille,
  drawFlameVentTelegraph,
  drawMazeBarricade,
  drawMazeGate,
  drawMazeGrate,
} from '../sprites/bigTopMazeProps';
import {
  BURNOUT_FLASH_FRAMES,
  isInFinalChamber,
  MAZE_CAT_SPAWN_TILE,
  MAZE_HUMAN_SPAWN_TILE,
  MAZE_BLOCKS,
  MAZE_GRIMALDI_TILE,
  MAZE_VENTS,
  ventFlameProgress,
  ventPhaseAt,
  ventTelegraphProgress,
  type MazeBlock,
  type MazeHalf,
  type VentSchedule,
} from '../map/bigTopMazeLayout';
import { BIGTOP_BURNOUT_DIALOG, GRIMALDI_CURE_DIALOG } from './circusQuestDialogs';
import { SAWDUST_FLOOR } from '../map/tileTypes';
import { drawOverlay } from '../ui/Box';

const FRAMES_PER_SECOND = 60;

/** Music fades, matched to the ones the overworld half of the questline uses. */
const CIRCUS_BATTLE_FADE_IN_MS = 1000;
const CIRCUS_THEME_FADE_IN_MS = 2000;

/** How close a crawler must be to the vine to pour the potion on him. */
const POUR_RANGE_TILES = 2.4;
/** How close a crawler must be to their own unsolved block for the hint to show. */
const BLOCK_HINT_RANGE_TILES = 3.5;
/** How close the acting crawler must be to a target for its action prompt to show. */
const TARGET_PROMPT_RANGE_TILES = 3;

/** The white-out a burnout paints over everything, at its brightest. */
const BURNOUT_FLASH_COLOR = '#ffe8c0';
const BURNOUT_FLASH_PEAK_ALPHA = 0.92;

/** The one consumable the cure spends, when the party happens to have one. */
const POUR_ITEM_ID = 'health_potion';

const BANNER_SECONDS = 5;
const BANNER_FRAMES = BANNER_SECONDS * FRAMES_PER_SECOND;
const BANNER_FADE_FRAMES = 60;
const BANNER_TITLE_Y = 70;
const BANNER_TITLE_SIZE = 26;
const BANNER_SUBTITLE_Y = 102;
const BANNER_SUBTITLE_SIZE = 13;
const BANNER_GLOW_BLUR = 12;

// ── Cutscene script, in frames at 60 fps ──────────────────────────────────────

/** The vine takes the poison on and sags. */
const CS_POISON_FRAME = 20;
/** How long the poison takes to bloom fully across him. */
const CS_POISON_BLOOM_FRAMES = 70;
/** Carl starts talking once the vine has visibly reacted. */
const CS_DIALOG_FRAME = 110;
/** After the last dialog page, the human walks the last steps up to the trunk. */
const CS_APPROACH_FRAMES = 45;
/** The cure flourish: the tint drains, the mass straightens, the glow lifts. */
const CS_CURE_FRAMES = 110;
/** How far short of the vine the scripted walk stops. */
const CS_APPROACH_STOP_TILES = 1.5;
/** Frames the camera takes to slide from the crawler onto the vine. */
const CS_CAMERA_LERP_FRAMES = 45;

/** Where in the cutscene the script currently is. */
type CutsceneBeat = 'poison' | 'dialog' | 'approach' | 'cure' | 'done';

const OBJECTIVE_Y_FROM_BOTTOM = 96;
const OBJECTIVE_SIZE = 13;

/** World-space hint text sits this far above the crawler's head. */
const HINT_LIFT_TILES = 1.6;
const HINT_SIZE = 11;
const HINT_COLOR = '#ffe9a8';
const HINT_OUTLINE = 'rgba(0,0,0,0.85)';

const TILE_CENTRE = 0.5;

/** How far above its own tile a flame column reaches, for the culling test. */
const FLAME_COLUMN_HEIGHT_TILES = 2;

/**
 * How far apart two vents' flame clocks are set, so a bank of them lighting on
 * the same frame does not churn in lockstep.
 *
 * The column art is a pure function of the frame counter it is handed, and the
 * vents carry no state of their own to vary it with — so the offset has to come
 * from the one thing a vent does own, its tile. Strides that share no factor
 * with the spread keep neighbours in a row and in a column apart.
 */
const VENT_PHASE_SPREAD_FRAMES = 37;
const VENT_PHASE_COLUMN_STRIDE = 7;
const VENT_PHASE_ROW_STRIDE = 13;

function ventFlamePhase(vent: VentSchedule, frame: number): number {
  const offset =
    (vent.tileX * VENT_PHASE_COLUMN_STRIDE + vent.tileY * VENT_PHASE_ROW_STRIDE) %
    VENT_PHASE_SPREAD_FRAMES;
  return frame + offset;
}

/** How near a vent has to be for its ignition to be worth hearing. */
const VENT_CUE_RANGE_TILES = 9;
/** How long the ignition cue rests before another vent may claim it. */
const VENT_CUE_COOLDOWN_FRAMES = 18;

/**
 * How close to a vent's centre the companion steering treats as "get off this".
 *
 * Only correct inside a narrow band, and both edges of it bite:
 *
 * - Below `√2 / 2 ≈ 0.707` it stops covering the vent's own tile. Positions are
 *   compared centre to centre, and the same centre-tile rule decides who gets
 *   burned out — so a crawler whose centre sits in the corner region of a lit
 *   vent would cost the party the whole run with the steering never having
 *   reacted at all.
 * - At 1 or above it reaches the centre of the tile next door. The maze's safe
 *   ground is usually exactly there (a pulse corridor's dwell cells sit between
 *   two banks), so a wider reach shoves a parked crawler off perfectly good
 *   ground every time the bank beside them lights.
 *
 * Exported, and asserted against both bounds by the maze's own gate, because
 * neither failure has a symptom anything else would catch.
 */
export const HAZARD_ESCAPE_RADIUS_TILES = 0.8;

/**
 * Whether a tile drawn at this screen position is worth the paint.
 *
 * The maze is 44×30 tiles against a viewport that shows well under half of it,
 * and a lit vent costs a gradient and a dozen bezier fills — so more than half
 * of that work would be spent on flame nobody can see. `liftTiles` extends the
 * test upward for art that stands taller than its own tile.
 */
function isOnScreen(x: number, y: number, liftTiles = 0): boolean {
  return (
    x > -TILE_SIZE &&
    y > -TILE_SIZE * (1 + liftTiles) &&
    x < viewportWidth() + TILE_SIZE &&
    y < viewportHeight() + TILE_SIZE
  );
}

function tileKeyOf(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

/** Cardinal steps only: a parked crawler walks, and a diagonal can cut a corner. */
const RESTING_SPOT_NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export class BigTopMazeSystem implements GameSystem, GroundHazardSource {
  /**
   * Shown by BuildingInteriorScene if the party falls in here.
   *
   * Nothing in the maze can kill them — the fire costs the walk rather than
   * health, and both creatures in the room are damage-immune — so the only way
   * to reach this is to come through the flap already burning or poisoned.
   */
  readonly defeatMessage = 'The show went on without you.';

  private frame = 0;
  private grimaldi: GrimaldiVine | null = null;
  private readonly targets = new Map<string, MazeBlockTarget>();
  /** Every tile a vent can light, for the "is this safe to stand on" question. */
  private readonly ventTiles = new Set(MAZE_VENTS.map((vent) => tileKeyOf(vent.tileX, vent.tileY)));
  private readonly clearedBlocks = new Set<string>();

  /** Vents stop for good once the cure lands — the tent has nothing left to defend. */
  private hazardsArmed = true;

  /** Frames left before another vent may be heard lighting. */
  private ventCueCooldown = 0;

  /** Frames left of the white-out a burnout paints. Drives nothing but the paint. */
  private flashFrames = 0;

  /**
   * The most recent frame context, so `renderUI` — which is handed only a
   * drawing surface — can still ask where the crawlers are standing.
   */
  private lastContext: SystemContext | null = null;

  private beat: CutsceneBeat | null = null;
  private beatFrame = 0;
  private cameraLerp = 0;
  private cameraLerpFrom: { x: number; y: number } | null = null;
  private approachFrom: { x: number; y: number } | null = null;

  private bannerTimer = BANNER_FRAMES;

  private readonly dialog: QuestDialog;
  /**
   * Kept apart from the cure's box rather than shared with it, because the two
   * answer Escape in opposite ways: the cure may not be dismissed at all, and
   * this one is nothing but a dismissal.
   */
  private readonly burnoutDialog: QuestDialog;

  /** Polled and cleared by the scene, which owns the door out. */
  exitPending = false;
  /**
   * Set when a burnout has moved both crawlers, so the scene can re-anchor the
   * parked one. Without it the anchored follow drive walks whoever the player is
   * not holding straight back out of the flap and into the corridor they just
   * burned in.
   */
  partyResetPending = false;
  /** Polled and cleared by the scene's audio pass. */
  gateSoundPending = false;
  braceSoundPending = false;
  ventIgnitionSoundPending = false;
  pourSoundPending = false;
  burnoutSoundPending = false;
  cureSoundPending = false;
  vineGroanSoundPending = false;

  constructor(
    private readonly map: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: CircusQuestProgress,
    private readonly audio: AudioManager | null,
  ) {
    this.dialog = new QuestDialog(audio);
    this.burnoutDialog = new QuestDialog(audio);
    this.spawnFurniture();
    // Deliberately no `bossFightInitiated`: there is no boss and no fight, and
    // the event is what hands the soundtrack to the boss-music table.
    this.audio?.playMusic('circus_battle', { fadeInMs: CIRCUS_BATTLE_FADE_IN_MS });
  }

  private spawnFurniture(): void {
    const grimaldi = new GrimaldiVine(MAZE_GRIMALDI_TILE.x, MAZE_GRIMALDI_TILE.y, TILE_SIZE);
    grimaldi.setMap(this.map);
    this.addMob(grimaldi);
    this.grimaldi = grimaldi;

    for (const block of MAZE_BLOCKS) {
      // The destructible presents the face the acting crawler approaches from,
      // which is whichever side of the dividing wall its own half is on.
      const facing = block.propTile.x > block.grateTile.x ? 'east' : 'west';
      const target = new MazeBlockTarget(
        block.propTile.x,
        block.propTile.y,
        TILE_SIZE,
        block.kind,
        facing,
      );
      target.setMap(this.map);
      this.addMob(target);
      this.targets.set(block.id, target);
    }
  }

  // ── Public surface consumed by BuildingInteriorScene ───────────────────────

  get isDialogOpen(): boolean {
    return this.dialog.isOpen || this.burnoutDialog.isOpen;
  }

  advanceDialog(): boolean {
    return this.burnoutDialog.advance() || this.dialog.advance();
  }

  /**
   * Escape closes the burnout box and refuses to close the cure's.
   *
   * The cure's dialog is one beat of a script that is holding both crawlers
   * still and waiting on the box to finish — dismissing it without finishing it
   * would leave the party locked in place with nothing left to advance, and no
   * way out of the finale at all. There is nothing to decline there anyway: the
   * potion has already been poured. The burnout box is the opposite: nothing is
   * waiting on it, the party has already been moved, and it is pure explanation.
   */
  dismissDialog(): boolean {
    return this.burnoutDialog.dismiss();
  }

  handleClick(mx: number, my: number): boolean {
    return this.burnoutDialog.handleClick(mx, my) || this.dialog.handleClick(mx, my);
  }

  /**
   * True while the script owns both crawlers. The scene skips movement and
   * attack input entirely, the same way the spider quest's cutscene does.
   */
  get playerLocked(): boolean {
    return this.beat !== null && this.beat !== 'done';
  }

  /**
   * The maze is two people solving one room from opposite sides, so the party
   * may not be bundled back together: following would walk the idle crawler
   * into a corridor nobody is steering them through.
   */
  get followDisabled(): boolean {
    return true;
  }

  /** The point the camera holds, or null while the crawlers own it. */
  get cameraTargetOverride(): { x: number; y: number } | null {
    const grimaldi = this.grimaldi;
    if (grimaldi === null || !this.playerLocked) return null;
    const target = { x: grimaldi.x, y: grimaldi.y };
    const from = this.cameraLerpFrom;
    if (from === null || this.cameraLerp >= 1) return target;
    return {
      x: from.x + (target.x - from.x) * this.cameraLerp,
      y: from.y + (target.y - from.y) * this.cameraLerp,
    };
  }

  // ── Hazards ───────────────────────────────────────────────────────────────

  private get liveVents(): ReadonlyArray<VentSchedule> {
    return this.hazardsArmed ? MAZE_VENTS : [];
  }

  /** The push out of any vent that is lit or about to be, for companion steering. */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const cx = x + TILE_SIZE * TILE_CENTRE;
    const cy = y + TILE_SIZE * TILE_CENTRE;
    const reach = TILE_SIZE * HAZARD_ESCAPE_RADIUS_TILES;
    let pushX = 0;
    let pushY = 0;
    for (const vent of this.liveVents) {
      if (ventPhaseAt(vent, this.frame) === 'idle') continue;
      const ventCx = (vent.tileX + TILE_CENTRE) * TILE_SIZE;
      const ventCy = (vent.tileY + TILE_CENTRE) * TILE_SIZE;
      const dx = cx - ventCx;
      const dy = cy - ventCy;
      const dist = Math.hypot(dx, dy);
      if (dist > reach) continue;
      if (dist === 0) {
        // Standing dead centre gives no direction of its own; anywhere is better.
        pushY -= 1;
        continue;
      }
      const weight = 1 - dist / reach;
      pushX += (dx / dist) * weight;
      pushY += (dy / dist) * weight;
    }
    const magnitude = Math.hypot(pushX, pushY);
    if (magnitude === 0) return null;
    return { dx: pushX / magnitude, dy: pushY / magnitude };
  }

  /**
   * Where a crawler should be parked when the player hands them over.
   *
   * Their own position, unless that is ground a vent lights — the anchored
   * follow drive walks a parked crawler back to their anchor over and over, and
   * an anchor inside a trap corridor is a crawler stepping into fire every time
   * it goes out. Returns a *world* position, so it can be handed straight to the
   * companion system as an anchor.
   */
  restingSpotFor(entity: Player): { x: number; y: number } {
    const tileX = Math.floor((entity.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE);
    const tileY = Math.floor((entity.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE);
    if (!this.ventTiles.has(tileKeyOf(tileX, tileY))) return { x: entity.x, y: entity.y };

    // Deliberately the *whole* rule: a crawler on ground that never lights is
    // left exactly where the player put them. Preferring somewhere roomier was
    // tried and backed out — every rest cell the maze teaches the player to
    // stand on (an alcove pocket, a dwell cell between two banks) sits one tile
    // off a vent by construction, so "roomier" moved the crawler out of the very
    // spot the corridor was designed around, and sometimes across the fire to
    // get there.
    //
    // A sprint corridor has no vent-free tile in it at all, so this walk can be
    // long. That is right: there is nowhere in one to stand, and walking out the
    // way they came is the only answer. The follower outpaces the flame wave.
    const seen = new Set<string>([tileKeyOf(tileX, tileY)]);
    const queue = [{ x: tileX, y: tileY }];
    for (const tile of queue) {
      if (!this.ventTiles.has(tileKeyOf(tile.x, tile.y))) {
        return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
      }
      for (const [dx, dy] of RESTING_SPOT_NEIGHBOURS) {
        const next = { x: tile.x + dx, y: tile.y + dy };
        const key = tileKeyOf(next.x, next.y);
        if (seen.has(key) || !this.map.isWalkable(next.x, next.y)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    // Unreachable in the authored maze — every corridor opens onto ground that
    // never burns — so leaving them where they stand is the safe default.
    return { x: entity.x, y: entity.y };
  }

  /** The lit vent this crawler is standing in, if any. */
  private ventUnder(entity: Player): VentSchedule | null {
    const tileX = Math.floor((entity.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE);
    const tileY = Math.floor((entity.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE);
    for (const vent of this.liveVents) {
      if (vent.tileX !== tileX || vent.tileY !== tileY) continue;
      return ventPhaseAt(vent, this.frame) === 'flame' ? vent : null;
    }
    return null;
  }

  /**
   * Sends the whole party back to their flaps, because one of them stood in fire.
   *
   * No health changes hands. Touching a vent costs the walk — both crawlers wake
   * up where they came in and do the corridors again — which is the only
   * currency a timing puzzle can charge in without eventually making itself
   * unfinishable. Doors already opened stay open: a burn teaches the corridor,
   * and re-locking a counterweight somebody already brought down would teach
   * nothing but resentment.
   *
   * Both, not just the one who burned. The maze is solved by two people standing
   * in the right two places, and leaving the other crawler mid-corridor while
   * their partner restarts would hand the player a state neither of them can
   * walk out of.
   */
  private beginBurnout(ctx: SystemContext): void {
    this.placeAtSpawn(ctx.human, MAZE_HUMAN_SPAWN_TILE);
    this.placeAtSpawn(ctx.cat, MAZE_CAT_SPAWN_TILE);
    this.flashFrames = BURNOUT_FLASH_FRAMES;
    this.partyResetPending = true;
    this.burnoutSoundPending = true;
    this.burnoutDialog.open(BIGTOP_BURNOUT_DIALOG, () => undefined);
  }

  /**
   * Puts a crawler back on their flap and stops them dead.
   *
   * The momentum matters as much as the position: a crawler mid-knockback or
   * mid-attack arrives at the flap still carrying the frames they left with, and
   * a shove owed from a corridor two rooms away would spend itself walking them
   * off the tile they just woke up on.
   */
  private placeAtSpawn(entity: Player, tile: { x: number; y: number }): void {
    entity.x = tile.x * TILE_SIZE;
    entity.y = tile.y * TILE_SIZE;
    entity.knockbackFramesRemaining = 0;
    entity.isMoving = false;
  }

  /**
   * Whether either crawler is standing in fire this frame.
   *
   * Deliberately not "which one": a burnout resets both of them, so the identity
   * of whoever was careless is a fact with nothing downstream that wants it.
   */
  private someoneIsInFlame(ctx: SystemContext): boolean {
    return (
      (ctx.human.isAlive && this.ventUnder(ctx.human) !== null) ||
      (ctx.cat.isAlive && this.ventUnder(ctx.cat) !== null)
    );
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  private blockFor(id: string): MazeBlock {
    const block = MAZE_BLOCKS.find((candidate) => candidate.id === id);
    // Every id in `targets` came out of MAZE_BLOCKS a moment ago.
    if (block === undefined) throw new Error(`unknown Big Top maze block: ${id}`);
    return block;
  }

  private openBarrier(block: MazeBlock): void {
    const tile = this.map.structure[block.barrierTile.y][block.barrierTile.x];
    // Walkability is read off the live tile type, so opening a barrier is a
    // single write; only the painted art is cached, and that is what the dirty
    // mark is for.
    tile.type = SAWDUST_FLOOR;
    this.map.markTileDirty(block.barrierTile.x, block.barrierTile.y);
    this.clearedBlocks.add(block.id);
    if (block.kind === 'sandbag') this.gateSoundPending = true;
    else this.braceSoundPending = true;
  }

  private updateBlocks(): void {
    for (const [id, target] of this.targets) {
      if (!target.broken || this.clearedBlocks.has(id)) continue;
      this.openBarrier(this.blockFor(id));
    }
  }

  /** The first block of this half that is still standing, if any. */
  private pendingBlockFor(half: MazeHalf): MazeBlock | null {
    return (
      MAZE_BLOCKS.find((block) => block.blocks === half && !this.clearedBlocks.has(block.id)) ??
      null
    );
  }

  /** The first block this half can act on, if any. */
  private pendingActionFor(half: MazeHalf): MazeBlock | null {
    return (
      MAZE_BLOCKS.find((block) => block.clearedBy === half && !this.clearedBlocks.has(block.id)) ??
      null
    );
  }

  private halfOf(entity: Player, human: HumanPlayer): MazeHalf {
    return entity === human ? 'human' : 'cat';
  }

  // ── The pour ──────────────────────────────────────────────────────────────

  private inChamber(entity: Player): boolean {
    return isInFinalChamber(
      Math.floor((entity.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
      Math.floor((entity.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
    );
  }

  private bothInChamber(ctx: SystemContext): boolean {
    return this.inChamber(ctx.human) && this.inChamber(ctx.cat);
  }

  private canPour(ctx: SystemContext): boolean {
    const grimaldi = this.grimaldi;
    if (grimaldi === null || this.beat !== null) return false;
    // The human does the pouring — it is Carl who has the conversation, and the
    // cat has no hands for a bottle.
    if (ctx.active !== ctx.human) return false;
    if (!this.bothInChamber(ctx)) return false;
    const dist = Math.hypot(grimaldi.x - ctx.human.x, grimaldi.y - ctx.human.y);
    return dist <= TILE_SIZE * POUR_RANGE_TILES;
  }

  /** Space / tap: pours the potion and starts the cure. Returns true when handled. */
  tryInteract(ctx: SystemContext): boolean {
    if (!this.canPour(ctx)) return false;
    this.beginCure(ctx);
    return true;
  }

  private beginCure(ctx: SystemContext): void {
    const human = ctx.human;
    // Taken from whichever pack has one — Signet hands the bottle to whoever
    // walked up to her, and that is not always the crawler who pours it.
    //
    // Spent if the party has one, but never required: the pour is a scripted act
    // of the story, and a quest that could dead-end on an empty pack is a quest
    // that eventually does.
    if (!human.inventory.removeOne(POUR_ITEM_ID)) ctx.cat.inventory.removeOne(POUR_ITEM_ID);
    this.pourSoundPending = true;
    this.vineGroanSoundPending = true;
    this.beat = 'poison';
    this.beatFrame = 0;
    this.cameraLerp = 0;
    this.cameraLerpFrom = { x: human.x, y: human.y };
    this.bannerTimer = 0;
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.lastContext = ctx;
    this.frame++;
    if (this.bannerTimer > 0) this.bannerTimer--;
    if (this.flashFrames > 0) this.flashFrames--;

    this.updateBlocks();

    if (this.beat !== null) {
      this.updateCutscene(ctx);
      return;
    }

    // Ahead of the ignition cue, so the frame a crawler is caught plays the
    // burnout rather than one more whoosh from the vent that caught them.
    if (this.someoneIsInFlame(ctx)) {
      this.beginBurnout(ctx);
      return;
    }
    // Silent behind the burnout box: the scene halts before draining the cue,
    // so a vent lighting while the player reads would be heard on the frame they
    // close it, whooshing for fire that finished burning long before.
    if (!this.burnoutDialog.isOpen) this.noteVentIgnition(ctx.active);
  }

  /**
   * The ignition cue, for vents the crawler is actually near.
   *
   * Sixty-six vents on six clocks light about fifteen times a second between
   * them; played unconditionally that is a fireball whoosh every four frames,
   * most of it from the other half of the tent where the player cannot even see
   * the flame it belongs to. Only what is close enough to matter is heard, and
   * never twice inside one breath.
   */
  private noteVentIgnition(active: Player): void {
    if (this.ventCueCooldown > 0) {
      this.ventCueCooldown--;
      return;
    }
    const reach = TILE_SIZE * VENT_CUE_RANGE_TILES;
    for (const vent of this.liveVents) {
      if (ventPhaseAt(vent, this.frame) !== 'flame') continue;
      if (ventPhaseAt(vent, this.frame - 1) === 'flame') continue;
      const dx = (vent.tileX + TILE_CENTRE) * TILE_SIZE - (active.x + TILE_SIZE * TILE_CENTRE);
      const dy = (vent.tileY + TILE_CENTRE) * TILE_SIZE - (active.y + TILE_SIZE * TILE_CENTRE);
      if (Math.hypot(dx, dy) > reach) continue;
      this.ventIgnitionSoundPending = true;
      this.ventCueCooldown = VENT_CUE_COOLDOWN_FRAMES;
      return;
    }
  }

  private updateCutscene(ctx: SystemContext): void {
    const grimaldi = this.grimaldi;
    if (grimaldi === null) return;
    this.beatFrame++;
    if (this.cameraLerp < 1) {
      this.cameraLerp = Math.min(1, this.beatFrame / CS_CAMERA_LERP_FRAMES);
    }

    switch (this.beat) {
      case 'poison': {
        const bloom = Math.max(
          0,
          Math.min(1, (this.beatFrame - CS_POISON_FRAME) / CS_POISON_BLOOM_FRAMES),
        );
        grimaldi.poisonAmount = bloom;
        grimaldi.sagAmount = bloom;
        if (this.beatFrame >= CS_DIALOG_FRAME) {
          this.beat = 'dialog';
          this.beatFrame = 0;
          // The crawler is captured rather than the frame context, which is
          // rebuilt every frame and long stale by the time the box closes.
          const walker = ctx.human;
          this.dialog.open(GRIMALDI_CURE_DIALOG, () => this.beginApproach(walker));
        }
        break;
      }
      case 'dialog':
        // The dialog owns the beat; `beginApproach` moves it on when it closes.
        break;
      case 'approach': {
        const from = this.approachFrom;
        if (from !== null) {
          const walk = Math.min(1, this.beatFrame / CS_APPROACH_FRAMES);
          const stopShort = TILE_SIZE * CS_APPROACH_STOP_TILES;
          const dx = grimaldi.x - from.x;
          const dy = grimaldi.y - from.y;
          const dist = Math.hypot(dx, dy);
          const travel = Math.max(0, dist - stopShort);
          ctx.human.x = from.x + (dist === 0 ? 0 : (dx / dist) * travel * walk);
          ctx.human.y = from.y + (dist === 0 ? 0 : (dy / dist) * travel * walk);
        }
        if (this.beatFrame >= CS_APPROACH_FRAMES) {
          this.beat = 'cure';
          this.beatFrame = 0;
          this.cureSoundPending = true;
        }
        break;
      }
      case 'cure': {
        const cured = Math.min(1, this.beatFrame / CS_CURE_FRAMES);
        grimaldi.cureAmount = cured;
        grimaldi.poisonAmount = 1 - cured;
        grimaldi.sagAmount = 1 - cured;
        if (this.beatFrame >= CS_CURE_FRAMES) {
          // Straight out, with no beat held on the cured vine. Signet is outside
          // the flap assuming the party went in to kill her father, and she says
          // so the instant they reappear — a pause here is a pause in the middle
          // of the one exchange the questline is built to land.
          this.beat = 'done';
          this.finishCure();
          this.exitPending = true;
        }
        break;
      }
      case 'done':
      case null:
        break;
    }
  }

  private beginApproach(human: HumanPlayer): void {
    this.beat = 'approach';
    this.beatFrame = 0;
    this.approachFrom = { x: human.x, y: human.y };
  }

  private finishCure(): void {
    this.progress.stage = 'grimaldi_redeemed';
    // Everything goes cold at once: a vent still cycling behind a cured vine
    // would be the tent disagreeing with its own ending.
    this.hazardsArmed = false;
    this.bus.emit('objectiveComplete', { objectiveId: 'grimaldi_redeemed' });
    this.audio?.playMusic('circus_theme', { fadeInMs: CIRCUS_THEME_FADE_IN_MS });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * The room's own furniture, drawn under the crawlers: grates, shut gates and
   * barricades, cold vent grilles, and the warning on the ones about to fire.
   */
  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const block of MAZE_BLOCKS) {
      drawMazeGrate(
        ctx,
        block.grateTile.x * TILE_SIZE - camX,
        block.grateTile.y * TILE_SIZE - camY,
        TILE_SIZE,
      );
      if (this.clearedBlocks.has(block.id)) continue;
      const barrierX = block.barrierTile.x * TILE_SIZE - camX;
      const barrierY = block.barrierTile.y * TILE_SIZE - camY;
      if (block.kind === 'sandbag') drawMazeGate(ctx, barrierX, barrierY, TILE_SIZE);
      else drawMazeBarricade(ctx, barrierX, barrierY, TILE_SIZE);
    }

    for (const vent of MAZE_VENTS) {
      const x = vent.tileX * TILE_SIZE - camX;
      const y = vent.tileY * TILE_SIZE - camY;
      if (!isOnScreen(x, y)) continue;
      drawFlameVentGrille(ctx, x, y, TILE_SIZE);
      if (!this.hazardsArmed) continue;
      const telegraph = ventTelegraphProgress(vent, this.frame);
      if (telegraph > 0) drawFlameVentTelegraph(ctx, x, y, TILE_SIZE, telegraph);
    }
  }

  /**
   * The fire itself, drawn over the crawlers so a column standing in front of
   * one still reads as fire they are inside rather than behind.
   */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.hazardsArmed) return;
    for (const vent of MAZE_VENTS) {
      const burn = ventFlameProgress(vent, this.frame);
      if (burn <= 0) continue;
      const x = vent.tileX * TILE_SIZE - camX;
      const y = vent.tileY * TILE_SIZE - camY;
      if (!isOnScreen(x, y, FLAME_COLUMN_HEIGHT_TILES)) continue;
      drawFlameVentColumn(ctx, x, y, TILE_SIZE, burn, ventFlamePhase(vent, this.frame));
    }
  }

  /** Prompts and switch hints, in world space over whoever they are aimed at. */
  renderPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    ctxFrame: SystemContext,
  ): void {
    if (this.playerLocked) return;
    const grimaldi = this.grimaldi;
    const active = ctxFrame.active;

    if (grimaldi !== null && this.canPour(ctxFrame)) {
      // Over the crawler rather than over him. Every other prompt in the game
      // hangs above the thing it names, but he is four tiles tall and his art
      // runs off the top of its own sprite — a prompt cleared of all that sits
      // near the top of the screen, nowhere near the eye, which is watching the
      // character it is telling to act. The room's other hints are on the
      // crawler for the same reason.
      drawInteractionPrompt(
        ctx,
        active.x - camX,
        active.y - camY - TILE_SIZE * HINT_LIFT_TILES,
        TILE_SIZE,
        'Pour health potion on Grimaldi',
      );
      return;
    }

    const half = this.halfOf(active, ctxFrame.human);
    const actionable = this.pendingActionFor(half);
    if (
      actionable !== null &&
      this.withinTiles(active, actionable.propTile, TARGET_PROMPT_RANGE_TILES)
    ) {
      const target = this.targets.get(actionable.id);
      if (target !== undefined && !target.broken) {
        // The chip would name the interact key, and none of this is done with
        // it. What the attack key actually produces is the chip — and for both
        // crawlers that is a toggle the player owns rather than a fixed weapon:
        // Carl throws a stone whenever the sling is out, Donut claws whenever
        // Magic Missile is not in her bar. Either mismatch tells the player to
        // press a button that will not do what the chip promised.
        const thrown =
          half === 'human' ? ctxFrame.human.isWieldingSlingshot : ctxFrame.cat.isMissileSlotted;
        drawInteractionPrompt(
          ctx,
          target.x - camX,
          target.y - camY,
          TILE_SIZE,
          // Neither line names a weapon, because neither crawler's is fixed —
          // the chip beside them is where "which button, and what leaves your
          // hand" is answered.
          actionable.kind === 'sandbag' ? 'Bring down the counterweight' : 'Break the brace',
          thrown ? 'FIRE' : 'HIT',
        );
        return;
      }
    }

    const blocked = this.pendingBlockFor(half);
    if (blocked !== null) {
      if (!this.withinTiles(active, blocked.blockedRestTile, BLOCK_HINT_RANGE_TILES)) return;
      this.drawSwitchHint(ctx, active, camX, camY, blocked);
      return;
    }

    // Nothing left to open. Whatever is missing now is one of the two crawlers:
    // either the other one is still out in the maze, or they are both here and
    // the cat is the one holding the controls — and it is Carl who does the
    // talking and the pouring.
    if (!this.inChamber(active)) return;
    if (!this.bothInChamber(ctxFrame)) {
      const waitingFor = half === 'human' ? 'Donut' : 'Carl';
      this.drawWorldHint(
        ctx,
        active,
        camX,
        camY,
        `${waitingFor} has to be here too — press ${this.switchControlLabel()} to switch`,
      );
      return;
    }
    if (half === 'cat') {
      this.drawWorldHint(
        ctx,
        active,
        camX,
        camY,
        `Carl has the potion — press ${this.switchControlLabel()} to switch`,
      );
    }
  }

  private withinTiles(entity: Player, tile: { x: number; y: number }, rangeTiles: number): boolean {
    const dx = tile.x * TILE_SIZE - entity.x;
    const dy = tile.y * TILE_SIZE - entity.y;
    return Math.hypot(dx, dy) <= TILE_SIZE * rangeTiles;
  }

  /** On a touch screen there is no key to name, so the on-screen control is. */
  private switchControlLabel(): string {
    return platform.isMobile ? 'the switch button' : `[${keybindings.labelFor('switchCharacter')}]`;
  }

  private drawSwitchHint(
    ctx: CanvasRenderingContext2D,
    active: Player,
    camX: number,
    camY: number,
    blocked: MazeBlock,
  ): void {
    const control = this.switchControlLabel();
    this.drawWorldHint(
      ctx,
      active,
      camX,
      camY,
      blocked.blocks === 'human'
        ? `Donut can reach that counterweight — press ${control} to switch`
        : `Carl can break that brace — press ${control} to switch`,
    );
  }

  private drawWorldHint(
    ctx: CanvasRenderingContext2D,
    active: Player,
    camX: number,
    camY: number,
    line: string,
  ): void {
    drawText(ctx, line, {
      x: active.x - camX + TILE_SIZE * TILE_CENTRE,
      y: active.y - camY - TILE_SIZE * HINT_LIFT_TILES,
      size: HINT_SIZE,
      bold: true,
      color: HINT_COLOR,
      align: 'center',
      outline: HINT_OUTLINE,
    });
  }

  /**
   * What the room is asking for once every door is open.
   *
   * Rebuilt from where the crawlers actually stand rather than left as one line,
   * because "bring both of you to the pole" reads as a bug once both of them
   * plainly are at it.
   */
  private chamberObjective(): string {
    const ctx = this.lastContext;
    if (ctx === null || !this.bothInChamber(ctx)) {
      return 'The chamber is open. Bring both of you to the pole.';
    }
    return 'Carl has the potion. Pour it over him.';
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    // Under the boxes rather than over them: the white-out is the room going
    // white, and a message printed behind its own flash cannot be read.
    if (this.flashFrames > 0) {
      drawOverlay(ctx, {
        canvasWidth: viewportWidth(),
        canvasHeight: viewportHeight(),
        color: BURNOUT_FLASH_COLOR,
        alpha: (this.flashFrames / BURNOUT_FLASH_FRAMES) * BURNOUT_FLASH_PEAK_ALPHA,
      });
    }
    this.dialog.render(ctx);
    this.burnoutDialog.render(ctx);

    if (this.bannerTimer > 0) {
      const alpha =
        this.bannerTimer < BANNER_FADE_FRAMES ? this.bannerTimer / BANNER_FADE_FRAMES : 1;
      drawText(ctx, 'UNDER THE BIG TOP', {
        x: viewportWidth() / 2,
        y: BANNER_TITLE_Y,
        size: BANNER_TITLE_SIZE,
        bold: true,
        color: '#a8f070',
        align: 'center',
        alpha,
        glow: '#3a6a2a',
        glowBlur: BANNER_GLOW_BLUR,
      });
      drawText(ctx, 'Two ways in. Neither of you can walk it alone.', {
        x: viewportWidth() / 2,
        y: BANNER_SUBTITLE_Y,
        size: BANNER_SUBTITLE_SIZE,
        color: '#d4edaa',
        align: 'center',
        alpha,
      });
    }

    if (this.beat !== null || this.isDialogOpen) return;
    const remaining = MAZE_BLOCKS.filter((block) => !this.clearedBlocks.has(block.id)).length;
    const objective =
      remaining > 0
        ? `Open the way — ${remaining} of ${MAZE_BLOCKS.length} still barred`
        : this.chamberObjective();
    drawText(ctx, objective, {
      x: viewportWidth() / 2,
      y: viewportHeight() - OBJECTIVE_Y_FROM_BOTTOM,
      size: OBJECTIVE_SIZE,
      bold: true,
      color: remaining > 0 ? '#e8d060' : '#a8f070',
      align: 'center',
    });
  }
}
