// TIMELINE — the film is a pure function of time; this file says what is on screen when.
// Schema: see ENGINE.md ("Timeline"). Shots live in src/shots/<group>.js, one file per owner, so
// worlds can be built in parallel; this file only merges them. Times come from src/lib/story.js.
//   city.js      CITY      S01 S09 S10 S15 S17 S18 S19
//   interior.js  INTERIOR  S02 S04a S08 S11 S14 S16
//   macro.js  Group B  S03 S04b S05 S06 S07 S12 S13 S21 S22
//   field.js  Group A  S20
//   paper.js  Group A  S23 S24

import { shots as city } from './shots/city.js';
import { shots as interior } from './shots/interior.js';
import { shots as macro } from './shots/macro.js';
import { shots as field } from './shots/field.js';
import { shots as paper } from './shots/paper.js';
import { DURATION as STORY_DURATION } from './lib/story.js';

/** Film-wide look (merged over DEFAULT_POST in src/post.js; worlds and shots override it). */
export const LOOK = {
  letterbox: 0,   // 18:9 delivery: the picture is the whole 2160x1080 frame, no black bars
};

export const shots = [...city, ...interior, ...macro, ...field, ...paper].sort((a, b) => a.start - b.start);

/** Film length in seconds. Audio renders exactly this long. */
export const DURATION = 240;
if (STORY_DURATION !== DURATION) console.warn(`[timeline] DURATION ${DURATION} != story.DURATION ${STORY_DURATION}`);
