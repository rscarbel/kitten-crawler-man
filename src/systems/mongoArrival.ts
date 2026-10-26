/**
 * Mongo's arrival as a reward, shared by every scene that can show the
 * reward chest bringing him. Earning the chest does not bring him: he joins
 * when the player opens it, and is announced and explained when it closes.
 * The chest waits in the saved presentation queue until then, so a chest
 * left unopened across a reload still brings him, once.
 */

import { getMongoStats, MONGO_DEF } from '../abilities/mongo';
import { crawlerName } from '../characters/characters';
import type { EventBus } from '../core/EventBus';
import type { GrantedReward } from '../core/items/loot/GrantedReward';
import type { RewardPresentation } from '../loot/rewardChest';
import { drawMongoIcon } from '../sprites/mongoSprite';
import { iconSquare } from '../ui/icons/iconSquare';
import type { MenusKit } from './kits/MenusKit';
import type { MongoSystem } from './MongoSystem';

const MONGO_REWARD_DESCRIPTION = `A loyal velociraptor companion. Summon ${MONGO_DEF.name} to fight alongside ${crawlerName('cat')} in battle!`;

/** Whether `presentation` is the chest that brought Mongo to the party. */
export function presentsMongo(presentation: RewardPresentation): boolean {
  return presentation.rewards.some((line) => line.kind === 'companion');
}

/** Mongo joins the party as the chest that brings him is opened, so he can be summoned from then on. */
export function joinMongoOnOpen(presentation: RewardPresentation, mongo: MongoSystem): void {
  if (presentsMongo(presentation)) mongo.unlocked = true;
}

/** Mongo's "New Ability!" card, drawn at the stage his current level shows. */
function mongoGrantedReward(mongoLevel: () => number): GrantedReward {
  return {
    kind: 'ability',
    name: MONGO_DEF.name,
    description: MONGO_REWARD_DESCRIPTION,
    renderIcon: (ctx, rect) => {
      const { x, y, size } = iconSquare(rect);
      const stage = getMongoStats(mongoLevel()).stage;
      drawMongoIcon(ctx, stage, x + size / 2, y + size / 2, size);
    },
  };
}

/**
 * Announces Mongo once the chest that brought him has closed, then explains
 * him after the reward cards drain. Only this first grant explains him: the
 * circus quest hands back a pet the player already knows, and the Abilities
 * tab reopens the explainer on request.
 */
export function introduceMongo(bus: EventBus, menus: MenusKit, mongoLevel: () => number): void {
  bus.emit('rewardGranted', { rewards: [mongoGrantedReward(mongoLevel)] });
  menus.rewardGrantedDialog.afterQueueDrains(() => menus.craftExplainers.open('mongo'));
}
