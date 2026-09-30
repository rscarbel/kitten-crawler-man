/**
 * Checks for `verify:borrowed-blueprints` that nothing on the party's side can
 * hurt Midge while she is on the escort, and that the road's hostiles still can:
 *
 * - every weapon kind a crawler swings, throws or casts is refused at the
 *   attack sites' friendly-fire gate (`takesPlayerDamage`) and at the door;
 * - both crawlers, Mongo, a hireling's credited blow, a turned thrall, an
 *   allied mob's own swing, dynamite, trebuchet shrapnel and every status the
 *   party lays leave her bar where it was;
 * - no party targeting may pick her: she is not hostile, not the pet's prey,
 *   and cannot be turned;
 * - a hostile's blow, its thrown or standing harm, and a status it laid all
 *   still land.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { makeBurn, makePoison } from '../../src/core/StatusEffect';
import { Cow } from '../../src/creatures/Cow';
import { Goblin } from '../../src/creatures/Goblin';
import { Mongo } from '../../src/creatures/Mongo';
import type { Mob, PlayerDamageType } from '../../src/creatures/Mob';
import type { DamageSource, Player } from '../../src/Player';
import { merritGateTile } from '../../src/systems/briarHollow/blueprints/escortRoute';
import { MIDGE_COAT } from '../../src/systems/briarHollow/LivestockSystem';
import { standAt } from '../villageSiegeHarness';
import { blueprintsRig } from './fence';
import type { Check } from './fenna';

/** Updates for Midge to answer the party at Merrit's gate and go on the lead. */
const PICKUP_UPDATES = 30;
/** A blow well inside her escort bar, so no probe beats her down on its own. */
const PROBE_DAMAGE = 10;
/** Long enough for every damage-over-time status to tick several times. */
const STATUS_TICK_UPDATES = 600;
const MONGO_LEVEL = 5;
const MONGO_HP = 100;
/** Enough swings that a dodge roll cannot stop every one. */
const SWINGS_TO_LAND_ONE = 20;

const EVERY_PARTY_WEAPON: readonly PlayerDamageType[] = [
  'melee',
  'missile',
  'shell',
  'smush',
  'explosion',
  'slingshot',
];

/**
 * A mob on the party's side landing its own swing, the way a village soldier
 * or any other ally that is not a turned enemy does: through `dealDamage`,
 * which carries only a `mob` source and no attacker.
 */
class AlliedSwinger extends Cow {
  swingAt(target: Player): boolean {
    return this.dealDamage(target, PROBE_DAMAGE);
  }
}

/** A hostile landing a swing, the ambushers' own route. */
class HostileSwinger extends Goblin {
  swingAt(target: Player): boolean {
    return this.dealDamage(target, PROBE_DAMAGE);
  }

  /** Swings until one connects, since Midge may sidestep any single swing. */
  landSwingOn(target: Player): void {
    for (let swing = 0; swing < SWINGS_TO_LAND_ONE; swing++) {
      if (this.swingAt(target)) return;
    }
  }
}

interface Probe {
  readonly name: string;
  readonly hit: (midge: Cow) => void;
}

function tickStatuses(midge: Cow): void {
  for (let update = 0; update < STATUS_TICK_UPDATES; update++) midge.tickTimers();
}

function restore(midge: Cow): void {
  midge.statusEffects = [];
  midge.hp = midge.maxHp;
}

/** The damage `hit` did to a whole Midge, her bar and her statuses put back afterwards. */
function damageFrom(midge: Cow, hit: (midge: Cow) => void): number {
  restore(midge);
  const before = midge.hp;
  hit(midge);
  const dealt = before - midge.hp;
  restore(midge);
  return dealt;
}

