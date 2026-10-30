import { displayHp } from '../core/party/crawlerFormulas';
import { activeRunStats } from '../core/progression/GameStats';
import { TILE_SIZE } from '../core/constants';
import { Deinonychus } from '../creatures/Deinonychus';
import type { CatPlayer } from '../creatures/CatPlayer';
import { HumanPlayer } from '../creatures/HumanPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import { EmoteEffectSystem } from './EmoteEffectSystem';
import { hostileWithinRadius } from './interactionPromptGate';
import { playPetGesture } from '../creatures/humanGestures';
import { drawInteractionPromptOver } from '../ui/InteractionPrompt';
import {
  advanceDeinonychusRecovery,
  DEINONYCHUS_KILL_RECOVERY_FRAMES,
  DEINONYCHUS_MIN_SUMMON_HP,
  deinonychusFramesUntilReady,
  deinonychusTotalRecoveryFrames,
  tickDeinonychusRegen,
  type DeinonychusPetState,
} from '../core/state/DeinonychusPetState';
import { getDeinonychusStats, DEINONYCHUS_DAMAGE_PER_XP } from '../abilities/deinonychus';
import { drawDeinonychusIcon, prewarmDeinonychusPet } from '../sprites/deinonychusSprite';
import type { GameSystem, SystemContext } from './GameSystem';
import type { CarriedCompanion } from './companionCarry';
import type { AbilityManager } from '../core/skills/AbilityManager';
import type { HudToasts, ToastOptions } from '../ui/hud/toasts';
import type { SummonModel } from '../ui/hud/hudModel';
import { paintOffscreenPetMarker } from '../ui/hud/offscreenPetMarker';
import { CAT_SPEECH_STYLE, TimedSpeech, drawTimedSpeechBubble } from '../sprites/speechBubble';
import { ANY_TILE, findNearbyWalkableTile, type TileFilter } from '../map/findWalkableTile';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { worldToScreen, type Camera } from '../core/rendering/camera';
import { DEINONYCHUS_LINES } from '../dialog/scripts/deinonychus';
import { petWords, type PetNames, type PetWords } from '../core/party/petNames';

/**
 * Deinonychus's lifecycle: summoning, recall, off-duty recovery and the summon button.
 *
 * The pet's HP is *persistent*. He does not heal by being put away and brought
 * back out; he regenerates while off duty and carries whatever is left
 * into his next summon. That is the whole shape of the feature: sending him in
 * costs something, and the cost is paid in the time he needs to recover.
 */

/** Fraction of a tile giving its centre, for tile lookups from a sprite corner. */
const TILE_CENTER = 0.5;

/**
 * How far from the tile the cat is facing the summon may look for open ground.
 *
 * Small on purpose: a pet that appears several tiles away has not been summoned
 * to her side, and past this the honest answer is her own tile.
 */
const SPAWN_SEARCH_RADIUS_TILES = 3;

/**
 * How close an enemy has to be for the companion cat to send Deinonychus in.
 *
 * About the reach of her own engage scan: near enough that the fight is plainly
 * hers, not so far that she wastes a summon on a mob idling across a hall.
 */
const AUTO_SUMMON_THREAT_RADIUS_TILES = 7;
/**
 * The wait before the cat tries again after a summon she could not make.
 *
 * Without it a cat standing somewhere too tight for him retries every frame, and
 * each refusal re-raises the "No room" line over her head.
 */
const AUTO_SUMMON_RETRY_FRAMES = 120;

/** How close, centre to centre, a crawler must be to pet Deinonychus. */
export const DEINONYCHUS_PET_RANGE_TILES = 1.4;
/**
 * On the overworld no room list exists, so the pet is instead refused with a
 * hostile anywhere within this many tiles — the same shape `hostileWithinRadius`
 * gives every other "is it safe to stand still here" check.
 */
const DEINONYCHUS_PET_OVERWORLD_CLEAR_RADIUS_TILES = 10;

/** His portrait fills this fraction of the Summon card's icon square. */
const DEINONYCHUS_CARD_ICON_SIZE_RATIO = 0.9;
// The Summon button as the Deinonychus explainer pictures it: its label, its health
// number and its size, which `verify-deinonychus.ts` holds to fitting one row.
const DEINONYCHUS_BUTTON_LABEL_SIZE = 8;
/**
 * His health as a number, beside the label.
 *
 * The bar answers "roughly how hurt is he"; the number is what makes a regen
 * tick visibly *count up*, which is the thing that teaches "he is healing right
 * now" without a line of text saying so.
 */
const DEINONYCHUS_HP_TEXT_SIZE = 7;
const DEINONYCHUS_BUTTON_TEXT_INSET = 2;
/**
 * Clear space the label and the health number must leave between them.
 *
 * Both sit on one row, left- and right-aligned, and at the sizes they started
 * from the worst live pairing — 'Resting' beside '190/220', which is exactly the
 * state the number was added for — came to 79.4 px of the button's 80. They did
 * not overlap; they touched, and only on the assumption that the browser's
 * monospace is 0.6 em wide. `verify-deinonychus.ts` gates the arithmetic against a
 * pessimistic ratio so the next size change cannot quietly close the gap.
 */
export const DEINONYCHUS_BUTTON_TEXT_MIN_GAP = 6;

/**
 * The pictured Summon button's own size: the rows inside it are laid out
 * against these two numbers, so a caller free to pass any width could push
 * the label through the health number without anything failing.
 */
export const SUMMON_BUTTON_WIDTH = 80;
export const SUMMON_BUTTON_HEIGHT = 48;

/**
 * Every label the button can show.
 *
 * Exported and read by the render rather than duplicated as literals there, so
 * the width gate in `verify-deinonychus.ts` measures the strings that are actually
 * drawn. Duplicated, renaming one to something longer leaves the gate green
 * while the row overflows.
 */
export const DEINONYCHUS_BUTTON_LABELS = {
  recall: 'Recall',
  resting: 'Resting',
  summon: 'Summon',
} as const;
export const DEINONYCHUS_BUTTON_TEXT_SIZES = {
  label: DEINONYCHUS_BUTTON_LABEL_SIZE,
  hp: DEINONYCHUS_HP_TEXT_SIZE,
  inset: DEINONYCHUS_BUTTON_TEXT_INSET,
} as const;

