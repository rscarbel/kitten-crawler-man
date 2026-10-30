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
 * Water follows the river model: `GameMap.floodWater` and `drainWater`, with
 * wading for free. A channel at full flow (the main channel, an open
 * spillway) cannot be waded; its tiles are held shut until it runs down.
 */

import { TILE_SIZE } from '../../core/constants';
import { renderQuality } from '../../core/perf/RenderQuality';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import type { TownMemory } from '../../core/state/TownMemory';
import type { AudioManager } from '../../audio/AudioManager';
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
  SEWER_FULL_FLOW_DEPTH,
  type SewerChannelId,
  type SewerValveEffect,
  type SewerWorkId,
} from '../../map/sewer/sewerLayouts';
import type {
  ParsedSewerConnection,
  ParsedSewerFight,
  ParsedSewerSection,
  ParsedSewerValve,
  SewerTile,
} from '../../map/sewer/sewerPlan';
import { itemAt } from '../../map/sewer/sewerPlan';
import type { Player } from '../../Player';
import { TURN_VALVE_ROWS } from '../../sprites/art/humanFigure';
import {
  paintCulvertMouth,
  paintGrateLightOnFloor,
  paintRatNestTile,
  paintSewerLadder,
  paintSpillwayOutfall,
  paintValveWheel,
} from '../../sprites/art/sewer/sewerPropArt';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { objectiveBandEntry, type ObjectiveLine } from '../../ui/hud/objectiveLine';
import type { Camera } from '../../core/rendering/camera';
import type { SystemContext } from '../GameSystem';
import { exitFixtureOnTile, type InteriorExitFixtureSystem } from '../interiorExitFixtures';
import type { PartyTransferRequest } from '../partySplit/partyTransfer';
import { MashInteraction, type MashInteractionDef, type MashPress } from '../MashInteraction';
import type { WorkChannelBuilder } from '../WorkChannel';
import { questMobLevel } from '../questMobLevel';
import { WaterAnimationSystem } from '../WaterAnimationSystem';
import { SewerLighting } from './sewerLighting';
import { SEWER_CUES, type SewerCue } from '../../audio/sewerSoundCues';

/** Hauls on a sluice's valve wheel to turn it all the way. */
const SEWER_VALVE_PRESSES = 5;
/** From the valve's tile centre to the crawler's, in tiles: from any tile beside it. */
const SEWER_VALVE_REACH_TILES = 1.6;
/** How far the wheel and its post stand above the valve's tile, in pixels. */
const SEWER_VALVE_ART_RISE_PX = 14;
/** Each haul turns the wheel a quarter. */
const VALVE_TURNS_PER_PRESS = 0.25;

const SEWER_VALVE_DEF: MashInteractionDef = {
  pressesRequired: SEWER_VALVE_PRESSES,
  deed: 'turn the valve',
  humanRows: TURN_VALVE_ROWS,
  barStyle: 'build',
  reachTiles: SEWER_VALVE_REACH_TILES,
  artRisePx: SEWER_VALVE_ART_RISE_PX,
};

/** A lowered channel runs down to its bed over this many world ticks. */
const CHANNEL_DRAIN_TICKS = 150;
/** A flooded sump takes this long to carry its nest off. */
const NEST_WASH_FRAMES = 90;
/** How far round a fight's marked tile a body may be set down. */
const FIGHT_SPAWN_SEARCH_TILES = 2;
/** The spillway's outfall pipe is drawn over this many of its columns. */
const OUTFALL_SPAN_COLUMNS = 2;
const TILE_CENTRE = 0.5;
const WADER_CENTRE = 0.5;

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
  readonly partyLevel: number;
  /** Whether the cellar elf guides the party through this visit. */
  readonly guided: boolean;
  /** Where the tower-cistern culvert hands the party. */
  readonly cistern: PartyTransferRequest;
  /** The crawlers on this map, whose light is cut out of the dark; read every frame. */
  readonly presentCrawlers: () => readonly Player[];
}

