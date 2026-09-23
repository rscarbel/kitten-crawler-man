import type { MercenaryVoiceId } from '../../core/mercenaryTemplates';

/**
 * What a hired mercenary says, and when.
 *
 * The lines are written for each character rather than lifted from anywhere:
 * the Meat Shields hires are crude, funny and a little bleak, with the cruelty
 * aimed at the dungeon and never at the player. Nothing here reaches past the
 * third floor — no later deaths, no later spells, nothing the characters have
 * not lived through yet by the time the party can hire them.
 *
 * The cat crawler is "Princess" to the two cretins, because in the books Sledge
 * is devoted to Donut and Bomo follows his lead.
 */

/**
 * The moments a hireling may speak.
 *
 * - `hired`: first appearance outside the club.
 * - `idle`: nothing hostile in range for a good while.
 * - `engage`: picked a fight (for a medic who never picks one, a hostile came close).
 * - `kill`: its own blow finished something.
 * - `low_hp`: crossed below a fraction of its health.
 * - `special`: its kit's signature move went off.
 * - `owner_hurt` / `cat_hurt`: the crawler it follows, or the cat, took a wound.
 * - `death`: last words.
 * - `talk`: the player walked up and pressed interact.
 * - `floor_end`: the floor is won and the contract with it.
 */
export type MercenaryBarkTrigger =
  | 'hired'
  | 'idle'
  | 'engage'
  | 'kill'
  | 'low_hp'
  | 'special'
  | 'owner_hurt'
  | 'cat_hurt'
  | 'death'
  | 'talk'
  | 'floor_end';

/** The two stone noises a golem can make; see `playMobAudioCues` for which cue each is. */
export type MercenaryGrunt = 'grunt' | 'frustrated';

type LinesByTrigger = Partial<Record<MercenaryBarkTrigger, readonly string[]>>;

export interface MercenaryVoice {
  /** Spoken lines. A trigger missing here is one the character is silent on. */
  readonly lines: LinesByTrigger;
  /**
   * Stage directions, drawn in italics, for a character who does not talk. Read
   * only where `lines` has nothing for the trigger.
   */
  readonly actions?: LinesByTrigger;
  /** Sounds made instead of words, read only where neither table has a line. */
  readonly grunts?: Partial<Record<MercenaryBarkTrigger, MercenaryGrunt>>;
}

/** Any two barks are at least this far apart, so a busy fight is not a wall of bubbles. */
export const BARK_MIN_GAP_FRAMES = 180;

const HIRED_BARK_COOLDOWN_FRAMES = 0;
/** Long enough that a walk across town brings one or two, not a monologue. */
const IDLE_BARK_COOLDOWN_FRAMES = 2100;
const ENGAGE_BARK_COOLDOWN_FRAMES = 720;
const KILL_BARK_COOLDOWN_FRAMES = 480;
const LOW_HP_BARK_COOLDOWN_FRAMES = 1200;
/** Specials run on their own cooldowns; this only stops a double announcement. */
const SPECIAL_BARK_COOLDOWN_FRAMES = 240;
const OWNER_HURT_BARK_COOLDOWN_FRAMES = 900;
const CAT_HURT_BARK_COOLDOWN_FRAMES = 600;
const DEATH_BARK_COOLDOWN_FRAMES = 0;
const TALK_BARK_COOLDOWN_FRAMES = 0;
const FLOOR_END_BARK_COOLDOWN_FRAMES = 0;

/** Frames before the same trigger can fire again for the same hireling. */
export const BARK_COOLDOWN_FRAMES: Readonly<Record<MercenaryBarkTrigger, number>> = {
  hired: HIRED_BARK_COOLDOWN_FRAMES,
  idle: IDLE_BARK_COOLDOWN_FRAMES,
  engage: ENGAGE_BARK_COOLDOWN_FRAMES,
  kill: KILL_BARK_COOLDOWN_FRAMES,
  low_hp: LOW_HP_BARK_COOLDOWN_FRAMES,
  special: SPECIAL_BARK_COOLDOWN_FRAMES,
  owner_hurt: OWNER_HURT_BARK_COOLDOWN_FRAMES,
  cat_hurt: CAT_HURT_BARK_COOLDOWN_FRAMES,
  death: DEATH_BARK_COOLDOWN_FRAMES,
  talk: TALK_BARK_COOLDOWN_FRAMES,
  floor_end: FLOOR_END_BARK_COOLDOWN_FRAMES,
};