/** The cat's calls are centred over her tile. */
const SPEECH_ANCHOR_X_RATIO = 0.5;

/** How long the recovery toast stays up after the latest kill that fed it. */
const RECOVERY_TOAST_FRAMES = 90;
const RECOVERY_TOAST_KEY = 'deinonychus-recovery';
/**
 * Keyed, so a run of kills reads as one toast whose total climbs and whose
 * clock restarts on each kill, rather than a stack of identical flags.
 */
const RECOVERY_TOAST: ToastOptions = {
  tone: 'info',
  icon: 'hourglass',
  key: RECOVERY_TOAST_KEY,
  durationTicks: RECOVERY_TOAST_FRAMES,
};
const HEALING_RULE_TOAST: ToastOptions = { tone: 'info', icon: 'heart' };
const FRAMES_PER_SECOND = 60;
/** Decimals on the toast's seconds. One kill is worth well under a second. */
const RECOVERY_TOAST_DECIMALS = 1;

/**
 * Progress toward his next level, 0–1, for the strip above the button's HP bar.
 *
 * Full at the cap rather than empty: `xpToNextLevel` is Infinity there, and a
 * bar reading zero for a maxed-out pet says the opposite of what is true.
 */
export function deinonychusXpFraction(abilityManager: AbilityManager): number {
  const state = abilityManager.getState('deinonychus');
  if (state === null) return 0;
  if (!Number.isFinite(state.xpToNextLevel) || state.xpToNextLevel <= 0) return 1;
  return Math.max(0, Math.min(1, state.xp / state.xpToNextLevel));
}

/**
 * A point-in-time copy of the pet's scene-level state, for the in-run safe-room
 * checkpoint. His HP and the summon lock are durable and travel with
 * {@link DeinonychusPetState} instead.
 */
export interface DeinonychusCheckpoint {
  unlocked: boolean;
}

export class DeinonychusSystem implements GameSystem {
  /** Whether Deinonychus has joined the party: the reward for the party's two-hundredth dungeon kill. */
  unlocked = false;

  /** The currently active Deinonychus instance (null when not summoned). */
  deinonychus: Deinonychus | null = null;

  /** The cat's summon and recall calls, said over her head. */
  private readonly speech = new TimedSpeech();

  /**
   * The mob list from the last frame.
   *
   * `checkHealth` and `toggleRecall` are both called from outside the system's
   * own `update`, so they have no context to read it from — and both of them
   * start a retreat, which has to shake off everything targeting him.
   */
  private retreatMobs: Mob[] = [];

  /**
   * Whether the "he only heals while recalled" line has been said in this scene.
   *
   * Scoped to the system, and so re-armed with every scene — a visit to a floor
   * rather than a floor, since a shop door builds a new one. That is a real
   * choice rather than a free one: summon and recall is a toggle a player can
   * work all afternoon, so this flag is genuinely de-duplicating within a scene
   * too. Repeating the line once per floor is simply judged cheap. Its sibling
   * could not be scoped this way, because the knockout latch it describes stays
   * true for minutes and would re-announce at every transition.
   */
  private hasExplainedOffDutyRegen = false;

  /**
   * Frames he has spent collapsing or running home this summon.
   *
   * Credited to his recovery when he despawns. The recovery ceiling is a promise
   * about the time from the moment he is spent, and he is on the field — where
   * nothing heals him — for the whole run home that follows it.
   */
  private retreatFrames = 0;
  /** Recovery frames the showing recovery toast totals across the kills that fed it. */
  private recoveryToastFrames = 0;

  /** Frames left before the companion cat may try another summon on her own. */
  private autoSummonRetryFrames = 0;
  /** Reused every frame by {@link catWantsToSummon}, which runs whenever he is off duty. */
  private readonly threatQuery = new Set<Mob>();
  /** The hearts a pet press raises over him. */
  private readonly emotes = new EmoteEffectSystem();

  /**
   * @param petState  HP and the quest lock, threaded by reference across scenes
   *                  because the `Deinonychus` instance is destroyed on every despawn.
   * @param petLevel  Reads the current ability level. A function rather than a
   *                  number so a level-up mid-summon is picked up immediately.
   * @param grantAbilityXp  Pays XP into the Deinonychus ability. Injected for the same
   *                  reason `petLevel` is: the system has no ability manager of
   *                  its own, and the scene owns the one that must be levelled.
   * @param petXpFraction  Progress toward the next pet level, 0–1, for the strip
   *                  above the HP bar. Same injection, same reason.
   * @param toasts  The stack above the hotbar. Carries the running total kills
   *                  have taken off his recovery and the two first-time healing
   *                  rules, which are stated nowhere else.
   * @param petNames  The run's pet names, read each time he is spoken of, so
   *                  a name given while he is out is the one used next.
   */
  constructor(
    private readonly petState: DeinonychusPetState,
    private readonly petLevel: () => number,
    private readonly grantAbilityXp: (amount: number) => void,
    private readonly petXpFraction: () => number,
    private readonly toasts: Pick<HudToasts, 'post' | 'isShowing'>,
    private readonly petNames: PetNames,
  ) {}

  private get words(): PetWords {
    return petWords(this.petNames, 'deinonychus');
  }

  /**
   * His HP right now — the live creature's while he is out, the stored value
   * while he is not.
   *
   * `petState.hp` alone is only written back on despawn, so a bar reading it
   * stays full while he is being chewed to pieces. The live value alone is just
   * as wrong the other way: `checkHealth` pins a spent pet at one hit point so
   * he can walk home, and reading that would save him as 1 and paint his bar
   * green for a dinosaur the player has already spent.
   */
  get hp(): number {
    if (this.deinonychus === null) return this.petState.hp;
    return this.deinonychus.exhausted ? 0 : this.deinonychus.hp;
  }

  get maxHp(): number {
    return getDeinonychusStats(this.petLevel()).maxHp;
  }

