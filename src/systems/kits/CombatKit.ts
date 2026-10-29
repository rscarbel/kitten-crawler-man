/**
 * CombatKit — everything a place needs in order to be somewhere a fight can
 * happen: spell effects, mob AI, attack and death resolution, gore, floating
 * damage numbers, the seismic stomp blast, regeneration, and the death screen.
 *
 * A scene constructs one of these and gets combat. Before it existed, the
 * dungeon owned all of it as loose fields while `BuildingInteriorScene` owned a
 * hand-built subset that only came to life for three quest encounters — which is
 * why swinging at anything in an ordinary shop did nothing at all.
 *
 * The members stay concrete types rather than a `GameSystem[]`: their `update`
 * signatures are not uniform (`SeismicStompEffectSystem.update()` takes nothing,
 * `MobUpdateLoop.update(ctx)` takes the frame), so a homogeneous loop could only
 * be reached through casts.
 */

import { outgoingHitDamageOn } from '../../core/combat/outgoingHit';
import { MAGIC_HIT } from '../../core/combat/damageTags';
import { GearSystem } from '../GearSystem';
import { RELIC_HUM_HEARING_TILES, RELIC_HUM_LOOP, RELIC_HUM_VOLUME } from '../gearTraitSoundCues';
import { TILE_SIZE } from '../../core/constants';
import { makeElectrified } from '../../core/combat/StatusEffect';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { Mob } from '../../creatures/Mob';
import type { AudioManager } from '../../audio/AudioManager';
import type { SoundId } from '../../audio/sounds';
import type { AbilityManager } from '../../core/skills/AbilityManager';
import { DeathScreen } from '../../ui/DeathScreen';
import { BodyPartGoreSystem } from '../BodyPartGoreSystem';
import {
  resolveKills,
  resolvePlayerAttacks,
  type CombatContext,
  type MeleeStructureTarget,
} from '../CombatSystem';
import { FloatingCombatTextSystem } from '../FloatingCombatTextSystem';
import { playMobAudioCues } from '../GameLoopPhases';
import type { SystemContext } from '../GameSystem';
import { GoreSystem } from '../GoreSystem';
import { MagicMissileImpactEffectSystem } from '../MagicMissileImpactEffectSystem';
import { MeleeImpactEffectSystem } from '../MeleeImpactEffectSystem';
import { MobUpdateLoop } from '../MobUpdateLoop';
import { PlayerTickSystem } from '../PlayerTickSystem';
import type { SafeRoomSystem } from '../SafeRoomSystem';
import { SeismicStompEffectSystem } from '../SeismicStompEffectSystem';
import { StatusChangeWatcher } from '../statusChangeEvents';
import { StormcallerStrikeSystem } from '../StormcallerStrikeSystem';
import type { SpellSystem } from '../SpellSystem';
import type { DestructiblePropSystem } from '../DestructiblePropSystem';
import type { TownInteriorPropDestructionSystem } from '../TownInteriorPropDestructionSystem';
import type { TreeSystem } from '../TreeSystem';
import type { SceneWorld } from './SceneWorld';

const TILE_CENTRE_FRACTION = 0.5;
const HALF_TILE = TILE_SIZE * TILE_CENTRE_FRACTION;

/** Damage the level-15 shield's parting shockwave deals to everything it catches. */
const SHOCKWAVE_DAMAGE = 4;
/**
 * How far past its drawn radius the shockwave still catches people. The ring
 * reads as a thick band rather than a hairline, so the harm follows the art
 * rather than the single number the ripple is centred on.
 */
const SHOCKWAVE_RADIUS_TILE_MARGIN = 2;
/** Reach, target cap and damage of the level-15 shield's chain lightning. */
const CHAIN_LIGHTNING_RANGE_TILES = 3;
const CHAIN_LIGHTNING_MAX_TARGETS = 3;
const CHAIN_LIGHTNING_DAMAGE = 2;

