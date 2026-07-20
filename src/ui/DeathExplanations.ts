import { randomFromArray } from '../utils';

/**
 * All possible named causes of player death.
 * Used to key into DEATH_EXPLANATIONS for a flavor text pick.
 */
export type DeathCause =
  | 'failureToRevive'
  | 'levelTimerRanOut'
  | 'goblin'
  | 'cockroach'
  | 'hoarder'
  | 'juicer'
  | 'bugaboo'
  | 'burnedStatus'
  | 'poisonStatus'
  | 'sepsisStatus'
  | 'electrifiedStatus'
  | 'spitVenomStatus'
  | 'grotesqueSpiderSlam'
  | 'grotesqueSpiderScreech'
  | 'grotesqueSpiderSpit'
  | 'krakarenCloneSlam'
  | 'krakarenCloneRegularMelee'
  | 'ballOfSwine'
  | 'tuskling'
  | 'troglodyte'
  | 'smallSpider'
  | 'skyFowl'
  | 'llama'
  | 'rat'
  | 'brindleGrub'
  | 'cowTailedGrub'
  | 'brindledVespa'
  | 'explosiveFriendlyFire'
  | 'doomsdayExplosion'
  | 'unknown';

export const DEATH_EXPLANATIONS: Record<DeathCause, readonly string[]> = {
  failureToRevive: [
    'You failed to revive your companion in time.',
    'Next time, revive your companion faster.',
  ],
  levelTimerRanOut: [
    'You stayed on the floor too long. The level collapse took its toll.',
    'The level collapse got you. You need to find the stairs faster.',
  ],
  goblin: [
    'You were clubbed to death by a goblin. Gruesome.',
    'A Goblin caved your chest in.',
    'A Goblin smashed your head in.',
    'You were killed by a 3 ft tall goblin. How embarrassing.',
  ],
  cockroach: [
    'You died by a cockroach. That is the dumbest way to die in this dungeon.',
    'The cockroach swarm was too much for you.',
  ],
  hoarder: [
    "You burned in a pool of the Hoarder's acid vomit.",
    'The Hoarder, the easiest boss in the dungeon, managed to kill you.',
    "You were corroded by vomit. I bet you won't stand in that again.",
  ],
  juicer: [
    'You took a dumbbell to the face. That went as well as you might expect.',
    'The Juicer absolutely crushed you.',
    'Oof. The Juicer collapsed your windpipe with a thrown dumbbell.',
  ],
  bugaboo: [
    'A Bugaboo swarmed you to death. Hard to dodge what you cannot see.',
    'The Bugaboo overwhelmed you. Watch for the swarm.',
    'You were killed by a Bugaboo. Maybe avoid the dark corners next time.',
  ],
  burnedStatus: [
    'You stood in the flames just a little too long.',
    'The fire eventually took you. Learn to step out of burning ground.',
    "You burned to death. Maybe don't stand in fire next time.",
  ],
  poisonStatus: [
    'The poison in your veins finally claimed you.',
    'Slow, ugly, and green. Poison got you.',
    'You died of poisoning. Troglodytes will do that to you.',
  ],
  sepsisStatus: [
    'Sepsis finally claimed you. Should have cleared that infection sooner.',
    'You died of sepsis. The crown giveth, the crown taketh.',
    'That crown-inflicted infection festered until it killed you. Maybe reconsider your gear.',
  ],
  electrifiedStatus: [
    'The electricity finally arced through your heart.',
    'You were electrocuted by a lingering charge. Move faster next time.',
    'Zapped. The electrified status finished you off.',
  ],
  spitVenomStatus: [
    'Spider venom dissolved you from the inside. Should have cleared that debuff.',
    'The spit venom worked its way through you. Disgusting way to go.',
    'You died to venom. Keep the poison off next time.',
  ],
  grotesqueSpiderSlam: [
    'You were crushed under the legs of a mutant spider. Maybe get out of the red zone next time...',
    "You did not get out of the beast's legs in time. Next time, get out of the red area.",
    'Crunch. The giant spider thing slammed you into the ground. Take the hint and avoid red ground areas.',
  ],
  grotesqueSpiderScreech: [
    'Your head literally exploded from the mutant spider screech. Avoid the red areas next time.',
    'Your mind was melted by the screech of the creature. Next time, step away and out of the red warning area to survive.',
    'You were killed by a screech so loud your organs ruptured. Step out of the red zones to avoid this fate next time...',
  ],
  grotesqueSpiderSpit: [
    'Acid from the mutant spider dissolved your armor and then you.',
    "The spider's spit projectile caught you. Keep moving to dodge them.",
    "You were dissolved by the grotesque spider's acid spit. Hard to come back from that.",
  ],
  krakarenCloneSlam: [
    "You were crushed under the Krakaren's falling appendage. Don't stand in the shadow.",
    "The Krakaren's slam reduced you to paste. The shadow on the ground was right there.",
    'The Krakaren Clone smashed you flat. The dark zone on the floor was not decoration.',
  ],
  krakarenCloneRegularMelee: [
    'A Krakaren Clone beat you to death with its tentacles.',
    "You were shredded by the Krakaren's tentacles. It happens.",
    'The Krakaren Clone tore you apart.',
  ],
  ballOfSwine: [
    'The Ball of Swine ran you down at full speed. Try placing gym barriers next time.',
    'You were flattened by a giant rolling pig monster. Of all the ways to go...',
    "The Ball of Swine made contact while zooming. That'll do it every time.",
  ],
  tuskling: [
    "A Tuskling gored you. They're dazed, not dead.",
    "One of the Ball of Swine's piglets killed you. Embarrassing.",
    'A pig monster killed you. Let that sink in.',
  ],
  troglodyte: [
    "A Troglodyte's tongue lashed you to death.",
    "Poisoned and stabbed by a cave lizard's tongue. Watch the windup next time.",
    "The Troglodyte's tongue struck true. Keep moving to avoid it.",
  ],
  smallSpider: [
    "A spider killed you. That's not anyone's preferred way to go.",
    "The spider's bite quickly liquified your organs.",
    '8-legged death came for you. Spiders are not your friend.',
  ],
  skyFowl: [
    "A Sky Fowl's talons finished you off.",
    'You were killed by a dungeon bird.',
    "The Sky Fowl's talons found you at the worst possible moment.",
  ],
  llama: [
    'A Llama spat a lava ball right into your face.',
    'You were killed by a llama. A llama.',
    "The llama's lava wore through your defenses. You had it coming.",
  ],
  rat: [
    'A rat gnawed through your ankles until you dropped.',
    "You were killed by a rat. That's the dungeon for you.",
    "Rats. Just... rats. That's what killed you.",
  ],
  brindleGrub: [
    'A harmless-looking worm bit through your ankle. Embarrassing.',
    'Stage one. A stage-one grub. That is what got you.',
    'The larva finished you off before it even evolved. Brutal.',
  ],
  cowTailedGrub: [
    'A Cow-Tailed Grub bit you to death. Slow and shameful.',
    "The grub's mandibles found every gap in your armor.",
    'You were killed by a larva. A literal larva.',
  ],
  brindledVespa: [
    "Brindled Vespa acid burned through you. Don't let the hornets swarm.",
    'A giant dungeon hornet dissolved you with acid spit.',
    "The Vespa's acid found you at full stack. Pop those spits early next time.",
  ],
  explosiveFriendlyFire: [
    "Your own dynamite got you. That's a one-way ticket.",
    'You blew yourself up. No one else to blame here.',
    'Self-inflicted dynamite death. At least you took the blast personally.',
  ],
  doomsdayExplosion: [
    'You were standing next to a city-sized bomb.',
    'The soul crystal went off before you cleared the blast radius.',
    'The Over City came down around you. You should have run faster.',
  ],
  unknown: [
    'Something in the dungeon killed you. Better luck next time.',
    'Death came from an unexpected direction.',
    'The dungeon took you. It happens to everyone eventually.',
  ],
};

/** Pick a random explanation string for the given death cause. */
export function pickDeathExplanation(cause: DeathCause): string {
  const options = DEATH_EXPLANATIONS[cause];
  if (options.length === 0) return '';
  return randomFromArray([...options]);
}