  /** 0–1, for the button's HP bar. Live, like {@link hp} — the two feed one widget. */
  get hpRatio(): number {
    const max = this.maxHp;
    return max <= 0 ? 0 : Math.max(0, Math.min(1, this.hp / max));
  }

  /**
   * True while he is recovering from a knockout and cannot be sent back in at
   * any health short of full. Persisted, so it survives a reload.
   */
  get restingUntilFull(): boolean {
    // Live/stored, exactly like `hp`: the latch is only written into the pet
    // state on despawn, and both autosaves can fire while he is still limping
    // home — which stored `hp: 0` alongside `resting: false`, and a reload from
    // that pair had him summonable again one regen tick later.
    return this.petState.restingUntilFull || (this.deinonychus?.exhausted ?? false);
  }

  /**
   * Frames of recovery left before the Summon button goes live.
   *
   * Zero while he is out — the button says Recall then, and a countdown over it
   * would be counting down to something that is already true.
   */
  get framesUntilReady(): number {
    if (this.deinonychus !== null) return 0;
    return deinonychusFramesUntilReady(this.petState, this.maxHp, this.minSummonHp);
  }

  /**
   * The health he has to have recovered before the button will send him in:
   * alive, nothing more. Every clock on the button — the countdown, the drain
   * overlay, the `canSummon` gate — measures against this one number.
   */
  private get minSummonHp(): number {
    return DEINONYCHUS_MIN_SUMMON_HP;
  }

  /**
   * Summon Deinonychus near the cat.
   * Returns the new Deinonychus instance to be added to the mobs array + grid.
   */
  summon(cat: CatPlayer, gameMap: GameMap): Deinonychus | null {
    if (!this.canSummon || cat.isAway) return null;

    const spawn = this.findSpawnTile(cat, gameMap);
    if (spawn === null) {
      // `canSummon` is true here, so the button looks live and the key is armed.
      // Refusing in silence is indistinguishable from a dropped input.
      this.speak(DEINONYCHUS_LINES.noRoom(this.words).paragraphs[0]);
      return null;
    }
    const deinonychus = this.spawnAt(spawn, cat, gameMap);
    this.speech.say(DEINONYCHUS_LINES.summon(this.words).paragraphs[0]);
    return deinonychus;
  }

  private spawnAt(tile: { x: number; y: number }, cat: CatPlayer, gameMap: GameMap): Deinonychus {
    const deinonychus = new Deinonychus(
      tile.x,
      tile.y,
      TILE_SIZE,
      cat,
      this.petLevel(),
      this.petState.hp,
    );
    deinonychus.setMap(gameMap);
    this.deinonychus = deinonychus;
    this.petState.regenFrames = 0;
    this.retreatFrames = 0;
    return deinonychus;
  }

  /**
   * Whether he is out and fighting fit enough to walk through a door with the
   * party. A pet already running home, collapsing or spent is put away at the
   * threshold instead: the new scene would build him fresh, and a fresh Deinonychus
   * has forgotten the recall he was obeying.
   */
  get followsThroughDoor(): boolean {
    const deinonychus = this.deinonychus;
    if (deinonychus === null) return false;
    return !deinonychus.recalling && !deinonychus.collapsing && !deinonychus.exhausted;
  }

  /**
   * Brings him in beside the cat on the far side of a door he walked through
   * with the party, at the health he left with.
   *
   * Not a summon: nobody pressed anything, so there is no call, no usage XP and
   * no release cry, and the recovery floor a summon demands is not asked again
   * of a pet who was already out. The knockout latch still refuses him — a door
   * is not a way around it.
   */
  carryIn(cat: CatPlayer, gameMap: GameMap): Deinonychus | null {
    if (!this.unlocked || this.deinonychus !== null || cat.isAway) return null;
    if (this.petState.restingUntilFull) return null;
    if (this.petState.hp <= 0) return null;
    const spawn = this.findSpawnTile(cat, gameMap);
    if (spawn === null) return null;
    return this.spawnAt(spawn, cat, gameMap);
  }

  /** Him, as one of the companions a scene moves with the party. */
  asCarriedCompanion(cat: CatPlayer): CarriedCompanion {
    return {
      body: this.deinonychus,
      followsLiveGroup: !cat.isAway,
      landingTile: (map, isAcceptable) => this.findSpawnTile(cat, map, isAcceptable),
      putAway: (mobs, grid) => this.dismiss(mobs, grid),
      onPlaced: (mobs) => {
        const deinonychus = this.deinonychus;
        if (deinonychus === null) return;
        deinonychus.onRescued();
        // Re-pointed now rather than on the next `update`: the mob loop runs
        // first, and one AI tick against the storey he left is a bite aimed at a
        // creature that is no longer in the room.
        deinonychus.allMobs = mobs;
        this.retreatMobs = mobs;
      },
    };
  }

  /**
   * Whether the companion cat should send Deinonychus in on her own this frame: she is
   * fighting, or a hostile is close enough that she soon will be.
   *
   * Only the threat is judged here. The caller owns the other half of the
   * question — whether the player has left this to her at all — because the
   * setting, the stance and who is being driven are the scene's to know.
   */
  catWantsToSummon(ctx: SystemContext): boolean {
    if (this.autoSummonRetryFrames > 0) {
      this.autoSummonRetryFrames--;
      return false;
    }
    const { cat, human, gameMap, bossRoom } = ctx;
    if (!this.canSummon || cat.isAway || !cat.isAlive || cat.isKnockedOut) return false;
    if (cat.autoTarget?.isAlive === true) return true;

    // Centres cancel in the distance, so the query can use raw sprite origins;
    // only the sight line needs them.
    this.threatQuery.clear();
    const nearby = ctx.roster.grid.queryCircle(
      cat.x,
      cat.y,
      AUTO_SUMMON_THREAT_RADIUS_TILES * TILE_SIZE,
      this.threatQuery,
    );
    const catCentreX = cat.x + TILE_SIZE * TILE_CENTER;
    const catCentreY = cat.y + TILE_SIZE * TILE_CENTER;
    for (const mob of nearby) {
      if (!mob.isHostileTarget || mob.avoidInstead) continue;
      // Held out of the fight by a script, it is not a threat to send him at.
      if (mob.offLimitsToAllies) continue;
      // An unstarted boss fight is the player's to start. Sending the pet at it
      // through the doorway would begin it for them with nobody in the room.
      if (bossRoom?.isUntriggeredBossRoomMob(mob, human) === true) continue;
      const mobCentreX = mob.x + TILE_SIZE * TILE_CENTER;
      const mobCentreY = mob.y + TILE_SIZE * TILE_CENTER;
      if (gameMap.hasLineOfSight(catCentreX, catCentreY, mobCentreX, mobCentreY)) return true;
    }
    return false;
  }