const KALEIDOSCOPE_ORBIT_LOOP = 'kaleidoscope_orb_orbit_loop' satisfies SoundId;
/** Under everything else: a hum that can run for half a minute must not wear on the player. */
const KALEIDOSCOPE_ORBIT_LOOP_VOLUME = 0.25;

export interface CombatKitDeps {
  readonly world: SceneWorld;
  readonly abilityManager: AbilityManager;
  /** Narrowed exactly as `CombatContext` narrows it. Null where there is no safe room. */
  readonly safeRoom: Pick<SafeRoomSystem, 'isEntityInSafeRoom'> | null;
  /**
   * Shared by every kit in one scene. A scene with several maps (a tower's
   * storeys) builds a kit per map, and a watcher per kit would report the
   * same status change once from each.
   */
  readonly statusChanges?: StatusChangeWatcher;
}

/** Systems a swing can reach that not every scene has. */
export interface CombatResolutionExtras {
  /**
   * Optional only for a caller that has no `DestructionKit` at all. Every scene
   * has one today — a map whose props are architecture builds it over an empty
   * set of breakable kinds rather than going without.
   */
  readonly destructibles?: DestructiblePropSystem;
  /** A building interior's placed-prop breakables — absent everywhere else. */
  readonly interiorProps?: TownInteriorPropDestructionSystem;
  /** Absent everywhere but the overworld, which is the only map that grows trees. */
  readonly trees?: TreeSystem;
  /** Absent everywhere but a map with a village palisade. */
  readonly structures?: MeleeStructureTarget;
}

/** What the scene needs back out of a resolved frame of combat. */
export interface CombatOutcome {
  /** True when any attack connected this frame — the dungeon's combat telemetry rides on it. */
  readonly hitLanded: boolean;
}

/** The direction a killing blow threw its victim, as a unit vector. */
interface ImpactDirection {
  readonly dx: number;
  readonly dy: number;
}

export class CombatKit {
  /**
   * The same instance the roster hands to every mob it accepts, so a shield cast
   * by the party and a mob's read of it can never be two different systems.
   */
  readonly spells: SpellSystem;
  readonly mobLoop = new MobUpdateLoop();
  readonly gore = new GoreSystem();
  readonly bodyPartGore: BodyPartGoreSystem;
  readonly floatingText = new FloatingCombatTextSystem();
  readonly playerTick = new PlayerTickSystem();
  readonly seismicStompFx = new SeismicStompEffectSystem();
  readonly meleeFx = new MeleeImpactEffectSystem();
  readonly missileFx = new MagicMissileImpactEffectSystem();
  /** The Stormcaller's waves in flight, with what each swing has struck. */
  readonly stormcaller = new StormcallerStrikeSystem();
  readonly gear: GearSystem;
  /**
   * Whether the hostile world took its step this frame: false on the frames a
   * crawler's last stand holds it back, which is how it runs at half speed.
   * Set by {@link updateMobs}, which skips the mobs' own AI on those frames.
   * The owning scene skips the hostile systems it runs on the same frames:
   * the projectile systems, fairies and summons, boss-room dressings, the boss
   * rooms' shots and acid, and an interior's quest fight. Room locks, timers
   * and anything friendly keep full pace.
   */
  worldStepTaken = true;
  readonly deathScreen = new DeathScreen();
  private readonly statusChanges: StatusChangeWatcher;

  private readonly world: SceneWorld;
  private readonly abilityManager: AbilityManager;
  /**
   * Rebuilt in place each frame rather than reallocated: `resolvePlayerAttacks`
   * and `resolveKills` read the same context, but a scene has to be able to run
   * its own death interceptions (Deinonychus, a hired mercenary) between them.
   */
  private readonly combatCtx: CombatContext;