/**
 * Triggers that ignore {@link BARK_MIN_GAP_FRAMES}: the player asked for `talk`
 * by walking up and pressing a key, last words that lose to a kill line two
 * seconds earlier are never heard at all, and a signature move is the one
 * moment its line is for — a finisher lands seconds into a fight, right after
 * the `engage` line that would otherwise swallow it. Each kit's special runs on
 * its own cooldown, so exempting it never makes a wall of bubbles.
 */
export const GAP_EXEMPT_TRIGGERS: ReadonlySet<MercenaryBarkTrigger> = new Set([
  'talk',
  'death',
  'special',
]);

const SLEDGE: MercenaryVoice = {
  lines: {
    hired: [
      'Sledge here. Sledge protect.',
      'Contract good. Sledge walk with you.',
      'Where Princess? Sledge go where Princess go.',
      'Sledge ready.',
    ],
    idle: [
      'Quiet. Sledge like quiet.',
      'Princess safe. Good.',
      'Bomo like this hallway. Bomo like every hallway.',
      'Sledge not bored. Sledge guarding.',
    ],
    engage: ['Bad guy. Go away now.', 'Sledge see you.', 'No.', 'Stand back. Sledge handle.'],
    kill: ['Surviving is winning.', 'Gone now.', 'Next.', 'That one done.'],
    low_hp: [
      'Sledge cracked. Sledge fine.',
      'Hurt. Still here.',
      'Rock chip. Rock grow back. Maybe.',
      'Not dead yet.',
    ],
    special: [
      'Shield. Stay inside.',
      'Sledge buy this. Worth it.',
      'Glow is good. Stand in glow.',
      'Protect.',
    ],
    owner_hurt: [
      'Hey. Stop that.',
      'Sledge saw that.',
      'Nobody hit boss.',
      'You okay? Sledge fix.',
    ],
    cat_hurt: [
      'NO touch Princess.',
      'Princess! Sledge coming.',
      'You hurt Princess. Bad idea.',
      'Princess behind Sledge. Now.',
    ],
    death: [
      'Princess... run.',
      'Sledge... tried.',
      'Tell Bomo... Sledge say bye.',
      'Keep... Princess... safe.',
    ],
    talk: [
      'Bomo say hi. Bomo not here. Still say hi.',
      'Sledge not talk much. This is most.',
      'You pay. Sledge stay. Simple.',
      'Tux is rented. Do not bleed on tux.',
    ],
    floor_end: [
      'Floor done. Contract done. Good work.',
      'Sledge go back now. Tell Princess bye.',
      'Stairs. Sledge stay. Rules.',
      'You live. Good.',
    ],
  },
};

const BOMO: MercenaryVoice = {
  lines: {
    hired: [
      'Bomo here! Bomo protect.',
      'You pick Bomo? Good pick.',
      'Bomo buy spell with own money. Now Bomo use for you.',
      'Where we go? Bomo follow.',
    ],
    idle: [
      'Where Sledgy? Bomo miss Sledgy.',
      'Sledgy say quiet is good. Bomo think quiet is boring.',
      'Bomo count steps. Bomo lose count.',
      'Bomo like club. Bomo like here also. Less music.',
    ],
    engage: ['Bomo smash.', 'Stand behind Bomo.', 'You! Stop!', 'Bomo see bad thing.'],
    kill: ['Bomo smash good.', 'Down it go.', 'Sledgy would clap.', 'Easy.'],
    low_hp: [
      'Bomo hurt... Bomo okay.',
      'Ow. Big ow.',
      'Bomo need sit down. Later.',
      'Rock crack. Not break.',
    ],
    special: [
      'Shield! Stay in shield!',
      'Bomo protect!',
      'Glow keep you. Stay in glow.',
      'Bomo spell. Bomo money. You safe.',
    ],
    owner_hurt: [
      'Hey! No hit friend!',
      'Stand behind Bomo!',
      'Bomo fix. Bomo fix.',
      'That make Bomo mad.',
    ],
    cat_hurt: [
      'Princess! No!',
      'Nobody hurt Princess. Sledgy say so.',
      'Bomo coming, Princess!',
      'Bad! Bad thing hit Princess!',
    ],
    death: [
      'Tell Sledgy... Bomo tried.',
      'Bomo... sorry.',
      'Princess... Bomo protect... little bit.',
      'Sledgy...',
    ],
    talk: [
      'He buy spell with own money. He buy for Princess protect.',
      'Sledgy best friend. Bomo best friend too. Of Sledgy.',
      'Bomo not remember name of this place. Bomo remember you.',
      'Tux itch. Rosemarie say wear tux.',
    ],
    floor_end: [
      'Floor done! Bomo go home to Sledgy.',
      'Bye bye. Bomo had good time.',
      'You live! Bomo do job good.',
      'Contract over. Bomo wave.',
    ],
  },
};

