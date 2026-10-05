import { playDrinkGesture } from '../creatures/humanGestures';
import { displayHp } from '../core/crawlerFormulas';
import type { Player } from '../Player';
import { canAffordCoins, spendPartyCoins } from '../core/partyCoins';
import type { AudioManager } from '../audio/AudioManager';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import type { MercenaryTemplateId } from '../core/mercenaryTemplates';
import type { CretinVariant } from '../sprites/cretinSprite';

/** Prices for the VIP back-room services (canon-flavoured coin sinks). */
const VIP_HEAL_PRICE = 40;
const VIP_COCKTAIL_PRICE = 60;
/** The escort pair (canon: 300/crawler, 500/pair). Free when casino wagers exceed it. */
export const BODYGUARD_PAIR_PRICE = 500;

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

/** A service as the lounge screen draws it: what it is, what pressing it costs, and whether it can be pressed. */
export interface VipServiceCard {
  readonly kind: VipServiceKind;
  readonly name: string;
  readonly desc: string;
  readonly actionLabel: string;
  readonly disabled: boolean;
  /** A line about the service's state (HP, already active, comped); empty when there is nothing to say. */
  readonly statusLine: string;
}

interface VipService {
  name: string;
  /** Takes the escort pair because the escort card names whichever two are working tonight. */
  desc: (escort: EscortPair) => string;
  kind: VipServiceKind;
}

const VIP_SERVICES: ReadonlyArray<VipService> = [
  {
    name: 'Full Recovery',
    desc: () => 'A back-room medic patches you up completely.',
    kind: 'heal',
  },
  {
    name: 'VIP Cocktail',
    desc: () => 'Speed Fizz + Cooldown Crisp on the house pour.',
    kind: 'buff',
  },
  {
    name: 'Private Escort',
    desc: (escort) => `${escort.names} shadow you through the club.`,
    kind: 'escort',
  },
];

/**
 * The Desperado Club's VIP Lounge — the tasteful adaptation of the book's
 * members-only back room. Sells three premium coin sinks: a
 * full heal, a short buff cocktail, and a Cretin bodyguard escort. The
 * escort is free when the player's casino wagers this visit clear
 * {@link BODYGUARD_PAIR_PRICE} — the canon "spend enough at the tables and
 * security is free" perk. The escort is cosmetic (the club is a safe zone); the
 * host {@link DesperadoClubSystem} renders the two Cretins trailing the player.
 */
export class ClubVipLoungeSystem {
  open = false;

  /** Set when the escort is hired; the host clears it after firing the bodyguard achievement. */
  escortPending = false;

  /** True once the escort has been hired this visit; the host renders the two Cretins. */
  private escortHired = false;

  /** Casino coins wagered this visit, captured when the panel opens (the free-escort gate). */
  private wageredAtOpen = 0;

  /** Transient status line (e.g. "Not enough coins"); cleared on the next valid action. */
  private feedbackMsg = '';

  constructor(
    private readonly audio: AudioManager | null,
    private readonly roster: MercenaryRoster,
  ) {}

  get escortActive(): boolean {
    return this.escortHired;
  }

  /** Read live, so a Cretin hired at the desk mid-visit hands the escort to the relief pair. */
  get escortPair(): EscortPair {
    return escortPairFor(this.roster);
  }

  openPanel(coinsWageredThisVisit: number): void {
    this.open = true;
    this.wageredAtOpen = coinsWageredThisVisit;
    this.feedbackMsg = '';
  }

  close(): void {
    this.open = false;
  }

  private get escortIsFree(): boolean {
    return this.wageredAtOpen > BODYGUARD_PAIR_PRICE;
  }

  private escortCost(): number {
    return this.escortIsFree ? 0 : BODYGUARD_PAIR_PRICE;
  }

  private heal(player: Player, companion: Player): void {
    if (player.hp >= player.maxHp) {
      this.feedbackMsg = "You're already at full health.";
      this.audio?.play('error');
      return;
    }
    if (!canAffordCoins(player, companion, VIP_HEAL_PRICE)) {
      this.feedbackMsg = 'Not enough coins for the medic.';
      this.audio?.play('error');
      return;
    }
    spendPartyCoins(player, companion, VIP_HEAL_PRICE, player);
    player.hp = player.maxHp;
    this.feedbackMsg = 'Patched up. Good as new.';
    this.audio?.play('potion_drink');
  }

