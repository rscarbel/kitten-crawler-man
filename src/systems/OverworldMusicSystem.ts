/**
 * OverworldMusicSystem — zone-based background music for Taloncrest
 * overworld: a shuffled town playlist inside the town wall, a shuffled
 * circus playlist on the circus grounds, Briar Hollow's own zone inside its palisade
 * with the lumber yard's and Merrit's farm's own songs, a harvest theme out at the village quarry, and a
 * shuffled wilds playlist between. Each zone
 * is an area claim; a fight's battle or boss claim outranks it, so crossing a
 * zone edge mid-fight changes nothing that is heard. Once every stolen cat is
 * home, the town's playlist carries their song too.
 */

import { TILE_SIZE } from '../core/constants';
import type { MusicClaims } from '../audio/AudioScope';
import type { MusicSelection } from '../audio/music/MusicDirector';
import { CIRCUS_MUSIC_TRACKS, TOWN_MUSIC_TRACKS, WILDS_MUSIC_TRACKS } from '../audio/sounds';
import type { MusicTrackId } from '../audio/sounds';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';
import { isAtLumberYard } from './briarHollow/resourceZones';
import { CATS_HOME_SONG } from './missingCats/missingCatsSoundCues';

type MusicZone = 'town' | 'wilds' | 'circus' | 'village' | 'lumber_yard' | 'farm' | 'quarry';

const ZONE_TRACKS: Record<MusicZone, ReadonlyArray<MusicTrackId>> = {
  town: TOWN_MUSIC_TRACKS,
  wilds: WILDS_MUSIC_TRACKS,
  circus: CIRCUS_MUSIC_TRACKS,
  village: ['briar_hollow_theme'],
  lumber_yard: ['under_the_willows'],
  farm: ['hayfield_afternoon'],
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
/** A body's position is its top-left corner; its centre is half a tile in. */
const BODY_CENTRE_OFFSET_PX = TILE_SIZE / 2;

export class OverworldMusicSystem implements GameSystem {
  private currentZone: MusicZone | null = null;
  /** A zone the player has crossed into but whose music has not taken over yet. */
  private pendingZone: MusicZone | null = null;
  private pendingZoneFrames = 0;

  constructor(
    private readonly map: GameMap,
    private readonly music: MusicClaims,
    /** Whether the stolen cats have all walked home, which adds their song to the town's. */
    private readonly catsHome: () => boolean,
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

  /** The playlist of the zone a body standing at this top-left position is in. */
  zoneSelectionAt(bodyX: number, bodyY: number): MusicSelection {
    return { kind: 'playlist', ids: this.tracksOf(this.zoneAt(bodyX, bodyY)) };
  }

  private tracksOf(zone: MusicZone): ReadonlyArray<MusicTrackId> {
    const tracks = ZONE_TRACKS[zone];
    return zone === 'town' && this.catsHome() ? [...tracks, CATS_HOME_SONG] : tracks;
  }

  /**
   * Claims the playlist of the zone a body standing at this top-left position
   * is in. Also called as the scene is entered when that playlist carried on
   * through a building visit, so it is claimed again before the scene change
   * could fade it out. Takes over at once, with no dwell.
   */
  claimZoneAt(bodyX: number, bodyY: number): void {
    this.claimZone(this.zoneAt(bodyX, bodyY));
  }

  private claimZone(zone: MusicZone): void {
    this.pendingZone = null;
    if (zone === this.currentZone) return;
    this.currentZone = zone;
    this.music.claimMusic({
      owner: 'overworld_zone',
      layer: 'area',
      selection: { kind: 'playlist', ids: this.tracksOf(zone) },
      fadeInMs: ZONE_FADE_MS,
    });
  }

  /**
   * The zone of a body standing at this top-left position, judged at its
   * centre: the same point the town wall and the harvest reach are measured
   * from, so the music agrees with where the crawler is working.
   */
  private zoneAt(bodyX: number, bodyY: number): MusicZone {
    const worldX = bodyX + BODY_CENTRE_OFFSET_PX;
    const worldY = bodyY + BODY_CENTRE_OFFSET_PX;
    const circusCentre = this.map.circusCentre;
    const circusRadius = this.map.circusRadiusTiles;
    if (circusCentre && circusRadius !== undefined) {
      const dx = worldX / TILE_SIZE - circusCentre.x;
      const dy = worldY / TILE_SIZE - circusCentre.y;
      if (Math.hypot(dx, dy) <= circusRadius + CIRCUS_ZONE_BUFFER_TILES) return 'circus';
    }
    if (this.map.isInsideTownWall(worldX, worldY)) return 'town';
    if (isAtLumberYard(this.map, worldX, worldY)) return 'lumber_yard';
    if (this.map.isOnMerritsFarm(worldX, worldY)) return 'farm';
    if (this.map.isInBriarHollow(worldX, worldY)) return 'village';
    if (this.map.briarHollowDistrictAt(worldX, worldY) === 'quarry') return 'quarry';
    return 'wilds';
  }
}
