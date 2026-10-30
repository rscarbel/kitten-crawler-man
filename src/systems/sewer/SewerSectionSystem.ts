/**
 * One section of the sewer under Taloncrest, as the party walks it: its
 * water and the valves that move it, the rat nest the water carries off,
 * its fights, the elf guide leading the way, its dark and its ways out.
 *
 * Run by `BuildingInteriorScene` as the encounter on the section's storey.
 * Everything that must outlast the visit — a valve turned, a fight won — is
 * written to `TownMemory.settledSewerWorks` the moment it happens, and the
 * section is rebuilt from that record on every visit: the map's water is
 * never saved, so it is put back here.
 *
 * Water follows the river model: `GameMap.floodWater` and `drainWater`. Nobody
 * walks through sewer water: every wet channel tile, and every tile the rat
 * nest still chokes, is held shut to every body until it has run dry, and the
 * hold is read off the map's own water every tick, so a drain under way keeps
 * the party, the guide and every mob out until its last tile is dry. A body
 * standing where water arrives is set down on the nearest dry tile.
 *
 * A sump's outlet pipe is the one thing the party can turn on and off again:
 * one wheel opens it and another shuts it, and each takes a press only while
 * that would change something, so no order of turns leaves the way shut with
 * no wheel left to open it. A pipe is found shut whenever the section is
 * built, so a party arriving from the far end is never cut off by water left
 * running behind it. A shut pipe's sump runs down the drain in its floor,
 * heard draining until it is dry; the drain mouth is never walked, and the
 * sump is laid out wide enough to cross on either side of it.
 */

import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../../core/constants';
import { renderQuality } from '../../core/perf/RenderQuality';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import type { TownMemory } from '../../core/state/TownMemory';
import { placedGain, type AudioManager } from '../../audio/AudioManager';
import type { AudioScope } from '../../audio/AudioScope';
import type { LoopLevel } from '../../audio/loopLevels';
import type { Mob } from '../../creatures/Mob';
import { SewerGuide } from '../../creatures/SewerGuide';
import {
  SEWER_GUIDE_HURT_BARKS,
  SEWER_GUIDE_STOP_LINES,
  SEWER_GUIDE_WAITING_BARKS,
  SEWER_GUIDE_WORK_LINES,
} from '../../dialog/scripts/scenes/sewerGuide';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import type { GameMap } from '../../map/GameMap';
import { claimDungeonFloorTheme } from '../../map/dungeon/floorTheme';
import { warmDungeonWater } from '../../map/tiles/dungeonWaterShore';
import {
  isSluiceValve,
  SEWER_FULL_FLOW_DEPTH,
  type SewerChannelId,
  type SewerGuideHold,
  type SewerNestDef,
  type SewerOutletId,
  type SewerOutletValveId,
  type SewerValveEffect,
  type SewerWorkId,
} from '../../map/sewer/sewerLayouts';
import type {
  ParsedSewerConnection,
  ParsedSewerFight,
  ParsedSewerOutlet,
  ParsedSewerSection,
  ParsedSewerValve,
  SewerTile,
} from '../../map/sewer/sewerPlan';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import { tileCoordKey } from '../../map/tileIndex';
import { itemAt } from '../../map/sewer/sewerPlan';
import type { Player } from '../../Player';
import { TURN_VALVE_ROWS } from '../../sprites/art/humanFigure';
import {
  paintCulvertMouth,
  paintDrainDebris,
  paintGrateLightOnFloor,
  paintRatNestTile,
  paintSewerLadder,
  paintSpillwayOutfall,
  paintSumpDrain,
  paintValveWheel,
  paintWallOutlet,
  SUMP_DRAIN_SWIRL_TURNS_PER_SECOND,
  type SumpDrainState,
} from '../../sprites/art/sewer/sewerPropArt';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { objectiveBandEntry, type ObjectiveLine } from '../../ui/hud/objectiveLine';
import { terrainAlignedCamera, type Camera } from '../../core/rendering/camera';
import type { SystemContext } from '../GameSystem';
import { exitFixtureOnTile, type InteriorExitFixtureSystem } from '../interiorExitFixtures';
import type { PartyTransferRequest } from '../partySplit/partyTransfer';
import { MashInteraction, type MashInteractionDef, type MashPress } from '../MashInteraction';
import type { WorkChannelBuilder } from '../WorkChannel';
import { questMobLevel } from '../questMobLevel';
import { WaterAnimationSystem } from '../WaterAnimationSystem';
import { SewerLighting, type SewerGlint } from './sewerLighting';
import {
  SEWER_CUES,
  SEWER_OUTFLOW_LOOP,
  SEWER_SUMP_DRAIN_LOOP,
  SEWER_WATER_LOOP_HEARING_TILES,
  type SewerCue,
} from '../../audio/sewerSoundCues';

/** Hauls on a sluice's valve wheel to turn it all the way. */
const SEWER_VALVE_PRESSES = 5;
/** From the valve's tile centre to the crawler's, in tiles: from any tile beside it. */
const SEWER_VALVE_REACH_TILES = 1.6;
/** How far the wheel and its post stand above the valve's tile, in pixels. */
const SEWER_VALVE_ART_RISE_PX = 14;
/** Each haul turns the wheel a quarter. */
const VALVE_TURNS_PER_PRESS = 0.25;