  /** Called when a summon the cat chose herself was refused, so she backs off. */
  onAutoSummonRefused(): void {
    this.autoSummonRetryFrames = AUTO_SUMMON_RETRY_FRAMES;
  }

  /**
   * Where to drop him: the tile the cat is facing if there is room, otherwise
   * the nearest tile to it that he can actually stand in.
   *
   * In front rather than behind because the facing tile is the one the player is
   * about to send him at — a pet that lands between her and the fight is already
   * pointed the right way, and the ring search below only leaves it when that
   * tile is wall, a stairwell, or too tight to move in.
   *
   * The cat's tile is taken from her centre, never as `floor(cat.x / TILE_SIZE)`:
   * that is the tile under her sprite's top-left *corner*, one tile off in a
   * narrow hallway, where the neighbouring tile is masonry and he would spawn
   * inside the wall. For the same reason every candidate, the facing tile
   * included, is validated before he is placed on it.
   *
   * The sight test keeps the ring search from solving a blocked corridor by
   * putting him in the room on the other side of the wall, and stairwell tiles
   * are excluded because `isWalkable` admits them while `Mob.moveWithCollision`
   * refuses to enter one — the spawn contract has to match the movement contract
   * or he lands somewhere he cannot leave by three of its four sides.
   *
   * Returns null when there is nowhere he can stand, and the summon is refused.
   * There is deliberately no "just use the cat's tile" fallback: the only way to
   * reach one is for the cat herself to be standing somewhere unwalkable — a
   * boss room's door sealing under her, a scripted placement — which is precisely the
   * case where that tile is the wrong answer.
   */
  private findSpawnTile(
    cat: CatPlayer,
    gameMap: GameMap,
    isAcceptable: TileFilter = ANY_TILE,
  ): { x: number; y: number } | null {
    const catTileX = Math.floor((cat.x + TILE_SIZE * TILE_CENTER) / TILE_SIZE);
    const catTileY = Math.floor((cat.y + TILE_SIZE * TILE_CENTER) / TILE_SIZE);
    const facedTileX = catTileX + Math.round(cat.facingX);
    const facedTileY = catTileY + Math.round(cat.facingY);

    const inSightOfCat = (x: number, y: number): boolean =>
      gameMap.hasLineOfSight(
        cat.x + TILE_SIZE * TILE_CENTER,
        cat.y + TILE_SIZE * TILE_CENTER,
        (x + TILE_CENTER) * TILE_SIZE,
        (y + TILE_CENTER) * TILE_SIZE,
      );

    return findNearbyWalkableTile(
      gameMap,
      facedTileX,
      facedTileY,
      SPAWN_SEARCH_RADIUS_TILES,
      (x, y) => inSightOfCat(x, y) && !gameMap.isStairwellTile(x, y) && isAcceptable(x, y),
    );
  }

  /**
   * Called each frame. Returns true on the frame he finished despawning; the
   * removal from `mobs` and `mobGrid` has already happened by then.
   */
  update(ctx: SystemContext): boolean {
    const { cat, gameMap } = ctx;
    const { mobs, grid: mobGrid } = ctx.roster;
    this.retreatMobs = mobs;

    this.speech.tick();
    this.emotes.update(1 / FRAMES_PER_SECOND);

    if (!this.deinonychus) {
      // Also here, not only from `onLevelUp`: `setGodModeMinLevel` moves the
      // effective level without firing that callback, and a pet left holding a
      // level-1 value against a level-15 maximum reads as permanently dying.
      this.rescaleStoredHp();
      this.tickRegen();
      this.explainKnockoutOnce();
      return false;
    }

    this.deinonychus.allMobs = mobs;
    if (this.deinonychus.recalling || this.deinonychus.collapsing) this.retreatFrames++;
    this.payOutDamageXp(this.deinonychus);
    // A growth spurt mid-fight has to reach the creature that is already out, or
    // he keeps the juvenile's stats and sheet until the next time he is summoned.
    this.deinonychus.applyLevel(this.petLevel());

    // The cat going down does not spend him: he keeps fighting, guarding her
    // fallen body the same way he guards her standing, because `this.owner`
    // (his leash and follow anchor) is her position either way.

    // After the AI has run — the mob loop ticks before this system, and the latch
    // is set inside `updateAI` — so a stall decided this frame is answered this
    // frame rather than one behind. Not once the recall has landed: he is at her
    // feet fading out, and snapping a half-transparent dinosaur across the room is
    // a glitch rather than a rescue.
    // Excluded for the same reason `recallArrived` is: the collapse is a
    // sub-second one-shot that has to play where he fell. A stall latched in the
    // corner he was beaten to zero in would otherwise snap a mid-collapse dinosaur
    // across the room. Nothing is lost — the collapse always ends in a recall,
    // and `runHome` re-latches within a couple of seconds if he really is stuck.
    const midAnimation = this.deinonychus.recallArrived || this.deinonychus.collapsing;
    const stranded = this.deinonychus.needsRescue && !midAnimation;
    if (stranded && this.rescue(this.deinonychus, cat, gameMap, mobs, mobGrid)) return true;

    if (this.deinonychus.despawnComplete) return this.finishDespawn(mobs, mobGrid);
    return false;
  }

