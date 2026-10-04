// GRAINS — the shared sprite "skins" for the film's one recurring particle: bubble, snow, sand,
// ash, ember, seed tuft, snowflake, star. Every world draws its grains with createParticles()
// from ./particles.js and one of these fragment bodies, so a grain looks like the same kind of
// thing in every shot. Each body computes `col` (premultiplied, for additive blending) from
// `uv` (-1..1 across the quad) and `vColor` (linear rgb, a = opacity).
//
//   createParticles({ ..., fragment: GRAIN_FRAG.bubble, blending: 'additive' })
//
// Lens character: anamorphic, so out-of-focus discs are ovals 1 : 1.5 (taller than wide).

const OVAL = /* glsl */ `vec2 q = vec2(uv.x * 1.5, uv.y); float r = length(q);`;

export const GRAIN_FRAG = {
  // Tiny in-focus point: tight gaussian core with a faint skirt.
  point: /* glsl */ `
    float r2 = dot(uv, uv);
    float a = exp(-r2 * 9.0) + 0.12 * exp(-r2 * 2.0);
    a *= 1.0 - smoothstep(0.8, 1.0, r2);
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,

  // Out-of-focus disc (ice bubble near the lens, far seed, snow in front of the lens):
  // flat oval with a slightly brighter rim and a soft edge.
  bubble: /* glsl */ `
    ${OVAL}
    float disc = 1.0 - smoothstep(0.86, 1.0, r);
    float rim = smoothstep(0.62, 0.9, r) * disc;
    float a = disc * (0.42 + 0.58 * rim);
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,

  // Strongly out-of-focus highlight (macro bokeh): the same oval as `bubble`, creamier — a nearly
  // flat disc with only a breath of rim, so that overlapping discs melt into each other.
  bokeh: /* glsl */ `
    ${OVAL}
    float disc = 1.0 - smoothstep(0.8, 1.0, r);
    float rim = smoothstep(0.7, 0.93, r) * disc;
    float a = disc * (0.72 + 0.28 * rim);
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,

  // Snow / spindrift / ash: soft, slightly flattened fleck.
  snow: /* glsl */ `
    float r2 = dot(uv * vec2(1.0, 1.25), uv * vec2(1.0, 1.25));
    float a = exp(-r2 * 5.0) * (1.0 - smoothstep(0.75, 1.0, r2));
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,

  // Sand / silt: small hard-edged grain with a specular glint on its upper left.
  sand: /* glsl */ `
    float r = length(uv);
    float body = 1.0 - smoothstep(0.55, 0.8, r);
    float glint = exp(-dot(uv - vec2(-0.2, 0.25), uv - vec2(-0.2, 0.25)) * 14.0);
    float a = body * (0.7 + 0.9 * glint);
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * body);`,

  // Ember: white-hot core, orange skirt.
  ember: /* glsl */ `
    float r2 = dot(uv, uv);
    float core = exp(-r2 * 18.0), skirt = exp(-r2 * 3.5) * (1.0 - smoothstep(0.7, 1.0, r2));
    col = vec4((vColor.rgb * skirt + vec3(1.0, 0.9, 0.7) * core) * vColor.a, vColor.a * skirt);`,

  // Seed tuft: bright core, soft halo, six hair-fine rays (the silk seen in sunlight).
  tuft: /* glsl */ `
    float r = length(uv), ang = atan(uv.y, uv.x);
    float core = exp(-r * r * 60.0);
    float halo = exp(-r * r * 5.0) * 0.35;
    float rays = pow(abs(cos(ang * 3.0)), 48.0) * exp(-r * 3.2) * 0.8;
    float a = (core + halo + rays) * (1.0 - smoothstep(0.85, 1.0, r));
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,

  // Star: needle-sharp core with a faint horizontal anamorphic streak.
  star: /* glsl */ `
    float r2 = dot(uv, uv);
    float core = exp(-r2 * 40.0);
    float streak = exp(-uv.y * uv.y * 260.0) * exp(-uv.x * uv.x * 3.0) * 0.25;
    float a = (core + streak) * (1.0 - smoothstep(0.8, 1.0, r2));
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,

  // Water drop in the air (use blending 'normal'): a dark lens with a bright rim, a hot highlight
  // and the light it gathers at its bottom.
  drop: /* glsl */ `
    float r = length(uv * vec2(1.12, 1.0));
    float body = 1.0 - smoothstep(0.72, 0.82, r);
    float rim = smoothstep(0.3, 0.76, r) * body;
    vec2 hp = uv - vec2(-0.26, 0.3);
    float hi = exp(-dot(hp, hp) * 34.0);
    vec2 lp = uv - vec2(0.12, -0.42);
    float lo = exp(-dot(lp, lp) * 9.0) * body;
    vec3 c = vColor.rgb * (0.10 + 0.45 * rim + 0.9 * lo) + vec3(hi * 2.5 * dot(vColor.rgb, vec3(0.3333)));
    col = vec4(c * vColor.a * body, vColor.a * body * 0.55);`,

  // Rain streak (additive): a thin slanted line, brighter toward its head.
  rain: /* glsl */ `
    vec2 q = vec2(uv.x + 0.18 * uv.y, uv.y);
    float a = exp(-q.x * q.x * 900.0) * smoothstep(1.0, 0.2, abs(uv.y)) * (0.75 - 0.25 * uv.y);
    col = vec4(vColor.rgb * vColor.a * a, vColor.a * a);`,
};
