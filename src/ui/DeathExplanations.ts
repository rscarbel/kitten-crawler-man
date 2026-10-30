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
  | 'trashGremlin'
  | 'bigRooster'
  | 'bigRoosterSlam'
  | 'bigRoosterClub'
  | 'bigRoosterPlateRoll'
  | 'bigRoosterKettlebell'
  | 'bigRoosterExerciseBall'
  | 'roosterPeck'
  | 'roosterPunch'
  | 'fuzzyNightmare'
  | 'burnedStatus'
  | 'poisonStatus'
  | 'electrifiedStatus'
  | 'spitVenomStatus'
  | 'grotesqueSpiderSlam'
  | 'grotesqueSpiderScreech'
  | 'grotesqueSpiderSpit'
  | 'krakenSlam'
  | 'krakenRegularMelee'
  | 'krakenTentacleStrike'
  | 'electricGoblinGrenade'
  | 'electricGoblinPuddle'
  | 'electricGoblinSwipe'
  | 'electricGoblinWave'
  | 'electricGoblinElectrified'
  | 'wereboar'
  | 'lizardman'
  | 'smallSpider'
  | 'spiderHatchling'
  | 'hawkfolk'
  | 'acidLlama'
  | 'rat'
  | 'gravediggerBeetle'
  | 'giantWasp'
  | 'ruinsGhoul'
  | 'raveling'
  | 'lemur'
  | 'tallClown'
  | 'fatClown'
  | 'massiveClown'
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
  | 'theLich'
  | 'theLichHands'
  | 'rockGolem'
  | 'rockGolemRoll'
  | 'rockGolemRock'
  | 'mantis'
  | 'lion'
  | 'elf'
  | 'direBear'
  | 'shieldFairy'
  | 'healingFairy'
  | 'necroFairy'
  | 'iceFairyBolt'
  | 'fireFairyFireball'
  | 'fireFairyBlast'
  | 'fireFairyDeathFlame'
  | 'fireFairyDeathExplosion'
  | 'goblinDynamite'
  | 'goblinBlackPowder'
  | 'frozenSolid'
  | 'burningTree'
  | 'fireballFlames'
  | 'acidPuddle'
  | 'burningOil'
  | 'clownGas'
  | 'lichFirewall'
  | 'lichOrb'
  | 'trashAvalanche'
  | 'towerWard'
  | 'towerBell'
  | 'explosiveFriendlyFire'
  | 'siegeFriendlyFire'
  | 'raisedRatkin'
  | 'graveBull'
  | 'necromancerBolt'
  | 'necromancerPulse'
  | 'sharkAttack'
  | 'unknown';