/** What the prompt says each kind of valve does. */
const VALVE_DEEDS = {
  lower: 'shut the spillway',
  open_outlet: 'open the sump pipe',
  shut_outlet: 'shut the sump pipe off',
} as const satisfies Record<SewerValveEffect['kind'], string>;

/** What the last haul on each kind of wheel sounds like. */
const VALVE_FINISH_CUES = {
  lower: 'sluiceShut',
  open_outlet: 'pipeOpen',
  shut_outlet: 'sluiceShut',
} as const satisfies Record<SewerValveEffect['kind'], SewerCue>;

function valveDef(effect: SewerValveEffect): MashInteractionDef {
  return {
    pressesRequired: SEWER_VALVE_PRESSES,
    deed: VALVE_DEEDS[effect.kind],
    humanRows: TURN_VALVE_ROWS,
    barStyle: 'build',
    reachTiles: SEWER_VALVE_REACH_TILES,
    artRisePx: SEWER_VALVE_ART_RISE_PX,
  };
}

/** A lowered channel runs down to its bed over this many world ticks. */
const CHANNEL_DRAIN_TICKS = 150;
/** A sump whose pipe is shut runs down its drain over this many world ticks: long enough to hear it go. */
const SUMP_DRAIN_TICKS = 300;
/** An opened pipe first wets its channel's floor, then fills it to its depth this many ticks later. */
const OUTLET_FILL_TICKS = 40;
/** The first water an opened pipe puts down: enough to shut the channel at once. */
const OUTLET_FIRST_DEPTH = 1;
/** The stream out of a pipe swells to full, or dwindles to nothing, over this many ticks. */
const OUTLET_FLOW_RAMP_TICKS = 24;
/** A flooded sump takes this long, with its pipe running, to carry its nest off. */
const NEST_WASH_FRAMES = 90;
/** How far round a body caught by arriving water the dry tile it is set down on may be. */
const FLOOD_RESCUE_SEARCH_TILES = 4;
/** How far round a fight's marked tile a body may be set down. */
const FIGHT_SPAWN_SEARCH_TILES = 2;
/** The spillway's outfall pipe is drawn over this many of its columns. */
const OUTFALL_SPAN_COLUMNS = 2;
const TILE_CENTRE = 0.5;
const WADER_CENTRE = 0.5;
const MS_PER_SECOND = 1000;
const MS_PER_WORLD_TICK = MS_PER_SECOND / WORLD_TICKS_PER_SECOND;
/** How hard a sump's drain pulls while its pipe still pours in faster than it can take. */
const DRAIN_PULL_WHILE_FILLING = 0.45;

/** What a sewer section needs from the room it runs in. */
export interface SewerSectionDeps {
  readonly map: GameMap;
  readonly section: ParsedSewerSection;
  /** The run's record of the sewer's valves and fights. */
  readonly memory: TownMemory;
  readonly addMob: (mob: Mob) => void;
  /** The section storey's exit fixtures, where its ways out are stood up. */
  readonly exits: InteriorExitFixtureSystem;
  readonly audio: AudioManager | null;
  /** The scene's scope, through which the sump's pour and drain loop. */
  readonly loops: SewerLoops | null;
  readonly partyLevel: number;
  /** Whether the cellar elf guides the party through this visit. */
  readonly guided: boolean;
  /** Where the tower-cistern culvert hands the party. */
  readonly cistern: PartyTransferRequest;
  /** The crawlers on this map, whose light is cut out of the dark; read every frame. */
  readonly presentCrawlers: () => readonly Player[];
}

/** The part of the scene's audio scope the section's water loops through. */
export type SewerLoops = Pick<AudioScope, 'startLoop' | 'stopLoop' | 'setAmbientLoopVolume'>;

interface LiveValve {
  readonly parsed: ParsedSewerValve;
  mash: MashInteraction;
  /** Turns the wheel made before its presses were last handed back, so it never spins back to rest. */
  earlierTurns: number;
}

/** An outlet pipe as it stands this visit. */
interface LiveOutlet {
  readonly parsed: ParsedSewerOutlet;
  running: boolean;
  /** How full its stream is drawn, 0 to 1, eased toward `running`. */
  flow: number;
  /** Ticks until an opened pipe has filled its channel to depth; 0 once it has, or while shut. */
  fillTicks: number;
}

type OutletValveKind = Extract<SewerValveEffect['kind'], 'open_outlet' | 'shut_outlet'>;

/** Anything with a body that arriving water may have to move. */
type Body = Pick<Mob, 'x' | 'y' | 'mobility'>;

interface LiveFight {
  readonly parsed: ParsedSewerFight;
  readonly mobs: Mob[];
}

/** One sewer section's water, valves, nest, fights, guide, dark and ways out. */
export class SewerSectionSystem {
  readonly defeatMessage = 'You fell in the drains, and nobody up on the terrace heard a thing.';