interface LiveValve {
  readonly parsed: ParsedSewerValve;
  mash: MashInteraction;
}

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
  private readonly fights: LiveFight[];
  private readonly water: WaterAnimationSystem;
  /** Frames left of the nest being carried off; 0 once it is gone or while it still stands. */
  private nestWashFrames = 0;
  private nestPresent: boolean;
  /** Which channels stand at full flow, held shut against wading. */
  private readonly fullFlow = new Set<SewerChannelId>();
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
    this.nestPresent = !this.isRaised('nest_basin');
    this.applyWater();
    this.valves = this.section.valves.map((parsed) => ({
      parsed,
      mash: this.buildValve(parsed),
    }));
    this.fights = this.section.fights.map((parsed) => this.raiseFight(parsed));
    this.placeConnections();
    this.guide = deps.guided ? this.raiseGuide() : null;
  }

  // ── Water ──────────────────────────────────────────────────────────────────

  /** The effect of the turned valve that works `channel`, or null while no valve on it has been turned. */
  private valveTurnedFor(channel: SewerChannelId): SewerValveEffect | null {
    for (const valve of this.section.valves) {
      if (valve.def.effect.channel !== channel) continue;
      if (this.settled.has(valve.def.id)) return valve.def.effect;
    }
    return null;
  }

  private isRaised(channel: SewerChannelId): boolean {
    return this.valveTurnedFor(channel)?.kind === 'raise';
  }

  private isLowered(channel: SewerChannelId): boolean {
    return this.valveTurnedFor(channel)?.kind === 'lower';
  }

  /** Puts every channel at the level its valve leaves it, at once: a section is always built dry. */
  private applyWater(): void {
    this.map.floodWater(this.section.mainChannel, SEWER_FULL_FLOW_DEPTH);
    this.holdShut(this.section.mainChannel, true);
    const spillway = this.section.channels.spillway;
    if (!this.isLowered('spillway')) {
      this.map.floodWater(spillway, SEWER_FULL_FLOW_DEPTH);
      this.holdShut(spillway, true);
      this.fullFlow.add('spillway');
    }
    const basinValve = this.valveTurnedFor('nest_basin');
    if (basinValve?.kind === 'raise') {
      this.map.floodWater(this.section.channels.nest_basin, basinValve.depth);
    }
    this.holdShut(this.section.nest, this.nestPresent);
    warmDungeonWater(this.map.structure);
  }

  private holdShut(tiles: ReadonlyArray<SewerTile>, shut: boolean): void {
    for (const tile of tiles) {
      if (shut) this.map.blockTilePermanently(tile.x, tile.y);
      else this.map.unblockTilePermanently(tile.x, tile.y);
    }
  }

  private turnValve(valve: ParsedSewerValve): void {
    this.settled.add(valve.def.id);
    const { effect } = valve.def;
    const tiles = this.section.channels[effect.channel];
    const at = this.tileCentrePx(valve.tile);
    this.play('waterRush', at);
    switch (effect.kind) {
      case 'lower':
        this.map.drainWater(tiles, CHANNEL_DRAIN_TICKS);
        this.fullFlow.delete(effect.channel);
        this.holdShut(tiles, false);
        this.guide?.say(SEWER_GUIDE_WORK_LINES.spillwayLowered);
        return;
      case 'raise':
        this.map.floodWater(tiles, effect.depth);
        if (this.nestPresent) this.nestWashFrames = NEST_WASH_FRAMES;
        return;
      default: {
        const unhandled: never = effect;
        throw new Error(`unhandled valve effect ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private advanceNestWash(): void {
    if (this.nestWashFrames <= 0) return;
    this.nestWashFrames--;
    if (this.nestWashFrames > 0) return;
    this.nestPresent = false;
    this.holdShut(this.section.nest, false);
    this.guide?.say(SEWER_GUIDE_WORK_LINES.nestWashedOut);
  }

  /** How much of the nest is still standing, 1 to 0. */
  private nestPresence(): number {
    if (!this.nestPresent) return 0;
    if (this.nestWashFrames <= 0) return 1;
    return this.nestWashFrames / NEST_WASH_FRAMES;
  }

  // ── Valves ─────────────────────────────────────────────────────────────────

  private buildValve(parsed: ParsedSewerValve): MashInteraction {
    this.map.blockTilePermanently(parsed.tile.x, parsed.tile.y);
    const turned = this.settled.has(parsed.def.id);
    return new MashInteraction({
      def: SEWER_VALVE_DEF,
      footprint: { x: parsed.tile.x, y: parsed.tile.y, w: 1, h: 1 },
      pressesDone: turned ? SEWER_VALVE_PRESSES : 0,
      onPress: (press) => this.onValvePress(parsed, press),
    });
  }

  private onValvePress(valve: ParsedSewerValve, press: MashPress): void {
    const at = this.tileCentrePx(valve.tile);
    switch (press.kind) {
      case 'advanced':
        this.play('valveTurn', at);
        return;
      case 'finished':
        this.play('sluiceShut', at);
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
      mayLeave: (index) => {
        const hold = itemAt(stops, index)?.def.holdsUntil ?? null;
        return hold === null || this.settled.has(hold);
      },
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
    this.map.advanceWaterDrains();
    this.advanceNestWash();
    this.noteFightsWon();
    this.water.beginFrame();
    const centre = TILE_SIZE * WADER_CENTRE;
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
    if (this.fullFlow.has('spillway')) {
      return { text: 'Shut the spillway with the valve in the alcove', tone: 'warning' };
    }
    if (this.nestPresent) {
      return { text: 'Flood the sump to clear the rat nest', tone: 'warning' };
    }
    return { text: 'Follow the drain to the tower cistern', tone: 'success' };
  }

  renderWorld(ctx: CanvasRenderingContext2D, camera: Camera, _active: Player): void {
    const { x: camX, y: camY } = camera;
    this.water.renderGround(ctx, camera);
    const ts = TILE_SIZE;
    for (const grate of this.section.streetGrates) {
      paintGrateLightOnFloor(ctx, grate.x * ts - camX, grate.y * ts - camY, ts);
    }
    const ladder = this.section.ladder;
    paintSewerLadder(ctx, ladder.x * ts - camX, ladder.y * ts - camY, ts);
    this.renderOutfall(ctx, camX, camY);
    this.renderCulverts(ctx, camX, camY);
    const presence = this.nestPresence();
    for (const tile of this.section.nest) {
      paintRatNestTile(ctx, tile.x * ts - camX, tile.y * ts - camY, ts, tile.x, tile.y, presence);
    }
    for (const valve of this.valves) {
      const { tile } = valve.parsed;
      const turns = valve.mash.pressesDone * VALVE_TURNS_PER_PRESS;
      paintValveWheel(ctx, tile.x * ts - camX, tile.y * ts - camY, ts, turns);
    }
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
    const pouring = this.fullFlow.has('spillway');
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
    this.lighting.renderDarkness(ctx, camera, lit);
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

  leaveFloor(_ctx: SystemContext): void {
    this.lighting.release();
  }

  dispose(): void {
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