export function verifyMidgeFriendlyFire(check: Check): void {
  const { rig, blueprints } = blueprintsRig('escort_midge');
  const gate = merritGateTile(rig.site);
  if (gate === null) {
    check(false, "the rig map has Merrit's gate");
    rig.dispose();
    return;
  }
  standAt(rig.human, gate.x, gate.y);
  standAt(rig.cat, gate.x, gate.y);
  for (let update = 0; update < PICKUP_UPDATES; update++) rig.step();
  const midge = blueprints.escort.midge;
  check(
    midge !== null && blueprints.escort.isEscorting,
    'Midge is on the lead for the escort at the gate',
  );
  if (midge === null) {
    rig.dispose();
    return;
  }

  const { human, cat } = rig;
  const mongo = new Mongo(gate.x, gate.y, TILE_SIZE, cat, MONGO_LEVEL, MONGO_HP);
  const thrall = new Goblin(gate.x, gate.y, TILE_SIZE, 'sword');
  thrall.convertToAlly(human);
  const ally = new AlliedSwinger(gate.x, gate.y, TILE_SIZE, MIDGE_COAT, 'adult');
  const hostile = new HostileSwinger(gate.x, gate.y, TILE_SIZE, 'axe');
  const siegeShrapnel: DamageSource = { kind: 'siege', dodgeable: false };

  const partyProbes: Probe[] = [];
  for (const crawler of [human, cat]) {
    for (const weapon of EVERY_PARTY_WEAPON) {
      partyProbes.push({
        name: `the ${crawler === human ? 'human' : 'cat'}'s ${weapon}`,
        hit: (target) => target.takeDamageFrom(PROBE_DAMAGE, crawler, weapon),
      });
    }
    partyProbes.push({
      name: `a burn the ${crawler === human ? 'human' : 'cat'} laid`,
      hit: (target) => {
        target.applyStatus(makeBurn(crawler));
        tickStatuses(target);
      },
    });
    partyProbes.push({
      name: `a status tick the ${crawler === human ? 'human' : 'cat'} applied`,
      hit: (target) =>
        target.takeDamage(PROBE_DAMAGE, { kind: 'status', effectType: 'poison', applier: crawler }),
    });
  }
  const mobDealers: ReadonlyArray<{ readonly name: string; readonly body: Mob }> = [
    { name: 'Mongo', body: mongo },
    { name: 'a turned thrall', body: thrall },
    { name: 'an allied mob', body: ally },
  ];
  for (const { name, body } of mobDealers) {
    partyProbes.push({
      name: `${name}'s blow`,
      hit: (target) => target.takeDamageFrom(PROBE_DAMAGE, body, 'melee'),
    });
    partyProbes.push({
      name: `${name}'s unnamed blow`,
      hit: (target) => target.takeDamageFrom(PROBE_DAMAGE, body, null),
    });
    partyProbes.push({
      name: `a hireling blow ${name} struck for the human`,
      hit: (target) => target.takeCreditedDamage(PROBE_DAMAGE, human, 'melee', body),
    });
    partyProbes.push({
      name: `poison ${name} laid`,
      hit: (target) => {
        target.applyStatus(makePoison(body));
        tickStatuses(target);
      },
    });
  }
  partyProbes.push(
    {
      name: 'an allied mob swinging through its own attack',
      hit: (target) => ally.swingAt(target),
    },
    {
      name: 'dynamite the party lit',
      hit: (target) => target.takeDamage(PROBE_DAMAGE, { kind: 'dynamite' }),
    },
    {
      name: "the party's trebuchet shrapnel",
      hit: (target) => target.takeDamage(PROBE_DAMAGE, siegeShrapnel),
    },
    {
      name: "a trebuchet boulder's credited splash",
      hit: (target) => target.takeCreditedDamage(PROBE_DAMAGE, human, null, null),
    },
  );

  for (const probe of partyProbes) {
    const dealt = damageFrom(midge, probe.hit);
    check(dealt === 0, `${probe.name} does Midge no harm (dealt ${dealt})`);
  }

  const openGates = EVERY_PARTY_WEAPON.filter((weapon) => midge.takesPlayerDamage(weapon));
  check(
    openGates.length === 0,
    `every attack site's friendly-fire gate refuses her (open to: ${openGates.join(', ') || 'none'})`,
  );
  check(
    !midge.isHostile && !midge.isPetAttackable && !midge.canBeConverted(),
    'no party targeting can pick her: not hostile, not the pet’s prey, not convertible',
  );

  const hostileProbes: Probe[] = [
    {
      name: "an ambusher's swing",
      hit: (target) => hostile.landSwingOn(target),
    },
    {
      name: "an ambusher's credited blow",
      hit: (target) => target.takeDamageFrom(PROBE_DAMAGE, hostile, null),
    },
    {
      name: "an ambusher's thrown harm",
      hit: (target) =>
        target.takeDamage(PROBE_DAMAGE, {
          kind: 'mob',
          mobType: hostile.mobType,
          undodgeable: true,
        }),
    },
    {
      name: 'a burn an ambusher laid',
      hit: (target) => {
        target.applyStatus(makeBurn(hostile));
        tickStatuses(target);
      },
    },
  ];
  for (const probe of hostileProbes) {
    const dealt = damageFrom(midge, probe.hit);
    check(dealt > 0, `${probe.name} still hurts Midge (dealt ${dealt})`);
  }

  rig.step();
  check(
    blueprints.escort.isEscorting,
    'after every probe she is still on the lead, not scared home',
  );
  mongo.dispose();
  thrall.dispose();
  ally.dispose();
  hostile.dispose();
  rig.dispose();
}
