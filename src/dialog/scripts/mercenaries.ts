/**
 * What each hired mercenary says, and when.
 *
 * The lines are written for each character rather than lifted from anywhere:
 * the Meat Shields hires are crude, funny and a little bleak, with the cruelty
 * aimed at the dungeon and never at the player. Nothing here reaches past the
 * third floor — no later deaths, no later spells, nothing the characters have
 * not lived through yet by the time the party can hire them.
 *
 * The cat crawler is "Princess" to the two cretins, because in the books Sledge
 * is devoted to Donut and Bomo follows his lead.
 *
 * `MercenaryBarker` (`src/creatures/mercenaries/MercenaryBarker.ts`) reads
 * every one of these pools generically, through `MercenaryLines` and
 * `linesFor` — never by trigger name against this file — so a bark that goes
 * unread here is a bark nobody will ever hear.
 */

import { speakerLines } from '../line';
import type { MercenaryLines } from '../roles';
import type { MercenaryVoice } from '../../creatures/mercenaries/mercenaryVoices';

const sledge = speakerLines('sledge');

export const SLEDGE_LINES = {
  hired: [
    sledge.bark('Sledge here. Sledge protect.'),
    sledge.bark('Contract good. Sledge walk with you.'),
    sledge.bark('Where Princess? Sledge go where Princess go.'),
    sledge.bark('Sledge ready.'),
  ],
  idle: [
    sledge.bark('Quiet. Sledge like quiet.'),
    sledge.bark('Princess safe. Good.'),
    sledge.bark('Bomo like this hallway. Bomo like every hallway.'),
    sledge.bark('Sledge not bored. Sledge guarding.'),
  ],
  engage: [
    sledge.bark('Bad guy. Go away now.'),
    sledge.bark('Sledge see you.'),
    sledge.bark('No.'),
    sledge.bark('Stand back. Sledge handle.'),
  ],
  kill: [
    sledge.bark('Surviving is winning.'),
    sledge.bark('Gone now.'),
    sledge.bark('Next.'),
    sledge.bark('That one done.'),
  ],
  lowHp: [
    sledge.bark('Sledge cracked. Sledge fine.'),
    sledge.bark('Hurt. Still here.'),
    sledge.bark('Rock chip. Rock grow back. Maybe.'),
    sledge.bark('Not dead yet.'),
  ],
  special: [
    sledge.bark('Shield. Stay inside.'),
    sledge.bark('Sledge buy this. Worth it.'),
    sledge.bark('Glow is good. Stand in glow.'),
    sledge.bark('Protect.'),
  ],
  ownerHurt: [
    sledge.bark('Hey. Stop that.'),
    sledge.bark('Sledge saw that.'),
    sledge.bark('Nobody hit boss.'),
    sledge.bark('You okay? Sledge fix.'),
  ],
  catHurt: [
    sledge.bark('NO touch Princess.'),
    sledge.bark('Princess! Sledge coming.'),
    sledge.bark('You hurt Princess. Bad idea.'),
    sledge.bark('Princess behind Sledge. Now.'),
  ],
  downed: [
    sledge.bark('Sledge down. Help Sledge up.'),
    sledge.bark('Sledge... fall over. Come get Sledge.'),
    sledge.bark('Floor cold. Sledge want up.'),
    sledge.bark('Not dead. Sledge wait. Hurry.'),
  ],
  revived: [
    sledge.bark('Sledge up. Thank you.'),
    sledge.bark('Back. Sledge protect again.'),
    sledge.bark('Good hands. Sledge owe you.'),
  ],
  potion: [
    sledge.bark('Sledge drink. Sledge fine.'),
    sledge.bark('Tastes bad. Works good.'),
    sledge.bark('Glug.'),
  ],
  death: [
    sledge.bark('Princess... run.'),
    sledge.bark('Sledge... tried.'),
    sledge.bark('Tell Bomo... Sledge say bye.'),
    sledge.bark('Keep... Princess... safe.'),
  ],
  talk: [
    sledge.bark('Bomo say hi. Bomo not here. Still say hi.'),
    sledge.bark('Sledge not talk much. This is most.'),
    sledge.bark('You pay. Sledge stay. Simple.'),
    sledge.bark('Tux is rented. Do not bleed on tux.'),
  ],
  floorEnd: [
    sledge.bark('Floor done. Contract done. Good work.'),
    sledge.bark('Sledge go back now. Tell Princess bye.'),
    sledge.bark('Stairs. Sledge stay. Rules.'),
    sledge.bark('You live. Good.'),
  ],
} satisfies MercenaryLines;