  private buff(player: Player, companion: Player): void {
    const speedActive = player.hasStatus('speed_fizz');
    const cooldownActive = player.hasStatus('cooldown_crisp');
    if (speedActive && cooldownActive) {
      this.feedbackMsg = 'That cocktail is already coursing through you.';
      this.audio?.play('error');
      return;
    }
    if (!canAffordCoins(player, companion, VIP_COCKTAIL_PRICE)) {
      this.feedbackMsg = 'Not enough coins for the cocktail.';
      this.audio?.play('error');
      return;
    }
    spendPartyCoins(player, companion, VIP_COCKTAIL_PRICE, player);
    if (!speedActive) player.activateSpeedFizz();
    if (!cooldownActive) player.activateCooldownCrisp();
    this.feedbackMsg = 'The VIP Cocktail hits. You feel unstoppable.';
    this.audio?.play('potion_drink');
    playDrinkGesture(player);
  }

  private hireEscort(player: Player, companion: Player): void {
    if (this.escortHired) return;
    const cost = this.escortCost();
    if (!canAffordCoins(player, companion, cost)) {
      this.feedbackMsg = 'The escort costs more coins than you carry.';
      this.audio?.play('error');
      return;
    }
    spendPartyCoins(player, companion, cost, player);
    this.escortHired = true;
    this.escortPending = true;
    this.feedbackMsg = this.escortIsFree
      ? 'On the house — the tables have been kind. Enjoy the muscle.'
      : `${this.escortPair.names} fall in behind you.`;
    this.audio?.play('purchase_success');
  }

  /** The line the lounge last answered with; empty until something is pressed. */
  get feedback(): string {
    return this.feedbackMsg;
  }

  /** The three services, in the order the lounge lists them. */
  serviceCards(player: Player, companion: Player): VipServiceCard[] {
    return VIP_SERVICES.map((service) => {
      const state = this.buttonStateFor(service.kind, player, companion);
      return {
        kind: service.kind,
        name: service.name,
        desc: service.desc(this.escortPair),
        actionLabel: state.label,
        disabled: state.disabled,
        statusLine: state.statusLine,
      };
    });
  }

  /** Presses a service's button, refused and charged by the same rules as a click. */
  activate(kind: VipServiceKind, player: Player, companion: Player): void {
    switch (kind) {
      case 'heal':
        this.heal(player, companion);
        return;
      case 'buff':
        this.buff(player, companion);
        return;
      case 'escort':
        this.hireEscort(player, companion);
        return;
    }
  }

  private buttonStateFor(
    kind: VipServiceKind,
    player: Player,
    companion: Player,
  ): { label: string; disabled: boolean; statusLine: string } {
    switch (kind) {
      case 'heal': {
        const atFull = player.hp >= player.maxHp;
        return {
          label: `Buy — ${VIP_HEAL_PRICE}`,
          disabled: atFull || !canAffordCoins(player, companion, VIP_HEAL_PRICE),
          statusLine: atFull
            ? 'Already at full health.'
            : `${displayHp(player.hp)} / ${player.maxHp} HP`,
        };
      }
      case 'buff': {
        const bothActive = player.hasStatus('speed_fizz') && player.hasStatus('cooldown_crisp');
        return {
          label: `Buy — ${VIP_COCKTAIL_PRICE}`,
          disabled: bothActive || !canAffordCoins(player, companion, VIP_COCKTAIL_PRICE),
          statusLine: bothActive ? 'Cocktail already active.' : '',
        };
      }
      case 'escort': {
        if (this.escortHired) {
          return {
            label: 'Hired',
            disabled: true,
            statusLine: `${this.escortPair.names} have your back.`,
          };
        }
        const free = this.escortIsFree;
        const cost = this.escortCost();
        return {
          label: free ? 'Hire — FREE' : `Hire — ${cost}`,
          disabled: !canAffordCoins(player, companion, cost),
          statusLine: free ? 'Comped: your table play covers it.' : '',
        };
      }
    }
  }
}