  constructor(deps: CombatKitDeps) {
    this.world = deps.world;
    this.abilityManager = deps.abilityManager;
    this.statusChanges = deps.statusChanges ?? new StatusChangeWatcher();
    this.spells = deps.world.roster.spells;
    this.bodyPartGore = new BodyPartGoreSystem(deps.world.gameMap);
    this.gear = new GearSystem(deps.world);
    this.deathScreen.audio = deps.world.audio;
    this.combatCtx = {
      human: deps.world.pm.human,
      cat: deps.world.pm.cat,
      mobs: deps.world.roster.mobs,
      mobGrid: deps.world.roster.grid,
      gameMap: deps.world.gameMap,
      safeRoom: deps.safeRoom,
      bus: deps.world.bus,
      abilityManager: deps.abilityManager,
      spells: this.spells,
      seismicStompFx: this.seismicStompFx,
      meleeFx: this.meleeFx,
      missileFx: this.missileFx,
      weaponProcs: { stormcallerStorm: this.stormcaller },
      gearWorld: this.gear,
      hitLanded: false,
    };
  }

  /**
   * Gore for a mob that has just died, thrown away from whoever killed it.
   *
   * Called by the owning scene from its single `mobKilled` subscription rather
   * than wired here: a tower builds one kit per floor onto one scene bus, and a
   * kit that subscribed for itself would have every inactive floor spawning the
   * same viscera into a system nothing ever renders or ticks.
   */
  spawnKillGore(mob: Mob, killer: HumanPlayer | CatPlayer | null): void {
    const cx = mob.x + HALF_TILE;
    const cy = mob.y + HALF_TILE;
    const impact = impactAwayFrom(cx, cy, killer);
    this.gore.spawnGore(cx, cy, impact.dx, impact.dy);
    this.bodyPartGore.spawnParts(cx, cy, mob.bodyPartKey, TILE_SIZE, impact.dx, impact.dy);
  }

  /** Gore raised by something other than a death — the `spawnGore` event's payload. */
  spawnGore(x: number, y: number, impactDx: number, impactDy: number): void {
    this.gore.spawnGore(x, y, impactDx, impactDy);
  }

  /**
   * Advances both crawlers' swings and the cat's missiles. Runs before
   * {@link updateMobs} so a missile fired this frame is in flight when the mobs
   * it is aimed at decide where to stand.
   */
  updatePlayerAttacks(): void {
    const { human, cat } = this.world.pm;
    human.updateAttack();
    human.updateRocks(this.world.gameMap);
    const wallImpact = human.pendingSlingshotWallImpact;
    if (wallImpact !== null) {
      human.pendingSlingshotWallImpact = null;
      this.world.bus.emit('slingshotImpact', wallImpact);
    }
    cat.updateAttack();
    cat.updateMissiles(this.world.roster.grid);
  }

  /**
   * Spells, then mob AI — in that order, because a shield raised this frame has
   * to exist before the mobs that would walk into it choose a step. The
   * active crawler is placed as the listener first, so every sound the frame
   * places in the world is heard from where the player now stands.
   */
  updateMobs(ctx: SystemContext): void {
    this.world.audio?.setListenerToCrawler(ctx.active);
    this.spells.update(ctx);
    this.worldStepTaken = this.gear.takeWorldStep();
    if (this.worldStepTaken) this.mobLoop.update(ctx);
  }

  /**
   * Lands every attack the party threw this frame.
   *
   * Split from {@link resolveKills} rather than bundled with it because a scene
   * has to intercept its own allies' deaths in between — a fallen mercenary must
   * leave the roster before kill resolution can pay the party XP for it.
   */
  resolvePlayerAttacks(extras: CombatResolutionExtras = {}): CombatOutcome {
    const ctx = this.combatCtx;
    ctx.mobGrid = this.world.roster.grid;
    ctx.destructibles = extras.destructibles;
    ctx.interiorProps = extras.interiorProps;
    ctx.trees = extras.trees;
    ctx.structures = extras.structures;
    resolvePlayerAttacks(ctx);
    this.stormcaller.update(ctx);
    this.world.pm.cat.flushPendingSubMissiles();
    return { hitLanded: ctx.hitLanded };
  }