const bomo = speakerLines('bomo');

export const BOMO_LINES = {
  hired: [
    bomo.bark('Bomo here! Bomo protect.'),
    bomo.bark('You pick Bomo? Good pick.'),
    bomo.bark('Bomo buy spell with own money. Now Bomo use for you.'),
    bomo.bark('Where we go? Bomo follow.'),
  ],
  idle: [
    bomo.bark('Where Sledgy? Bomo miss Sledgy.'),
    bomo.bark('Sledgy say quiet is good. Bomo think quiet is boring.'),
    bomo.bark('Bomo count steps. Bomo lose count.'),
    bomo.bark('Bomo like club. Bomo like here also. Less music.'),
  ],
  engage: [
    bomo.bark('Bomo smash.'),
    bomo.bark('Stand behind Bomo.'),
    bomo.bark('You! Stop!'),
    bomo.bark('Bomo see bad thing.'),
  ],
  kill: [
    bomo.bark('Bomo smash good.'),
    bomo.bark('Down it go.'),
    bomo.bark('Sledgy would clap.'),
    bomo.bark('Easy.'),
  ],
  lowHp: [
    bomo.bark('Bomo hurt... Bomo okay.'),
    bomo.bark('Ow. Big ow.'),
    bomo.bark('Bomo need sit down. Later.'),
    bomo.bark('Rock crack. Not break.'),
  ],
  special: [
    bomo.bark('Shield! Stay in shield!'),
    bomo.bark('Bomo protect!'),
    bomo.bark('Glow keep you. Stay in glow.'),
    bomo.bark('Bomo spell. Bomo money. You safe.'),
  ],
  ownerHurt: [
    bomo.bark('Hey! No hit friend!'),
    bomo.bark('Stand behind Bomo!'),
    bomo.bark('Bomo fix. Bomo fix.'),
    bomo.bark('That make Bomo mad.'),
  ],
  catHurt: [
    bomo.bark('Princess! No!'),
    bomo.bark('Nobody hurt Princess. Sledgy say so.'),
    bomo.bark('Bomo coming, Princess!'),
    bomo.bark('Bad! Bad thing hit Princess!'),
  ],
  downed: [
    bomo.bark('Bomo fall down! Help Bomo!'),
    bomo.bark('Ow. Bomo on floor. Come get Bomo?'),
    bomo.bark('Bomo lie here. Not long, okay?'),
    bomo.bark('Sledgy would pick Bomo up. You pick Bomo up?'),
  ],
  revived: [
    bomo.bark('Bomo up! Bomo up!'),
    bomo.bark('Thank you! Bomo protect again!'),
    bomo.bark('Bomo okay now. Mostly.'),
  ],
  potion: [
    bomo.bark('Bomo drink medicine!'),
    bomo.bark('Yuck. Bomo better.'),
    bomo.bark('Glug glug. Bomo good.'),
  ],
  death: [
    bomo.bark('Tell Sledgy... Bomo tried.'),
    bomo.bark('Bomo... sorry.'),
    bomo.bark('Princess... Bomo protect... little bit.'),
    bomo.bark('Sledgy...'),
  ],
  talk: [
    bomo.bark('He buy spell with own money. He buy for Princess protect.'),
    bomo.bark('Sledgy best friend. Bomo best friend too. Of Sledgy.'),
    bomo.bark('Bomo not remember name of this place. Bomo remember you.'),
    bomo.bark('Tux itch. Rosemarie say wear tux.'),
  ],
  floorEnd: [
    bomo.bark('Floor done! Bomo go home to Sledgy.'),
    bomo.bark('Bye bye. Bomo had good time.'),
    bomo.bark('You live! Bomo do job good.'),
    bomo.bark('Contract over. Bomo wave.'),
  ],
} satisfies MercenaryLines;