  /**
   * Brings a stranded pet to the cat, because he has told us he cannot walk
   * there — see {@link Deinonychus.needsRescue}.
   *
   * Landing tile comes from the same {@link findSpawnTile} a summon uses, so the
   * contract is identical: walkable, room to move in, in the cat's sight, not a
   * stairwell. In front of her rather than on her, so it reads as a loyal animal
   * catching up rather than as a sprite appearing out of the floor.
   *
   * @returns true when he was despawned instead — the caller must report that
   *   frame the same way a completed recall does.
   */
  private rescue(
    deinonychus: Deinonychus,
    cat: CatPlayer,
    gameMap: GameMap,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): boolean {
    const landing = this.findSpawnTile(cat, gameMap);
    if (landing === null) {
      // Nowhere beside the cat he could stand — she is somewhere unwalkable
      // herself, which is a boss room's door sealing under her or a scripted
      // placement. Put him away instead: `finishDespawn` preserves his HP and
      // hands the button back as Summon, so the unrecoverable state ends either
      // way and neither branch costs the player anything.
      deinonychus.onRescued();
      // Spoken after the despawn, not before it: `finishDespawn` may raise the
      // off-duty-regen line, which is a speech bubble too, and the first of two
      // bubbles set on one frame is replaced before it is ever drawn.
      const despawned = this.finishDespawn(mobs, mobGrid);
      this.speak(DEINONYCHUS_LINES.recall(this.words).paragraphs[0]);
      return despawned;
    }

    const preX = deinonychus.x;
    const preY = deinonychus.y;
    deinonychus.x = landing.x * TILE_SIZE;
    deinonychus.y = landing.y * TILE_SIZE;
    // A position written by anything other than the mob's own movement has to be
    // re-indexed by hand; nothing downstream fixes it up, and attacks then miss
    // him at the tile the grid still believes he is on.
    mobGrid.move(deinonychus, preX, preY);
    deinonychus.onRescued();
    // Whatever was chasing him was chasing him *there*. Left alone they beeline
    // to a tile he is no longer on for the rest of the floor.
    this.releaseTargeting(mobs, deinonychus);
    this.speak(DEINONYCHUS_LINES.arrived(this.words).paragraphs[0]);
    return false;
  }

  /**
   * A kill takes {@link DEINONYCHUS_KILL_RECOVERY_FRAMES} off his recovery.
   *
   * The point is to make pushing forward the faster way to get him back rather
   * than standing in a cleared corridor watching a countdown — so it is worth
   * being clear about what it does *not* do. It never pays a pet who is out (his
   * live HP lives on the creature, and the stored value this heals is a stale
   * copy from his last despawn).
   */
  onKill(isCatActive: boolean): void {
    if (!this.unlocked || this.deinonychus !== null) return;
    const framesSaved = advanceDeinonychusRecovery(
      this.petState,
      this.maxHp,
      this.minSummonHp,
      DEINONYCHUS_KILL_RECOVERY_FRAMES,
    );
    // Zero whenever he was already fit, which is most of the run — no toast for
    // a boost that did nothing.
    if (framesSaved <= 0) return;
    // The toast annotates the countdown on his Summon card, so it shows only
    // while that card does.
    const summonCardShown = this.summonCard(isCatActive) !== null;
    if (summonCardShown) this.pushRecoveryToast(framesSaved);
  }

  /** Adds `framesSaved` to the running total on the recovery toast, starting a fresh total once the last toast has gone. */
  private pushRecoveryToast(framesSaved: number): void {
    const continuesShownTotal = this.toasts.isShowing(RECOVERY_TOAST_KEY);
    this.recoveryToastFrames = (continuesShownTotal ? this.recoveryToastFrames : 0) + framesSaved;
    const secondsSaved = this.recoveryToastFrames / FRAMES_PER_SECOND;
    this.toasts.post(
      `${this.words.opening} is recovering −${secondsSaved.toFixed(RECOVERY_TOAST_DECIMALS)}s`,
      RECOVERY_TOAST,
    );
  }

  /**
   * Turns the damage he has landed into ability XP — see
   * {@link DEINONYCHUS_DAMAGE_PER_XP} for why he is paid for it at all.
   *
   * Only whole points are paid and the remainder stays banked on the creature,
   * so the rate is the same whether he lands a hundred damage in one blow or in
   * fifty. The most he can lose is the tail end of one bite, on despawn.
   */
  private payOutDamageXp(deinonychus: Deinonychus): void {
    const earnedXp = Math.floor(deinonychus.damageDealtPendingXp / DEINONYCHUS_DAMAGE_PER_XP);
    if (earnedXp <= 0) return;
    deinonychus.damageDealtPendingXp -= earnedXp * DEINONYCHUS_DAMAGE_PER_XP;
    this.grantAbilityXp(earnedXp);
  }

  /**
   * Recovery while he is off duty. The clock and the arithmetic live on the pet
   * state, which outlives every scene, so a door or a staircase never throws a
   * tick away.
   *
   * Not gated on `unlocked`: a pet nobody has unlocked is at full health by
   * definition, so the tick is already a no-op there.
   */
  private tickRegen(): void {
    tickDeinonychusRegen(this.petState, this.maxHp);
  }

  /**
   * Intercepts lethal damage. Called from `DungeonScene` after mob damage
   * resolution, before kills are resolved, so Deinonychus never actually dies: he
   * collapses, gets up, and runs home on his last legs.
   */
  checkHealth(): void {
    if (!this.deinonychus) return;
    if (this.deinonychus.hp > 0) return;
    // Deliberately *not* gated on whether he is already retreating. He runs home
    // on one hit point, and mobs keep swinging at him the whole way — gated, the
    // interception switched itself off exactly when it was needed, he died for
    // real mid-recall, and the system was left holding a dead pet it could
    // neither despawn nor resummon for the rest of the floor.
    const alreadyRetreating = this.deinonychus.collapsing || this.deinonychus.recalling;
    // Recorded before that early return, not inside `beginCollapse`. Recalling a
    // wounded pet is the obvious thing to do when he is in trouble, and mobs keep
    // swinging at him the whole way home — his HP reaching zero on that run is
    // still his HP reaching zero, and skipping the flag made pressing R in time
    // a way to spend him for free.
    this.deinonychus.exhausted = true;
    // One hit point, so he stays alive long enough to play the collapse and run
    // back. The zero the player cares about is written into the pet state on
    // despawn — see `finishDespawn`.
    this.deinonychus.hp = 1;
    // `takeDamage` has already flagged the death that is being intercepted here.
    // Left set, `resolveKills` would run its whole kill path on a pet that is
    // still standing: a `mobKilled` event, a stray point of XP to the human, and
    // a corpse the scene then has to reason about.
    this.deinonychus.justDied = false;
    this.deinonychus.killedBy = null;
    this.deinonychus.killedByDealer = null;
    this.deinonychus.killType = null;
    this.deinonychus.damageTakenBy.clear();
    if (alreadyRetreating) return;
    this.speak(DEINONYCHUS_LINES.recall(this.words).paragraphs[0]);
    this.deinonychus.beginCollapse();
    this.releaseTargeting(this.retreatMobs, this.deinonychus);
  }