export const DEATH_EXPLANATIONS: Record<DeathCause, readonly string[]> = {
  failureToRevive: [
    'You failed to revive your companion in time.',
    'Next time, revive your companion faster.',
  ],
  levelTimerRanOut: [
    'Caroline ran out of patience before you ran out of floor.',
    'You took too long, and Caroline does not wait. Find the stairs faster.',
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
  trashGremlin: [
    "You stood in the Trash Gremlin's spit until there was less of you to stand.",
    'The Trash Gremlin, the easiest boss in the dungeon, is wearing your boots as a hat now.',
    'Its throat glowed. You saw it glow. You stayed exactly where you were.',
  ],
  bigRooster: [
    'A dumbbell came at you from across the gym. You were standing exactly where he aimed it.',
    'Big Rooster threw iron at you until you stopped getting up. He called it a set.',
    'All chest, all arms, all throw. You lost the argument at range.',
  ],
  bigRoosterSlam: [
    'Both fists came down over his comb and the floor came up under you.',
    'The chalk ring was a suggestion to leave. You stayed for the shockwave.',
  ],
  bigRoosterClub: [
    'You got close to the rooster holding a dumbbell. He used it the way a dumbbell is not meant to be used.',
    'One wide swing, one cracked crawler. Nobody spots you in this gym.',
    'He raised the weight high behind his shoulder first. That was your cue.',
  ],
  bigRoosterPlateRoll: [
    'He bowled a plate down a chalk lane and you stood in the lane.',
    'Flattened by a rolling bumper plate. The line on the floor was the part where you move.',
    'Big Rooster rolled iron at your ankles and called it cardio.',
  ],
  bigRoosterKettlebell: [
    'A shadow grew under your feet and you let it finish growing.',
    'It rained kettlebells. You did not find the dry spot.',
    'Somewhere above the gym a kettlebell picked you. You should have picked a different tile.',
  ],
  bigRoosterExerciseBall: [
    'Run over by an exercise ball. It was rolling the whole time; so was your luck.',
    'A ball the size of a crawler came off the wall and through you.',
    'He kicked the balls loose and you stood in the way of one. Core workout.',
  ],
  roosterPeck: [
    'Pecked to death. By a rooster. In a gym.',
    'A beak found the soft spot every time. You had several.',
    'The neck drew back before each peck. You watched it happen anyway.',
  ],
  roosterPunch: [
    'A rooster threw a straight right and you caught it with your face.',
    'Small bird, big arms, one clean punch. Do not tell anyone.',
    'He leads with the fist, not the beak. You learned that last.',
  ],
  fuzzyNightmare: [
    'The thing under the bed got you. You never did check under there.',
    'Those arms reach a lot further than they look. Stay clear of the long rake.',
    'A Fuzzy Nightmare came up through the floor and raked you open. Board the grates sooner.',
  ],
  burningTree: [
    'You stood against a burning tree until it finished the job.',
    'The tree was on fire. You were standing in it. These facts are related.',
    'Burned alive by a tree you set light to. Poetic, in a way.',
  ],
  burningOil: [
    'You stood in a pool of burning oil. The drum said flammable for a reason.',
    'Someone set the oil alight. You stayed to watch it burn, from the inside.',
    'The spill was on fire. So, then, were you.',
  ],
  fireballFlames: [
    'You stood in the fire a fireball left behind until it burned through you.',
    'The fireball missed. The patch of fire it left did not.',
    'Killed by the flames on the floor rather than the shot. The floor was the trap.',
  ],
  acidPuddle: [
    'You stood in a puddle of acid until there was not enough of you left to stand.',
    'The glob missed. The puddle it left ate through your boots, then the rest of you.',
    'Killed by the puddle rather than the shot. Acid on the floor is still acid.',
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
  theLich: [
    'A green bolt from the top of the tower. The Warden does not come down to its callers.',
    'The Lich killed you at arm’s length, which is how it has run this town for years.',
    'You climbed the whole tower to be struck from a chair that never moved.',
  ],
  theLichHands: [
    'The tower floor opened in a wedge and every hand in it had a grip on you.',
    'The red cone was the notice. You did not file a response, so the hands did.',
    'Held down by the dead while the thing in the robes watched. Out of the cone was the answer.',
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
  lichFirewall: [
    'The wall of fire crossed the room and you were not in the gap.',
    'There was one way through it. You were standing everywhere else.',
    'The top of the tower burned you down. The Warden did not stand up to watch.',
  ],
  lichOrb: [
    'A green light landed on the floor you were standing on. You had been warned.',
    'The circle was on the ground for a reason. You were still inside it.',
    'The Lich rained soul-fire on the room and one of them found you.',
  ],
  towerWard: [
    'The ward line was lit when you stepped into it. The cat could have told you when.',
    'Water-borne light, the archivist called it. It burned like any other kind.',
  ],
  towerBell: [
    'A bell the size of a cart swung through the beam you were standing on.',
    'You were on the beam when the bell came back. It always comes back on the beat.',
  ],
  trashAvalanche: [
    'A tower of garbage came down on you. The Trash Gremlin calls that redecorating.',
    'Buried under a landslide of tin cans and wet cardboard. The tower wobbled first. You watched it wobble.',
    'Flattened by trash. The roaches will be moving into you by morning.',
  ],
  electricGoblinGrenade: [
    'A shock grenade landed in the ring it had been drawing under you the whole way down.',
    'The Current Goblin lobbed one at you specifically. The circle on the floor was your name tag.',
    'Grenade, ring, zap. You had the whole flight to take one step.',
  ],
  electricGoblinPuddle: [
    'He raised both rods, the puddle lit up, and you were still standing in it when he plunged them in.',
    'Cooked in a puddle. His boots are rubber. Yours, it turns out, are not.',
    'The water crackled for a good long while first. Puddles are for stepping out of.',
  ],
  electricGoblinSwipe: [
    'You got close enough to hug the Current Goblin, and he swatted you across the lab with a live rod.',
    'Shocked off your feet by a rod to the chest. Close range was his idea, not yours.',
  ],
  electricGoblinWave: [
    'A wave of current ran straight down the floor at you. One step sideways and it would have missed.',
    'He slammed his rods and the floor came for you in a straight line. You stayed on the line.',
    "You tried to outrun the slam wave. It runs faster than you do. That's why you step aside.",
  ],
  electricGoblinElectrified: [
    'The grenade only stung. Then the current in you kept seizing you until there was nothing left to seize.',
    'Still buzzing from his grenade, you locked up one last time and did not unlock.',
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
    "You died of poisoning. A Lizardman's tongue will do that to you.",
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
    'When the red fills to its outline, it lands. Be outside the line.',
    'Her legs came down the moment the red cone filled. When the outline goes solid, step out of it.',
    'Crunch. The cone was full and you were still in it. Get out while the red is still growing.',
  ],
  grotesqueSpiderScreech: [
    'When the red fills to its outline, it lands. Be outside the line.',
    'The circle filled from her body to its edge, and then she screamed. Be past the outline before it fills.',
    'Your organs ruptured the instant the red reached the ring. Once the outline goes solid, it is too late to be inside it.',
  ],
  grotesqueSpiderSpit: [
    'The aim line froze, then the glob flew down it. Step sideways off the line when it stops tracking you.',
    'Once her aim line locks it cannot follow you. Sidestep it; running straight back only keeps you on it.',
    "You were dissolved by acid that flew exactly where the frozen line pointed. Don't stand on the line.",
  ],
  krakenSlam: [
    "The Kraken's slam took a big piece out of you, and you didn't have a big piece left. Step off the red before it lands.",
    'One slam is a hard hit, not a death. You took it hurt. Heal up before the red comes for you, or be somewhere else.',
    'The tentacle came down on the red patch, and you were standing in it with too little health to spare. Red floor means move.',
  ],
  krakenRegularMelee: [
    'The Kraken beat you to death with its tentacles.',
    "You were shredded by the Kraken's tentacles. It happens.",
    'The Kraken tore you apart.',
  ],
  krakenTentacleStrike: [
    'A guard tentacle swatted you flat while you were watching the big one. The little ones hit too.',
    'You died to the small tentacle beside you, not the boss in front of you. Cut them down first.',
    'The guard tentacle whipped down where you were standing. It reared for half a second before it did.',
  ],
  wereboar: [
    'A Wereboar gored you. Step aside from the charge and it runs out of room.',
    'Steel only half bit it, and the blast never touched it. Magic would have.',
    "A man with a boar's head killed you. Let that sink in.",
  ],
  lizardman: [
    "A Lizardman's barbed tongue lashed you to death from three tiles out.",
    'The Lizardman gaped, aimed and struck. Step off its line while the mouth is opening.',
    'Speared by a venomous tongue. A Lizardman commits to its aim before it strikes, so keep moving.',
  ],
  smallSpider: [
    "A spider killed you. That's not anyone's preferred way to go.",
    "The spider's bite quickly liquified your organs.",
    '8-legged death came for you. Spiders are not your friend.',
  ],
  spiderHatchling: ['A spider egg hatched. Smash eggs before they crack open.'],
  hawkfolk: [
    "A Hawkfolk's talons finished you off.",
    'You were killed by a dungeon bird.',
    "The Hawkfolk's talons found you at the worst possible moment.",
  ],
  acidLlama: [
    'An Acid Llama hawked a glob of acid right into your face.',
    'You were killed by a llama. A llama that spits acid, but still a llama.',
    "The llama's acid ate through your defenses. You had it coming.",
  ],
  rat: [
    'A rat gnawed through your ankles until you dropped.',
    "You were killed by a rat. That's the dungeon for you.",
    "Rats. Just... rats. That's what killed you.",
  ],
  gravediggerBeetle: [
    'A Gravedigger Beetle sheared through you. It was a larva a minute ago.',
    'Fire from range, mandibles up close. The beetle had an answer for everything.',
    'You let the pupa hatch. Next time, crack it while it is still a sac.',
  ],
  giantWasp: [
    'A Giant Wasp stung you one time too many. They come in swarms near the trees.',
    'Wasp venom from the branches, then a stinger up close. You got both.',
    'You walked under the forest edge and the wasps took it personally.',
  ],
  ruinsGhoul: [
    'A Ruins Ghoul tore you apart. It used to be a person, if that helps.',
    'You were killed by a shambling former citizen of Taloncrest.',
    'The ghoul got its hands on you. There was not much left after that.',
  ],
  raveling: [
    'A floating head with its guts still attached ate you. Welcome to Taloncrest.',
    'A Raveling drifted in and finished you off. Ravelings are hard to pin down.',
    'You were killed by a Raveling. Flying entrails are a genuine threat here.',
  ],
  lemur: [
    'A lemur put a thrown knife through you. The act still holds up.',
    'You were killed by a knife-throwing lemur. Nobody is going to believe that.',
    'The Lemur landed its blade. Keep out of its throwing lane.',
  ],
  tallClown: [
    'A Tall Clown stomped down on you from above.',
    'You were killed by a clown on stilts. That is the whole sentence.',
    'The Tall Clown reached further than you thought it could. They always do.',
  ],
  fatClown: [
    'A Fat Clown slammed its bulk into you and that was that.',
    'You were flattened by a bloated circus performer.',
    'The Fat Clown body-checked you into the afterlife.',
  ],
  massiveClown: [
    'The Massive Clown caved you in with an oversized mallet.',
    "You took the Massive Clown's mallet head-on. Try not to be there when it swings.",
    'The Massive Clown finished you off. It got faster once you had it hurt, and you did not.',
  ],
  lion: [
    'A lion ran you down in the long grass and bit.',
    'You were killed by a lion. It covered the open ground faster than you did.',
    'The lion got its teeth in. Out in the open there is nowhere to hide from one.',
  ],
  elf: [
    'A bolt of cold fire from an elf burned a hole through you.',
    'An elf burned you as an offering, hoping Caroline would finally notice.',
    "You were killed by an elf's cold fire. Break line of sight on those casters.",
  ],
  direBear: [
    'A Dire Bear opened you up with one paw swipe.',
    'You were mauled by a Dire Bear. When it rears up, step back.',
    'The Dire Bear brought its paw down on you. It gave you plenty of warning.',
  ],
  shieldFairy: [
    'A blue fairy was still handing out wards when the fight killed you. Kill the fairy, drop the shields.',
    'Something you were already hitting was warded by a fairy you never bothered to look for.',
    'You never found the thing painting hexagons on your target. It kept doing it until you died.',
  ],
  healingFairy: [
    'A green fairy kept topping off the thing you were fighting. You never got around to her.',
    'You out-damaged the healer right up until you did not. She was the easier kill.',
    'The fairy healing your target outlasted your patience. She should have died first.',
  ],
  necroFairy: [
    'A black fairy raised the thing you had just killed. It killed you the second time.',
    'You cleared the room and a fairy un-cleared it. That one was on you.',
    'Something you had already put down got up again, courtesy of a necro fairy you left alive.',
  ],
  iceFairyBolt: [
    'A white fairy fired an ice bolt at where you stood. It is slower than you. You stood still.',
    'The ice bolt flies dead straight and never turns. One step sideways and it sails past.',
    'You took a fairy’s ice bolt to the face. You watched it cross the room to get there.',
  ],
  fireFairyFireball: [
    'A red fairy dropped a fireball on the exact spot you were standing when she threw it.',
    'The reticle was under your feet before it landed. You had time to not be there.',
    'You ate a fairy-thrown fireball. The red dot on the ground was not decorative.',
  ],
  fireFairyBlast: [
    'The fireball missed, sat there fizzing, and you stood on it until it went off.',
    'A landed charge fills its red circle before it blows. You watched it fill.',
    'The fairy already missed you once. The ground she missed onto did not.',
  ],
  fireFairyDeathFlame: [
    'The fire fairy died and left a patch of flame behind. You never stepped out of it.',
    'Killing the fairy did not put out what she left burning under you.',
    'She was already dead. The flame patch she dropped was not.',
  ],
  fireFairyDeathExplosion: [
    'A fire fairy went out with a bang, on a delay, and you were still standing over the ashes.',
    'The mini-explosion had a countdown lit at the fairy’s death. You did not watch it.',
    'You killed the fire fairy. The fairy killed you back, a few seconds later.',
  ],
  goblinDynamite: [
    'A goblin threw a lit stick at your feet. The red circle filled up. So did you, with shrapnel.',
    'The stick bounced, settled and fizzed. You had two whole seconds and spent them standing there.',
    'Dynamite has a short fuse. Shorter than your attention span, apparently.',
  ],
  goblinBlackPowder: [
    'The goblin held the bomb up and drew a red circle on you. Then it stopped drawing and threw.',
    'Black powder goes off the moment it lands. The circle you ignored was where it was going to land.',
    'No fuse on the ground, no second chance. The only warning was the circle while it aimed.',
  ],
  frozenSolid: [
    'You were encased in ice and could not so much as raise a hand while it finished you.',
    'Frozen solid, unable to act, while whatever was already hitting you kept hitting you.',
    'The ice fairy did not need to land another shot. You were already standing still for everyone else.',
  ],
  explosiveFriendlyFire: [
    "Your own explosive got you. That's a one-way ticket.",
    'You blew yourself up. No one else to blame here.',
    'Self-inflicted blast death. At least you took it personally.',
  ],
  raisedRatkin: [
    'One of Briar Hollow’s own dead clawed you down. It was slower than you.',
    'A raised ratkin got its claws in. They shamble; you did not have to stand there.',
  ],
  graveBull: [
    'The Grave Bull pawed the ground for a full second, then ran straight through you.',
    'It lowered its head, scraped the dirt and charged in a straight line. One step aside was enough.',
  ],
  necromancerBolt: [
    'Vordrick’s blue soul bolts flew exactly where the fan on the ground said they would.',
    'The necromancer’s volley is slower than you walk. You walked into it.',
  ],
  necromancerPulse: [
    'You stood in the lit ground between the necromancer’s staff and the wall until it went off.',
    'The Grave Pulse glows for a second and a half before it bursts. You were still in the glow.',
  ],
  siegeFriendlyFire: [
    "Flattened by your own trebuchet's shrapnel.",
    'A single chip of your own boulder was all it took. Stand clear of the landing next time.',
  ],
  sharkAttack: [
    'The fin was circling for a reason. You stepped off the raft while it was looking.',
    'Open water belongs to the shark. You were in it for one swim too many.',
    'Something with a lot of teeth came up from under you. It did not come up twice.',
    'The raft was dry and safe. The water between rafts was neither.',
  ],
  unknown: [
    'Something in the dungeon killed you. Better luck next time.',
    'Death came from an unexpected direction.',
    'The dungeon took you. It happens to everyone eventually.',
  ],
};

/**
 * Advice shown above the explanation, for the deaths whose way out is not
 * obvious from the line about what happened.
 */
const DEATH_HINTS: Readonly<Partial<Record<DeathCause, string>>> = {
  sharkAttack: 'Wait for the shark to be as far as possible before swimming to a new raft.',
};

/** What the death screen says about a death: an optional hint, then the flavour line. */
export interface DeathMessage {
  readonly hint: string | null;
  readonly explanation: string;
}

/** A death message with no hint, for a line that does not come from a {@link DeathCause}. */
export function plainDeathMessage(explanation: string): DeathMessage {
  return { hint: null, explanation };
}

/** The cause's hint, if it has one, and a random explanation for it. */
export function pickDeathMessage(cause: DeathCause): DeathMessage {
  const options = DEATH_EXPLANATIONS[cause];
  const explanation = options.length === 0 ? '' : randomFromArray([...options]);
  return { hint: DEATH_HINTS[cause] ?? null, explanation };
}