const dongQuixote = speakerLines('dongQuixote');

export const DONG_QUIXOTE_LINES = {
  hired: [
    dongQuixote.bark('Dong Quixote, knight-errant, at thy service, and at thy price.'),
    dongQuixote.bark('A quest! Lead on, and I shall follow at a stately pace.'),
    dongQuixote.bark('Fear not, good crawler. Thy champion is arrived.'),
    dongQuixote.bark('My lance is thine until this floor is done.'),
  ],
  idle: [
    dongQuixote.bark('Corcunda was the most beautiful man who ever lived. I say it plainly.'),
    dongQuixote.bark('These halls want for a horse. As do I.'),
    dongQuixote.bark('Hark, how the dungeon breathes. As do I. Mostly out.'),
    dongQuixote.bark('I danced the Parade in my day. The crowds wept. From joy, I maintain.'),
  ],
  engage: [
    dongQuixote.bark('Have at thee, knave!'),
    dongQuixote.bark('Stand and be skewered!'),
    dongQuixote.bark('A foe! At last, a worthy foe!'),
    dongQuixote.bark('Villain! Meet the point of my conviction!'),
  ],
  kill: [
    dongQuixote.bark('Another foe unhorsed, and I without a horse!'),
    dongQuixote.bark('Yield! Ah. Too late for yielding.'),
    dongQuixote.bark('So fall the wicked. Someone sing of it.'),
    dongQuixote.bark('Corcunda, didst thou see? No. No, of course not.'),
  ],
  lowHp: [
    dongQuixote.bark('A scratch! A mere... a considerable scratch.'),
    dongQuixote.bark('I have bled worse in duels over lesser insults.'),
    dongQuixote.bark('My breath grows short. My resolve does not.'),
    dongQuixote.bark('Fetch my smelling salts! Afterwards!'),
  ],
  special: [
    dongQuixote.bark('For Corcunda!'),
    dongQuixote.bark('CHARGE!'),
    dongQuixote.bark('Clear the lists!'),
    dongQuixote.bark('Lance down, heart high!'),
  ],
  ownerHurt: [
    dongQuixote.bark('Unhand my patron, cur!'),
    dongQuixote.bark('Thou shalt answer for that blow!'),
    dongQuixote.bark('Courage, friend! Help rides to thee. On foot.'),
    dongQuixote.bark('A wound upon my patron is a wound upon mine honour!'),
  ],
  catHurt: [
    dongQuixote.bark('The fair lady is struck! Villainy!'),
    dongQuixote.bark('Strike a noble cat? Thou hast chosen poorly.'),
    dongQuixote.bark('My lady! Behind my lance!'),
    dongQuixote.bark('Treachery against a lady most feline!'),
  ],
  downed: [
    dongQuixote.bark('I am unhorsed! A hand, good crawler!'),
    dongQuixote.bark('I merely rest. Help me rise, and swiftly!'),
    dongQuixote.bark('Lend me thy arm! My dignity I shall retrieve myself.'),
    dongQuixote.bark('Fallen, but not vanquished! Not yet!'),
  ],
  revived: [
    dongQuixote.bark('Risen! Let the minstrels note it.'),
    dongQuixote.bark('My thanks, friend. Now, where was the villain?'),
    dongQuixote.bark('Up again, as all great knights must be.'),
  ],
  potion: [
    dongQuixote.bark('A restorative! Most bracing.'),
    dongQuixote.bark('To thy health! And mine!'),
    dongQuixote.bark('Vile tincture. Splendid effect.'),
  ],
  death: [
    dongQuixote.bark('Vale to you all. Vale.'),
    dongQuixote.bark('Corcunda... I come...'),
    dongQuixote.bark('Tell them... I fell forward.'),
    dongQuixote.bark('A gallant end... a most gallant... ow.'),
  ],
  talk: [
    dongQuixote.bark('Ask me of Corcunda. No, do. I insist.'),
    dongQuixote.bark('My muscles? Mine own. They merely rest between breaths.'),
    dongQuixote.bark('I have fought for coin before, but never for so little. It is liberating.'),
    dongQuixote.bark('Chivalry is not dead, friend. It is only very old.'),
  ],
  floorEnd: [
    dongQuixote.bark('The floor is won! I take my leave, with a bow.'),
    dongQuixote.bark('Our contract ends, and yet our legend begins.'),
    dongQuixote.bark('Farewell! Remember my charge, if not my name.'),
    dongQuixote.bark('Back to the Parade with me. Fear not; I shall tell it well.'),
  ],
} satisfies MercenaryLines;

