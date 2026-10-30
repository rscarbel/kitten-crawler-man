import { HumanPlayer } from '../../creatures/HumanPlayer';
import { CatPlayer } from '../../creatures/CatPlayer';
import type { Player } from '../../Player';
import { TILE_SIZE } from '../constants';
import type { ItemId } from '../items/defs/ItemDefs';
import type { XpDiminishingTier } from '../../levels/xpDiminishing';
import type { PartyArrivalTiles } from '../../map/findWalkableTile';
import type { CrawlerKind } from '../skills/SkillManager';
import { crawlerDisplayName } from '../../characters/characters';
import {
  createPartySplitState,
  crawlerIsLive,
  presenceOf,
  type PartyFormation,
  type PartyPresence,
  type PartySplitState,
} from './partySplit';

export type Crawler = HumanPlayer | CatPlayer;

const SPLIT_TRAVEL_REFUSAL = 'The stone will not carry a party that is apart.';

/**
 * The player party (Human + Cat): a single handle systems can accept instead
 * of separate `human`/`cat` parameters.
 */
export class PlayerManager {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;

  /**
   * @param xpCurve The diminishing-returns curve of the floor the party is on,
   *   or `undefined` for a floor that has none. Required rather than optional
   *   so that no scene — an interior hanging off a floor included — can build
   *   a party that quietly earns XP at full rate.
   * @param heldParty The two crawlers to keep rather than build: a scene rebuilt
   *   around a floor held aside keeps the very objects the floor's creatures
   *   and systems point at.
   */
  constructor(
    spawnX: number,
    spawnY: number,
    xpCurve: readonly XpDiminishingTier[] | undefined,
    heldParty?: { readonly human: HumanPlayer; readonly cat: CatPlayer },
  ) {
    if (heldParty === undefined) {
      this.human = new HumanPlayer(spawnX, spawnY, TILE_SIZE);
      this.cat = new CatPlayer(spawnX + 1, spawnY, TILE_SIZE);
      this.human.isActive = true;
    } else {
      this.human = heldParty.human;
      this.cat = heldParty.cat;
    }
    this.human.xpCurve = xpCurve;
    this.cat.xpCurve = xpCurve;
    this.human.bindPresence(() => this.isKindPresent('human'));
    this.cat.bindPresence(() => this.isKindPresent('cat'));
  }

  private split: PartySplitState = createPartySplitState();

  /** Who is on this map, for systems that are handed presence rather than the party. */
  readonly presence: PartyPresence = presenceOf(() => this.split.formation);

  /**
   * Reads the run's formation from here on. Every scene binds the state it was
   * handed right after building its party, so a split survives every door.
   */
  bindPartySplit(state: PartySplitState): void {
    this.split = state;
    this.steerLiveGroup();
  }

  get formation(): PartyFormation {
    return this.split.formation;
  }

  /**
   * Hands the controls to a live crawler when the steered one is away, which
   * a hand-over to the other group always makes it. Call after any change to
   * the formation.
   */
  steerLiveGroup(): void {
    if (this.active().isAway && !this.inactiveCrawler().isAway) this.swapSteering();
  }

  private isKindPresent(kind: CrawlerKind): boolean {
    return crawlerIsLive(this.split.formation, kind);
  }

  /** The currently player-controlled character. */
  active(): Crawler {
    return this.human.isActive ? this.human : this.cat;
  }

  private inactiveCrawler(): Crawler {
    return this.human.isActive ? this.cat : this.human;
  }

  /**
   * The crawler not being steered, when it is on this map; null while the
   * party is split and it is away. What every in-world rule asks for: who
   * follows, who can be revived, who stands beside the steered one.
   */
  presentPartner(): Crawler | null {
    const partner = this.inactiveCrawler();
    return partner.isAway ? null : partner;
  }

  /**
   * The crawler not being steered, wherever it is. Right only for the party
   * as a roster: rewards, the save and the HUD's frames.
   */
  partnerAnywhere(): Crawler {
    return this.inactiveCrawler();
  }