const DONG_QUIXOTE: MercenaryVoice = {
  lines: {
    hired: [
      'Dong Quixote, knight-errant, at thy service, and at thy price.',
      'A quest! Lead on, and I shall follow at a stately pace.',
      'Fear not, good crawler. Thy champion is arrived.',
      'My lance is thine until this floor is done.',
    ],
    idle: [
      'Corcunda was the most beautiful man who ever lived. I say it plainly.',
      'These halls want for a horse. As do I.',
      'Hark, how the dungeon breathes. As do I. Mostly out.',
      'I danced the Parade in my day. The crowds wept. From joy, I maintain.',
    ],
    engage: [
      'Have at thee, knave!',
      'Stand and be skewered!',
      'A foe! At last, a worthy foe!',
      'Villain! Meet the point of my conviction!',
    ],
    kill: [
      'Another foe unhorsed, and I without a horse!',
      'Yield! Ah. Too late for yielding.',
      'So fall the wicked. Someone sing of it.',
      'Corcunda, didst thou see? No. No, of course not.',
    ],
    low_hp: [
      'A scratch! A mere... a considerable scratch.',
      'I have bled worse in duels over lesser insults.',
      'My breath grows short. My resolve does not.',
      'Fetch my smelling salts! Afterwards!',
    ],
    special: ['For Corcunda!', 'CHARGE!', 'Clear the lists!', 'Lance down, heart high!'],
    owner_hurt: [
      'Unhand my patron, cur!',
      'Thou shalt answer for that blow!',
      'Courage, friend! Help rides to thee. On foot.',
      'A wound upon my patron is a wound upon mine honour!',
    ],
    cat_hurt: [
      'The fair lady is struck! Villainy!',
      'Strike a noble cat? Thou hast chosen poorly.',
      'My lady! Behind my lance!',
      'Treachery against a lady most feline!',
    ],
    death: [
      'Vale to you all. Vale.',
      'Corcunda... I come...',
      'Tell them... I fell forward.',
      'A gallant end... a most gallant... ow.',
    ],
    talk: [
      'Ask me of Corcunda. No, do. I insist.',
      'My muscles? Mine own. They merely rest between breaths.',
      'I have fought for coin before, but never for so little. It is liberating.',
      'Chivalry is not dead, friend. It is only very old.',
    ],
    floor_end: [
      'The floor is won! I take my leave, with a bow.',
      'Our contract ends, and yet our legend begins.',
      'Farewell! Remember my charge, if not my name.',
      'Back to the Parade with me. Fear not; I shall tell it well.',
    ],
  },
};