const splashZone = speakerLines('splashZone');

export const SPLASH_ZONE_LINES = {
  hired: [
    splashZone.bark("Splash Zone! Front rows get wet, that's the deal."),
    splashZone.bark('Lifeguard on duty! Nobody runs, everybody lives.'),
    splashZone.bark("Hey, hey! Let's make some waves."),
    splashZone.bark('You picked the otter. Great call, honestly.'),
  ],
  idle: [
    splashZone.bark("Snail Trail's gonna love this story."),
    splashZone.bark('No running on the wet floor. Which is every floor down here.'),
    splashZone.bark('Hydrate! Seriously, drink something.'),
    splashZone.bark('Nobody down here swims. Wasted opportunity, if you ask me.'),
  ],
  engage: [
    splashZone.bark('Whistle! Everybody out of the water!'),
    splashZone.bark('Incoming! Stay behind the rope line.'),
    splashZone.bark("Okay, pal, pool's closed."),
    splashZone.bark('Got a live one!'),
  ],
  kill: [
    splashZone.bark("And that's a no-diving zone."),
    splashZone.bark('Sploosh. Next!'),
    splashZone.bark("Pool's closed. Permanently."),
    splashZone.bark("Should've read the signs, buddy."),
  ],
  lowHp: [
    splashZone.bark('Okay, okay, lifeguard needs a lifeguard!'),
    splashZone.bark('Taking on water here!'),
    splashZone.bark("I'm good! Mostly good! Somewhat good!"),
    splashZone.bark('Somebody throw me a floatie!'),
  ],
  special: [
    splashZone.bark('Everybody out of the pool!'),
    splashZone.bark('Wave incoming! Hold your breath!'),
    splashZone.bark('Wet Spot routine, coming right up!'),
    splashZone.bark("Surf's up, suckers!"),
  ],
  ownerHurt: [
    splashZone.bark('Whoa, you okay? Stay on your feet!'),
    splashZone.bark('Buddy system! I got you!'),
    splashZone.bark('Hey! No roughhousing with my crawler!'),
    splashZone.bark('Keep your head above water!'),
  ],
  catHurt: [
    splashZone.bark("Kitty's hit! Cover the cat!"),
    splashZone.bark('Hey, not the cat! Never the cat!'),
    splashZone.bark('Hang in there, fuzzy!'),
    splashZone.bark('Cat overboard!'),
  ],
  downed: [
    splashZone.bark('Lifeguard down! Somebody get over here!'),
    splashZone.bark('Little help? I am very small and very flat.'),
    splashZone.bark('Man overboard! Me! I am the man!'),
    splashZone.bark("I'm okay! I'm not okay! Come get me!"),
  ],
  revived: [
    splashZone.bark('Back on duty! Thanks, pal.'),
    splashZone.bark('Mouth-to-mouth not required. Appreciated anyway.'),
    splashZone.bark("Whew! Okay, where's the deep end?"),
  ],
  potion: [
    splashZone.bark('Hydrate!'),
    splashZone.bark('Tastes like pool water. Works, though.'),
    splashZone.bark('Drink break!'),
  ],
  death: [
    splashZone.bark('Tell Snail Trail... tell her I stuck the landing.'),
    splashZone.bark("Guess... I'm off duty."),
    splashZone.bark('Somebody... blow the whistle...'),
    splashZone.bark("Don't... run... on the wet floor..."),
  ],
  talk: [
    splashZone.bark(
      "My wife dances at Bitches. Snail Trail. Best in the club, don't let anybody tell you different.",
    ),
    splashZone.bark("Crossbow's small, but so am I. We make it work."),
    splashZone.bark('Water magic is ninety percent timing and ten percent not drowning.'),
    splashZone.bark("Rule one of lifeguarding: count heads. I'm counting yours."),
  ],
  floorEnd: [
    splashZone.bark("Floor's done! Heading home to the missus."),
    splashZone.bark('Great swim, team. Towel off.'),
    splashZone.bark('Shift over! Stay safe out there.'),
    splashZone.bark("That's my whistle. Good luck down there!"),
  ],
} satisfies MercenaryLines;

