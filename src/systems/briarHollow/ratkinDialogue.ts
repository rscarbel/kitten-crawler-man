// AUTO-GENERATED transcription of the Briar Hollow villager dialogue data.
// Regenerate rather than hand-edit if the source data changes.

export type VillagerId =
  | 'bramblewick'
  | 'merrit'
  | 'pipkin'
  | 'sella'
  | 'vetch'
  | 'oren'
  | 'tikka'
  | 'fenna'
  | 'garn'
  | 'sedge'
  | 'hobb'
  | 'marta'
  | 'pru'
  | 'nella'
  | 'cricket'
  | 'wicker'
  | 'midge';

export const VILLAGER_IDS: readonly VillagerId[] = [
  'bramblewick',
  'merrit',
  'pipkin',
  'sella',
  'vetch',
  'oren',
  'tikka',
  'fenna',
  'garn',
  'sedge',
  'hobb',
  'marta',
  'pru',
  'nella',
  'cricket',
  'wicker',
  'midge',
] as const;

export type Circumstance =
  | 'after_victory'
  | 'after_village_damage'
  | 'already_max_axe'
  | 'already_max_pickaxe'
  | 'ask_about_axe'
  | 'ask_about_burgers'
  | 'ask_about_cows'
  | 'ask_about_farm'
  | 'ask_about_healing'
  | 'ask_about_necromancer'
  | 'ask_about_pickaxe'
  | 'ask_about_stew'
  | 'ask_about_town'
  | 'ask_about_trebuchet_ammunition'
  | 'ask_about_village'
  | 'ask_how_lumber_yard_works'
  | 'ask_how_to_gather'
  | 'attack_imminent'
  | 'attack_started'
  | 'axe_task'
  | 'axe_upgrade_available'
  | 'basic_tools_already_owned'
  | 'before_tools'
  | 'bulk_processing_boards_selected'
  | 'bulk_processing_complete'
  | 'bulk_processing_fee_explanation'
  | 'bulk_processing_insufficient_fee'
  | 'bulk_processing_rope_selected'
  | 'bulk_processing_service'
  | 'buy_burger'
  | 'buy_healing'
  | 'buy_stew'
  | 'cannot_afford'
  | 'cannot_afford_upgrade'
  | 'collection_speed'
  | 'command_follow'
  | 'command_patrol'
  | 'command_stay'
  | 'construction_experience'
  | 'construction_explanation'
  | 'construction_skill_already_granted'
  | 'construction_skill_granted'
  | 'construction_tutorial_trigger'
  | 'construction_unlocked'
  | 'cow_petted_nearby'
  | 'deposit_depleted'
  | 'directions_to_lumber_yard'
  | 'directions_to_quarry'
  | 'enemy_breach'
  | 'enemy_spotted'
  | 'explain_boards'
  | 'explain_resource_gathering'
  | 'explain_rope'
  | 'first_meeting'
  | 'follow_active'
  | 'fortifications_advanced'
  | 'fortifications_started'
  | 'fortified_stone_explanation'
  | 'fully_healthy'
  | 'gate_under_attack'
  | 'grant_basic_tools'
  | 'healing_complete'
  | 'level_10_construction'
  | 'level_15_construction'
  | 'low_supplies'
  | 'manual_processing_instructions'
  | 'no_logs'
  | 'patrol_active'
  | 'patrol_return'
  | 'pickaxe_task'
  | 'pickaxe_upgrade_available'
  | 'quest_accepted'
  | 'quest_active'
  | 'quest_complete'
  | 'quest_declined'
  | 'quest_explanation'
  | 'quest_offer'
  | 'resourcing_skill_already_granted'
  | 'resourcing_skill_granted'
  | 'resourcing_tutorial_trigger'
  | 'resourcing_unlocked'
  | 'service_menu'
  | 'shared_upgrade_explanation'
  | 'shop_open'
  | 'snare_explanation'
  | 'spikes_unlocked'
  | 'stay_active'
  | 'stew_cooldown_active'
  | 'stone_delivered'
  | 'stone_upgrade_available'
  | 'stone_wall_explanation'
  | 'tools_obtained'
  | 'tools_required'
  | 'trebuchet_ammo_explanation'
  | 'trebuchet_explanation'
  | 'trebuchet_repair_explanation'
  | 'upgrade_purchased'
  | 'wall_repair_explanation'
  | 'wood_processing_task'
  | 'wooden_wall_built'
  | 'wooden_wall_explanation';

