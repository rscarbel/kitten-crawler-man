/**
 * OverworldMusicSystem — zone-based background music for the Over City
 * overworld: a shuffled town playlist inside the town safe zone, a shuffled
 * circus playlist on the circus grounds, Briar Hollow's own zone inside its palisade, a
 * harvest theme out at the village quarry, and a
 * shuffled wilds playlist between. Each zone
 * is an area claim; a fight's battle or boss claim outranks it, so crossing a
 * zone edge mid-fight changes nothing that is heard.
 */

import { TILE_SIZE } from '../core/constants';
import type { MusicClaims } from '../audio/AudioScope';
import type { MusicSelection } from '../audio/music/MusicDirector';
import { CIRCUS_MUSIC_TRACKS, TOWN_MUSIC_TRACKS, WILDS_MUSIC_TRACKS } from '../audio/sounds';
import type { MusicTrackId } from '../audio/sounds';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';

type MusicZone = 'town' | 'wilds' | 'circus' | 'village' | 'quarry';

const ZONE_TRACKS: Record<MusicZone, ReadonlyArray<MusicTrackId>> = {
  town: TOWN_MUSIC_TRACKS,
  wilds: WILDS_MUSIC_TRACKS,
  circus: CIRCUS_MUSIC_TRACKS,
  village: ['briar_hollow_theme'],
  quarry: ['medieval_harvest_theme'],
};

const ZONE_FADE_MS = 1500;
/** The circus music starts a little before the player reaches the grounds. */
const CIRCUS_ZONE_BUFFER_TILES = 4;
/**
 * How long the player must stay in a new zone before its music takes over,
 * about a second and a half at 60 fps, so walking along a zone edge never
 * flips the track back and forth. The circus buffer is the spatial half of
 * the same rule.
 */
const ZONE_DWELL_FRAMES = 90;

export class OverworldMusicSystem implements GameSystem {
  private currentZone: MusicZone | null = null;
  /** A zone the player has crossed into but whose music has not taken over yet. */
  private pendingZone: MusicZone | null = null;
  private pendingZoneFrames = 0;

  constructor(
    private readonly map: GameMap,
    private readonly music: MusicClaims,
  ) {}

  update(ctx: SystemContext): void {
    const zone = this.zoneAt(ctx.active.x, ctx.active.y);
    if (this.currentZone === null) {
      this.claimZone(zone);
      return;
    }
    if (zone === this.currentZone) {
      this.pendingZone = null;
      return;
    }
    if (zone !== this.pendingZone) {
      this.pendingZone = zone;
      this.pendingZoneFrames = 0;
    }
    this.pendingZoneFrames++;
    if (this.pendingZoneFrames >= ZONE_DWELL_FRAMES) this.claimZone(zone);
  }

  /** The playlist of the zone at a point. */
  zoneSelectionAt(worldX: number, worldY: number): MusicSelection {
    return { kind: 'playlist', ids: ZONE_TRACKS[this.zoneAt(worldX, worldY)] };
  }

  /**
   * Claims the zone's playlist at a point. Also called as the scene is
   * entered when that playlist carried on through a building visit, so it is
   * claimed again before the scene change could fade it out. Takes over at
   * once, with no dwell.
   */
  claimZoneAt(worldX: number, worldY: number): void {
    this.claimZone(this.zoneAt(worldX, worldY));
  }

  private claimZone(zone: MusicZone): void {
    this.pendingZone = null;
    if (zone === this.currentZone) return;
    this.currentZone = zone;
    this.music.claimMusic({
      owner: 'overworld_zone',
      layer: 'area',
      selection: { kind: 'playlist', ids: ZONE_TRACKS[zone] },
      fadeInMs: ZONE_FADE_MS,
    });
  }

  private zoneAt(worldX: number, worldY: number): MusicZone {
    const circusCentre = this.map.circusCentre;
    const circusRadius = this.map.circusRadiusTiles;
    if (circusCentre && circusRadius !== undefined) {
      const dx = worldX / TILE_SIZE - circusCentre.x;
      const dy = worldY / TILE_SIZE - circusCentre.y;
      if (Math.hypot(dx, dy) <= circusRadius + CIRCUS_ZONE_BUFFER_TILES) return 'circus';
    }
    if (this.map.isInTownSafeZone(worldX, worldY)) return 'town';
    if (this.map.isInBriarHollow(worldX, worldY)) return 'village';
    if (this.map.briarHollowDistrictAt(worldX, worldY) === 'quarry') return 'quarry';
    return 'wilds';
  }
}