const SPLASH_ZONE: MercenaryVoice = {
  lines: {
    hired: [
      "Splash Zone! Front rows get wet, that's the deal.",
      'Lifeguard on duty! Nobody runs, everybody lives.',
      "Hey, hey! Let's make some waves.",
      'You picked the otter. Great call, honestly.',
    ],
    idle: [
      "Snail Trail's gonna love this story.",
      'No running on the wet floor. Which is every floor down here.',
      'Hydrate! Seriously, drink something.',
      'Nobody down here swims. Wasted opportunity, if you ask me.',
    ],
    engage: [
      'Whistle! Everybody out of the water!',
      'Incoming! Stay behind the rope line.',
      "Okay, pal, pool's closed.",
      'Got a live one!',
    ],
    kill: [
      "And that's a no-diving zone.",
      'Sploosh. Next!',
      "Pool's closed. Permanently.",
      "Should've read the signs, buddy.",
    ],
    low_hp: [
      'Okay, okay, lifeguard needs a lifeguard!',
      'Taking on water here!',
      "I'm good! Mostly good! Somewhat good!",
      'Somebody throw me a floatie!',
    ],
    special: [
      'Everybody out of the pool!',
      'Wave incoming! Hold your breath!',
      'Wet Spot routine, coming right up!',
      "Surf's up, suckers!",
    ],
    owner_hurt: [
      'Whoa, you okay? Stay on your feet!',
      'Buddy system! I got you!',
      'Hey! No roughhousing with my crawler!',
      'Keep your head above water!',
    ],
    cat_hurt: [
      "Kitty's hit! Cover the cat!",
      'Hey, not the cat! Never the cat!',
      'Hang in there, fuzzy!',
      'Cat overboard!',
    ],
    death: [
      'Tell Snail Trail... tell her I stuck the landing.',
      "Guess... I'm off duty.",
      'Somebody... blow the whistle...',
      "Don't... run... on the wet floor...",
    ],
    talk: [
      "My wife dances at Bitches. Snail Trail. Best in the club, don't let anybody tell you different.",
      "Crossbow's small, but so am I. We make it work.",
      'Water magic is ninety percent timing and ten percent not drowning.',
      "Rule one of lifeguarding: count heads. I'm counting yours.",
    ],
    floor_end: [
      "Floor's done! Heading home to the missus.",
      'Great swim, team. Towel off.',
      'Shift over! Stay safe out there.',
      "That's my whistle. Good luck down there!",
    ],
  },
};

const GLUTEUS_MAXX: MercenaryVoice = {
  lines: {
    hired: [
      "LET'S GOOO. Point me at something.",
      'Gluteus Maxx, baby! Maximum glute!',
      "Contract signed, pump secured, let's MOVE.",
      "Oh I am SO ready. I've been ready since breakfast.",
    ],
    idle: [
      "Is it leg day? It's always leg day.",
      "Nobody's hitting me. I hate it. I love it. I hate it.",
      "Feel that? That's my heartbeat. It's fast. Is that normal?",
      "I could do squats. Should I do squats? I'm doing squats.",
    ],
    engage: [
      "Oh, it's HAPPENING.",
      'Come here, come here, come HERE!',
      'Fresh meat! For my FISTS!',
      "Mine! That one's mine!",
    ],
    kill: [
      'DOWN! Stay down!',
      "Who's next? Anyone? ANYONE?",
      "That's cardio, baby.",
      "Feel the burn! They didn't. They're dead.",
    ],
    low_hp: [
      "I'm fine! I'm great! Is my arm supposed to do that?",
      'Pain is just weakness... leaving... quickly...',
      'More! More! Wait. Less!',
      "Blood's just sweat that's trying harder!",
    ],
    special: [
      'Game over, pal. Game. Over.',
      'Glute Crush! Glute! CRUSH!',
      'Sit DOWN.',
      'Have a seat. Forever.',
    ],
    owner_hurt: [
      "Hey! HEY! That's my paycheck!",
      'Nobody touches the client!',
      'You want some of THIS?',
      'Oh you did NOT.',
    ],
    cat_hurt: [
      'Not the kitty! NOT THE KITTY!',
      'You hit the cat? You hit the CAT?',
      'Kitty down! Rage up!',
      'That cat is a celebrity, you animal!',
    ],
    death: [
      'Worth it.',
      'Tell my glutes... they did great.',
      'Was... that... a PR?',
      'Totally... worth it.',
    ],
    talk: [
      "Rosemarie says no more uppers. Rosemarie isn't here.",
      'People say I can crush a guy with my butt. People are RIGHT.',
      'Short king. Big gauntlets. Bigger heart.',
      "Armour? I've got abs.",
    ],
    floor_end: [
      "Floor's done? Aw, I was just warming up!",
      'Good sweat, everybody. Good sweat.',
      'See ya! Stay hydrated! Stay SWOLE!',
      "That's the set. Rack it.",
    ],
  },
};