interface DialogueLine {
  readonly circumstance: Circumstance;
  readonly text: string;
}

interface VillagerEntry {
  readonly id: VillagerId;
  readonly name: string;
  readonly role: string;
  readonly backstory: string;
  readonly dialogueOptions: readonly DialogueLine[];
}

const VILLAGER_TABLE: Readonly<Record<VillagerId, VillagerEntry>> = {
  bramblewick: {
    id: 'bramblewick',
    name: 'Mayor Bramblewick',
    role: 'mayor',
    backstory:
      'Bramblewick has governed Briar Hollow for twelve seasons. He inherited a quiet farming settlement and has watched it become increasingly threatened by a necromancer in the nearby ruins. He keeps careful records of every villager lost and is determined to give the town one final chance to survive.',
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: "You two are Crawlers, aren't you? Then perhaps you've arrived at exactly the right time. Around here, that usually means trouble has arrived as well.",
      },
      {
        circumstance: 'ask_about_village',
        text: 'This is Briar Hollow. Small, quiet, and until recently, rather unremarkable. We farm, trade, and keep to ourselves.',
      },
      {
        circumstance: 'ask_about_necromancer',
        text: "There's a necromancer in the ruins east of here. At first it only took travelers and stray animals. Then it started taking our people. Now it raises our dead against us.",
      },
      {
        circumstance: 'quest_offer',
        text: "The attacks are becoming more frequent. We may not survive another. Help us fortify the village and defend us when it comes. Do that, and you'll have our gratitude.",
      },
      {
        circumstance: 'quest_accepted',
        text: 'Then we have work to do. Oren can outfit you, Tikka knows what we need built, and everyone else will do what they can.',
      },
      {
        circumstance: 'quest_declined',
        text: 'I understand. If you change your mind, come back before the attack.',
      },
      {
        circumstance: 'before_tools',
        text: "You'll need an axe and a pickaxe before you can gather what we need. Oren keeps them at the forge.",
      },
      {
        circumstance: 'tools_obtained',
        text: 'Good. Now you can actually do something useful with all that enthusiasm.',
      },
      {
        circumstance: 'resourcing_unlocked',
        text: 'Oren has explained the work? Then you know what we need. Every load of wood and stone buys us a little more time.',
      },
      {
        circumstance: 'construction_unlocked',
        text: "Tikka says you're ready to build. Then perhaps our little town finally has a chance.",
      },
      {
        circumstance: 'fortifications_started',
        text: "It's beginning to look like a fortress. A very small fortress, but I'll take what I can get.",
      },
      {
        circumstance: 'fortifications_advanced',
        text: 'Wooden walls, stone walls, siege equipment... I hardly recognize the place anymore.',
      },
      {
        circumstance: 'attack_imminent',
        text: "They're coming. Get everyone behind the defenses and prepare yourselves.",
      },
      {
        circumstance: 'attack_started',
        text: "They're through the outer defenses! Hold the town!",
      },
      {
        circumstance: 'after_victory',
        text: "They're gone. For the first time in months, I can look beyond that gate without expecting the dead to come walking back.",
      },
      {
        circumstance: 'after_village_damage',
        text: 'Rebuild what we can. Whatever they destroyed, we can replace. Whoever they took, we cannot.',
      },
      {
        circumstance: 'quest_complete',
        text: "You saved Briar Hollow. I don't know what a village like ours can possibly offer Crawlers, but you have our gratitude.",
      },
    ],
  },
  merrit: {
    id: 'merrit',
    name: 'Merrit Roottail',
    role: 'farmer',
    backstory:
      "Merrit tends Briar Hollow's grain, vegetables, mushrooms, and pasture. She was born in the village and has spent nearly her entire life farming its surrounding fields. She refuses to abandon the crops, even with the necromancer nearby.",
    dialogueOptions: [
      { circumstance: 'first_meeting', text: 'Watch your feet. Those are winter crops.' },
      {
        circumstance: 'ask_about_farm',
        text: "We grow grain where the soil is decent and mushrooms where it isn't. The pasture's mostly for the cows.",
      },
      {
        circumstance: 'ask_about_cows',
        text: "They're harmless. You can pet them if you like. Just don't frighten the calves.",
      },
      { circumstance: 'cow_petted_nearby', text: 'See? Even a Crawler can make a cow happy.' },
      {
        circumstance: 'quest_active',
        text: "You want to help? Keep the walls standing. I'll keep everyone fed.",
      },
      {
        circumstance: 'attack_imminent',
        text: "I've brought the tools inside. The fields can wait. People can't.",
      },
      { circumstance: 'after_victory', text: "Tomorrow I'll plant again. That's what farmers do." },
    ],
  },
  pipkin: {
    id: 'pipkin',
    name: 'Pipkin Paws',
    role: 'cook',
    backstory:
      'Pipkin runs the village kitchen and sells simple meals to residents and travelers. His burgers and stew are the two staples of the village. He takes considerable pride in keeping everyone fed during difficult times.',
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: "Welcome! Hungry? I've got burgers, stew, and absolutely no patience for anyone asking what went into either one.",
      },
      {
        circumstance: 'shop_open',
        text: "I've got two things on the menu today: burgers if you're in a hurry, and stew if you're planning to stay alive for a while.",
      },
      {
        circumstance: 'ask_about_burgers',
        text: 'Fresh meat, a hot pan, bread, and enough seasoning to make it worth chewing. Simple. Reliable.',
      },
      {
        circumstance: 'ask_about_stew',
        text: "Stew is the filling option. It'll heal you the same way a health potion does.",
      },
      { circumstance: 'buy_burger', text: 'One burger coming up. Coins on the counter.' },
      {
        circumstance: 'buy_stew',
        text: "Good choice. Eat it whenever you need the same kind of recovery you'd get from a health potion.",
      },
      {
        circumstance: 'stew_cooldown_active',
        text: "Not yet. Whatever's keeping you from using a health potion is keeping you from using my stew, too.",
      },
      { circumstance: 'cannot_afford', text: "Come back when you've got the coin." },
      {
        circumstance: 'quest_active',
        text: "I've been cooking extra. The workers need food, the soldiers need food, and apparently Crawlers do too.",
      },
      { circumstance: 'attack_imminent', text: "Kitchen's closed! Get behind the walls!" },
      {
        circumstance: 'after_victory',
        text: "You survived, so I'll make something special. Don't ask what it is. It's a surprise.",
      },
    ],
  },
  sella: {
    id: 'sella',
    name: 'Doctor Sella Morrowtail',
    role: 'doctor',
    backstory:
      "Sella is Briar Hollow's physician and has years of experience treating injuries caused by monsters, accidents, and village raids. She has seen the consequences of the necromancer's attacks up close and is especially strict about making sure injured people are treated before returning to combat.",
    dialogueOptions: [
      { circumstance: 'first_meeting', text: "You look healthy. Let's keep it that way." },
      {
        circumstance: 'service_menu',
        text: "I provide treatment for a fee. Sit down, I'll patch you up, and then you can go back to getting yourself injured.",
      },
      {
        circumstance: 'ask_about_healing',
        text: "I'll restore you for a fee. No need to make a larger problem out of a smaller one.",
      },
      { circumstance: 'buy_healing', text: 'Treatment will cost you. Hold still.' },
      {
        circumstance: 'healing_complete',
        text: 'There. Good as new. Try not to make me undo my work.',
      },
      { circumstance: 'cannot_afford', text: "I can sympathize, but medicine isn't free." },
      {
        circumstance: 'fully_healthy',
        text: "You're already fine. Spending money here would be an impressive waste of it.",
      },
      {
        circumstance: 'quest_active',
        text: 'The best treatment I can give this village is keeping the dead outside the walls.',
      },
      {
        circumstance: 'attack_imminent',
        text: "I've moved the patients somewhere defensible. If anyone is hurt, bring them to me.",
      },
      {
        circumstance: 'after_victory',
        text: 'Count your injuries later. For now, enjoy being alive.',
      },
    ],
  },
  vetch: {
    id: 'vetch',
    name: 'Vetch Nibnose',
    role: 'merchant',
    backstory:
      "Vetch runs the village's general store and trading post. He deals in useful supplies, scavenged goods, and anything else people are willing to sell. He is perpetually concerned about inventory, profit margins, and the alarming cost of replacing merchandise destroyed by undead.",
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: "Welcome to Vetch's establishment. Everything is useful, everything is reasonably priced, and nothing here is stolen.",
      },
      {
        circumstance: 'shop_open',
        text: 'Tools, supplies, provisions, odds and ends. Look around.',
      },
      {
        circumstance: 'ask_about_town',
        text: 'The necromancer has been terrible for business. Terrible for the population as well, obviously. But business is what I notice first.',
      },
      {
        circumstance: 'quest_active',
        text: "Everyone's buying rope, food, nails, and anything that can keep a wall from falling down.",
      },
      {
        circumstance: 'low_supplies',
        text: "We're getting low. Which means prices may become less friendly.",
      },
      {
        circumstance: 'attack_imminent',
        text: "Shop's closed. I'm moving anything valuable underground.",
      },
      {
        circumstance: 'after_victory',
        text: 'Excellent. Everyone survived. That is very good for future business.',
      },
    ],
  },
  oren: {
    id: 'oren',
    name: 'Oren Ironwhisker',
    role: 'blacksmith',
    backstory:
      "Oren owns and operates the village smithy. He provides the player's initial gathering tools, sells increasingly powerful axe and pickaxe variants, and teaches the basics of resource gathering.",
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: "Welcome to the forge. If you're looking for something sharp or heavy, you're in the right place.",
      },
      {
        circumstance: 'shop_open',
        text: 'Axes, pickaxes, repairs, improvements. Better tools cost more. Better tools also get the job done faster.',
      },
      {
        circumstance: 'ask_about_axe',
        text: "The axe is for timber. Walk up to a tree and use it. You don't need to equip anything manually; the tool will be used automatically.",
      },
      {
        circumstance: 'ask_about_pickaxe',
        text: 'The pickaxe is for stone. Walk up to a rock deposit and use it. Same deal. The proper tool gets used automatically.',
      },
      {
        circumstance: 'grant_basic_tools',
        text: "These are yours. Basic Axe. Basic Pickaxe. They'll get you started.",
      },
      {
        circumstance: 'basic_tools_already_owned',
        text: "You've already got the basic tools. No point giving you another pair.",
      },
      {
        circumstance: 'explain_resource_gathering',
        text: "Here's the important part. Chop trees for wood. Mine rocks for stone. Bring the wood to the lumber yard and the stone to the quarry.",
      },
      {
        circumstance: 'resourcing_skill_granted',
        text: "There. Now you know what you're doing. You've learned Resourcing.",
      },
      {
        circumstance: 'resourcing_skill_already_granted',
        text: "I already taught you the basics. You don't need the lesson twice.",
      },
      {
        circumstance: 'resourcing_tutorial_trigger',
        text: "Watch the explanation that just popped up. It'll show you exactly how harvesting works.",
      },
      {
        circumstance: 'directions_to_lumber_yard',
        text: 'Take that axe to the lumber yard. Or find any trees out on the map. Any tree will give you wood.',
      },
      {
        circumstance: 'directions_to_quarry',
        text: "Take the pickaxe to the quarry. Any exposed rock deposit will do. You'll get stone while you're working it.",
      },
      {
        circumstance: 'axe_upgrade_available',
        text: "You've got enough coin for an upgrade. Your new axe will gather wood more efficiently.",
      },
      {
        circumstance: 'pickaxe_upgrade_available',
        text: "You've got enough coin for an upgrade. Your new pick will gather stone more efficiently.",
      },
      {
        circumstance: 'already_max_axe',
        text: "That's the best axe I've got. Beyond this, you're asking for a miracle.",
      },
      {
        circumstance: 'already_max_pickaxe',
        text: "That's the finest pick I can make. I don't have anything better to sell you.",
      },
      {
        circumstance: 'cannot_afford_upgrade',
        text: "Come back with more coin. The forge doesn't run on promises.",
      },
      {
        circumstance: 'upgrade_purchased',
        text: "There you are. The upgrade replaces your old tool. You'll both benefit from it.",
      },
      {
        circumstance: 'shared_upgrade_explanation',
        text: "You're working as a pair, so you don't need separate upgraded tools. Improve one and the upgrade applies to both of you.",
      },
      {
        circumstance: 'quest_active',
        text: 'The engineer keeps sending me orders for fortifications. The least you can do is gather the materials.',
      },
      {
        circumstance: 'attack_imminent',
        text: 'Forge is shutting down. Weapons first. Tools can wait.',
      },
    ],
  },
  tikka: {
    id: 'tikka',
    name: 'Tikka Geargrinder',
    role: 'engineer',
    backstory:
      "Tikka manages the village's construction and defense preparations. She is practical, mechanically minded, and responsible for turning the materials gathered by the Crawlers into a functioning defensive position.",
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: "You're the Crawlers. Good. I need labor more than I need introductions.",
      },
      {
        circumstance: 'quest_explanation',
        text: "We're building defenses before the next attack. That means wood, stone, and a great deal of work.",
      },
      {
        circumstance: 'tools_required',
        text: 'First things first. Get an axe and a pickaxe from Oren.',
      },
      {
        circumstance: 'axe_task',
        text: 'Take the axe and chop trees. Every tree out there can provide wood.',
      },
      {
        circumstance: 'pickaxe_task',
        text: 'Take the pickaxe and gather stone from the rock deposits around the ruins.',
      },
      {
        circumstance: 'wood_processing_task',
        text: "Raw wood isn't what we build with. Take it to Fenna at the lumber yard and turn it into boards or rope.",
      },
      {
        circumstance: 'construction_explanation',
        text: "Once you've got boards and stone, you can start building. Open the Construction menu and you'll see what you can make.",
      },
      {
        circumstance: 'construction_skill_granted',
        text: "There. You've learned Construction. Every time you build or repair something, you'll get better at it.",
      },
      {
        circumstance: 'construction_skill_already_granted',
        text: "You've already learned Construction. Go build something.",
      },
      {
        circumstance: 'construction_tutorial_trigger',
        text: "Watch the explanation. It'll show you how to use the Construction menu.",
      },
      {
        circumstance: 'wooden_wall_explanation',
        text: 'The fence around the town is flimsy. One hit can destroy it. Use five boards of wood to turn a section into a proper wooden wall.',
      },
      {
        circumstance: 'stone_wall_explanation',
        text: 'A wooden wall can be upgraded with five stone. That turns it into a much stronger stone wall.',
      },
      {
        circumstance: 'fortified_stone_explanation',
        text: 'Stone can be reinforced further. Eight stone and two boards turns a stone wall into a fortified stone wall.',
      },
      {
        circumstance: 'trebuchet_explanation',
        text: "A trebuchet needs fifteen boards and five rope. It occupies a two-by-three space, so make sure there's room.",
      },
      {
        circumstance: 'trebuchet_ammo_explanation',
        text: 'Trebuchets throw stone. They can hold twenty-five pieces of ammunition at once.',
      },
      {
        circumstance: 'trebuchet_repair_explanation',
        text: 'If a trebuchet breaks, repair it with three boards and one rope. Damage can be repaired the same way.',
      },
      {
        circumstance: 'snare_explanation',
        text: 'A snare takes three boards and one rope. It occupies one tile and stops enemies in place when they trigger it.',
      },
      {
        circumstance: 'wall_repair_explanation',
        text: 'Wooden walls are repaired with boards. Stone walls are repaired with stone. Repairs are cheaper than replacing the whole section.',
      },
      {
        circumstance: 'spikes_unlocked',
        text: "You've gotten good enough at Construction to add spikes. Hold the interaction menu on a construction and you'll see the option.",
      },
      {
        circumstance: 'level_10_construction',
        text: 'Your construction skill is getting efficient. Resource costs are starting to drop.',
      },
      {
        circumstance: 'level_15_construction',
        text: "At this point, you're not really building anymore. You're performing miracles with lumber and stone.",
      },
      {
        circumstance: 'attack_imminent',
        text: "That's all the preparation we're getting. Whatever we've built is what we have.",
      },
      { circumstance: 'after_victory', text: "The walls held. Mostly. I'll take mostly." },
    ],
  },
  fenna: {
    id: 'fenna',
    name: 'Fenna Splintertail',
    role: 'lumber_yard_foreman',
    backstory:
      "Fenna runs the village lumber yard and sawmill. She teaches workers how to use the machinery to process wood into boards or rope, and she offers a paid bulk-processing service for anyone who doesn't want to process each piece manually.",
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: "Logs go in there. Finished material comes out over here. Stand clear unless you want sawdust in places sawdust shouldn't be.",
      },
      {
        circumstance: 'ask_how_lumber_yard_works',
        text: 'Bring me raw wood. From there, you can process it yourself one piece at a time, or pay me to process a whole batch.',
      },
      {
        circumstance: 'manual_processing_instructions',
        text: 'Put your wood into the mill, choose boards or rope, and process it. One wood makes two boards. One wood makes one rope.',
      },
      {
        circumstance: 'explain_boards',
        text: "Boards are the sturdy stuff. They're used for wooden walls, trebuchets, repairs, and other construction.",
      },
      {
        circumstance: 'explain_rope',
        text: "Rope is for the moving parts. You'll need it for trebuchets and snare traps.",
      },
      {
        circumstance: 'bulk_processing_service',
        text: "Or give me the wood and pay one coin per piece. I'll process as much as you tell me to, up to what you've got in your inventory.",
      },
      {
        circumstance: 'bulk_processing_boards_selected',
        text: "Boards it is. Tell me how many you want processed and I'll handle the batch.",
      },
      {
        circumstance: 'bulk_processing_rope_selected',
        text: "Rope it is. Tell me how much you want processed and I'll handle the batch.",
      },
      {
        circumstance: 'bulk_processing_fee_explanation',
        text: 'The fee is one coin per piece of wood processed. So ten wood costs ten coins.',
      },
      {
        circumstance: 'bulk_processing_complete',
        text: 'Finished. Your processed materials are ready.',
      },
      {
        circumstance: 'bulk_processing_insufficient_fee',
        text: "That's not enough coin for the amount you've asked me to process.",
      },
      {
        circumstance: 'no_logs',
        text: "Come back with some wood. The mill isn't powered by optimism.",
      },
      {
        circumstance: 'quest_active',
        text: "You keep bringing me wood and I'll keep turning it into something Tikka can use.",
      },
      {
        circumstance: 'construction_experience',
        text: "Every bit of processing teaches you something. Don't tell Oren I said gathering counts as construction.",
      },
      {
        circumstance: 'attack_imminent',
        text: "We're shutting down the mill. Get whatever materials you've got inside the walls.",
      },
    ],
  },
  garn: {
    id: 'garn',
    name: 'Garn Picknose',
    role: 'quarry_foreman',
    backstory:
      'Garn oversees stone gathering around the village. There is no formal deep quarry; the workers instead harvest usable stone from exposed rock formations and the remains of ruined structures surrounding the settlement.',
    dialogueOptions: [
      { circumstance: 'first_meeting', text: "Stone's out there. Pickaxe is how you get it." },
      {
        circumstance: 'ask_how_to_gather',
        text: "Walk up to a rock deposit and use your pickaxe. Keep working and it'll give you stone.",
      },
      {
        circumstance: 'collection_speed',
        text: 'You get one stone for every stretch of time you spend working the deposit. Better tools make the work more efficient.',
      },
      { circumstance: 'deposit_depleted', text: "That one's finished. Find another rock deposit." },
      {
        circumstance: 'stone_delivered',
        text: 'Good load. Keep bringing it. Strong walls consume a shocking amount of stone.',
      },
      {
        circumstance: 'ask_about_trebuchet_ammunition',
        text: 'Keep some pieces large and dense. Those make better trebuchet ammunition than loose rubble.',
      },
      {
        circumstance: 'quest_active',
        text: 'Every stone you bring back is another piece of the wall between us and the dead.',
      },
      {
        circumstance: 'attack_imminent',
        text: "Drop the tools and head inside. We're not losing workers before the fighting even starts.",
      },
    ],
  },
  sedge: {
    id: 'sedge',
    name: 'Sedge Quickclaw',
    role: 'soldier',
    backstory:
      'Sedge is one of the younger members of the village militia. He joined after losing his older brother in an early necromancer raid. He is fast, alert, and eager to prove that he can protect the village.',
    dialogueOptions: [
      { circumstance: 'first_meeting', text: "I'm on watch. Keep moving." },
      { circumstance: 'command_follow', text: "Understood. I'll follow." },
      { circumstance: 'command_stay', text: "I'll hold this position." },
      { circumstance: 'command_patrol', text: "I'll patrol the area." },
      { circumstance: 'follow_active', text: 'Still with you.' },
      { circumstance: 'stay_active', text: "I'm holding position." },
      { circumstance: 'patrol_active', text: "I'm sweeping the area." },
      {
        circumstance: 'patrol_return',
        text: 'Nothing moving nearby. Nothing I could see, anyway.',
      },
      { circumstance: 'enemy_spotted', text: 'Movement! Out there!' },
      { circumstance: 'attack_imminent', text: "They're coming!" },
    ],
  },
  hobb: {
    id: 'hobb',
    name: 'Hobb Greycloak',
    role: 'soldier',
    backstory:
      'Hobb has served as a village guard for most of his adult life. He is quiet, dependable, and particularly protective of the main gate, which he has repaired after every previous attack.',
    dialogueOptions: [
      { circumstance: 'first_meeting', text: 'State your business, then keep clear of the gate.' },
      { circumstance: 'command_follow', text: "Aye. I'll follow." },
      { circumstance: 'command_stay', text: "I'll hold here." },
      { circumstance: 'command_patrol', text: 'Patrolling.' },
      { circumstance: 'follow_active', text: 'Lead on.' },
      { circumstance: 'patrol_return', text: 'Perimeter is clear for now.' },
      { circumstance: 'gate_under_attack', text: "Gate's taking a beating!" },
      { circumstance: 'enemy_breach', text: "They're through the outer defenses!" },
    ],
  },
  marta: {
    id: 'marta',
    name: 'Marta Redwhisker',
    role: 'soldier',
    backstory:
      "Marta is the most experienced fighter in the militia and acts as its unofficial captain. She is skilled at keeping frightened villagers organized and is trusted by the mayor to coordinate the town's defense.",
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: "You want to help? Then listen when you're given an order.",
      },
      { circumstance: 'command_follow', text: "I'll follow your lead." },
      { circumstance: 'command_stay', text: "I'll defend this position." },
      { circumstance: 'command_patrol', text: "I'll sweep the perimeter." },
      { circumstance: 'follow_active', text: "I'm with you." },
      { circumstance: 'stay_active', text: 'This position is secure.' },
      { circumstance: 'patrol_active', text: "I'm checking the perimeter." },
      { circumstance: 'patrol_return', text: 'No movement on the perimeter.' },
      { circumstance: 'attack_imminent', text: 'Positions! Everyone to the walls!' },
      { circumstance: 'enemy_breach', text: "They're inside! Fall back!" },
      { circumstance: 'after_victory', text: "We held. That's all that matters." },
    ],
  },
  pru: {
    id: 'pru',
    name: 'Pru Bristleback',
    role: 'soldier',
    backstory:
      'Pru worked at the lumber yard before joining the militia. She is physically strong, practical, and still carries a spear with a shaft she made herself.',
    dialogueOptions: [
      { circumstance: 'first_meeting', text: "Don't mind the spear. It's mostly for monsters." },
      { circumstance: 'command_follow', text: 'Right behind you.' },
      { circumstance: 'command_stay', text: "I'll stay here." },
      { circumstance: 'command_patrol', text: "I'll check the perimeter." },
      { circumstance: 'follow_active', text: 'Still with you.' },
      { circumstance: 'patrol_return', text: 'Nothing obvious out there.' },
      { circumstance: 'after_victory', text: 'My spear survived. Good enough for me.' },
    ],
  },
  nella: {
    id: 'nella',
    name: 'Nella Softstep',
    role: 'townsfolk',
    backstory:
      'Nella is the village seamstress and quietly one of its best sources of information. She notices everything happening around town and often knows which villagers are frightened or preparing for trouble before anyone else does.',
    dialogueOptions: [
      { circumstance: 'first_meeting', text: "You're the Crawlers everyone is talking about." },
      {
        circumstance: 'ask_about_town',
        text: "Everyone's afraid. They just don't want to be the first one to say it.",
      },
      {
        circumstance: 'quest_active',
        text: "I've been sewing gloves for the workers. Losing fingers to axes before the monsters arrive would be embarrassing.",
      },
      { circumstance: 'attack_imminent', text: "They're here." },
      { circumstance: 'after_victory', text: 'Tomorrow might almost feel normal.' },
    ],
  },
  cricket: {
    id: 'cricket',
    name: 'Cricket Mudwhisk',
    role: 'townsfolk',
    backstory:
      'Cricket maintains the village wells and drainage systems. He spends most of his life covered in mud and considers that an acceptable price for keeping the town supplied with clean water.',
    dialogueOptions: [
      { circumstance: 'first_meeting', text: "Well's that way. Don't fall in it." },
      {
        circumstance: 'ask_about_village',
        text: "Water's good. Food's getting tight. Spirits are worse.",
      },
      {
        circumstance: 'quest_active',
        text: "I've moved the water barrels behind the inner defenses.",
      },
      {
        circumstance: 'attack_imminent',
        text: "Wells are sealed. Whatever happens, we're keeping the water clean.",
      },
      { circumstance: 'after_victory', text: "The wells are fine. That's something." },
    ],
  },
  wicker: {
    id: 'wicker',
    name: 'Wicker Longtooth',
    role: 'townsfolk',
    backstory:
      "Wicker is the village carpenter and repairman. He builds doors, carts, ladders, shutters, and most of the structures nobody else has time to construct. During the siege, he helps reinforce the town's wooden defenses.",
    dialogueOptions: [
      { circumstance: 'first_meeting', text: 'Need something fixed?' },
      {
        circumstance: 'quest_active',
        text: "Bring boards here and I'll turn them into something sturdier.",
      },
      {
        circumstance: 'wooden_wall_built',
        text: "That'll hold for a while. Don't ask me how long 'a while' is.",
      },
      {
        circumstance: 'stone_upgrade_available',
        text: "Stone can reinforce that. It'll cost more, but it'll take more punishment.",
      },
      { circumstance: 'attack_imminent', text: "I've barred every door that still closes." },
      {
        circumstance: 'after_victory',
        text: "Give me some time and I'll make this place look like a village again.",
      },
    ],
  },
  midge: {
    id: 'midge',
    name: 'Midge Candleear',
    role: 'townsfolk',
    backstory:
      "Midge maintains the village lamps and warning bell. She has become unusually good at spotting movement in the surrounding ruins and was the first villager to realize the necromancer's attacks were changing.",
    dialogueOptions: [
      {
        circumstance: 'first_meeting',
        text: 'There were lights in the ruins last night. Blue ones.',
      },
      {
        circumstance: 'ask_about_necromancer',
        text: "It used to come from the east. Lately it's been testing the southern road too.",
      },
      {
        circumstance: 'quest_active',
        text: "I've marked where we've seen movement. A patrol there might be useful.",
      },
      { circumstance: 'attack_imminent', text: "Bell! They're moving through the ruins!" },
      {
        circumstance: 'after_victory',
        text: "I'll ring the bell tomorrow. Hopefully it'll mean something good.",
      },
    ],
  },
} as const;

export function line(id: VillagerId, c: Circumstance): string | undefined {
  const entry = VILLAGER_TABLE[id];
  const found = entry.dialogueOptions.find((option) => option.circumstance === c);
  return found?.text;
}

export function villagerEntry(id: VillagerId): VillagerEntry {
  return VILLAGER_TABLE[id];
}
