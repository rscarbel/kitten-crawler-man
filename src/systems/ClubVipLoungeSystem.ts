import { playDrinkGesture } from '../creatures/humanGestures';
import { displayHp } from '../core/crawlerFormulas';
import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import type { ClubMembership } from '../core/ClubMembership';
import type { MercenaryTemplateId } from '../core/mercenaryTemplates';
import type { CretinVariant } from '../sprites/cretinSprite';
import { SERVICE_PRICES } from '../economy/servicePrices';
import type { ServiceIconId } from '../sprites/art/itemIcons/serviceIcons';
import {
  ShopSession,
  offerUnless,
  type ShopMenu,
  type ShopPurchaseResult,
  type ShopRow,
} from '../ui/screens/shop/shopSession';

/**
 * Stamped on a booking made where no scene has named the floor. Only harnesses
 * build the lounge that way, and {@link ClubVipLoungeSystem.escortActive}
 * honours any booking while the floor is unknown.
 */
const HARNESS_ESCORT_LEVEL_ID = 'harness';

/** The two Cretins who shadow a crawler that books the Private Escort. */
export interface EscortPair {
  /** Both names together, as the panel prints them. */
  readonly names: string;
  readonly variants: readonly [CretinVariant, CretinVariant];
}

/** The club's usual security detail, and the pair in the books. */
const HOUSE_ESCORT: EscortPair = { names: 'The Sledge & Bomo', variants: ['sledge', 'bomo'] };

/** Club security who are not Meat Shields hires, so they are never out on contract. */
const RELIEF_ESCORT: EscortPair = {
  names: 'Clay-ton & Very Sullen',
  variants: ['clayton', 'very_sullen'],
};

/** Hires who are also the house escort: with either out on contract, the relief pair works the floor. */
const HOUSE_ESCORT_HIRES: ReadonlySet<MercenaryTemplateId> = new Set(['sledge', 'bomo']);

/**
 * Which pair walks the floor with a crawler. One Cretin cannot shadow the
 * party inside the club while also being under contract to it, so a hired
 * Sledge or Bomo sends Clay-ton and Very Sullen instead.
 */
export function escortPairFor(roster: MercenaryRoster): EscortPair {
  const hiredId = roster.active?.id;
  const houseEscortOnContract = hiredId !== undefined && HOUSE_ESCORT_HIRES.has(hiredId);
  return houseEscortOnContract ? RELIEF_ESCORT : HOUSE_ESCORT;
}

/** One of the lounge's three paid services. */
export type VipServiceKind = 'heal' | 'buff' | 'escort';

const LOUNGE_TITLE = 'VIP Lounge';
const LOUNGE_BARK = 'A hush-quiet back room — velvet, privacy, and comped luxury.';
const ALREADY_HEALED = 'Already at full health';
const COCKTAIL_ACTIVE = 'Cocktail already active';
const ESCORT_HIRED = 'Hired';

const VIP_SERVICE_ART = {
  heal: 'vip_recovery',
  buff: 'vip_cocktail',
  escort: 'vip_escort',
} as const satisfies Record<VipServiceKind, ServiceIconId>;

const VIP_SERVICE_KINDS: readonly VipServiceKind[] = ['heal', 'buff', 'escort'];

function vipServiceKind(key: string): VipServiceKind | null {
  return VIP_SERVICE_KINDS.find((kind) => kind === key) ?? null;
}

/**
 * The Desperado Club's VIP Lounge — the tasteful adaptation of the book's
 * members-only back room. Sells three premium coin sinks: a
 * full heal, a short buff cocktail, and a Cretin bodyguard escort. The
 * escort is free when the player's casino wagers this visit clear
 * the escort's own price — the canon "spend enough at the tables and
 * security is free" perk. The booking lasts until the party leaves the floor it
 * was made on, so it is kept on the {@link ClubMembership} that outlives each
 * visit. The escort is cosmetic (the club is a safe zone); the host
 * {@link DesperadoClubSystem} renders the two Cretins trailing the player.
 */
export class ClubVipLoungeSystem {
  /** The lounge's counter, drawn by the shop screen like every other. */
  readonly session = new ShopSession();

  /** Set when the escort is hired; the host clears it after firing the bodyguard achievement. */
  escortPending = false;

  /** Casino coins wagered this visit, captured when the panel opens (the free-escort gate). */
  private wageredAtOpen = 0;

  constructor(
    private readonly audio: AudioManager | null,
    private readonly roster: MercenaryRoster,
    private readonly membership: ClubMembership,
  ) {}

  /**
   * Whether the escort is on duty on the floor the party stands on. A roster
   * that has not been told its floor is a harness with no floor to outlast, so
   * a booking there lasts as long as the membership object does.
   */
  get escortActive(): boolean {
    const bookedLevelId = this.membership.escortLevelId;
    if (bookedLevelId === null) return false;
    const floorLevelId = this.roster.floorLevelId;
    return floorLevelId === null || bookedLevelId === floorLevelId;
  }

  /** Read live, so a Cretin hired at the desk mid-visit hands the escort to the relief pair. */
  get escortPair(): EscortPair {
    return escortPairFor(this.roster);
  }

  get open(): boolean {
    return this.session.isOpen;
  }

