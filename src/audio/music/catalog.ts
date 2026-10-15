import type { MusicTrackId } from '../sounds';

/** Where a song is heard, in the order the music page lists them. */
export const MUSIC_AREA_IDS = [
  'dungeon',
  'over_city',
  'wilds',
  'briar_hollow',
  'circus',
  'desperado_club',
  'interiors',
  'battles',
  'activities',
] as const;

export type MusicAreaId = (typeof MUSIC_AREA_IDS)[number];

export const MUSIC_AREA_LABELS = {
  dungeon: 'Dungeon',
  over_city: 'Over City',
  wilds: 'Wilds',
  briar_hollow: 'Briar Hollow',
  circus: 'Circus',
  desperado_club: 'Desperado Club',
  interiors: 'Interiors',
  battles: 'Battles',
  activities: 'Activities',
} as const satisfies Record<MusicAreaId, string>;

/** Who made a recording: a real name, an uploader's username, or both. */
export type MusicAuthor =
  | { readonly authorName: string; readonly authorUsername?: string }
  | { readonly authorUsername: string; readonly authorName?: string };

export type MusicAttribution = MusicAuthor & {
  readonly originalTitle: string;
  /** Where the recording was licensed from; absent for the user's own compositions. */
  readonly source?: 'Pixabay';
};

export interface MusicTrackDef {
  /** The name the game shows, which may differ from the recording's own title. */
  readonly title: string;
  readonly area: MusicAreaId;
  readonly attribution: MusicAttribution;
}