const gluteusMaxx = speakerLines('gluteusMaxx');

export const GLUTEUS_MAXX_LINES = {
  hired: [
    gluteusMaxx.bark("LET'S GOOO. Point me at something."),
    gluteusMaxx.bark('Gluteus Maxx, baby! Maximum glute!'),
    gluteusMaxx.bark("Contract signed, pump secured, let's MOVE."),
    gluteusMaxx.bark("Oh I am SO ready. I've been ready since breakfast."),
  ],
  idle: [
    gluteusMaxx.bark("Is it leg day? It's always leg day."),
    gluteusMaxx.bark("Nobody's hitting me. I hate it. I love it. I hate it."),
    gluteusMaxx.bark("Feel that? That's my heartbeat. It's fast. Is that normal?"),
    gluteusMaxx.bark("I could do squats. Should I do squats? I'm doing squats."),
  ],
  engage: [
    gluteusMaxx.bark("Oh, it's HAPPENING."),
    gluteusMaxx.bark('Come here, come here, come HERE!'),
    gluteusMaxx.bark('Fresh meat! For my FISTS!'),
    gluteusMaxx.bark("Mine! That one's mine!"),
  ],
  kill: [
    gluteusMaxx.bark('DOWN! Stay down!'),
    gluteusMaxx.bark("Who's next? Anyone? ANYONE?"),
    gluteusMaxx.bark("That's cardio, baby."),
    gluteusMaxx.bark("Feel the burn! They didn't. They're dead."),
  ],
  lowHp: [
    gluteusMaxx.bark("I'm fine! I'm great! Is my arm supposed to do that?"),
    gluteusMaxx.bark('Pain is just weakness... leaving... quickly...'),
    gluteusMaxx.bark('More! More! Wait. Less!'),
    gluteusMaxx.bark("Blood's just sweat that's trying harder!"),
  ],
  special: [
    gluteusMaxx.bark('Game over, pal. Game. Over.'),
    gluteusMaxx.bark('Glute Crush! Glute! CRUSH!'),
    gluteusMaxx.bark('Sit DOWN.'),
    gluteusMaxx.bark('Have a seat. Forever.'),
  ],
  ownerHurt: [
    gluteusMaxx.bark("Hey! HEY! That's my paycheck!"),
    gluteusMaxx.bark('Nobody touches the client!'),
    gluteusMaxx.bark('You want some of THIS?'),
    gluteusMaxx.bark('Oh you did NOT.'),
  ],
  catHurt: [
    gluteusMaxx.bark('Not the kitty! NOT THE KITTY!'),
    gluteusMaxx.bark('You hit the cat? You hit the CAT?'),
    gluteusMaxx.bark('Kitty down! Rage up!'),
    gluteusMaxx.bark('That cat is a celebrity, you animal!'),
  ],
  downed: [
    gluteusMaxx.bark("I'm DOWN! Get me UP!"),
    gluteusMaxx.bark('Spot me! SPOT ME!'),
    gluteusMaxx.bark('This is just a floor stretch! Help me up!'),
    gluteusMaxx.bark('Nobody saw that. Help me up before somebody sees that.'),
  ],
  revived: [
    gluteusMaxx.bark("BACK! Let's GO!"),
    gluteusMaxx.bark('Second set! SECOND SET!'),
    gluteusMaxx.bark("That's what I call a recovery day!"),
  ],
  potion: [
    gluteusMaxx.bark('Pre-workout!'),
    gluteusMaxx.bark('Chug! Chug! Chug!'),
    gluteusMaxx.bark('Protein shake, baby!'),
  ],
  death: [
    gluteusMaxx.bark('Worth it.'),
    gluteusMaxx.bark('Tell my glutes... they did great.'),
    gluteusMaxx.bark('Was... that... a PR?'),
    gluteusMaxx.bark('Totally... worth it.'),
  ],
  talk: [
    gluteusMaxx.bark("Rosemarie says no more uppers. Rosemarie isn't here."),
    gluteusMaxx.bark('People say I can crush a guy with my butt. People are RIGHT.'),
    gluteusMaxx.bark('Short king. Big gauntlets. Bigger heart.'),
    gluteusMaxx.bark("Armour? I've got abs."),
  ],
  floorEnd: [
    gluteusMaxx.bark("Floor's done? Aw, I was just warming up!"),
    gluteusMaxx.bark('Good sweat, everybody. Good sweat.'),
    gluteusMaxx.bark('See ya! Stay hydrated! Stay SWOLE!'),
    gluteusMaxx.bark("That's the set. Rack it."),
  ],
} satisfies MercenaryLines;

