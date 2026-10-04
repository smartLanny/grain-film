// Shot owned by Group A (SCRIPT.md 8.4): S20, the migration, in FIELD (W5). Its time is fixed by
// SCRIPT.md section 4 (02:58.0 to 03:12.0 = 178..192); it comes in from S19 on a 0.5 s SHEEN
// ("match on the upward stream") and cuts to S21 on the descent.
// FIELD also serves: GRASS's backplate (createFieldBackplate), and the portal frame S14 shows in its
// drop (engine.portal('S20', 180.0)): nothing at 180.0 depends on anything before it.
//
// The camera is the world's own (worlds/field.js `flight(t)`: 12 m/s west along the river, 3 m -> 12 m
// -> 2 m above the meadow, 28 mm, the final tilt down into the grass). The lens is the world's too:
// `focus` 0..1 is the pull to 1 m (03:08.0 to 03:10.5), which also sizes the discs that flowers and
// windows become (X11); `hero` is the film time at which our butterfly is in focus by the lens.
import { shot, lookPost, abs, sheen, MERGED_INK } from './_shot.js';

// The grade of S20. It tints nothing: the world paints in the script's palette (SCRIPT.md W5: horizon #FFB25E,
// sky #C4553A to #1B2440, grass #E9B44C on #2E3B1F, the flowers, the city's ink) as the radiance that THIS grade
// returns to those colours, so it is told the grade (params.grade must equal the post values below).
const GRADE = { exposure: -0.8, tint: [1, 1, 1], contrast: 1.08, saturation: 1.1 };

export const shots = [
  shot('S20', 'field', {
    transitionIn: sheen(0.5),
    params: {
      flock: 1, walker: 1,                                     // the walker is passed 03:01 to 03:07 (walkerD in the world)
      sunElevation: abs([[185, 6], [190, -2]]),                // 03:05 to 03:10 the sun goes
      sunAzimuth: -12,                                         // into the notch south of the mountain
      cityLights: abs([[185, 0], [190, 1]]),                   // ... and the city's windows light one by one
      focus: abs([[188.0, 0], [190.5, 1]], 'inOutSine'),       // 03:08.0 to 03:10.5 focus comes close
      hero: 190.25,                                            // 03:10 our butterfly, by the lens; then it peels away
      cloudCover: 0.38, grade: GRADE,
      exposure: abs([[188.2, 0], [191.4, 1.2]], 'inOutSine'),   // EV on the land and its light: the eye opens as the light goes
    },
    post: lookPost('S20', {
      // the merged look (one setting for S19 to S22): ink line over a continuous colour wash. Little mist: the
      // city stands in its own, and the sky must keep its colour
      ink: { ...MERGED_INK, mist: 0.18, mistRange: [30, 300] },
      exposure: GRADE.exposure, tint: GRADE.tint, contrast: GRADE.contrast, saturation: GRADE.saturation,
    }),
    shutter: abs([[190.8, 0.8], [192, 0.5]]),                  // 0.8 for the wings; shorter as the lens comes down into the grass
  }),
];

export const cards = [];
