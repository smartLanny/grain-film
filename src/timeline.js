// TIMELINE — the film is a pure function of time; this file says what is on screen when.
// Schema: see docs/architecture.md ("Timeline"). Shots live in src/shots/<group>.js, one file per owner, so
// worlds can be built in parallel; this file only merges them. Times come from src/lib/story.js.

import { shots as ice } from './shots/ice.js';
import { shots as valley } from './shots/valley.js';
import { shots as tree } from './shots/tree.js';
import { shots as macro } from './shots/macro.js';

/** Film-wide look (merged over DEFAULT_POST in src/post.js; worlds and shots override it). */
export const LOOK = {
  letterbox: 2.0,
};

export const shots = [...ice, ...valley, ...tree, ...macro].sort((a, b) => a.start - b.start);

/** Film length in seconds. Audio renders exactly this long. */
export const DURATION = 240;