const bucketBoy = speakerLines('bucketBoy');

export const BUCKET_BOY_LINES = {
  hired: [
    bucketBoy.bark("I— I'm Bucket Boy. I'll do my best. I have a bucket."),
    bucketBoy.bark('You picked me? Really? Okay. Okay!'),
    bucketBoy.bark("I'll stay close. Very close. Is this too close?"),
    bucketBoy.bark("I promise I won't run away. Much."),
  ],
  idle: [
    bucketBoy.bark("The others remember the old seasons. I don't. Is that bad?"),
    bucketBoy.bark('I used to catch coins in this bucket. Rosemarie always aimed for my eyes.'),
    bucketBoy.bark("Is it quiet because it's safe, or quiet because it's waiting?"),
    bucketBoy.bark("I'm not scared. I'm just standing behind you on purpose."),
  ],
  engage: [
    bucketBoy.bark('EEEE— sorry. Sorry.'),
    bucketBoy.bark("Something's coming! Something's coming!"),
    bucketBoy.bark('Oh no. Oh no no no.'),
    bucketBoy.bark("Please don't look at me please don't look at me."),
  ],
  kill: [
    bucketBoy.bark("Did I do that? I'm so sorry. I mean, good?"),
    bucketBoy.bark('Oh! It stopped!'),
    bucketBoy.bark('Is it... is it dead? Yay?'),
    bucketBoy.bark("I didn't mean— well, I did mean."),
  ],
  lowHp: [
    bucketBoy.bark("I'm bleeding! Is this a lot of blood? It feels like a lot!"),
    bucketBoy.bark("Help! Help! I'm fine, but help!"),
    bucketBoy.bark('Owww... sorry. Ow.'),
    bucketBoy.bark("I'll fix myself in a second. After screaming."),
  ],
  special: [
    bucketBoy.bark('Hold still! Hold still, please!'),
    bucketBoy.bark("Triage! Um, that's the spell. It's working!"),
    bucketBoy.bark('Here, here, let me fix it.'),
    bucketBoy.bark('This might sting! Sorry! Sorry!'),
  ],
  ownerHurt: [
    bucketBoy.bark('Oh no oh no oh no.'),
    bucketBoy.bark("You're hurt! I can help! Wait for me!"),
    bucketBoy.bark("Don't die! Please! I'm not ready!"),
    bucketBoy.bark('I saw that! That looked bad!'),
  ],
  catHurt: [
    bucketBoy.bark('The cat! Is she okay? Is she okay?'),
    bucketBoy.bark('Miss Donut! Hold on!'),
    bucketBoy.bark("Oh no, not her, she's famous!"),
    bucketBoy.bark("I'm coming, kitty! Slowly! But coming!"),
  ],
  downed: [
    bucketBoy.bark("I fell! I fell and I'm scared! Please come get me!"),
    bucketBoy.bark("Don't leave me here! Please!"),
    bucketBoy.bark("I'm still alive! I think! Help!"),
    bucketBoy.bark("I can't heal myself lying down! Help!"),
  ],
  revived: [
    bucketBoy.bark('You came back for me! You actually came back!'),
    bucketBoy.bark("Thank you thank you thank you. I'll be braver. A bit."),
    bucketBoy.bark("I'm up! Sorry! Thank you! Sorry!"),
  ],
  potion: [
    bucketBoy.bark('Medicine! I know about medicine!'),
    bucketBoy.bark('Gulp. Okay. Better.'),
    bucketBoy.bark('This one tastes like my bucket.'),
  ],
  death: [
    bucketBoy.bark('Did... did I help?'),
    bucketBoy.bark('Sorry... I dropped my bucket.'),
    bucketBoy.bark('Tell Rosemarie... I tried really hard.'),
    bucketBoy.bark("I think... I'll remember this one."),
  ],
  talk: [
    bucketBoy.bark("I'm the cheapest one. That means I'm the best value! Right?"),
    bucketBoy.bark("My bucket is my friend. You're also my friend. Is that okay?"),
    bucketBoy.bark("I don't really fight. I mostly worry at things."),
    bucketBoy.bark("Everybody else is braver than me. But I'm here, and they're not."),
  ],
  floorEnd: [
    bucketBoy.bark('We made it! We actually made it!'),
    bucketBoy.bark('I get to go home? Thank you. Thank you so much.'),
    bucketBoy.bark('I only ran away once! And I came back!'),
    bucketBoy.bark("Bye! Good luck! Don't die! Sorry! Bye!"),
  ],
} satisfies MercenaryLines;

