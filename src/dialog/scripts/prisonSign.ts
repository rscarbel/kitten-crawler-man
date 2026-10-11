/** What the PRISON sign beside the stealth gate room's prison door says, if read. */

import { transientSpeaker } from '../line';

const sign = transientSpeaker('Sign', 'sign');

export const prisonSignLine = sign.line('GOBLIN HIGH SECURITY PRISON. NO ESCAPES SINCE TUESDAY.');