  /**
   * Turns this frame's deaths into XP, loot, gore and corpses.
   *
   * The grid is re-read here as well as in {@link resolvePlayerAttacks}, so a
   * scene that resolves a frame of deaths without a swing — a floor of mobs
   * burning down, say — cannot be reading the index a checkpoint rewind already
   * replaced.
   */
  resolveKills(): void {
    this.combatCtx.mobGrid = this.world.roster.grid;
    resolveKills(this.combatCtx);
  }

  /**
   * Pays the energy shield its earned XP and lands the two effects the
   * fifteenth level adds: the parting shockwave and the chain lightning a kill
   * through the shield throws.
   *
   * Drained here rather than left to the scene because a shield cast in a
   * building is the same shield cast in a corridor, and a copy of this in one
   * scene only is how the ability came to half-work indoors.
   */
  resolveSpellAftermath(): void {
    const { human } = this.world.pm;
    const grid = this.world.roster.grid;

    const touchXp = this.spells.drainTouchXp();
    if (touchXp > 0) this.abilityManager.addXp('energy_shield', touchXp);
    const blockXp = this.spells.drainBlockXp();
    if (blockXp > 0) this.abilityManager.addXp('energy_shield', blockXp);

    const shockwave = this.spells.drainPendingShockwave();
    if (shockwave !== null) {
      this.spells.addShockwaveRipple(shockwave.x, shockwave.y, shockwave.radiusPx);
      const reach = shockwave.radiusPx + TILE_SIZE * SHOCKWAVE_RADIUS_TILE_MARGIN;
      // The extra tile is the grid's, not the blast's: it keys mobs by origin
      // while the test below measures centres, so without the slack the wave
      // comes up short on one side of itself.
      for (const mob of grid.queryCircle(shockwave.x, shockwave.y, reach + TILE_SIZE)) {
        if (!mob.isAlive || !mob.takesPlayerDamage('energy_shield')) continue;
        const dx = mob.x + HALF_TILE - shockwave.x;
        const dy = mob.y + HALF_TILE - shockwave.y;
        if (Math.hypot(dx, dy) >= reach) continue;
        if (!human.zeroDamage) {
          const wave = outgoingHitDamageOn(human, mob, SHOCKWAVE_DAMAGE, MAGIC_HIT);
          mob.takeDamageFrom(wave, human, 'energy_shield');
        }
        mob.applyStatus(makeElectrified(human));
      }
    }

    for (const target of this.spells.drainChainLightningOrigins()) {
      const nearby = grid.queryCircle(target.x, target.y, TILE_SIZE * CHAIN_LIGHTNING_RANGE_TILES);
      let hits = 0;
      for (const mob of nearby) {
        if (!mob.isHostileTarget || hits >= CHAIN_LIGHTNING_MAX_TARGETS) continue;
        if (!mob.takesPlayerDamage('energy_shield')) continue;
        if (!human.zeroDamage) {
          const bolt = outgoingHitDamageOn(human, mob, CHAIN_LIGHTNING_DAMAGE, MAGIC_HIT);
          mob.takeDamageFrom(bolt, human, 'energy_shield');
        }
        this.spells.addChainLightningBolt(target.x, target.y, mob.x + HALF_TILE, mob.y + HALF_TILE);
        hits++;
      }
    }
  }