const tumbledown = speakerLines('tumbledown');

/**
 * Meat Shields' equipment rental. It has no words, only the golem's stone
 * grunts (see `TUMBLEDOWN_GRUNTS` in `mercenaryVoices.ts`) — and a few things
 * a person could say about it, set in italics.
 */
export const TUMBLEDOWN_ACTIONS = {
  hired: [tumbledown.bark('Tumbledown lumbers into step behind you.')],
  talk: [
    tumbledown.bark('Tumbledown regards you with the warmth of a quarry.'),
    tumbledown.bark('Tumbledown shifts its weight. Somewhere, gravel settles.'),
    tumbledown.bark('Tumbledown says nothing, loudly.'),
    tumbledown.bark('Tumbledown blinks. It takes a while.'),
  ],
  downed: [tumbledown.bark('Tumbledown slumps into a heap. Something in it still grinds.')],
  revived: [tumbledown.bark('Tumbledown heaves itself back together.')],
  death: [tumbledown.bark('Tumbledown comes apart, one boulder at a time.')],
  floorEnd: [tumbledown.bark('Tumbledown turns and trudges back toward the club.')],
} satisfies MercenaryLines;

export const SLEDGE = { lines: SLEDGE_LINES } satisfies MercenaryVoice;
export const BOMO = { lines: BOMO_LINES } satisfies MercenaryVoice;
export const DONG_QUIXOTE = { lines: DONG_QUIXOTE_LINES } satisfies MercenaryVoice;
export const SPLASH_ZONE = { lines: SPLASH_ZONE_LINES } satisfies MercenaryVoice;
export const GLUTEUS_MAXX = { lines: GLUTEUS_MAXX_LINES } satisfies MercenaryVoice;
export const BUCKET_BOY = { lines: BUCKET_BOY_LINES } satisfies MercenaryVoice;
export const TUMBLEDOWN_BASE = {
  lines: {},
  actions: TUMBLEDOWN_ACTIONS,
} satisfies MercenaryVoice;
