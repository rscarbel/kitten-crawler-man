import { TILE_SIZE } from '../core/constants';
import { Mongo } from '../creatures/Mongo';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import {
  advanceMongoRecovery,
  MONGO_KILL_RECOVERY_FRAMES,
  MONGO_MIN_SUMMON_HP,
  mongoFramesUntilReady,
  mongoTotalRecoveryFrames,
  tickMongoRegen,
  type MongoPetState,
} from '../core/MongoPetState';
import { getMongoStats, MONGO_DAMAGE_PER_XP } from '../abilities/mongo';
import { drawMongoIcon } from '../sprites/mongoSprite';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';
import { drawButton } from '../ui/Button';
import { drawBox, drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import { drawCooldownOverlay } from '../ui/CooldownOverlay';
import { ToastStack } from '../ui/ToastStack';
import { findNearbyWalkableTile } from '../map/findWalkableTile';

/**
 * Mongo's lifecycle: summoning, recall, off-duty recovery and the summon button.
 *
 * The pet's HP is *persistent*. He does not heal by being put away and brought
 * back out; he regenerates slowly while off duty and carries whatever is left
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

/** Duration a speech bubble stays visible (frames). */
const SPEECH_DURATION = 150;

// Rendering constants
const MONGO_BUTTON_ICON_SIZE_RATIO = 0.6;
/** Clear space between the label's top and the HP bar drawn under it. */
const MONGO_BUTTON_LABEL_GAP = 12;
const MONGO_BUTTON_LABEL_SIZE = 9;
const MONGO_ICON_Y_OFFSET = 6;
const MONGO_HP_BAR_HEIGHT = 4;
const MONGO_HP_BAR_INSET = 4;
const MONGO_HP_BAR_BOTTOM_GAP = 2;
const MONGO_HP_READY_COLOR = '#4ade80';
const MONGO_HP_SPENT_COLOR = '#ef4444';

// Speech bubble rendering
const SPEECH_BUBBLE_ALPHA_DECAY_TIME = 30; // frames
const SPEECH_BUBBLE_FONT_SIZE = 11;
const SPEECH_BUBBLE_BOLD_FONT = `bold ${SPEECH_BUBBLE_FONT_SIZE}px monospace`;
const SPEECH_BUBBLE_OFFSET_X_RATIO = 0.5;
const SPEECH_BUBBLE_OFFSET_Y = 28;
const SPEECH_BUBBLE_PADDING = 16;
const SPEECH_BUBBLE_PADDING_CORNERS = 6;
const SPEECH_BUBBLE_HEIGHT = 22;
const SPEECH_BUBBLE_BG_ALPHA = 0.8;
const SPEECH_BUBBLE_BORDER_WIDTH = 1;
const SPEECH_BUBBLE_BORDER_COLOR = '#60a5fa';
const SPEECH_BUBBLE_POINTER_SIZE = 5;
const SPEECH_BUBBLE_POINTER_HEIGHT = 6;
const SPEECH_BUBBLE_TEXT_Y_OFFSET = 15;
const SPEECH_BUBBLE_TEXT_Y_ADJUST = 9;

// Recovery toasts — the "-1.3s" flags a kill puts over the Summon button.
const RECOVERY_TOAST_FRAMES = 90;
/** Frames of the tail spent fading, so a toast never simply blinks out. */
const RECOVERY_TOAST_FADE_FRAMES = 30;
/**
 * Most toasts on screen at once.
 *
 * A stack taller than this stops being a readable list and starts covering the
 * hotbar above it, and the oldest is the one the player has already read.
 */
const RECOVERY_TOAST_MAX = 4;
const RECOVERY_TOAST_FONT_SIZE = 11;
/** Line pitch of the stack. Above the font size, or the rows touch. */
const RECOVERY_TOAST_LINE_HEIGHT = 13;
/** Clear space between the newest toast and the top of the button. */
const RECOVERY_TOAST_BOTTOM_GAP = 6;
/** Green, because it is time coming *off* a wait — the minus belongs to the clock. */
const RECOVERY_TOAST_COLOR = '#4ade80';
const FRAMES_PER_SECOND = 60;
/** Decimals on the toast's seconds. One kill is worth well under a second. */
const RECOVERY_TOAST_DECIMALS = 1;

/**
 * A point-in-time copy of the pet's scene-level state, for the in-run safe-room
 * checkpoint. His HP and the summon lock are durable and travel with
 * {@link MongoPetState} instead.
 */
export interface MongoCheckpoint {
  unlocked: boolean;
}

export class MongoSystem implements GameSystem {
  /** Whether the player has unlocked Mongo by defeating the Krakaren Clone. */
  unlocked = false;

  /** The currently active Mongo instance (null when not summoned). */
  mongo: Mongo | null = null;

  /** Current speech bubble text shown above the cat. */
  speechText: string | null = null;
  /** Remaining frames for the speech bubble. */
  speechTimer = 0;

  /**
   * The mob list from the last frame.
   *
   * `checkHealth` and `toggleRecall` are both called from outside the system's
   * own `update`, so they have no context to read it from — and both of them
   * start a retreat, which has to shake off everything targeting him.
   */
  private retreatMobs: Mob[] = [];

  /**
   * The "-1.3s" flags over the Summon button.
   *
   * Not merged by text: identical numbers back to back are the normal case here
   * — every kill is worth the same tick — and three of them mean three kills.
   */
  private readonly recoveryToasts = new ToastStack({
    displayTicks: RECOVERY_TOAST_FRAMES,
    fadeTicks: RECOVERY_TOAST_FADE_FRAMES,
    maxVisible: RECOVERY_TOAST_MAX,
    fontSize: RECOVERY_TOAST_FONT_SIZE,
    lineHeight: RECOVERY_TOAST_LINE_HEIGHT,
    color: RECOVERY_TOAST_COLOR,
    outline: true,
  });

  /**
   * @param petState  HP and the quest lock, threaded by reference across scenes
   *                  because the `Mongo` instance is destroyed on every despawn.
   * @param petLevel  Reads the current ability level. A function rather than a
   *                  number so a level-up mid-summon is picked up immediately.
   * @param grantAbilityXp  Pays XP into the Mongo ability. Injected for the same
   *                  reason `petLevel` is: the system has no ability manager of
   *                  its own, and the scene owns the one that must be levelled.
   */
  constructor(
    private readonly petState: MongoPetState,
    private readonly petLevel: () => number,
    private readonly grantAbilityXp: (amount: number) => void,
  ) {}

  /**
   * His HP right now — the live creature's while he is out, the stored value
   * while he is not.
   *
   * `petState.hp` alone is only written back on despawn, so a bar reading it
   * stays full while he is being chewed to pieces. The live value alone is just
   * as wrong the other way: `checkHealth` pins a spent pet at one hit point so
   * he can walk home, and reading that would save him as 1 and paint his bar
   * green for a raptor the player has already spent.
   */
  get hp(): number {
    if (this.mongo === null) return this.petState.hp;
    return this.mongo.exhausted ? 0 : this.mongo.hp;
  }

  get maxHp(): number {
    return getMongoStats(this.petLevel()).maxHp;
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
    return this.petState.restingUntilFull || (this.mongo?.exhausted ?? false);
  }

  /**
   * Frames of recovery left before the Summon button goes live.
   *
   * Zero while he is out — the button says Recall then, and a countdown over it
   * would be counting down to something that is already true.
   */
  get framesUntilReady(): number {
    if (this.mongo !== null) return 0;
    if (this.petState.summonLocked) return 0;
    return mongoFramesUntilReady(this.petState, this.maxHp);
  }

  /** Blocked while the circus quest holds him as Signet's collateral. */
  get summonLocked(): boolean {
    return this.petState.summonLocked;
  }

  set summonLocked(locked: boolean) {
    this.petState.summonLocked = locked;
  }

  /**
   * Summon Mongo near the cat.
   * Returns the new Mongo instance to be added to the mobs array + grid.
   */
  summon(cat: CatPlayer, gameMap: GameMap): Mongo | null {
    if (!this.canSummon) return null;

    const spawn = this.findSpawnTile(cat, gameMap);
    if (spawn === null) {
      // `canSummon` is true here, so the button looks live and the key is armed.
      // Refusing in silence is indistinguishable from a dropped input.
      this.speak('No room for Mongo!');
      return null;
    }
    this.mongo = new Mongo(spawn.x, spawn.y, TILE_SIZE, cat, this.petLevel(), this.petState.hp);
    this.mongo.setMap(gameMap);
    this.petState.regenFrames = 0;

    this.speechText = 'Go Mongo!';
    this.speechTimer = SPEECH_DURATION;

    return this.mongo;
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
   * Two things made the old version put him inside walls in a corridor. It took
   * the cat's tile as `floor(cat.x / TILE_SIZE)`, which is the tile under her
   * sprite's top-left *corner* rather than under her — one tile off in a narrow
   * hallway, where the neighbouring tile is masonry. And its fallback was that
   * same unvalidated tile, so the one branch that existed to handle a blocked
   * spawn placed him on ground nothing had checked.
   *
   * The sight test keeps the ring search from solving a blocked corridor by
   * putting him in the room on the other side of the wall, and stairwell tiles
   * are excluded because `isWalkable` admits them while `Mob.moveWithCollision`
   * refuses to enter one — the spawn contract has to match the movement contract
   * or he lands somewhere he cannot leave by three of its four sides.
   *
   * Returns null when there is nowhere he can stand, and the summon is refused.
   * There is deliberately no "just use the cat's tile" fallback: the only way to
   * reach one is for the cat herself to be standing somewhere unwalkable — an
   * arena door closing under her, a scripted placement — which is precisely the
   * case where that tile is the wrong answer.
   */
  private findSpawnTile(cat: CatPlayer, gameMap: GameMap): { x: number; y: number } | null {
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
      (x, y) => inSightOfCat(x, y) && !gameMap.isStairwellTile(x, y),
    );
  }

  /**
   * Called each frame. Returns true on the frame he finished despawning; the
   * removal from `mobs` and `mobGrid` has already happened by then.
   */
  update(ctx: SystemContext): boolean {
    const { mobs, mobGrid, cat } = ctx;
    this.retreatMobs = mobs;

    if (this.speechTimer > 0) this.speechTimer--;
    if (this.speechTimer <= 0) this.speechText = null;

    // Above the summoned/not-summoned branch below: a toast raised by the last
    // kill before he came up would otherwise hang on screen forever.
    this.recoveryToasts.update();

    if (!this.mongo) {
      // Also here, not only from `onLevelUp`: `setGodModeMinLevel` moves the
      // effective level without firing that callback, and a pet left holding a
      // level-1 value against a level-15 maximum reads as permanently dying.
      this.rescaleStoredHp();
      this.tickRegen();
      return false;
    }

    this.mongo.allMobs = mobs;
    this.payOutDamageXp(this.mongo);
    // A growth spurt mid-fight has to reach the creature that is already out, or
    // he keeps the juvenile's stats and sheet until the next time he is summoned.
    this.mongo.applyLevel(this.petLevel());

    // The cat going down spends him, by the player's ruling: he goes down with
    // her, and comes back owing the same full recovery a knockout costs, so a
    // wipe cannot be walked off by re-summoning the raptor on the next screen.
    // Set outside the recall guard below, which exists only to keep from
    // re-issuing the order — a Mongo already running home is spent just the same.
    if (!cat.isAlive) this.mongo.exhausted = true;

    // The cat going down calls him home, exactly as running out of health does.
    if (!cat.isAlive && !this.mongo.recalling && !this.mongo.collapsing) {
      this.speak('Mongo, come back!');
      this.mongo.beginRecall();
      this.releaseTargeting(mobs, this.mongo);
    }

    if (this.mongo.despawnComplete) return this.finishDespawn(mobs, mobGrid);
    return false;
  }

  /**
   * A kill takes {@link MONGO_KILL_RECOVERY_FRAMES} off his recovery.
   *
   * The point is to make pushing forward the faster way to get him back rather
   * than standing in a cleared corridor watching a countdown — so it is worth
   * being clear about what it does *not* do. It never pays a pet who is out (his
   * live HP lives on the creature, and the stored value this heals is a stale
   * copy from his last despawn), and never one held by the circus quest, whose
   * wait is a story beat rather than a cooldown.
   */
  onKill(): void {
    if (!this.unlocked || this.summonLocked || this.mongo !== null) return;
    const framesSaved = advanceMongoRecovery(this.petState, this.maxHp, MONGO_KILL_RECOVERY_FRAMES);
    // Zero whenever he was already fit, which is most of the run — no toast for
    // a boost that did nothing.
    if (framesSaved <= 0) return;
    this.pushRecoveryToast(framesSaved);
  }

  /** Raises a fresh "-1.3s" over the button, pushing the older ones up a row. */
  private pushRecoveryToast(framesSaved: number): void {
    const secondsSaved = framesSaved / FRAMES_PER_SECOND;
    this.recoveryToasts.show(`-${secondsSaved.toFixed(RECOVERY_TOAST_DECIMALS)}s`);
  }

  /**
   * Turns the damage he has landed into ability XP — see
   * {@link MONGO_DAMAGE_PER_XP} for why he is paid for it at all.
   *
   * Only whole points are paid and the remainder stays banked on the creature,
   * so the rate is the same whether he lands a hundred damage in one blow or in
   * fifty. The most he can lose is the tail end of one bite, on despawn.
   */
  private payOutDamageXp(mongo: Mongo): void {
    const earnedXp = Math.floor(mongo.damageDealtPendingXp / MONGO_DAMAGE_PER_XP);
    if (earnedXp <= 0) return;
    mongo.damageDealtPendingXp -= earnedXp * MONGO_DAMAGE_PER_XP;
    this.grantAbilityXp(earnedXp);
  }

  /**
   * Recovery while he is off duty. The clock and the arithmetic live on the pet
   * state so a building interior can run the identical tick.
   *
   * Not gated on `unlocked`: a pet nobody has unlocked is at full health by
   * definition, so the tick is already a no-op there — and the interior scene
   * has no way to know about the unlock, so a gate here would only make the two
   * call sites differ.
   */
  private tickRegen(): void {
    tickMongoRegen(this.petState, this.maxHp);
  }

  /**
   * Intercepts lethal damage. Called from `DungeonScene` after mob damage
   * resolution, before kills are resolved, so Mongo never actually dies: he
   * collapses, gets up, and runs home on his last legs.
   */
  checkHealth(): void {
    if (!this.mongo) return;
    if (this.mongo.hp > 0) return;
    // Deliberately *not* gated on whether he is already retreating. He runs home
    // on one hit point, and mobs keep swinging at him the whole way — gated, the
    // interception switched itself off exactly when it was needed, he died for
    // real mid-recall, and the system was left holding a dead pet it could
    // neither despawn nor resummon for the rest of the floor.
    const alreadyRetreating = this.mongo.collapsing || this.mongo.recalling;
    // Recorded before that early return, not inside `beginCollapse`. Recalling a
    // wounded pet is the obvious thing to do when he is in trouble, and mobs keep
    // swinging at him the whole way home — his HP reaching zero on that run is
    // still his HP reaching zero, and skipping the flag made pressing R in time
    // a way to spend him for free.
    this.mongo.exhausted = true;
    // One hit point, so he stays alive long enough to play the collapse and run
    // back. The zero the player cares about is written into the pet state on
    // despawn — see `finishDespawn`.
    this.mongo.hp = 1;
    // `takeDamage` has already flagged the death that is being intercepted here.
    // Left set, `resolveKills` would run its whole kill path on a pet that is
    // still standing: a `mobKilled` event, a stray point of XP to the human, and
    // a corpse the scene then has to reason about.
    this.mongo.justDied = false;
    this.mongo.killedBy = null;
    this.mongo.killedByDealer = null;
    this.mongo.killType = null;
    this.mongo.damageTakenBy.clear();
    if (alreadyRetreating) return;
    this.speak('Mongo, come back!');
    this.mongo.beginCollapse();
    this.releaseTargeting(this.retreatMobs, this.mongo);
  }

  /**
   * Rescale the stored HP when the pet levels while he is off duty.
   *
   * Takes no level argument on purpose — the effective level is read from the
   * same source everything else uses, so god mode's floor cannot make the two
   * disagree.
   *
   * Without it the two paths disagree: a summoned Mongo grows through
   * `Mongo.applyLevel` and an unsummoned one silently keeps the hit points of a
   * smaller animal against a larger maximum.
   */
  onPetLevelUp(): void {
    if (this.mongo !== null) return;
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
    if (!this.mongo || this.mongo.recalling || this.mongo.collapsing) return;
    this.speak('Mongo, come back!');
    this.mongo.beginRecall();
    this.releaseTargeting(this.retreatMobs, this.mongo);
  }

  private speak(text: string): void {
    this.speechText = text;
    this.speechTimer = SPEECH_DURATION;
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
  private releaseTargeting(mobs: Mob[], mongo: Mongo): void {
    for (const mob of mobs) {
      if (mob.retaliateMob === mongo) mob.retaliateMob = null;
      if (mob.currentTarget === mongo) mob.currentTarget = null;
    }
  }

  private finishDespawn(mobs: Mob[], mobGrid: SpatialGrid<Mob>): boolean {
    const mongo = this.mongo;
    if (!mongo) return false;
    this.releaseTargeting(mobs, mongo);
    // His remaining health goes back into the pet state, which is the only place
    // it survives: this instance is about to be thrown away.
    this.petState.hp = mongo.exhausted ? 0 : Math.max(0, mongo.hp);
    this.petState.scaledAgainstMaxHp = mongo.maxHp;
    // Recalled with health to spare he is available again immediately; recalled
    // spent, he owes the player the whole climb back to full.
    if (mongo.exhausted) this.petState.restingUntilFull = true;
    mobGrid.remove(mongo);
    const index = mobs.indexOf(mongo);
    if (index >= 0) mobs.splice(index, 1);
    this.mongo = null;
    this.petState.regenFrames = 0;
    return true;
  }

  /**
   * Remove Mongo immediately — a floor transition or a building entry, where
   * there is no time for a recall run. His HP is preserved either way.
   */
  dismiss(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (!this.mongo) return;
    this.finishDespawn(mobs, mobGrid);
  }

  /**
   * Snapshots the Krakaren-chest unlock so a death rewinds it.
   *
   * The live creature is deliberately not part of this. The death path already
   * calls {@link dismiss} before restoring, which runs the full despawn —
   * removing him from the mob list and grid and writing his remaining HP into
   * the shared pet state — so by the time a restore lands there is no summoned
   * Mongo to rewind, only the record of him. That also fixes the ordering the
   * pet state's own restore depends on: `dismiss` writes HP, then
   * `restoreMongoPetState` overwrites it with the checkpoint's.
   */
  captureCheckpoint(): MongoCheckpoint {
    return { unlocked: this.unlocked };
  }

  restoreCheckpoint(snapshot: MongoCheckpoint): void {
    this.unlocked = snapshot.unlocked;
  }

  /** Whether the summon button should be shown. */
  get canShow(): boolean {
    return this.unlocked;
  }

  /** Whether Mongo can be sent in right now. */
  get canSummon(): boolean {
    return (
      this.unlocked &&
      this.mongo === null &&
      !this.petState.summonLocked &&
      !this.petState.restingUntilFull &&
      this.hp >= MONGO_MIN_SUMMON_HP
    );
  }

  /** Whether the button's press does anything at all, in either direction. */
  get canPress(): boolean {
    if (this.canSummon) return true;
    // Not while he is collapsing: `toggleRecall` no-ops there, and a button that
    // looks live and does nothing for half a second reads as a dropped input.
    return this.mongo !== null && !this.mongo.recalling && !this.mongo.collapsing;
  }

  /**
   * Render the Summon/Recall button. Works for both desktop and mobile.
   * Returns the button rect for hit-testing.
   */
  renderSummonButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    isCatActive: boolean,
  ): { x: number; y: number; w: number; h: number } {
    const rect = { x, y, w, h };
    if (!this.unlocked || !isCatActive) return rect;

    const isActive = this.mongo !== null;
    const usable = this.canPress;

    drawButton(ctx, {
      x,
      y,
      width: w,
      height: h,
      label: '',
      fill: isActive ? 'rgba(37,99,235,0.30)' : usable ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)',
      border: isActive ? '#2563eb' : usable ? '#475569' : '#334155',
      borderWidth: 1.5,
      radius: 0,
    });

    drawMongoIcon(
      ctx,
      getMongoStats(this.petLevel()).stage,
      x + w / 2,
      y + h / 2 - MONGO_ICON_Y_OFFSET,
      Math.min(w, h) * MONGO_BUTTON_ICON_SIZE_RATIO,
    );

    const label = isActive ? 'Recall' : this.restingUntilFull ? 'Resting' : 'Summon';
    drawText(ctx, label, {
      x: x + w / 2,
      y: y + h - MONGO_HP_BAR_HEIGHT - MONGO_HP_BAR_BOTTOM_GAP - MONGO_BUTTON_LABEL_GAP,
      size: MONGO_BUTTON_LABEL_SIZE,
      color: usable ? '#94a3b8' : '#64748b',
      align: 'center',
    });

    // His health, which is what the countdown over it is counting *toward* —
    // there is no separate cooldown clock, only the climb back up this bar.
    drawProgressBar(ctx, {
      x: x + MONGO_HP_BAR_INSET,
      y: y + h - MONGO_HP_BAR_HEIGHT - MONGO_HP_BAR_BOTTOM_GAP,
      width: w - MONGO_HP_BAR_INSET * 2,
      height: MONGO_HP_BAR_HEIGHT,
      value: this.hpRatio,
      ...PROGRESS_PRESETS.hp,
      // Green once he is fit to send in, red while he is still recovering: the
      // bar answers "can I summon him" as well as "how hurt is he".
      fill: this.canSummon || isActive ? MONGO_HP_READY_COLOR : MONGO_HP_SPENT_COLOR,
    });

    // The wait is only legible as a number. The HP bar answers "how hurt is he",
    // but a raptor resting off a knockout is unavailable at 99% as surely as at
    // 1%, and the bar cannot show the difference between "nearly" and "yes".
    if (!isActive) {
      drawCooldownOverlay(ctx, {
        x,
        y,
        width: w,
        height: h,
        remainingFrames: this.framesUntilReady,
        totalFrames: mongoTotalRecoveryFrames(this.petState, this.maxHp),
      });
    }

    this.renderRecoveryToasts(ctx, x, y, w);

    return rect;
  }

  /**
   * The stack of "-1.3s" flags, drawn upward from just above the button.
   *
   * Anchored to the button rather than to the screen so it cannot drift away
   * from the countdown it is explaining — the number the toast is subtracting
   * from is the one drawn on this button, and the two have to read as one
   * widget. That is also why it is drawn from here: the button's rect is a
   * layout decision the caller makes per frame, and nothing else knows it.
   */
  private renderRecoveryToasts(
    ctx: CanvasRenderingContext2D,
    buttonX: number,
    buttonY: number,
    buttonWidth: number,
  ): void {
    const newestRowTopY = buttonY - RECOVERY_TOAST_BOTTOM_GAP - RECOVERY_TOAST_FONT_SIZE;
    this.recoveryToasts.render(ctx, buttonX + buttonWidth / 2, newestRowTopY);
  }

  /**
   * Render the cat's speech bubble for Mongo-related lines.
   */
  renderSpeechBubble(ctx: CanvasRenderingContext2D, catScreenX: number, catScreenY: number): void {
    if (!this.speechText || this.speechTimer <= 0) return;

    const alpha = Math.min(1, this.speechTimer / SPEECH_BUBBLE_ALPHA_DECAY_TIME);
    const text = this.speechText;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = SPEECH_BUBBLE_BOLD_FONT;
    const tw = ctx.measureText(text).width;
    const bw = tw + SPEECH_BUBBLE_PADDING;
    const bh = SPEECH_BUBBLE_HEIGHT;
    const bx = catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO - bw / 2;
    const by = catScreenY - SPEECH_BUBBLE_OFFSET_Y;

    drawBox(ctx, {
      x: bx,
      y: by,
      width: bw,
      height: bh,
      fill: `rgba(0,0,0,${SPEECH_BUBBLE_BG_ALPHA})`,
      border: SPEECH_BUBBLE_BORDER_COLOR,
      borderWidth: SPEECH_BUBBLE_BORDER_WIDTH,
      radius: SPEECH_BUBBLE_PADDING_CORNERS,
    });

    // The pointer is the one part with no utility for it: a triangle hanging off
    // one edge of a box is not a box.
    ctx.fillStyle = `rgba(0,0,0,${SPEECH_BUBBLE_BG_ALPHA})`;
    ctx.beginPath();
    ctx.moveTo(
      catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO - SPEECH_BUBBLE_POINTER_SIZE,
      by + bh,
    );
    ctx.lineTo(
      catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO,
      by + bh + SPEECH_BUBBLE_POINTER_HEIGHT,
    );
    ctx.lineTo(
      catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO + SPEECH_BUBBLE_POINTER_SIZE,
      by + bh,
    );
    ctx.closePath();
    ctx.fill();

    // Text
    drawText(ctx, text, {
      x: catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO,
      y: by + SPEECH_BUBBLE_TEXT_Y_OFFSET - SPEECH_BUBBLE_TEXT_Y_ADJUST,
      size: SPEECH_BUBBLE_FONT_SIZE,
      bold: true,
      color: '#e0f2fe',
      align: 'center',
      alpha,
    });

    ctx.restore();
  }
}