  readonly lighting: SewerLighting;
  readonly guide: SewerGuide | null;
  private readonly map: GameMap;
  private readonly section: ParsedSewerSection;
  private readonly settled: Set<SewerWorkId>;
  private readonly valves: LiveValve[];
  private readonly outlets: LiveOutlet[];
  private readonly outletsById = new Map<SewerOutletId, LiveOutlet>();
  /** The wheels that open and shut each outlet pipe. */
  private readonly outletValves = new Map<
    SewerOutletId,
    Partial<Record<OutletValveKind, SewerOutletValveId>>
  >();
  private readonly fights: LiveFight[];
  private readonly water: WaterAnimationSystem;
  /** Frames of running water the nest has taken so far; it is gone at `NEST_WASH_FRAMES`. */
  private nestWashFrames = 0;
  private nestPresent: boolean;
  /** How much washed-out nest is being drawn down the drain, 0 to 1, eased toward whether the wash is under way. */
  private drainDebris = 0;
  /** How far the drains' swirl has turned, in turns; see `SumpDrainState.swirlTurns`. */
  private drainSwirlTurns = 0;
  /** Set when the nest is washed out: the guide says the way is open once, on the drain that follows. */
  private sumpDrainOwed = false;
  /** World ticks this visit has run, which the section's moving water is drawn from, so it stands still while the world is halted. */
  private ticks = 0;
  private readonly nestDef: SewerNestDef | null;
  /** Keys (see `tileCoordKey`) of the channel tiles held shut this tick: wet, or choked by the nest. */
  private readonly held = new Set<number>();
  /** Every tile that can stand under water or under the nest, whose hold is kept in step each tick. */
  private readonly holdable: ReadonlyArray<SewerTile>;
  private readonly nestKeys: ReadonlySet<number>;
  private readonly drainKeys: ReadonlySet<number>;
  private readonly releaseFloorTheme: () => void;

  constructor(private readonly deps: SewerSectionDeps) {
    // Before any of the section's chunks bake: its walls, walkways and
    // water are the dungeon pipeline's, drawn in the sewer's own materials.
    this.releaseFloorTheme = claimDungeonFloorTheme('sewer');
    this.map = deps.map;
    this.section = deps.section;
    this.settled = deps.memory.settledSewerWorks;
    this.lighting = new SewerLighting(
      this.section.grid.width,
      this.section.grid.height,
      this.section.streetGrates,
    );
    this.water = new WaterAnimationSystem(this.map, () => renderQuality.fullDetail);
    this.nestDef = this.section.layout.nest;
    this.nestPresent = this.nestDef !== null && !this.settled.has(this.nestDef.id);
    // A drain mouth is shut for good by the map itself, so its hold is never
    // handed back when the basin round it runs dry.
    this.drainKeys = new Set(this.section.drains.map((tile) => tileCoordKey(tile.x, tile.y)));
    this.holdable = [this.section.mainChannel, ...Object.values(this.section.channels)]
      .flat()
      .filter((tile) => !this.drainKeys.has(tileCoordKey(tile.x, tile.y)));
    this.nestKeys = new Set(this.section.nest.map((tile) => tileCoordKey(tile.x, tile.y)));
    for (const valve of this.section.valves) {
      const { def } = valve;
      if (isSluiceValve(def)) continue;
      const wheels = this.outletValves.get(def.effect.outlet) ?? {};
      this.outletValves.set(def.effect.outlet, { ...wheels, [def.effect.kind]: def.id });
    }
    this.outlets = this.section.outlets.map((parsed) => ({
      parsed,
      running: false,
      flow: 0,
      fillTicks: 0,
    }));
    for (const outlet of this.outlets) this.outletsById.set(outlet.parsed.def.id, outlet);
    this.applyWater();
    this.valves = this.section.valves.map((parsed) => ({
      parsed,
      mash: this.buildValve(parsed),
      earlierTurns: 0,
    }));
    this.fights = this.section.fights.map((parsed) => this.raiseFight(parsed));
    this.placeConnections();
    this.guide = deps.guided ? this.raiseGuide() : null;
  }

  // ── Water ──────────────────────────────────────────────────────────────────

  /** Whether the spillway's valve has run it down for good. */
  private spillwayLowered(): boolean {
    return this.section.valves.some(
      (valve) =>
        isSluiceValve(valve.def) &&
        valve.def.effect.channel === 'spillway' &&
        this.settled.has(valve.def.id),
    );
  }

  /** The id of the valve with `kind` on `outlet`, or null when the section has none. */
  private outletValveId(outlet: SewerOutletId, kind: OutletValveKind): SewerOutletValveId | null {
    return this.outletValves.get(outlet)?.[kind] ?? null;
  }

  /** Puts every channel at the level its valve leaves it, at once: a section is always built dry. */
  private applyWater(): void {
    this.map.floodWater(this.section.mainChannel, SEWER_FULL_FLOW_DEPTH);
    if (!this.spillwayLowered()) {
      this.map.floodWater(this.section.channels.spillway, SEWER_FULL_FLOW_DEPTH);
    }
    this.syncHolds();
    warmDungeonWater(this.map.structure);
  }

