import { speakerLines } from '../../line';

const say = speakerLines('recruiter');

/** Corporal Bristle's two lines: the plea that starts the questline, and his thanks once it is under way. */
export const RECRUITER = {
  recruit: say.line(
    'Please help us. Our small village nearby is in grave danger. Go and speak with our mayor for more details.',
  ),
  thanks: say.line(
    "I'm in town looking for more recruits to help us. I got word that you're helping defend the town, thank you so much! We are very grateful!",
  ),
} as const;