  /** The crawlers on this map (order: human, cat). What a scene places, simulates and judges. */
  presentCrawlers(): readonly Crawler[] {
    return this.wholeParty().filter((crawler) => !crawler.isAway);
  }

  /**
   * Both crawlers, wherever they are (order: human, cat). Right only for
   * rewards, the save and the HUD's roster; in-world rules use
   * {@link presentCrawlers}.
   */
  wholeParty(): readonly [HumanPlayer, CatPlayer] {
    return [this.human, this.cat];
  }

  /** Why the controls cannot pass to the other crawler right now, or null when they can. */
  switchRefusal(): string | null {
    const partner = this.inactiveCrawler();
    if (!partner.isAway) return null;
    const kind = partner === this.human ? 'human' : 'cat';
    return `${crawlerDisplayName(kind)} is somewhere else right now.`;
  }

  /**
   * Why the party cannot be carried somewhere as one (the anchor's travel,
   * its recall), or null when it can: a split party is on two maps, and the
   * stone moves only the crawlers standing beside it.
   */
  travelRefusal(): string | null {
    return this.split.formation.kind === 'split' ? SPLIT_TRAVEL_REFUSAL : null;
  }

  /** Swap which character is player-controlled. Does nothing while {@link switchRefusal} refuses. */
  switchActive(): void {
    if (this.switchRefusal() !== null) return;
    this.swapSteering();
  }

  private swapSteering(): void {
    this.human.isActive = !this.human.isActive;
    this.cat.isActive = !this.cat.isActive;
    // The companion AI prices its attacks off `getMeleeDamage` and closes to
    // reach, so a follower still holding the sling would walk into melee range
    // and swing a weapon it cannot swing. He puts it away when he stops driving,
    // and takes it back out when he drives again, so the round trip leaves him
    // as he was. A sword is swung like a fist, so he keeps it drawn.
    if (!this.human.isActive) {
      const sling = this.human.hasSlingDrawn ? this.human.mainHandWeaponId : null;
      if (sling !== null) this.human.stowWeapon();
      this.slingStowedBySwitch = this.human.mainHandWeaponId === null ? sling : null;
      return;
    }
    const stowed = this.slingStowedBySwitch;
    this.slingStowedBySwitch = null;
    const stillCarried = this.human.inventory.actionBar.slots.some((slot) => slot?.id === stowed);
    if (stowed !== null && stillCarried && this.human.mainHandWeaponId === null) {
      this.human.drawWeapon(stowed);
    }
  }

  /** The sling handing control to the cat put away, to be drawn again when he takes it back. */
  private slingStowedBySwitch: ItemId | null = null;

  /** True if either crawler on this map is in a safe room. */
  isAnySafe(safeRoom: { isEntityInSafeRoom(p: Player): boolean }): boolean {
    return this.presentCrawlers().some((crawler) => safeRoom.isEntityInSafeRoom(crawler));
  }

  /**
   * Stands the driven crawler on `arrival.leader` and the other on
   * `arrival.follower` — tiles from `findPartyArrivalTiles`, which checks
   * both, rather than a fixed offset that can land inside a wall or a prop.
   * An away crawler is not on this map and is left where it stands.
   */
  setPartyDown(arrival: PartyArrivalTiles): void {
    const driven = this.active();
    driven.x = arrival.leader.x * TILE_SIZE;
    driven.y = arrival.leader.y * TILE_SIZE;
    const partner = this.presentPartner();
    if (partner === null) return;
    partner.x = arrival.follower.x * TILE_SIZE;
    partner.y = arrival.follower.y * TILE_SIZE;
  }

  /** Ticks the present crawlers' timers; an away crawler stays frozen as the hand-over left it. */
  tickTimers(): void {
    for (const crawler of this.presentCrawlers()) crawler.tickTimers();
  }

  /** Update safe-room protection flags. */
  updateProtection(safeRoom: { isEntityInSafeRoom(p: Player): boolean }): void {
    for (const crawler of this.presentCrawlers()) {
      crawler.isProtected = safeRoom.isEntityInSafeRoom(crawler);
    }
  }
}