export const MUSIC_CATALOG = {
  tutorial_island: {
    title: 'Tutorial Island',
    area: 'dungeon',
    attribution: { authorUsername: 'Lesiakower', originalTitle: 'Waiting Time', source: 'Pixabay' },
  },
  bg_level_1: {
    title: 'Welcome to the Crawl',
    area: 'dungeon',
    attribution: {
      authorName: 'Gavin Mogensen',
      authorUsername: 'Fronbondi_Skegs',
      originalTitle: 'DRONE - Heart Racing Action - Ambient Background Track',
      source: 'Pixabay',
    },
  },
  bg_level_2: {
    title: 'The Second Floor Holds Its Breath',
    area: 'dungeon',
    attribution: {
      authorUsername: 'Monume',
      originalTitle: 'Tense Suspense Background Music',
      source: 'Pixabay',
    },
  },
  town_music_1: {
    title: 'Cobblestones and Coin Purses',
    area: 'over_city',
    attribution: {
      authorName: 'Yasuko n',
      authorUsername: '_Yasuko_',
      originalTitle: 'Village Courtyard Stroll',
      source: 'Pixabay',
    },
  },
  town_music_2: {
    title: 'The Jester Owes Rent',
    area: 'over_city',
    attribution: {
      authorUsername: 'VifotoFreeSounds',
      originalTitle: 'Funny Medieval Instrumental',
      source: 'Pixabay',
    },
  },
  riverside_welcome: {
    title: 'Riverside Welcome',
    area: 'over_city',
    attribution: { authorName: 'Ryan Scarbel', originalTitle: 'Riverside Welcome' },
  },
  forest_path: {
    title: 'Where the Path Forgets You',
    area: 'wilds',
    attribution: {
      authorName: 'Geoff Harvey',
      authorUsername: 'geoffharvey',
      originalTitle: 'Dark Goddess',
      source: 'Pixabay',
    },
  },
  terrifying_woods: {
    title: 'Terrifying Woods',
    area: 'wilds',
    attribution: { authorName: 'Ryan Scarbel', originalTitle: 'Terrifying Woods' },
  },
  old_quarter_evening_ending: {
    title: 'Old Quarter Evening',
    area: 'wilds',
    attribution: { authorName: 'Ryan Scarbel', originalTitle: 'Old Quarter Evening (Ending)' },
  },
  briar_hollow_theme: {
    title: 'Hearthsmoke Over Briar Hollow',
    area: 'briar_hollow',
    attribution: { authorUsername: 'kmacleod', originalTitle: 'The Britons', source: 'Pixabay' },
  },
  medieval_harvest_theme: {
    title: 'Songs of the Stonecutters',
    area: 'briar_hollow',
    attribution: { authorUsername: 'dominic251', originalTitle: 'Woods', source: 'Pixabay' },
  },
  under_the_willows: {
    title: 'Under the Willows',
    area: 'briar_hollow',
    attribution: { authorName: 'Ryan Scarbel', originalTitle: 'Under the Willows' },
  },
  hayfield_afternoon: {
    title: 'Hayfield Afternoon',
    area: 'briar_hollow',
    attribution: { authorName: 'Ryan Scarbel', originalTitle: 'Hayfield Afternoon' },
  },
  siege_theme: {
    title: 'Hold the Palisade',
    area: 'briar_hollow',
    attribution: {
      authorUsername: 'MondaMusic',
      originalTitle: 'Battle - Battle Music',
      source: 'Pixabay',
    },
  },
  circus_theme_1: {
    title: 'Cabaret for the Condemned',
    area: 'circus',
    attribution: {
      authorName: 'Alana Jordan',
      authorUsername: 'alanajordan',
      originalTitle: 'Dark Cabaret 01',
      source: 'Pixabay',
    },
  },
  circus_theme_2: {
    title: 'The Ringmaster Is Smiling',
    area: 'circus',
    attribution: {
      authorUsername: 'AstronautFlute',
      originalTitle: 'The Creepy Circus',
      source: 'Pixabay',
    },
  },
  circus_theme_3: {
    title: 'Sawdust and Greasepaint',
    area: 'circus',
    attribution: {
      authorName: 'Ksenia Nikolaeva',
      authorUsername: 'TOP_SUE',
      originalTitle: 'Dark Circus',
      source: 'Pixabay',
    },
  },
  circus_battle: {
    title: 'Send in the Clowns (Armed)',
    area: 'circus',
    attribution: {
      authorUsername: 'FreeMusicLab',
      originalTitle: 'Horror, Suspense - Mad Circus',
      source: 'Pixabay',
    },
  },
  desperado_club_1: {
    title: 'Last Call at the Desperado',
    area: 'desperado_club',
    attribution: {
      authorName: 'Louis King',
      authorUsername: 'landomp3',
      originalTitle: 'Sundown',
      source: 'Pixabay',
    },
  },
  desperado_club_2: {
    title: "Bouncer's Cardio",
    area: 'desperado_club',
    attribution: {
      authorName: 'Daniil Kharlamov',
      authorUsername: 'Watermello',
      originalTitle: 'Sport Techno',
      source: 'Pixabay',
    },
  },
  desperado_club_3: {
    title: 'Fog Machine Liturgy',
    area: 'desperado_club',
    attribution: {
      authorName: 'Nicholas Panek',
      authorUsername: 'NickPanek',
      originalTitle: 'Heavy German Techno Beat – Dark Industrial Instrumental',
      source: 'Pixabay',
    },
  },
  desperado_club_4: {
    title: 'Strobe Interlude',
    area: 'desperado_club',
    attribution: {
      authorName: 'Daniil Kharlamov',
      authorUsername: 'Watermello',
      originalTitle: 'Aggressive Electro Chase',
      source: 'Pixabay',
    },
  },
  casino_background_jazz_1: {
    title: 'Chips on the Felt',
    area: 'desperado_club',
    attribution: {
      authorName: 'Art Roseman',
      authorUsername: 'Art_Roseman',
      originalTitle: 'Big Band Swing Jazz',
      source: 'Pixabay',
    },
  },
  casino_background_jazz_2: {
    title: 'Smoke Over the Card Table',
    area: 'desperado_club',
    attribution: {
      authorUsername: 'Music_Flow',
      originalTitle: 'Royalty Free Jazz YouTube - Whisper Lounge',
      source: 'Pixabay',
    },
  },
  casino_background_jazz_3: {
    title: "High Rollers' Swing",
    area: 'desperado_club',
    attribution: {
      authorName: 'Anastasia Chubarova',
      authorUsername: 'Music_For_Videos',
      originalTitle: 'Big Band Jazz',
      source: 'Pixabay',
    },
  },
  casino_background_jazz_4: {
    title: "Lady Luck's Slow Dance",
    area: 'desperado_club',
    attribution: {
      authorUsername: 'Tunetank',
      originalTitle: 'Romantic Love Jazz',
      source: 'Pixabay',
    },
  },
  tavern_music_1: {
    title: 'Another Round for the Crawlers',
    area: 'interiors',
    attribution: {
      authorUsername: 'Tunetank',
      originalTitle: 'Medieval Festive Music',
      source: 'Pixabay',
    },
  },
  tavern_music_2: {
    title: "The Barmaid's Jig",
    area: 'interiors',
    attribution: {
      authorUsername: 'Tunetank',
      originalTitle: 'Medieval Happy Music',
      source: 'Pixabay',
    },
  },
  building_default_music_1: {
    title: 'Wipe Your Feet, Crawler',
    area: 'interiors',
    attribution: {
      authorUsername: 'Tunetank',
      originalTitle: 'Medieval Happy Music',
      source: 'Pixabay',
    },
  },
  guildhall_waltz: {
    title: 'Guildhall Waltz',
    area: 'interiors',
    attribution: { authorName: 'Ryan Scarbel', originalTitle: 'Guildhall Waltz' },
  },
  big_tower_1: {
    title: 'The Tower Keeps Climbing',
    area: 'interiors',
    attribution: {
      authorUsername: 'DELOSound',
      originalTitle: 'Medieval Background',
      source: 'Pixabay',
    },
  },
  temple_music: {
    title: 'Vespers Above the Clouds',
    area: 'interiors',
    attribution: {
      authorUsername: 'MusicInMedia',
      originalTitle: 'Sacred Chant - Spiritual Religious Choir',
      source: 'Pixabay',
    },
  },
  boss_music_1: {
    title: 'Mine, Mine, All of It',
    area: 'battles',
    attribution: {
      authorName: 'Douglas Gustafson',
      authorUsername: 'Psychronic',
      originalTitle: 'Binary Battle',
      source: 'Pixabay',
    },
  },
  boss_music_2: {
    title: 'Last Rites, Extra Pulp',
    area: 'battles',
    attribution: {
      authorName: 'Douglas Gustafson',
      authorUsername: 'Psychronic',
      originalTitle: 'Dimensional Nexus',
      source: 'Pixabay',
    },
  },
  boss_music_3: {
    title: 'Dance for the Viewers',
    area: 'battles',
    attribution: {
      authorName: 'Douglas Gustafson',
      authorUsername: 'Psychronic',
      originalTitle: 'Sinister Dance',
      source: 'Pixabay',
    },
  },
  brace_for_the_horde: {
    title: 'Brace for the Horde',
    area: 'battles',
    attribution: { authorName: 'Ryan Scarbel', originalTitle: 'Prepare to Defend' },
  },
  fix_the_plumbing_music: {
    title: 'Plunger Ballet',
    area: 'activities',
    attribution: {
      authorName: 'Ievgen Poltavskyi',
      authorUsername: 'HitsLab',
      originalTitle: 'Quirky - Quirky Sneaky Music',
      source: 'Pixabay',
    },
  },
  stealth_music: {
    title: 'Tiptoe Past the Warden',
    area: 'activities',
    attribution: {
      authorName: 'Omar Faruque',
      authorUsername: 'DesiFreeMusic',
      originalTitle: 'Stealth Mission Secret Spy Background Music for Covert Ops',
      source: 'Pixabay',
    },
  },
  keyboard_hero_music_track_1: {
    title: 'Eight Legs, Eight Bits',
    area: 'activities',
    attribution: {
      authorName: 'Krzysztof Szymanski',
      authorUsername: 'DJARTMUSIC',
      originalTitle: 'The Return Of The 8-bit Era',
      source: 'Pixabay',
    },
  },
} as const satisfies Record<MusicTrackId, MusicTrackDef>;

const ORIGINAL_COMPOSITION_LABEL = 'Original';

function authorCredit(author: MusicAuthor): string {
  const { authorName, authorUsername } = author;
  if (authorName !== undefined && authorUsername !== undefined) {
    return `${authorName} (${authorUsername})`;
  }
  return authorName ?? authorUsername ?? '';
}

/**
 * The one-line credit for a song, e.g.
 * `"Binary Battle" by Douglas Gustafson (Psychronic) · Pixabay`.
 */
export function formatAttribution(def: MusicTrackDef): string {
  const { attribution } = def;
  const source = attribution.source ?? ORIGINAL_COMPOSITION_LABEL;
  return `"${attribution.originalTitle}" by ${authorCredit(attribution)} · ${source}`;
}