  /** Opens the lounge for `guest`, whose health and drinks decide which services are on. */
  openPanel(coinsWageredThisVisit: number, guest: Player): void {
    this.wageredAtOpen = coinsWageredThisVisit;
    this.session.open(
      () => this.menu(guest),
      (option, buyer) => this.serve(option, buyer),
      {
        onBlocked: () => this.audio?.play('error'),
        blockedLine: (option) => this.refusalLine(option),
        rebuyGuardTicks: 0,
        sell: null,
        liveRows: false,
      },
    );
  }

  close(): void {
    this.session.close();
  }

  update(): void {
    this.session.update();
  }

  private menu(guest: Player): ShopMenu {
    return {
      title: LOUNGE_TITLE,
      bark: LOUNGE_BARK,
      byline: null,
      emblem: null,
      options: VIP_SERVICE_KINDS.map((kind) => this.serviceRow(kind, guest)),
    };
  }

  private serviceRow(kind: VipServiceKind, guest: Player): ShopRow {
    const art: ShopRow['art'] = { kind: 'service', service: VIP_SERVICE_ART[kind] };
    switch (kind) {
      case 'heal': {
        const atFull = guest.hp >= guest.maxHp;
        return {
          key: kind,
          label: 'Full Recovery',
          desc: `A back-room medic patches you up completely. ${displayHp(guest.hp)} / ${guest.maxHp} HP`,
          art,
          offer: offerUnless(atFull ? ALREADY_HEALED : null, {
            kind: 'coins',
            coins: SERVICE_PRICES.vip_lounge.heal,
          }),
          questErrand: false,
        };
      }
      case 'buff': {
        const bothActive = guest.hasStatus('speed_fizz') && guest.hasStatus('cooldown_crisp');
        return {
          key: kind,
          label: 'VIP Cocktail',
          desc: 'Speed Fizz + Cooldown Crisp on the house pour.',
          art,
          offer: offerUnless(bothActive ? COCKTAIL_ACTIVE : null, {
            kind: 'coins',
            coins: SERVICE_PRICES.vip_lounge.cocktail,
          }),
          questErrand: false,
        };
      }
      case 'escort': {
        const pitch = `${this.escortPair.names} shadow you through the club until this floor is done.`;
        if (this.escortActive) {
          return {
            key: kind,
            label: 'Private Escort',
            desc: `${this.escortPair.names} have your back until this floor is done.`,
            art,
            offer: { status: 'spent', reason: ESCORT_HIRED },
            questErrand: false,
          };
        }
        return {
          key: kind,
          label: 'Private Escort',
          desc: this.escortIsFree ? `${pitch} Comped: your table play covers it.` : pitch,
          art,
          offer: { status: 'open', cost: { kind: 'coins', coins: this.escortCost() } },
          questErrand: false,
        };
      }
    }
  }

  private refusalLine(option: ShopRow): string {
    switch (vipServiceKind(option.key)) {
      case 'heal':
        return option.offer.status === 'open'
          ? 'Not enough coins for the medic.'
          : "You're already at full health.";
      case 'buff':
        return option.offer.status === 'open'
          ? 'Not enough coins for the cocktail.'
          : 'That cocktail is already coursing through you.';
      case 'escort':
        return option.offer.status === 'open'
          ? 'The escort costs more coins than you carry.'
          : `${this.escortPair.names} already have your back.`;
      case null:
        return '';
    }
  }

  /** Performs a service the session has already checked the guest can pay for; the session takes the coins. */
  private serve(option: ShopRow, buyer: Player): ShopPurchaseResult {
    switch (vipServiceKind(option.key)) {
      case 'heal':
        return this.heal(buyer);
      case 'buff':
        return this.buff(buyer);
      case 'escort':
        return this.hireEscort();
      case null:
        return { ok: false, line: '' };
    }
  }

  private get escortIsFree(): boolean {
    return this.wageredAtOpen > SERVICE_PRICES.vip_lounge.bodyguard_pair;
  }

  private escortCost(): number {
    return this.escortIsFree ? 0 : SERVICE_PRICES.vip_lounge.bodyguard_pair;
  }

  private heal(player: Player): ShopPurchaseResult {
    if (player.hp >= player.maxHp) return { ok: false, line: "You're already at full health." };
    player.hp = player.maxHp;
    this.audio?.play('potion_drink');
    return { ok: true, line: 'Patched up. Good as new.' };
  }

  private buff(player: Player): ShopPurchaseResult {
    const speedActive = player.hasStatus('speed_fizz');
    const cooldownActive = player.hasStatus('cooldown_crisp');
    if (speedActive && cooldownActive) {
      return { ok: false, line: 'That cocktail is already coursing through you.' };
    }
    if (!speedActive) player.activateSpeedFizz();
    if (!cooldownActive) player.activateCooldownCrisp();
    this.audio?.play('potion_drink');
    playDrinkGesture(player);
    return { ok: true, line: 'The VIP Cocktail hits. You feel unstoppable.' };
  }

  private hireEscort(): ShopPurchaseResult {
    if (this.escortActive) return { ok: false, line: '' };
    this.membership.escortLevelId = this.roster.floorLevelId ?? HARNESS_ESCORT_LEVEL_ID;
    this.escortPending = true;
    this.audio?.play('purchase_success');
    return {
      ok: true,
      line: this.escortIsFree
        ? 'On the house — the tables have been kind. Enjoy the muscle.'
        : `${this.escortPair.names} fall in behind you.`,
    };
  }
}