  private centreDistanceTiles(active: HumanPlayer | CatPlayer, deinonychus: Deinonychus): number {
    const dx = active.x + TILE_SIZE * TILE_CENTER - (deinonychus.x + TILE_SIZE * TILE_CENTER);
    const dy = active.y + TILE_SIZE * TILE_CENTER - (deinonychus.y + TILE_SIZE * TILE_CENTER);
    return Math.hypot(dx, dy) / TILE_SIZE;
  }

  /**
   * Whether a pet press from `active` would land on Deinonychus right now: in range,
   * idle, and with no unfinished fight around either of them. On a dungeon
   * floor "around" means the room the crawler stands in ({@link GameMap.hostilesInRoom});
   * with no room list at all — the overworld, or a hallway — it means nobody
   * hostile within `isOverworld`'s wider clearance radius.
   */
  wouldPet(
    active: HumanPlayer | CatPlayer,
    gameMap: GameMap,
    mobs: readonly Mob[],
    mobGrid: SpatialGrid<Mob>,
    isOverworld: boolean,
  ): boolean {
    const deinonychus = this.deinonychus;
    if (!deinonychus?.acceptsPet) return false;
    if (this.centreDistanceTiles(active, deinonychus) > DEINONYCHUS_PET_RANGE_TILES) return false;
    if (isOverworld) {
      return !hostileWithinRadius(
        active,
        mobGrid,
        TILE_SIZE * DEINONYCHUS_PET_OVERWORLD_CLEAR_RADIUS_TILES,
      );
    }
    const activeTileX = Math.floor((active.x + TILE_SIZE * TILE_CENTER) / TILE_SIZE);
    const activeTileY = Math.floor((active.y + TILE_SIZE * TILE_CENTER) / TILE_SIZE);
    const roomIndex = gameMap.roomIndexAt(activeTileX, activeTileY);
    return gameMap.hostilesInRoom(roomIndex, mobs).length === 0;
  }

  /** Pets Deinonychus if a press from `active` would reach him. Returns whether it did. */
  tryPet(
    active: HumanPlayer | CatPlayer,
    gameMap: GameMap,
    mobs: readonly Mob[],
    mobGrid: SpatialGrid<Mob>,
    isOverworld: boolean,
  ): boolean {
    if (!this.wouldPet(active, gameMap, mobs, mobGrid, isOverworld)) return false;
    const deinonychus = this.deinonychus;
    // `wouldPet` already required this, but the null check has to be repeated
    // for the type system to carry it past the call it cannot see through.
    if (deinonychus === null) return false;
    deinonychus.celebratePet();
    activeRunStats()?.recordDeinonychusPetted();
    const head = deinonychus.headAnchor();
    this.emotes.spawnHearts(head.x, head.y);
    if (active instanceof HumanPlayer) playPetGesture(active, head);
    else active.playContentGesture(deinonychus.x, deinonychus.y);
    return true;
  }

