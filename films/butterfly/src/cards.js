// TITLE CARDS — merged from src/shots/<group>.js (each owner keeps the cards for its own shots).
// Schema: see src/titles.js header / ENGINE.md ("Title cards"). Text and timing: SCRIPT.md section 5.
// Only L1 (over picture), L2 and E (on paper) are cards; T1 (resist, CITY) and C0 (scales, SCALE)
// are drawn by their worlds.

import { cards as city } from './shots/city.js';
import { cards as interior } from './shots/interior.js';
import { cards as macro } from './shots/macro.js';
import { cards as field } from './shots/field.js';
import { cards as paper } from './shots/paper.js';

export const cards = [...city, ...interior, ...macro, ...field, ...paper].sort((a, b) => a.start - b.start);
