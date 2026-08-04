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
  | 'ballOfSwineStench'
  | 'tuskling'
  | 'troglodyte'
  | 'smallSpider'
  | 'skyFowl'
  | 'llama'
  | 'rat'
  | 'brindleGrub'
  | 'cowTailedGrub'
  | 'brindledVespa'
  | 'ruinsGhoul'
  | 'krasue'
  | 'circusLemur'
  | 'stiltClown'
  | 'fatClown'
  | 'terrorTheClown'
  | 'evilClown'
  | 'evilClownVial'
  | 'mantid'
  | 'mantidFlurry'
  | 'darkKnight'
  | 'darkKnightSlam'
  | 'darkKnightSweep'
  | 'darkKnightBolt'
  | 'skeletonLord'
  | 'skeletonLordHands'
  | 'skeletonWarrior'
  | 'skeletonArcher'
  | 'rockGolem'
  | 'rockGolemRoll'
  | 'rockGolemRock'
  | 'mantis'
  | 'ringmasterGrimaldi'
  | 'moldLion'
  | 'cityElfCultist'
  | 'heatherTheBear'
  | 'missQuill'
  | 'burningTree'
  | 'lavaFlames'
  | 'clownGas'
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
  burningTree: [
    'You stood against a burning tree until it finished the job.',
    'The tree was on fire. You were standing in it. These facts are related.',
    'Burned alive by a tree you set light to. Poetic, in a way.',
  ],
  lavaFlames: [
    'You stood in a pool of burning llama spit until it burned through you.',
    'The lava the llama spat was still there. So, briefly, were you.',
    'Killed by the puddle rather than the shot. The floor was the trap.',
  ],
  evilClown: [
    'The Evil Clown backhanded you across the wilderness. He did not stop grinning.',
    'A clown three tiles tall reached further than you thought he could.',
    'You were beaten to death by a clown. The grin was the last thing you saw.',
  ],
  mantid: [
    'The Mantid folded you in half with one arm and went back to waiting.',
    'A praying mantis the size of a horse reached out once. Once was enough.',
    'You were within reach of the arms. That was the whole mistake.',
  ],
  darkKnight: [
    'A gauntlet the size of your head found you while you were watching the mace.',
    'The Dark Knight punched you. There is no dodging a punch from a man in plate.',
    "You stood in arm's reach of a knight between his swings. That was the whole mistake.",
  ],
  darkKnightSlam: [
    'The red circle was on the ground for a full second. You were still standing in it.',
    'The mace came down where you were, not where you went. You did not go.',
    'A knight buried a mace in the earth. You were between it and the earth.',
  ],
  darkKnightSweep: [
    'He whirled the mace and you were inside the ring. Backing up was the answer.',
    'The circle around him was the warning. You closed instead.',
    'Swept off your feet by fifteen pounds of steel travelling in a circle.',
  ],
  darkKnightBolt: [
    'He raised the mace and the green fire came off it. Standing still was the mistake.',
    'Six bolts, two a second. You only had to cross the line of one of them.',
    'You backed out of his reach. He had already stopped needing it.',
  ],
  mantidFlurry: [
    'You stood in the flurry. The Mantid does not stop for three seconds.',
    'The exclamation mark was the warning. You spent it swinging at a wall of chitin.',
    'Cut apart by two arms moving faster than you could count. You had a second to run.',
  ],
  skeletonLord: [
    'A green bolt out of a dead man\u2019s hand. It found you across the whole clearing.',
    'The Skeleton Lord killed you from range, which is where he always intended to be.',
    'Witch-light in the ribs, and then none in yours.',
  ],
  skeletonLordHands: [
    'The ground opened in a cone and every hand in it wanted you.',
    'You saw the red wedge and stood in it. They held you while they finished.',
    'Dragged down by hands that came up through the dirt. Out of the cone was the answer.',
  ],
  skeletonWarrior: [
    'A skeleton with a notched sword and nothing to lose finished you.',
    'Killed by a thing that climbed out of the ground about a minute ago.',
    'It has no muscle, no blood and no reason to stop. You had all three.',
  ],
  skeletonArcher: [
    'A bone arrow, from something with no eyes to aim with.',
    'The archer kept its distance the whole fight. That was the fight.',
    'Shot dead by a skeleton that never once let you reach it.',
  ],
  rockGolem: [
    'A fist the size of your chest, arriving at the speed of a landslide.',
    'The golem hit you once. Once was the plan.',
    'Crushed by something that was a hillside until it decided otherwise.',
  ],
  rockGolemRock: [
    'It picked up the landscape and threw the landscape at you.',
    'You watched it haul a boulder off the ground and stayed exactly where you were.',
    'Killed by scenery. Thrown scenery, but scenery.',
  ],
  rockGolemRoll: [
    'It curled up and rolled straight through you. Three passes; you lasted one.',
    'A boulder with intent. Getting out of its lane was the whole counterplay.',
    'Flattened. Drop something heavy in its path next time \u2014 it cannot roll over a barricade.',
  ],
  mantis: [
    'A mantis took your head off with a limb it had been holding still for an hour.',
    'It was folded up like it was praying. Then it was not.',
    'Killed by a bug. A very large, very patient bug.',
  ],
  evilClownVial: [
    'A bottle broke at your feet and the green got into you before you moved.',
    'The clown threw a vial. You did not get out from under it.',
    'Killed by the glass, not the clown. He was still juggling when you dropped.',
  ],
  clownGas: [
    "You stood in the clown's gas until your lungs gave out.",
    'The green cloud was still there. So, briefly, were you.',
    'Killed by the bottle rather than the clown. The ground was the trap.',
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
    'The Ball of Swine ran you down. It never slows down on its own — make it hit something flat.',
    'You were flattened by a giant rolling pig monster. Of all the ways to go...',
    'The Ball of Swine caught you with its momentum up. Bait it square into the wall and it has to stop.',
    'It caroms off a glancing wall without losing a thing. Lead it in head-on instead.',
    'A gym barrier drags its momentum down every time it rolls through one. Worth remembering.',
  ],
  ballOfSwineStench: [
    'The Ball of Swine burst against the wall and the stench did the rest. Do not stand where it lands.',
    'Sewage and rotten meat, at pressure. You were far too close to that impact.',
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
  ruinsGhoul: [
    'A Ruins Ghoul tore you apart. It used to be a person, if that helps.',
    'You were killed by a shambling former citizen of the Over City.',
    'The ghoul got its hands on you. There was not much left after that.',
  ],
  krasue: [
    'A floating head with its guts still attached ate you. Welcome to the Over City.',
    'The Krasue drifted in and finished you off. They are hard to pin down.',
    'You were killed by a Krasue. Flying entrails are a genuine threat here.',
  ],
  circusLemur: [
    'A circus lemur put a thrown knife through you. The act still holds up.',
    'You were killed by a knife-throwing lemur. Nobody is going to believe that.',
    'The Former Circus Lemur landed its blade. Keep out of its throwing lane.',
  ],
  stiltClown: [
    'A Stilt Clown stomped down on you from above.',
    'You were killed by a clown on stilts. That is the whole sentence.',
    'The Stilt Clown reached further than you thought it could. They always do.',
  ],
  fatClown: [
    'A Fat Clown slammed its bulk into you and that was that.',
    'You were flattened by a bloated circus performer.',
    'The Fat Clown body-checked you into the afterlife.',
  ],
  terrorTheClown: [
    'Terror the Clown caved you in with an oversized mallet.',
    "You took Terror's mallet head-on. Try not to be there when it swings.",
    "Terror the Clown finished you off. Grimaldi's favorite is not for beginners.",
  ],
  ringmasterGrimaldi: [
    'Grimaldi the Pestiferous Vine crushed you against the big top pole.',
    'What is left of Redstone Grimaldi wrapped you up and squeezed.',
    'The Ringmaster killed you. He is a vine now, and he is still running the show.',
  ],
  moldLion: [
    'A Mold Lion mauled you. Its mane is fungus, and now so are you.',
    'You were killed by a lion made mostly of toxic mold. Unlucky.',
    'The Mold Lion got its claws in. Keep your distance from that mane.',
  ],
  cityElfCultist: [
    'A soul bolt from a City Elf Cultist burned a hole through you.',
    'The cultist offered you to the angels above. They accepted.',
    'You were killed by harvested soul-stuff. Break line of sight on those casters.',
  ],
  heatherTheBear: [
    'Heather the Bear opened you up with one paw swipe.',
    'The crowds adored her once. She just killed you.',
    'You were mauled by Heather. Whatever is wearing her skin does not pull punches.',
  ],
  missQuill: [
    'Miss Quill put a soul bolt through you without losing her composure.',
    'The town schoolteacher killed you. Every krasue in the city was her work too.',
    'Miss Quill finished the lesson. Interrupt her casting next time.',
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