const BUCKET_BOY: MercenaryVoice = {
  lines: {
    hired: [
      "I— I'm Bucket Boy. I'll do my best. I have a bucket.",
      'You picked me? Really? Okay. Okay!',
      "I'll stay close. Very close. Is this too close?",
      "I promise I won't run away. Much.",
    ],
    idle: [
      "The others remember the old seasons. I don't. Is that bad?",
      'I used to catch coins in this bucket. Rosemarie always aimed for my eyes.',
      "Is it quiet because it's safe, or quiet because it's waiting?",
      "I'm not scared. I'm just standing behind you on purpose.",
    ],
    engage: [
      'EEEE— sorry. Sorry.',
      "Something's coming! Something's coming!",
      'Oh no. Oh no no no.',
      "Please don't look at me please don't look at me.",
    ],
    kill: [
      "Did I do that? I'm so sorry. I mean, good?",
      'Oh! It stopped!',
      'Is it... is it dead? Yay?',
      "I didn't mean— well, I did mean.",
    ],
    low_hp: [
      "I'm bleeding! Is this a lot of blood? It feels like a lot!",
      "Help! Help! I'm fine, but help!",
      'Owww... sorry. Ow.',
      "I'll fix myself in a second. After screaming.",
    ],
    special: [
      'Hold still! Hold still, please!',
      "Triage! Um, that's the spell. It's working!",
      'Here, here, let me fix it.',
      'This might sting! Sorry! Sorry!',
    ],
    owner_hurt: [
      'Oh no oh no oh no.',
      "You're hurt! I can help! Wait for me!",
      "Don't die! Please! I'm not ready!",
      'I saw that! That looked bad!',
    ],
    cat_hurt: [
      'The cat! Is she okay? Is she okay?',
      'Miss Donut! Hold on!',
      "Oh no, not her, she's famous!",
      "I'm coming, kitty! Slowly! But coming!",
    ],
    death: [
      'Did... did I help?',
      'Sorry... I dropped my bucket.',
      'Tell Rosemarie... I tried really hard.',
      "I think... I'll remember this one.",
    ],
    talk: [
      "I'm the cheapest one. That means I'm the best value! Right?",
      "My bucket is my friend. You're also my friend. Is that okay?",
      "I don't really fight. I mostly worry at things.",
      "Everybody else is braver than me. But I'm here, and they're not.",
    ],
    floor_end: [
      'We made it! We actually made it!',
      'I get to go home? Thank you. Thank you so much.',
      'I only ran away once! And I came back!',
      "Bye! Good luck! Don't die! Sorry! Bye!",
    ],
  },
};

/**
 * Meat Shields' equipment rental. It has no words, only the golem's stone
 * grunts — and a few things a person could say about it, set in italics.
 */
const TUMBLEDOWN: MercenaryVoice = {
  lines: {},
  actions: {
    hired: ['Tumbledown lumbers into step behind you.'],
    talk: [
      'Tumbledown regards you with the warmth of a quarry.',
      'Tumbledown shifts its weight. Somewhere, gravel settles.',
      'Tumbledown says nothing, loudly.',
      'Tumbledown blinks. It takes a while.',
    ],
    death: ['Tumbledown comes apart, one boulder at a time.'],
    floor_end: ['Tumbledown turns and trudges back toward the club.'],
  },
  grunts: {
    hired: 'grunt',
    idle: 'grunt',
    engage: 'grunt',
    kill: 'grunt',
    special: 'grunt',
    low_hp: 'frustrated',
    owner_hurt: 'frustrated',
    cat_hurt: 'frustrated',
    death: 'frustrated',
    floor_end: 'grunt',
  },
};

export const MERCENARY_VOICES: Readonly<Record<MercenaryVoiceId, MercenaryVoice>> = {
  sledge: SLEDGE,
  bomo: BOMO,
  dong_quixote: DONG_QUIXOTE,
  splash_zone: SPLASH_ZONE,
  gluteus_maxx: GLUTEUS_MAXX,
  bucket_boy: BUCKET_BOY,
  tumbledown: TUMBLEDOWN,
};
