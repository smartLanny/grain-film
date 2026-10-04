// Shared helpers for the four shot files (city.js, macro.js, field.js, paper.js). Owner: Group A.
// Data only: times come from lib/story.js, never from numbers typed here.
import { SHOT, lookInk, lookInkMax, INK_GRAIN } from '../lib/story.js';

/** A timeline entry for shot `id` in `world` (start/end from story.SHOT). */
export const shot = (id, world, rest = {}) => ({ id, start: SHOT[id][0], end: SHOT[id][1], world, ...rest });

/**
 * The shot's LOOK (SCRIPT.md 7.3) as post settings, with your own post merged over it:
 *   post: lookPost('S12', { exposure: -0.5, ink: { mist: 0.4 } })
 * -> { ink: { amount, chroma (keyframed where the table gives a range), ...yours }, grain, ...yours }.
 * Grain drops to story.INK_GRAIN (0.015) where ink exceeds 0.7 (SCRIPT.md 7.1: the paper has tooth),
 * and bloom / halation drop to a third there: on a pale sheet the default bloom lifts every thin
 * black line to grey before the INK pass reads it. A lamp that should glow sets its own bloom.
 * Pools and paperScroll usually come from the world (world.post().ink); ink merges key by key.
 */
export function lookPost(id, post = {}) {
  const base = { ink: lookInk(id) };
  if (lookInkMax(id) > 0.7) { base.grain = INK_GRAIN; base.bloom = 0.015; base.halation = 0.04; }
  return { ...base, ...post, ink: { ...base.ink, ...(post.ink || {}) } };
}

/**
 * The merged look of the ending (SCRIPT.md 7.3: "ink line, full colour wash, in equal measure"; S19 to
 * S22 share it so the film arrives at ONE manner): the colour wash is continuous (the INK pass never
 * steps or stipples a saturated wash), the drawing is ink: a broad contour on near things, the dark
 * side of crisp edges, thin dark things as line, the darkest masses in the five tones, the paper's
 * tooth through the sky. Use with the table's own amounts (ink about 0.5):
 *   post: lookPost('S21', { ink: { ...MERGED_INK } })
 * `wet` stays low because the cameras of S19 and S20 are free; locked frames (S21, S22) may raise it.
 */
export const MERGED_INK = Object.freeze({ line: 1, lineWidth: 1.8, dry: 0.45, rake: 0.6, wet: 0.4 });

/** Keyframes in film seconds: abs([[t0, v0], [t1, v1]], 'inOutSine'). */
export const abs = (keys, ease) => ({ keys, time: 'absolute', ...(ease ? { ease } : {}) });

/** The SHEEN transition (SCRIPT.md 3.0): 18° from vertical, left to right. (The script's 12% of picture
 *  width read as a hard blue bar in the film; it is 18% with a lower gain.) */
export const sheen = (duration, extra = {}) => ({ type: 'sheen', duration, angle: 18, width: 0.18, dir: 1, ...extra });