  /**
   * Ages the viscera and the seismic stomp blast the frame's fighting left behind,
   * ticks the crawlers' worn gear, and sounds the blast. The boom belongs here
   * rather than with the mob cues because the stomp this frame just resolved
   * raised it.
   */
  updatePostCombat(audio: AudioManager | null): void {
    this.gore.update();
    this.bodyPartGore.update();
    this.seismicStompFx.update();
    this.meleeFx.update();
    this.missileFx.update();
    this.gear.update();
    if (this.seismicStompFx.blastSoundPending) {
      this.seismicStompFx.blastSoundPending = false;
      // `human_seismic_stomp` plays when the ability fires, a third of a second before
      // the foot lands; this is the boom and the ground's shudder the landing itself makes.
      audio?.play('dynamite_explosion');
      audio?.play('seismic_stomp_quake');
    }
    this.playKaleidoscopeCues(audio);
    this.playGearCues(audio);
    const { human, cat } = this.world.pm;
    this.statusChanges.update(human, cat, this.world.bus);
  }

  /**
   * What the crawlers' gear did this frame, and the hum of any relic worn.
   * Every gear cue is the party's own, so it keeps its side but not its
   * distance; the hum is the exception, a sound only heard beside the relic.
   */
  private playGearCues(audio: AudioManager | null): void {
    for (const cue of this.gear.drainSoundCues()) {
      if (cue.takes.length > 0) audio?.playRandomAt(cue.takes, cue.x, cue.y, {}, 'panOnly');
    }
    const listener = this.world.pm.active();
    const listenerX = listener.x + HALF_TILE;
    const listenerY = listener.y + HALF_TILE;
    let nearestTiles = Infinity;
    for (const relic of this.gear.relicHumPoints()) {
      const distanceTiles = Math.hypot(relic.x - listenerX, relic.y - listenerY) / TILE_SIZE;
      nearestTiles = Math.min(nearestTiles, distanceTiles);
    }
    const loops = this.world.audioScope;
    if (nearestTiles >= RELIC_HUM_HEARING_TILES) {
      loops?.stopAmbientLoop(RELIC_HUM_LOOP);
      return;
    }
    const closeness = 1 - nearestTiles / RELIC_HUM_HEARING_TILES;
    const volume = RELIC_HUM_VOLUME * closeness;
    loops?.startAmbientLoop(RELIC_HUM_LOOP, volume);
    loops?.setAmbientLoopVolume(RELIC_HUM_LOOP, volume);
  }

  /**
   * The cues of the cat's split missile copies. The orbit hum follows whether any copy is
   * circling the cat this frame rather than a started flag, so every way the
   * copies can vanish — fading, peeling off, a floor change dropping them, her
   * going down — silences it on the next frame without being told.
   */
  private playKaleidoscopeCues(audio: AudioManager | null): void {
    const { cat } = this.world.pm;
    const cues = cat.drainKaleidoscopeCues();
    if (cues.released) audio?.play('kaleidoscope_orb_spawn');
    if (cues.peeledOff) audio?.play('kaleidoscope_orb_seek');
    const loops = this.world.audioScope;
    if (cat.hasOrbitingKaleidoscopeCopies) {
      loops?.startAmbientLoop(KALEIDOSCOPE_ORBIT_LOOP, KALEIDOSCOPE_ORBIT_LOOP_VOLUME);
    } else {
      loops?.stopAmbientLoop(KALEIDOSCOPE_ORBIT_LOOP);
    }
  }

  /**
   * Plays the cues the frame's mobs flagged. Systems never call the audio
   * manager themselves — they raise a pending flag the owner drains, which is
   * what keeps one cue per frame however many sources raised it.
   *
   * Drained straight after {@link updateMobs} and before anything can remove a
   * mob from the roster: an ally intercepted on the frame it dies would
   * otherwise take its own last cue out of the list with it.
   */
  drainMobAudioCues(audio: AudioManager | null): void {
    playMobAudioCues(this.world.roster.mobs, audio);
  }