  /** Floats "Pet" over Deinonychus when a press from `active` would reach him. Returns whether it drew. */
  renderPetPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
    gameMap: GameMap,
    mobs: readonly Mob[],
    mobGrid: SpatialGrid<Mob>,
    isOverworld: boolean,
  ): boolean {
    const deinonychus = this.deinonychus;
    if (deinonychus === null) return false;
    if (!this.wouldPet(active, gameMap, mobs, mobGrid, isOverworld)) return false;
    // The press that would pet him is one step away: warm the row it plays.
    prewarmDeinonychusPet(deinonychus.stage);
    drawInteractionPromptOver(ctx, deinonychus, camX, camY, 'Pet');
    return true;
  }

  /** The hearts a pet raises, drawn over every body. */
  renderPetEmotes(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.emotes.render(ctx, camX, camY);
  }

  /**
   * Rescale the stored HP when the pet levels while he is off duty.
   *
   * Takes no level argument on purpose — the effective level is read from the
   * same source everything else uses, so god mode's floor cannot make the two
   * disagree.
   *
   * Without it the two paths disagree: a summoned Deinonychus grows through
   * `Deinonychus.applyLevel` and an unsummoned one silently keeps the hit points of a
   * smaller animal against a larger maximum.
   */
  onPetLevelUp(): void {
    if (this.deinonychus !== null) return;
    this.rescaleStoredHp();
  }

  /**
   * Rescale the stored HP onto the current maximum, keeping its fraction.
   *
   * Measured against the maximum the value was *last* scaled to, which the pet
   * state remembers — not against the previous level's, which god mode's level
   * floor makes wrong.
   */
  private rescaleStoredHp(): void {
    const previousMax = this.petState.scaledAgainstMaxHp;
    const newMax = this.maxHp;
    if (previousMax === newMax) return;
    const fraction = previousMax > 0 ? this.petState.hp / previousMax : 1;
    this.petState.hp = Math.min(newMax, Math.ceil(fraction * newMax));
    this.petState.scaledAgainstMaxHp = newMax;
  }

  /** The R key and the Summon button both route here: out → recall, in → summon. */
  toggleRecall(): void {
    if (!this.deinonychus || this.deinonychus.collapsing) return;
    if (this.deinonychus.recalling) {
      // Pressing recall at a pet who is already recalling *is* an input, and it
      // has an obvious meaning: he is not coming, bring him to me. Answering it
      // with nothing is what made the button dead exactly when the player most
      // needed it — the recall order was already given, and the only thing left
      // to give was the rescue.
      //
      // Except once he has arrived: he is standing at her feet fading out, and
      // "bring him to me" has already happened. The creature judges the rest —
      // a press two frames into the run is a double-tap, not a diagnosis.
      if (!this.deinonychus.recallArrived) this.deinonychus.requestRescue();
      return;
    }
    this.speak(DEINONYCHUS_LINES.recall(this.words).paragraphs[0]);
    this.deinonychus.beginRecall();
    this.releaseTargeting(this.retreatMobs, this.deinonychus);
  }

  private speak(text: string): void {
    this.speech.say(text);
  }

  /**
   * Drop every reference the mob list holds to the pet.
   *
   * Each mob he provoked holds a `retaliateMob` pointing at him, and the
   * staleness sweep that normally clears those only fires on a *dead* target —
   * which he never is, because the whole point of the recall is that he
   * survives it. Run at despawn it stops them beelining to the tile he vanished
   * from for the rest of the floor; run again when the retreat *starts*, it also
   * stops them escorting him all the way home, which is what made excluding him
   * from `extraTargets` do nothing.
   */
  private releaseTargeting(mobs: Mob[], deinonychus: Deinonychus): void {
    for (const mob of mobs) {
      if (mob.retaliateMob === deinonychus) mob.retaliateMob = null;
      if (mob.currentTarget === deinonychus) mob.currentTarget = null;
    }
  }

  /**
   * @param explainHealing whether this despawn is a moment the player is
   *   watching. False for a floor transition or a building entry, where the pet
   *   is put away as a side effect of something else and a notice about his
   *   health would arrive over a loading screen with nothing to attach it to.
   */
  private finishDespawn(mobs: Mob[], mobGrid: SpatialGrid<Mob>, explainHealing = true): boolean {
    const deinonychus = this.deinonychus;
    if (!deinonychus) return false;
    this.releaseTargeting(mobs, deinonychus);
    // His remaining health goes back into the pet state, which is the only place
    // it survives: this instance is about to be thrown away.
    this.petState.hp = deinonychus.exhausted ? 0 : Math.max(0, deinonychus.hp);
    this.petState.scaledAgainstMaxHp = deinonychus.maxHp;
    // Recalled with health to spare he is available again immediately; recalled
    // spent, he owes the player the whole climb back to full.
    if (deinonychus.exhausted) this.petState.restingUntilFull = true;
    // The knockout line is deliberately *not* said here — see
    // `explainKnockoutOnce`, which is driven by the state rather than by the
    // despawn that produced it.
    else if (explainHealing) this.explainOffDutyRegenOnce(deinonychus);
    mobGrid.remove(deinonychus);
    const index = mobs.indexOf(deinonychus);
    if (index >= 0) mobs.splice(index, 1);
    this.deinonychus = null;
    this.petState.regenFrames = 0;
    // Measured against full rather than the summon floor, so the credit heals
    // him whenever he is short of full, not only while he is unsummonable.
    advanceDeinonychusRecovery(
      this.petState,
      deinonychus.maxHp,
      deinonychus.maxHp,
      this.retreatFrames,
    );
    this.retreatFrames = 0;
    return true;
  }

  /**
   * Names the knockout rule the first time the player is actually looking at a
   * knocked-out pet.
   *
   * Driven by the state rather than by the despawn that produced it, because the
   * despawn is the wrong moment on both of the paths that matter. A party wipe
   * spends him and then rewinds: with a checkpoint the restore puts the latch
   * back to whatever it was, so a line said at despawn announces a knockout that
   * has just been undone — over a full green bar reading Summon — and burns its
   * one-shot, leaving the next real knockout explained by nothing. Without a
   * checkpoint the scene is replaced and the toast is cleared, so the line is
   * discarded unseen. Reading the settled state instead is right in both, and in
   * the ordinary case says it on the first frame the button goes grey.
   */
  private explainKnockoutOnce(): void {
    if (this.petState.knockoutRuleExplained) return;
    if (!this.unlocked) return;
    if (this.deinonychus !== null || !this.petState.restingUntilFull) return;
    this.petState.knockoutRuleExplained = true;
    this.toasts.post(
      `${this.words.opening} must heal fully before resummoning`,
      HEALING_RULE_TOAST,
    );
  }

  /**
   * Names the off-duty regen rule the first time he leaves the field wounded.
   *
   * True of every despawn and always has been; what was missing is that nothing
   * in the game ever said it. Said in the world at the moment it bites — the cat
   * talking to her pet, a notice stating the rule — because the alternative is
   * a tutorial screen for one sentence.
   */
  private explainOffDutyRegenOnce(deinonychus: Deinonychus): void {
    if (this.hasExplainedOffDutyRegen) return;
    if (deinonychus.hp >= deinonychus.maxHp) return;
    this.hasExplainedOffDutyRegen = true;
    this.speak(DEINONYCHUS_LINES.restUp(this.words).paragraphs[0]);
    this.toasts.post(`${this.words.opening} heals only while recalled`, HEALING_RULE_TOAST);
  }

  /**
   * Remove Deinonychus immediately — a floor transition or a building entry, where
   * there is no time for a recall run. His HP is preserved either way.
   */
  dismiss(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (!this.deinonychus) return;
    this.finishDespawn(mobs, mobGrid, false);
  }

  /**
   * Snapshots the unlock so a death rewinds it.
   *
   * The live creature is deliberately not part of this. The death path already
   * calls {@link dismiss} before restoring, which runs the full despawn —
   * removing him from the mob list and grid and writing his remaining HP into
   * the shared pet state — so by the time a restore lands there is no summoned
   * Deinonychus to rewind, only the record of him. That also fixes the ordering the
   * pet state's own restore depends on: `dismiss` writes HP, then
   * `restoreDeinonychusPetState` overwrites it with the checkpoint's.
   */
  captureCheckpoint(): DeinonychusCheckpoint {
    return { unlocked: this.unlocked };
  }

  restoreCheckpoint(snapshot: DeinonychusCheckpoint): void {
    this.unlocked = snapshot.unlocked;
  }

  /** Whether the summon button should be shown. */
  get canShow(): boolean {
    return this.unlocked;
  }

  /** Whether Deinonychus can be sent in right now. */
  get canSummon(): boolean {
    return (
      this.unlocked &&
      this.deinonychus === null &&
      !this.petState.restingUntilFull &&
      this.hp >= this.minSummonHp
    );
  }

  /** Whether the button's press does anything at all, in either direction. */
  get canPress(): boolean {
    if (this.canSummon) return true;
    const deinonychus = this.deinonychus;
    if (deinonychus === null) return false;
    // One rule, applied everywhere it holds: the button claims to be live only
    // when a press would actually do something. It does nothing through the
    // collapse one-shot, and nothing through the opening of a recall — where a
    // press is a double-tap rather than "he is not coming" — so it says so.
    if (deinonychus.collapsing) return false;
    if (deinonychus.recalling) return deinonychus.acceptsRescueRequest;
    return true;
  }

  /**
   * What the HUD's Summon card shows, or null while it is hidden: before he is
   * unlocked, or while the human leads.
   */
  summonCard(isCatActive: boolean): Omit<SummonModel, 'onTap'> | null {
    if (!this.unlocked || !isCatActive) return null;
    const isActive = this.deinonychus !== null;
    // 'Resting' covers every health reason he is unavailable, not just a
    // knockout. A pet recalled voluntarily at a third of his health is exactly
    // as unsummonable as a knocked-out one until he heals past the floor, and
    // labelling that state 'Summon' over a countdown says the button is ready
    // when it is refusing.
    const restingUp = !isActive && !this.canSummon;
    const label = isActive
      ? DEINONYCHUS_BUTTON_LABELS.recall
      : restingUp
        ? DEINONYCHUS_BUTTON_LABELS.resting
        : DEINONYCHUS_BUTTON_LABELS.summon;
    // The wait is only legible as a number. The HP bar answers "how hurt is
    // he", but a dinosaur resting off a knockout is unavailable at 99% as surely
    // as at 1%, and the bar cannot show the difference between "nearly" and "yes".
    const waitFrames = isActive ? 0 : this.framesUntilReady;
    const totalFrames = deinonychusTotalRecoveryFrames(this.petState, this.maxHp, this.minSummonHp);
    const stage = getDeinonychusStats(this.petLevel()).stage;
    return {
      petName: this.words.called,
      label,
      active: isActive,
      usable: this.canPress,
      // Green once he is fit to send in, red while he is still recovering: the
      // bar answers "can I summon him" as well as "how hurt is he".
      ready: this.canSummon || isActive,
      hp: displayHp(this.hp),
      maxHp: this.maxHp,
      xpFraction: this.petXpFraction(),
      cooldown: totalFrames > 0 ? Math.min(1, Math.max(0, waitFrames / totalFrames)) : 0,
      cooldownSeconds: Math.ceil(waitFrames / FRAMES_PER_SECOND),
      paintIcon: (ctx, rect) =>
        drawDeinonychusIcon(
          ctx,
          stage,
          rect.x + rect.w / 2,
          rect.y + rect.h / 2,
          Math.min(rect.w, rect.h) * DEINONYCHUS_CARD_ICON_SIZE_RATIO,
        ),
    };
  }

  /**
   * A marker pinned to the screen edge while he is out but off-camera.
   *
   * The rescue guarantees he can always get home, and this guarantees the
   * player can always tell where he is on the way, so no arrangement of pet and
   * geometry reads as "he is simply gone".
   *
   * Both the visibility test and the bearing are taken from the *active* crawler
   * rather than from the cat, because that is who the camera follows and who the
   * player is steering: the marker's position on screen is camera-relative, so a
   * bearing measured from anyone else points somewhere the arrow does not.
   *
   * "Off screen" means out of *sight*, not out of the rect. On a viewport large
   * enough for the fog to draw at all, everything past its outer radius is
   * painted solid black — and once the camera clamps at a map border a wide
   * swathe of that is inside the rect, so a pet there is on screen and completely
   * invisible, which is the state this marker exists to answer. On a viewport
   * small enough that the fog never draws, the same test marks a pet who is
   * technically still lit; a redundant icon is the right way round to be wrong.
   * Called from the scene after the fog and before the HUD; see the call site for
   * why it is pinned between them. It paints in the screen's own CSS pixels, so
   * it is drawn outside the world pass's zoom.
   */
  renderOffscreenMarker(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    active: HumanPlayer | CatPlayer,
    visibleRadiusPx: number,
  ): void {
    const deinonychus = this.deinonychus;
    // Nothing to point at during the fade: he is at her feet and on his way out.
    if (deinonychus === null || deinonychus.recallArrived) return;

    const { x: screenX, y: screenY } = worldToScreen(
      camera,
      deinonychus.x + TILE_SIZE * TILE_CENTER,
      deinonychus.y + TILE_SIZE * TILE_CENTER,
    );
    const width = viewportWidth();
    const height = viewportHeight();
    const insideViewport = screenX >= 0 && screenY >= 0 && screenX <= width && screenY <= height;
    const distanceFromActive = Math.hypot(deinonychus.x - active.x, deinonychus.y - active.y);
    if (insideViewport && distanceFromActive <= visibleRadiusPx) return;

    const stage = getDeinonychusStats(this.petLevel()).stage;
    paintOffscreenPetMarker(ctx, {
      screenX,
      screenY,
      screenW: width,
      screenH: height,
      bearing: Math.atan2(deinonychus.y - active.y, deinonychus.x - active.x),
      paintPortrait: (target, centreX, centreY, size) =>
        drawDeinonychusIcon(target, stage, centreX, centreY, size),
    });
  }

  /** Render the cat's speech bubble for Deinonychus-related lines. */
  renderSpeechBubble(ctx: CanvasRenderingContext2D, catScreenX: number, catScreenY: number): void {
    drawTimedSpeechBubble(
      ctx,
      this.speech,
      catScreenX + TILE_SIZE * SPEECH_ANCHOR_X_RATIO,
      catScreenY,
      CAT_SPEECH_STYLE,
    );
  }
}