  /** Whether a channel tile is shut to every body: under water, or under the nest. */
  private shouldHold(tile: SewerTile): boolean {
    if (this.map.dungeonWaterDepthAt(tile.x, tile.y) > 0) return true;
    return this.nestPresent && this.nestKeys.has(tileCoordKey(tile.x, tile.y));
  }

  /** Shuts every channel tile that is wet or choked, and opens every one that has run dry and clear. */
  private syncHolds(): void {
    for (const tile of this.holdable) {
      const key = tileCoordKey(tile.x, tile.y);
      const hold = this.shouldHold(tile);
      if (hold === this.held.has(key)) continue;
      if (hold) {
        this.held.add(key);
        this.map.blockTilePermanently(tile.x, tile.y);
      } else {
        this.held.delete(key);
        this.map.unblockTilePermanently(tile.x, tile.y);
      }
    }
  }

  /** Whether every tile of `channel` can be walked: run dry, and nothing left choking it. */
  private channelCrossable(channel: SewerChannelId): boolean {
    return this.section.channels[channel].every(
      (tile) => !this.held.has(tileCoordKey(tile.x, tile.y)),
    );
  }

  private holdMet(hold: SewerGuideHold | null): boolean {
    if (hold === null) return true;
    switch (hold.kind) {
      case 'work':
        return this.settled.has(hold.id);
      case 'crossable':
        return this.channelCrossable(hold.channel);
      default: {
        const unhandled: never = hold;
        throw new Error(`unhandled guide hold ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private liveOutlet(id: SewerOutletId): LiveOutlet | null {
    return this.outletsById.get(id) ?? null;
  }

  private turnValve(valve: ParsedSewerValve): void {
    const { def } = valve;
    if (isSluiceValve(def)) {
      this.play('waterRush', this.tileCentrePx(valve.tile));
      this.settled.add(def.id);
      this.map.drainWater(this.section.channels[def.effect.channel], CHANNEL_DRAIN_TICKS);
      this.guide?.say(SEWER_GUIDE_WORK_LINES.spillwayLowered);
      return;
    }
    const { effect } = def;
    switch (effect.kind) {
      case 'open_outlet':
        this.openOutlet(effect.outlet);
        return;
      case 'shut_outlet':
        this.shutOutlet(effect.outlet);
        return;
      default: {
        const unhandled: never = effect;
        throw new Error(`unhandled valve effect ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private openOutlet(id: SewerOutletId): void {
    const outlet = this.liveOutlet(id);
    if (outlet === null || outlet.running) return;
    outlet.running = true;
    outlet.fillTicks = OUTLET_FILL_TICKS;
    this.map.floodWater(this.section.channels[outlet.parsed.channel], OUTLET_FIRST_DEPTH);
    this.syncHolds();
    this.rewindValve(this.liveValve(this.outletValveId(id, 'shut_outlet')));
  }

  private shutOutlet(id: SewerOutletId): void {
    const outlet = this.liveOutlet(id);
    if (!outlet?.running) return;
    outlet.running = false;
    outlet.fillTicks = 0;
    this.map.drainWater(this.section.channels[outlet.parsed.channel], SUMP_DRAIN_TICKS);
  }

  /** Each pipe's stream eased toward its state and its channel filled to depth once due; then the nest washed. */
  private advanceOutlets(): void {
    for (const outlet of this.outlets) {
      const step = 1 / OUTLET_FLOW_RAMP_TICKS;
      outlet.flow = outlet.running
        ? Math.min(1, outlet.flow + step)
        : Math.max(0, outlet.flow - step);
      const { channel } = outlet.parsed;
      const { depth } = outlet.parsed.def;
      if (outlet.fillTicks > 0) {
        outlet.fillTicks--;
        if (outlet.fillTicks === 0) this.map.floodWater(this.section.channels[channel], depth);
      }
      if (!outlet.running) this.offerReopening(outlet);
    }
    this.advanceNestWash();
  }

  /**
   * Hands a shut pipe's opening wheel back once its channel has run dry, while
   * the channel still holds a nest to wash out: opened again mid-drain, the
   * drain under way would carry the new water off with it, and with the nest
   * gone a flood would only shut the way on.
   */
  private offerReopening(outlet: LiveOutlet): void {
    const openId = this.outletValveId(outlet.parsed.def.id, 'open_outlet');
    const opener = this.valves.find((valve) => valve.parsed.def.id === openId);
    if (!opener?.mash.isFinished) return;
    const { channel } = outlet.parsed;
    if (!this.nestChokes(channel) || !this.channelDry(channel)) return;
    this.rewindValve(opener);
  }

  /** Whether the nest still stands in `channel`, which a flood there would wash out. */
  private nestChokes(channel: SewerChannelId): boolean {
    return this.nestPresent && this.nestDef?.channel === channel;
  }

  private channelDry(channel: SewerChannelId): boolean {
    return this.section.channels[channel].every(
      (tile) => this.map.dungeonWaterDepthAt(tile.x, tile.y) === 0,
    );
  }

  /** Gives a turned wheel back its presses, so it can be worked again. */
  private rewindValve(valve: LiveValve | undefined): void {
    if (valve === undefined) return;
    valve.earlierTurns += valve.mash.pressesDone * VALVE_TURNS_PER_PRESS;
    valve.mash = this.buildValve(valve.parsed);
  }

  private liveValve(id: SewerOutletValveId | null): LiveValve | undefined {
    return this.valves.find((each) => each.parsed.def.id === id);
  }

  /** Advances once a tick however many pipes pour on the nest, so a second pipe does not double its pace. */
  private advanceNestWash(): void {
    const nest = this.nestDef;
    if (nest === null || !this.nestWashing()) return;
    this.nestWashFrames++;
    if (this.nestWashFrames < NEST_WASH_FRAMES) return;
    this.nestPresent = false;
    this.sumpDrainOwed = true;
    this.settled.add(nest.id);
    this.guide?.say(SEWER_GUIDE_WORK_LINES.nestWashedOut);
  }

  /** Whether a pipe is pouring into `channel`. */
  private pouringInto(channel: SewerChannelId): boolean {
    return this.outlets.some((outlet) => outlet.running && outlet.parsed.channel === channel);
  }

  /** Whether the nest basin is running down its drains: wet, and nothing pouring in. */
  private sumpDraining(): boolean {
    return !this.channelDry('nest_basin') && !this.pouringInto('nest_basin');
  }

  /** Whether the flood is carrying the nest down the drain this tick. */
  private nestWashing(): boolean {
    const nest = this.nestDef;
    if (nest === null || !this.nestPresent) return false;
    return this.pouringInto(nest.channel) && !this.channelDry(nest.channel);
  }

  private easeDrainDebris(): void {
    const step = 1 / OUTLET_FLOW_RAMP_TICKS;
    this.drainDebris = this.nestWashing()
      ? Math.min(1, this.drainDebris + step)
      : Math.max(0, this.drainDebris - step);
  }

  /** The pipe's pour and the sump's drain, each heard from where it is while it runs. */
  private updateWaterLoops(listener: { readonly x: number; readonly y: number }): void {
    const loops = this.deps.loops;
    if (loops === null) return;
    let pour = 0;
    for (const outlet of this.outlets) {
      if (outlet.flow <= 0) continue;
      pour = Math.max(pour, outlet.flow * this.levelHeardFrom(outlet.parsed.tile, listener));
    }
    let drain = 0;
    if (this.sumpDraining()) {
      for (const tile of this.section.drains) {
        drain = Math.max(drain, this.levelHeardFrom(tile, listener));
      }
    }
    setLoopLevel(loops, SEWER_OUTFLOW_LOOP, pour);
    setLoopLevel(loops, SEWER_SUMP_DRAIN_LOOP, drain);
  }

  private levelHeardFrom(tile: SewerTile, listener: { readonly x: number; readonly y: number }) {
    const source = this.tileCentrePx(tile);
    const distanceTiles = Math.hypot(source.x - listener.x, source.y - listener.y) / TILE_SIZE;
    return placedGain(distanceTiles, SEWER_WATER_LOOP_HEARING_TILES);
  }

  private silenceWaterLoops(): void {
    this.deps.loops?.stopLoop(SEWER_OUTFLOW_LOOP);
    this.deps.loops?.stopLoop(SEWER_SUMP_DRAIN_LOOP);
  }

  /** How much of the nest is still standing, 1 to 0. */
  private nestPresence(): number {
    if (!this.nestPresent) return 0;
    return 1 - this.nestWashFrames / NEST_WASH_FRAMES;
  }

  /** Sets every body standing on a held tile down on the nearest tile it may stand on. */
  private rescueFromWater(ctx: SystemContext): void {
    const crawlers: Body[] = ctx.partner === null ? [ctx.active] : [ctx.active, ctx.partner];
    for (const crawler of crawlers) this.rescueBody(crawler);
    for (const mob of ctx.roster.mobs) {
      if (!mob.isAlive) continue;
      const oldX = mob.x;
      const oldY = mob.y;
      if (this.rescueBody(mob)) ctx.roster.grid.move(mob, oldX, oldY);
    }
  }

  /** Returns whether the body was moved. */
  private rescueBody(body: Body): boolean {
    const tileX = Math.floor((body.x + TILE_SIZE * WADER_CENTRE) / TILE_SIZE);
    const tileY = Math.floor((body.y + TILE_SIZE * WADER_CENTRE) / TILE_SIZE);
    if (!this.held.has(tileCoordKey(tileX, tileY))) return false;
    const dry = findNearbyWalkableTile(this.map, tileX, tileY, FLOOD_RESCUE_SEARCH_TILES, (x, y) =>
      this.map.isWalkable(x, y, body.mobility),
    );
    if (dry === null) return false;
    body.x = dry.x * TILE_SIZE;
    body.y = dry.y * TILE_SIZE;
    return true;
  }

  /** Whether the nest's channel can be walked; true for a section with no nest. */
  private nestChannelCrossable(): boolean {
    return this.nestDef === null || this.channelCrossable(this.nestDef.channel);
  }

  /** Says so the first time the sump runs dry after its nest washed out: the way on is open. */
  private noteSumpDrained(wasCrossable: boolean): void {
    if (!this.sumpDrainOwed || wasCrossable || !this.nestChannelCrossable()) return;
    this.sumpDrainOwed = false;
    this.guide?.say(SEWER_GUIDE_WORK_LINES.sumpDrained);
  }

  // ── Valves ─────────────────────────────────────────────────────────────────

  /**
   * A valve takes presses only while turning it would change something: the
   * spillway's until it is lowered, a pipe's opening wheel while the pipe is
   * shut, its channel dry and a nest still in it, its shutting wheel while it
   * runs.
   */
  private buildValve(parsed: ParsedSewerValve): MashInteraction {
    this.map.blockTilePermanently(parsed.tile.x, parsed.tile.y);
    return new MashInteraction({
      def: valveDef(parsed.def.effect),
      footprint: { x: parsed.tile.x, y: parsed.tile.y, w: 1, h: 1 },
      pressesDone: this.valveSpent(parsed) ? SEWER_VALVE_PRESSES : 0,
      onPress: (press) => this.onValvePress(parsed, press),
    });
  }

  private valveSpent(parsed: ParsedSewerValve): boolean {
    const { def } = parsed;
    if (isSluiceValve(def)) return this.settled.has(def.id);
    const { effect } = def;
    switch (effect.kind) {
      case 'open_outlet': {
        const outlet = this.liveOutlet(effect.outlet);
        if (outlet === null || outlet.running) return true;
        const { channel } = outlet.parsed;
        return !this.nestChokes(channel) || !this.channelDry(channel);
      }
      case 'shut_outlet':
        return this.liveOutlet(effect.outlet)?.running !== true;
      default: {
        const unhandled: never = effect;
        throw new Error(`unhandled valve effect ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private onValvePress(valve: ParsedSewerValve, press: MashPress): void {
    const at = this.tileCentrePx(valve.tile);
    switch (press.kind) {
      case 'advanced':
        this.play('valveTurn', at);
        return;
      case 'finished':
        this.play(VALVE_FINISH_CUES[valve.def.effect.kind], at);
        this.turnValve(valve);
        return;
      default: {
        const unhandled: never = press;
        throw new Error(`unhandled press ${JSON.stringify(unhandled)}`);
      }
    }
  }

  // ── Fights ─────────────────────────────────────────────────────────────────

  private raiseFight(parsed: ParsedSewerFight): LiveFight {
    const fight: LiveFight = { parsed, mobs: [] };
    if (this.settled.has(parsed.def.id)) return fight;
    for (const spawn of parsed.spawns) {
      const mob = spawnMob(parsed.def.kind, spawn, this.map, liveSpawnContext('quest:storm-drain'));
      mob.applyMobLevel(questMobLevel(parsed.def.level, this.deps.partyLevel));
      applySpawnDifficulty(mob);
      mob.homePoint = { x: spawn.x * TILE_SIZE, y: spawn.y * TILE_SIZE };
      mob.leashRadiusTiles = FIGHT_SPAWN_SEARCH_TILES;
      this.deps.addMob(mob);
      fight.mobs.push(mob);
    }
    return fight;
  }

  private noteFightsWon(): void {
    for (const fight of this.fights) {
      if (fight.mobs.length === 0 || this.settled.has(fight.parsed.def.id)) continue;
      if (fight.mobs.some((mob) => mob.isAlive)) continue;
      this.settled.add(fight.parsed.def.id);
    }
  }

  // ── Guide ──────────────────────────────────────────────────────────────────

  private raiseGuide(): SewerGuide {
    const stops = this.section.guideStops;
    const first = itemAt(stops, 0)?.tile ?? this.section.ladder;
    const guide = new SewerGuide(first, TILE_SIZE, {
      stops: stops.map((stop) => stop.tile),
      mayLeave: (index) => this.holdMet(itemAt(stops, index)?.def.holdsUntil ?? null),
      lineAt: (index) => {
        const stop = itemAt(stops, index);
        return stop === undefined ? null : SEWER_GUIDE_STOP_LINES[stop.def.id];
      },
      waitingLines: SEWER_GUIDE_WAITING_BARKS,
      hurtLines: SEWER_GUIDE_HURT_BARKS,
    });
    guide.setMap(this.map);
    this.deps.addMob(guide);
    return guide;
  }

  // ── Connections ────────────────────────────────────────────────────────────

  private placeConnections(): void {
    for (const parsed of this.section.connections) this.placeConnection(parsed);
  }

  private placeConnection(parsed: ParsedSewerConnection): void {
    const { connection } = parsed;
    switch (connection.kind) {
      case 'street_grate':
        for (const tile of parsed.tiles)
          this.deps.exits.place(exitFixtureOnTile('sewer_ladder', tile));
        return;
      case 'tower_cistern':
        for (const tile of parsed.tiles) {
          this.deps.exits.place(
            exitFixtureOnTile('tower_culvert', tile, {
              kind: 'onward',
              request: this.deps.cistern,
            }),
          );
        }
        return;
      case 'culvert':
        // A culvert into another section is walked through the scene's
        // storey change, which no shipped section has a neighbour for yet.
        return;
      default: {
        const unhandled: never = connection;
        throw new Error(`unhandled sewer connection ${JSON.stringify(unhandled)}`);
      }
    }
  }

  // ── The encounter ──────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.ticks++;
    const sumpWasCrossable = this.nestChannelCrossable();
    this.map.advanceWaterDrains();
    this.advanceOutlets();
    this.syncHolds();
    this.rescueFromWater(ctx);
    this.noteSumpDrained(sumpWasCrossable);
    this.noteFightsWon();
    this.easeDrainDebris();
    this.drainSwirlTurns +=
      (this.drainPull() * SUMP_DRAIN_SWIRL_TURNS_PER_SECOND) / WORLD_TICKS_PER_SECOND;
    const centre = TILE_SIZE * WADER_CENTRE;
    this.updateWaterLoops({ x: ctx.active.x + centre, y: ctx.active.y + centre });
    this.water.beginFrame();
    const present = ctx.partner === null ? [ctx.active] : [ctx.active, ctx.partner];
    for (const crawler of present) {
      const tileX = Math.floor((crawler.x + centre) / TILE_SIZE);
      const tileY = Math.floor((crawler.y + centre) / TILE_SIZE);
      const wet = this.map.isWadeable(tileX, tileY);
      if (this.water.updateWader(crawler, crawler.x + centre, crawler.y + centre, wet)) {
        this.deps.audio?.play(crawler === ctx.human ? 'human_splash' : 'cat_splash');
      }
    }
  }

  /** A press on a valve wheel in reach of the active crawler. */
  tryInteract(ctx: SystemContext): boolean {
    for (const valve of this.valves) {
      if (valve.mash.tryInteract(ctx.active)) return true;
    }
    return false;
  }

  topBandEntries(): TopBandEntry[] {
    return [objectiveBandEntry('sewer-objective', this.objective())];
  }

  private objective(): ObjectiveLine {
    if (!this.spillwayLowered()) {
      return { text: 'Shut the spillway with the valve in the alcove', tone: 'warning' };
    }
    const nest = this.nestDef;
    if (nest === null) return { text: 'Follow the drain to the tower cistern', tone: 'success' };
    const sumpRunning = this.outlets.some((outlet) => outlet.running);
    if (this.nestPresent) {
      if (sumpRunning) return { text: 'Let the water carry the rat nest off', tone: 'warning' };
      // The opening wheel takes no press until the sump is dry again: a
      // second flood can only start from an empty basin.
      if (!this.channelDry(nest.channel)) {
        return { text: 'Wait for the sump to drain, then open the pipe again', tone: 'warning' };
      }
      return { text: 'Open the pipe over the sump to wash out the rat nest', tone: 'warning' };
    }
    if (sumpRunning) {
      return { text: 'Shut the sump pipe off with the wheel by the sump', tone: 'warning' };
    }
    if (!this.channelCrossable(nest.channel)) {
      return { text: 'Wait for the sump to drain', tone: 'warning' };
    }
    return { text: 'Follow the drain to the tower cistern', tone: 'success' };
  }

  /**
   * Everything here lies on the floor or in the walls, so it is drawn on the
   * terrain's pixel grid and moves in step with the bricks round it.
   */
  renderWorld(ctx: CanvasRenderingContext2D, camera: Camera, _active: Player): void {
    const { x: camX, y: camY } = terrainAlignedCamera(camera);
    this.water.renderGround(ctx, camera);
    const ts = TILE_SIZE;
    for (const grate of this.section.streetGrates) {
      paintGrateLightOnFloor(ctx, grate.x * ts - camX, grate.y * ts - camY, ts);
    }
    const ladder = this.section.ladder;
    paintSewerLadder(ctx, ladder.x * ts - camX, ladder.y * ts - camY, ts);
    this.renderOutfall(ctx, camX, camY);
    this.renderCulverts(ctx, camX, camY);
    const nowMs = this.ticks * MS_PER_WORLD_TICK;
    const drainState = this.drainState();
    for (const tile of this.section.drains) {
      const state = drainState(tile);
      const left = tile.x * ts - camX;
      const top = tile.y * ts - camY;
      paintSumpDrain(ctx, left, top, ts, tile.x, tile.y, state);
    }
    const presence = this.nestPresence();
    for (const tile of this.section.nest) {
      const drain = this.nearestDrain(tile);
      const drainOnScreen =
        drain === null
          ? null
          : { x: (drain.x + TILE_CENTRE) * ts - camX, y: (drain.y + TILE_CENTRE) * ts - camY };
      const left = tile.x * ts - camX;
      const top = tile.y * ts - camY;
      paintRatNestTile(ctx, left, top, ts, tile.x, tile.y, presence, drainOnScreen);
    }
    for (const tile of this.section.drains) {
      const centreX = (tile.x + TILE_CENTRE) * ts - camX;
      const centreY = (tile.y + TILE_CENTRE) * ts - camY;
      const seed = tile.x + tile.y;
      paintDrainDebris(ctx, centreX, centreY, ts, seed, this.drainDebris, nowMs);
    }
    for (const outlet of this.outlets) {
      const { tile } = outlet.parsed;
      paintWallOutlet(ctx, tile.x * ts - camX, tile.y * ts - camY, ts, outlet.flow, nowMs);
    }
    for (const valve of this.valves) {
      const { tile } = valve.parsed;
      const turns = valve.earlierTurns + valve.mash.pressesDone * VALVE_TURNS_PER_PRESS;
      paintValveWheel(ctx, tile.x * ts - camX, tile.y * ts - camY, ts, turns);
    }
  }

  /** What the water is doing at each drain mouth this frame. */
  private drainState(): (tile: SewerTile) => SumpDrainState {
    const pull = this.drainPull();
    const swirlTurns = this.drainSwirlTurns;
    const residue = this.nestDef !== null && !this.nestPresent;
    return (tile) => ({
      water: this.map.dungeonWaterDepthAt(tile.x, tile.y) / SEWER_FULL_FLOW_DEPTH,
      pull,
      swirlTurns,
      debris: this.drainDebris,
      residue,
    });
  }

  /** How hard the sump's water goes down its drains: hardest emptying, gently while a pipe still fills it. */
  private drainPull(): number {
    if (this.sumpDraining()) return 1;
    return this.pouringInto('nest_basin') ? DRAIN_PULL_WHILE_FILLING : 0;
  }

  private nearestDrain(tile: SewerTile): SewerTile | null {
    let nearest: SewerTile | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const drain of this.section.drains) {
      const distance = Math.hypot(drain.x - tile.x, drain.y - tile.y);
      if (distance >= nearestDistance) continue;
      nearest = drain;
      nearestDistance = distance;
    }
    return nearest;
  }

  private renderOutfall(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const spillway = this.section.channels.spillway;
    const top = spillway.reduce(
      (highest, tile) => Math.min(highest, tile.y),
      Number.POSITIVE_INFINITY,
    );
    const columns = spillway.filter((tile) => tile.y === top);
    const left = columns.reduce((west, tile) => Math.min(west, tile.x), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(top) || columns.length < OUTFALL_SPAN_COLUMNS) return;
    const pouring = !this.spillwayLowered();
    paintSpillwayOutfall(ctx, left * TILE_SIZE - camX, top * TILE_SIZE - camY, TILE_SIZE, pouring);
  }

  private renderCulverts(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const parsed of this.section.connections) {
      if (parsed.connection.kind !== 'tower_cistern' || parsed.tiles.length === 0) continue;
      const top = parsed.tiles.reduce(
        (highest, tile) => Math.min(highest, tile.y),
        Number.POSITIVE_INFINITY,
      );
      const east = parsed.tiles.reduce((most, tile) => Math.max(most, tile.x), 0) + 1;
      paintCulvertMouth(
        ctx,
        east * TILE_SIZE - camX,
        top * TILE_SIZE - camY,
        TILE_SIZE,
        parsed.tiles.length,
      );
    }
  }

  renderEffects(ctx: CanvasRenderingContext2D, camera: Camera): void {
    this.water.renderSplashes(ctx, camera.x, camera.y);
  }

  renderDarkness(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const lit = this.deps.presentCrawlers();
    this.lighting.renderDarkness(ctx, camera, lit, this.workableGlints(), this.ticks);
  }

  /** A faint lift in the dark over every wheel that would take a press. */
  private workableGlints(): SewerGlint[] {
    const glints: SewerGlint[] = [];
    for (const valve of this.valves) {
      if (valve.mash.isFinished) continue;
      const centre = this.tileCentrePx(valve.parsed.tile);
      glints.push({ x: centre.x, y: centre.y - SEWER_VALVE_ART_RISE_PX });
    }
    return glints;
  }

  /** The valves' prompts and progress bars, over the dark. */
  renderInteractionPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    for (const valve of this.valves) {
      valve.mash.renderProgress(ctx, camX, camY);
      if (active.isActive && valve.mash.renderPrompt(ctx, camX, camY, active)) return;
    }
  }

  /** The water stands still under a halt, so it falls silent too; the next tick brings the loops back in. */
  holdWhileHalted(): void {
    this.silenceWaterLoops();
  }

  leaveFloor(_ctx: SystemContext): void {
    this.lighting.release();
    this.silenceWaterLoops();
  }

  dispose(): void {
    this.silenceWaterLoops();
    this.lighting.release();
    this.water.dispose();
    this.releaseFloorTheme();
  }

  private tileCentrePx(tile: SewerTile): { x: number; y: number } {
    return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
  }

  private play(cue: SewerCue, at: { x: number; y: number }): void {
    this.deps.audio?.playRandomAt(SEWER_CUES[cue], at.x, at.y);
  }
}

/** Plays `loop` at `level` of its own volume, stopping it at zero. */
function setLoopLevel(loops: SewerLoops, loop: LoopLevel, level: number): void {
  if (level <= 0) {
    loops.stopLoop(loop);
    return;
  }
  // Asked every tick: a start declined while the buffer is still decoding or
  // audio is locked has to be retried.
  loops.startLoop(loop);
  loops.setAmbientLoopVolume(loop.id, loop.volume * level);
}