  /** The layer under the entities: settled blood, parts that came to rest, the Seismic Stomp's floor. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.gore.renderPuddles(ctx, camX, camY);
    this.bodyPartGore.renderSettled(ctx, camX, camY);
    this.seismicStompFx.renderGround(ctx, camX, camY);
  }

  /** The layer over the entities: airborne gore, shields, lightning, ripples, fog. */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number, cat: CatPlayer): void {
    this.gore.renderParticles(ctx, camX, camY);
    this.bodyPartGore.renderFlying(ctx, camX, camY);
    this.spells.renderEnergyShield(ctx, camX, camY);
    this.spells.renderCatMiniShield(ctx, camX, camY, cat);
    this.spells.renderChainLightning(ctx, camX, camY);
    this.stormcaller.render(ctx, camX, camY);
    this.spells.renderShockwaveRipples(ctx, camX, camY);
    this.spells.renderFogs(ctx, camX, camY);
    this.gear.render(ctx, camX, camY);
    this.seismicStompFx.render(ctx, camX, camY);
    this.meleeFx.render(ctx, camX, camY);
    this.missileFx.render(ctx, camX, camY);
  }

  /**
   * Drops what this floor has standing in the world, for a scene that is walking
   * away from the map rather than rewinding it: the shield and the fogs cast on a
   * storey stop existing when it stops being drawn, but nothing the party spent
   * is refunded.
   */
  leaveFloor(): void {
    this.spells.dropWorldEffects();
    this.stormcaller.reset();
    this.gear.reset();
    this.seismicStompFx.resetForCheckpoint();
    this.meleeFx.resetForCheckpoint();
    this.missileFx.resetForCheckpoint();
    // A damage number frozen mid-fade is a number the player reads on the way
    // back in, minutes after the hit it belonged to.
    this.floatingText.dispose();
    // The crawlers' own shots as well as the mobs': a missile or a stone belongs
    // to the crawler rather than to the roster, so it crosses the threshold with
    // them and would then be resolved against the new floor's grid and walls
    // from the old floor's coordinates.
    this.world.pm.cat.clearAirborneAttacks();
    this.world.pm.human.clearAirborneAttacks();
    for (const mob of this.world.roster.mobs) mob.clearAirborneAttacks();
    // Note what is *not* dropped: the gore. Blood stays where it fell, because a
    // room the party comes back to should still look like the room they left.
  }

  /** Drops everything in flight, so a rewound world has no leftovers mid-air. */
  resetForCheckpoint(): void {
    this.spells.resetForCheckpoint();
    this.stormcaller.reset();
    this.gear.reset();
    this.seismicStompFx.resetForCheckpoint();
    this.meleeFx.resetForCheckpoint();
    this.missileFx.resetForCheckpoint();
    this.gore.resetForCheckpoint();
    this.bodyPartGore.resetForCheckpoint();
    // Mob-owned shots too: a bolt is advanced from its caster's own AI, so one
    // left in the air is not dropped by clearing any system's list.
    for (const mob of this.world.roster.mobs) mob.clearAirborneAttacks();
  }

  dispose(): void {
    this.floatingText.dispose();
    this.gear.dispose();
    this.world.audioScope?.stopAmbientLoop(KALEIDOSCOPE_ORBIT_LOOP);
    this.world.audioScope?.stopAmbientLoop(RELIC_HUM_LOOP);
    // Drops the pack-alert grid. It is a module-level handle, so a scene that
    // exited without this leaves its whole roster — and through it its `GameMap`
    // — reachable for the rest of the page's life.
    this.mobLoop.dispose();
  }
}

/**
 * The unit vector pointing from `killer` to the point (`cx`, `cy`). Zero when
 * nobody swung — a mob burned down by poison falls where it stood.
 */
function impactAwayFrom(
  cx: number,
  cy: number,
  killer: HumanPlayer | CatPlayer | null,
): ImpactDirection {
  if (killer === null) return { dx: 0, dy: 0 };
  const dx = cx - (killer.x + HALF_TILE);
  const dy = cy - (killer.y + HALF_TILE);
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { dx: 0, dy: 0 };
  return { dx: dx / dist, dy: dy / dist };
}
