// TITLE CARDS — merged from src/shots/<group>.js (each owner keeps the cards for its own shots).
// Schema: see src/titles.js header / docs/architecture.md ("Title cards"). Text and timing: docs/story.md section 5.

import { cards as ice } from './shots/ice.js';
import { cards as valley } from './shots/valley.js';
import { cards as tree } from './shots/tree.js';
import { cards as macro } from './shots/macro.js';

export const cards = [...ice, ...valley, ...tree, ...macro].sort((a, b) => a.start - b.start);
