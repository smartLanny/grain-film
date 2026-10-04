// CITY set `scroll` (S01, S15; shown inside the dew drop of S07): the night panorama as a handscroll.
// One full-frame painting, closed-form in (scroll, time): planes of towers standing in mist, a river
// as a pale wash, a long bridge with an elevated railway and its train of pale dots, the title
// inscription by resist, and the black that is diluted away from the centre at the start.
//
// Painting space: 1 unit = the frame height of S01's framing. x runs along the scroll (the final
// frame of S01 is centred on x = 0; S15 is a second station further along, at x = STATION_B), y is up
// from the bottom edge of S01's frame. Plane i slides by K[i] of the scroll (K = 1 is the paper).

import * as THREE from 'three';
import { INK_OUT, BRUSH, TOWERS, RAIN } from './glsl.js';
import { FONT_STACKS } from '../../titles.js';
import { CARD_LAYOUT } from '../../shots/_card.js';
import { PALETTE, rgb } from '../../lib/story.js';
import { STATION_B, scrollS01 } from './choreo.js';


const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */ `
uniform float uScroll, uZoom, uCentreY, uNight, uMist, uLit, uWash, uTitle, uRain, uGold, uTime, uTrainX, uPx, uNear, uFar, uBright, uAspect;
uniform vec2 uWashCentre;
uniform vec4 uTitleRect;                 // paper space: x0, y0 (lower left), w, h
uniform sampler2D tTitle;
uniform vec3 uGoldSky, uGoldRiver;
varying vec2 vUv;
const float STATION_B = ${STATION_B.toFixed(3)};
const float K[7] = float[7](0.56, 0.64, 0.72, 0.80, 0.90, 0.96, 1.0);
` + BRUSH + /* glsl */ `
// ---- the skylines, art-directed: ranges, valleys, and the places left empty -------------------
float cityEnvelope(int layer, float x) {
  float k = K[layer];
  float xb = x - k * STATION_B;                    // the same place in S15's frame (0 = its centre)
  float n = 0.5 + 0.5 * snoise(vec2(x * 0.9 + float(layer) * 7.3, float(layer) * 1.7));
  float n2 = 0.5 + 0.5 * snoise(vec2(x * 2.3 + float(layer) * 3.1, 4.0));
  float e;
  if (layer == 0) {        // the far peaks: a few very tall ones, alone in the mist
    e = 0.30 + 0.45 * n * n2;
    e += 0.85 * bump(x, -0.50, 0.10) + 0.5 * bump(x, 0.25, 0.07) + 0.5 * bump(x, 1.25, 0.12);
    e *= 1.0 - 0.8 * band(x, 0.36, 1.0, 0.06);     // the sky kept clear for the inscription
    e += 0.8 * bump(xb, 0.78, 0.09) + 0.5 * bump(xb, -1.02, 0.08);
    e *= 1.0 - band(xb, -0.86, 0.36, 0.14);        // S15: the open reach, the horizon
  } else if (layer == 1) {
    e = 0.5 + 0.55 * n;
    e *= 1.0 - 0.5 * band(x, 0.34, 1.0, 0.08);
    e *= 1.0 - 0.6 * band(x, -0.2, 0.16, 0.06);
    e *= 1.0 - band(xb, -0.92, 0.30, 0.12);
  } else if (layer == 2) {
    e = 0.5 + 0.6 * n * (0.6 + 0.4 * n2);
    e *= 1.0 - 0.4 * band(x, 0.05, 0.4, 0.08);
    e *= 1.0 - band(xb, -0.98, 0.22, 0.10);
  } else if (layer == 3) { // the far bank's front row
    e = 0.6 + 0.5 * n2;
    e *= 1.0 - 0.97 * band(xb, -1.05, 0.14, 0.08);
  } else if (layer == 4) { // the near bank: sparse, tall, dark; kept off the river's best reaches
    e = 0.5 * bump(x, 1.45, 0.2) + 0.44 * bump(x, -0.40, 0.035);
    e += 0.75 * bump(xb, 1.02, 0.14) + 0.55 * bump(xb, -1.15, 0.1);
  } else if (layer == 5) { // rooftops along the bottom edge
    e = 0.62 + 0.45 * n;
    e += 0.4 * bump(x, -0.7, 0.12) + 0.55 * bump(x, 0.98, 0.14);
    e *= 1.0 - 0.4 * band(x, 0.12, 0.62, 0.1);
    e += 0.4 * bump(xb, 0.9, 0.2);
    e *= 1.0 - 0.6 * band(xb, -0.8, 0.3, 0.2);
  } else {
    e = 0.6 + 0.5 * n * n2;
    e += 0.35 * bump(x, -0.6, 0.2);
    e *= 1.0 - 0.45 * band(x, -0.28, 0.5, 0.1);
    e *= 1.0 - 0.7 * band(xb, -0.9, 0.5, 0.2);
  }
  return max(e, 0.0);
}
` + TOWERS + RAIN + INK_OUT + /* glsl */ `

// the hero tower (plane 4.5): where the scroll stops. x = 0 is its axis; its bright window is at y = BRIGHT_Y.
const float HERO_HW = 0.062, HERO_TOP = 0.655, HERO_WW = 0.124 / 5.0, HERO_WH = 0.030, BRIGHT_Y = 0.525;
vec4 heroTower(vec2 p, float px, float lit, out float bright) {
  float sd = sdBox(vec2(p.x, p.y - (HERO_TOP - 1.0) * 0.5), vec2(HERO_HW, (HERO_TOP + 1.0) * 0.5));
  sd = min(sd, sdBox(vec2(p.x - 0.006, p.y - 0.60), vec2(0.045, 0.132)));
  sd = min(sd, sdBox(vec2(p.x - 0.013, p.y - 0.70), vec2(0.023, 0.072)));
  float body = cov(sd, px);
  float c = body;
  // a water tank on legs, the mast and its crossbar, a second short aerial
  vec2 t = vec2(p.x + 0.049, p.y - HERO_TOP);
  c = max(c, cov(sdBox(vec2(t.x, t.y - 0.027), vec2(0.0095, 0.010)) - 0.0025, px));
  c = max(c, lineCov(abs(abs(t.x) - 0.008), 0.0013, px) * step(0.0, t.y) * step(t.y, 0.02));
  c = max(c, cov(sdBox(vec2(t.x, t.y - 0.0425), vec2(0.008, 0.0022)), px));
  c = max(c, lineCov(sdSeg(p, vec2(0.013, 0.77), vec2(0.013, 0.885)), 0.0021 * (1.0 - 0.65 * clamp((p.y - 0.77) / 0.115, 0.0, 1.0)), px));
  c = max(c, lineCov(sdSeg(p, vec2(0.006, 0.835), vec2(0.020, 0.835)), 0.0011, px));
  c = max(c, lineCov(sdSeg(p, vec2(0.029, 0.77), vec2(0.029, 0.80)), 0.0013, px));
  // windows: 5 bays; the middle bay holds the bright one
  float col = floor((p.x + HERO_HW) / HERO_WW), row = floor((BRIGHT_Y + 0.5 * HERO_WH - p.y) / HERO_WH);   // row 0 = the bright window's floor
  vec2 fc = vec2(fract((p.x + HERO_HW) / HERO_WW), fract((BRIGHT_Y + 0.5 * HERO_WH - p.y) / HERO_WH));
  vec3 wj = hash32(vec2(col + 3.0, row + 77.0));
  float isHero = step(abs(col - 2.0), 0.5) * step(abs(row), 0.5);
  float near = step(abs(col - 2.0), 1.5) * step(abs(row), 2.5);
  float isLit = max(isHero, step(wj.x, lit * 1.1) * (1.0 - near));
  vec2 wc = (fc - 0.5 + (wj.yz - 0.5) * 0.12 * (1.0 - isHero)) * vec2(HERO_WW, HERO_WH);
  float wsd = sdBox(wc, vec2(HERO_WW, HERO_WH) * mix(vec2(0.2, 0.19), vec2(0.27, 0.25), max(wj.z, isHero))) - HERO_WW * 0.06;
  float inside = cov(sd + HERO_WW * 0.36, px) * step(p.y, 0.76);
  float win = cov(wsd, px) * inside;
  // inside the bright window: the hump of someone asleep at a desk (S02 is this window)
  float hump = cov(length((wc - vec2(-0.0012, -0.0052)) * vec2(1.0, 1.5)) - 0.0034, px);
  bright = isHero * win * (1.0 - hump);
  float litM = win * isLit * (1.0 - isHero) * mix(0.55, 1.0, wj.y);
  float markM = win * (1.0 - isLit) * step(wj.y, 0.55) * (0.5 + 0.5 * wj.z);
  return vec4(c, litM, markM, clamp((p.y + 0.1) / (HERO_TOP + 0.1), 0.0, 1.0));
}
// the dark tower at the left edge of the last frame (repoussoir): slim, unfinished, a crane on it
float leftTower(vec2 p, float px, out float lit) {
  float sd = sdBox(vec2(p.x, p.y + 0.1), vec2(0.07, 0.72));
  sd = min(sd, sdBox(vec2(p.x + 0.018, p.y - 0.66), vec2(0.045, 0.05)));
  float c = cov(sd, px);
  // the open frame of the top floors
  vec2 f = vec2(p.x + 0.063, p.y - 0.71);
  float frame = max(lineCov(abs(fract(f.y / 0.026 + 0.5) - 0.5) * 0.026, 0.0016, px), lineCov(abs(fract(f.x / 0.03 + 0.5) - 0.5) * 0.03, 0.0018, px));
  c = max(c, frame * cov(sdBox(vec2(p.x + 0.018, p.y - 0.755), vec2(0.045, 0.045)), px));
  // the crane: mast, jib toward the picture, ties, counterweight, the hook line hanging in the sky
  float xm = 0.03, jy = 0.905;
  c = max(c, lineCov(sdSeg(p, vec2(xm, 0.62), vec2(xm, jy + 0.03)), 0.0032, px));
  c = max(c, lineCov(sdSeg(p, vec2(xm - 0.09, jy), vec2(xm + 0.27, jy - 0.004)), 0.0024, px));
  c = max(c, lineCov(sdSeg(p, vec2(xm, jy + 0.03), vec2(xm + 0.24, jy - 0.003)), 0.001, px));
  c = max(c, lineCov(sdSeg(p, vec2(xm + 0.2, jy - 0.003), vec2(xm + 0.2, 0.79)), 0.0009, px));
  c = max(c, cov(sdBox(p - vec2(xm + 0.2, 0.785), vec2(0.004, 0.006)), px));
  float col = floor((p.x + 0.07) / 0.02), row = floor(p.y / 0.027);
  vec3 wj = hash32(vec2(col + 91.0, row + 13.0));
  vec2 wc = (vec2(fract((p.x + 0.07) / 0.02), fract(p.y / 0.027)) - 0.5) * vec2(0.02, 0.027);
  lit = cov(sdBox(wc, vec2(0.0032, 0.004)) - 0.001, px) * cov(sd + 0.008, px) * step(wj.x, 0.05) * step(p.y, 0.6);
  return c;
}
// the long bridge with its elevated railway (plane between the banks)
const float DECK_Y = 0.258;
float bridgeDeckY(float x) { return DECK_Y + 0.006 * cos(x * 1.1); }
float pylon(vec2 p, float xp, float px) {
  float dy = bridgeDeckY(xp), top = dy + 0.21;
  float c = lineCov(sdSeg(p, vec2(xp, dy - 0.07), vec2(xp, top)), 0.0042 * (1.0 - 0.45 * clamp((p.y - dy) / 0.21, 0.0, 1.0)), px);
  c = max(c, cov(sdBox(p - vec2(xp, top + 0.004), vec2(0.0035, 0.006)), px));
  for (int i = 0; i < 8; i++) {
    float f = (float(i) + 1.0) / 8.0;
    float sx = f * 0.42;
    vec2 a = vec2(xp, top - 0.012 - 0.085 * (1.0 - f));
    c = max(c, 0.8 * lineCov(sdSeg(p, a, vec2(xp + sx, bridgeDeckY(xp + sx) + 0.003)), 0.0009, px));
    c = max(c, 0.8 * lineCov(sdSeg(p, a, vec2(xp - sx, bridgeDeckY(xp - sx) + 0.003)), 0.0009, px));
  }
  return c;
}
// returns coverage of the bridge structure
float bridge(vec2 p, float px) {
  float dy = bridgeDeckY(p.x);
  float c = cov(abs(p.y - dy) - 0.0032, px);                                         // the deck: one stroke
  c = max(c, 0.75 * lineCov(abs(p.y - dy - 0.0125), 0.0007, px));                    // the wire over the track
  float pc = 0.022;                                                                  // catenary posts
  float px0 = (floor(p.x / pc) + 0.5) * pc;
  c = max(c, 0.8 * lineCov(sdSeg(p, vec2(px0, dy), vec2(px0, dy + 0.0125)), 0.0008, px));
  float sp = 0.145;                                                                  // piers
  float xi = (floor(p.x / sp) + 0.5) * sp;
  float pier = cov(sdBox(p - vec2(xi, dy - 0.045), vec2(0.0042, 0.045)), px);
  pier = max(pier, cov(sdBox(p - vec2(xi, dy - 0.006), vec2(0.011, 0.003)), px));
  c = max(c, pier);
  c = max(c, pylon(p, 0.66, px));
  c = max(c, pylon(p, STATION_B * 0.86 - 0.36, px));
  return c;
}
// the train: a dark bar of cars with a row of pale dots. x0 = its head (it runs toward -x).
vec2 train(vec2 p, float x0, float px) {
  float dy = bridgeDeckY(p.x);
  float xi = p.x - x0;
  const float CAR = 0.058, N = 8.0;
  if (xi < -0.004 || xi > CAR * N) return vec2(0.0);
  float car = floor(xi / CAR), fx = xi - car * CAR;
  float bar = cov(sdBox(vec2(fx - CAR * 0.5, p.y - dy - 0.0072), vec2(CAR * 0.47, 0.0036)) - 0.001, px);
  float wp = CAR * 0.92 / 6.0;
  float wx = fx - CAR * 0.04, wi = floor(wx / wp);
  float dots = 0.0;
  if (wi >= 0.0 && wi < 6.0) dots = cov(length(vec2(wx - (wi + 0.5) * wp, (p.y - dy - 0.0078) * 1.0)) - 0.0021, px * 1.4);
  return vec2(bar, dots);
}

void main() {
  vec2 s = vec2((vUv.x - 0.5) * uAspect / uZoom, (vUv.y - 0.5) / uZoom + uCentreY);    // painting coords about the frame centre
  float px = uPx / uZoom;
  vec2 P = vec2(uScroll + s.x, s.y);                                                // on the paper (K = 1)
  float day = 1.0 - uNight;
  float d, z = 600.0;                          // view depth = 300 / K: the INK pass carries each plane's edge at its own speed
  vec3 hue = vec3(1.0);
  // the paper's strands, for every edge that is lost rather than drawn: mist lies along them
  float strand = 0.5 + 0.5 * (0.55 * vnoise(P * vec2(5.0, 70.0)) + 0.3 * vnoise(P * vec2(17.0, 190.0) + 3.0) + 0.15 * vnoise(P * 240.0));

  // ---- sky: a wash, heavy above, a glow of mist over the far bank; clouds as wet-in-wet ----
  vec2 cp = vec2(uScroll * 0.5 + s.x, s.y);
  float cl = fbm(cp * vec2(0.45, 1.3) + 3.1, 4), cl2 = fbm(cp * vec2(2.3, 5.5) - 7.7, 4);
  float lift = s.y + 0.15 * cl + 0.03 * cl2 + 0.2 * smoothstep(-0.1, 0.8, P.x);
  float skyN = 0.215 + 0.115 * smoothstep(0.47, 0.64, lift) + 0.25 * smoothstep(0.7, 0.92, lift);
  skyN += 0.02 * cl2;
  float deck = smoothstep(0.40, 0.95, s.y + 0.22 * cl + 0.08 * cl2);                 // S15's cloud deck: a heavy lid
  float xbSky = (uScroll * 0.5 + s.x) - 0.5 * STATION_B;                              // about S15's centre
  float skyD = mix(0.26, 0.56, deck) + 0.05 * cl2 * deck;
  skyD -= 0.21 * smoothstep(0.0, 0.5, cl + 0.3 * cl2) * (1.0 - deck) * smoothstep(-0.1, 0.7, xbSky);   // light behind the far city
  skyD += 0.07 * (1.0 - smoothstep(0.0, 0.5, abs(xbSky + 0.3))) * (1.0 - deck);        // heavier over the open reach
  d = mix(skyD, skyN, uNight);
  float mistTone = mix(0.17, 0.215, uNight);

  // ---- S15: the slit of gold under the cloud, at the horizon ----
  float xbS = (uScroll * 0.56 + s.x) - 0.56 * STATION_B;                              // far-plane coords about S15's centre
  if (uGold > 0.0) {
    // a slit, not a sunset: a hand's breadth of bare gold between the horizon and the cloud's foot
    float open = uGold * (0.012 + 0.02 * bump(xbS, -0.3, 0.42)) * (1.0 + 0.25 * vnoise(vec2(xbS * 9.0, 3.0)));
    float slit = band(s.y, 0.338, 0.338 + open, 0.0025) * band(xbS, -0.98, 0.34, 0.16);
    float glow = uGold * 0.3 * exp(-max(s.y - 0.34 - open, 0.0) / 0.022) * band(xbS, -0.9, 0.25, 0.3) * step(0.336, s.y);
    d = mix(d, 0.0, slit);
    d *= 1.0 - 0.5 * glow * (1.0 - slit);
    hue = mix(hue, uGoldSky, clamp(slit + glow, 0.0, 1.0));
  }

  // ---- the far bank: four planes of towers, each rising out of the mist that hides its foot ----
  float mTop[4] = float[4](0.47, 0.41, 0.375, 0.33);                                  // where each plane clears the mist
  float mH[4] = float[4](0.20, 0.16, 0.11, 0.03);
  float cw[4] = float[4](0.17, 0.105, 0.078, 0.05);
  float hLo[4] = float[4](0.30, 0.26, 0.17, 0.04);
  float hHi[4] = float[4](0.60, 0.56, 0.46, 0.21);
  float fillF[4] = float[4](0.8, 0.92, 0.95, 0.9);
  float tallF[4] = float[4](0.85, 0.5, 0.3, 0.05);
  float podF[4] = float[4](0.0, 0.0, 0.03, 0.028);
  float toneN[4] = float[4](0.47, 0.585, 0.72, 0.88);
  float toneD[4] = float[4](0.33, 0.40, 0.50, 0.66);
  float wwF[4] = float[4](0.0042, 0.0042, 0.0046, 0.005);
  float soft[4] = float[4](3.0, 2.2, 1.6, 1.2);
  for (int i = 0; i < 4; i++) {
    float k = K[i];
    vec2 q = vec2(uScroll * k + s.x, s.y - 0.335 + 0.006 * float(3 - i));
    q.x += 0.0012 * vnoise(q * vec2(3.0, 9.0) + float(i));                           // the brush is not a ruler
    vec4 tw = towerRow(q, 11.0 + float(i) * 5.0, i, cw[i], hLo[i], hHi[i], fillF[i], tallF[i], podF[i], i >= 2 ? 1.0 : 0.7, uLit * (0.5 + 0.22 * float(i)), wwF[i], px * soft[i]);
    // the mist: its top is uneven, and each tower stands a little differently in it
    float ci = floor(q.x / cw[i]);
    float mn = fbm(vec2(q.x * 1.1 + float(i) * 4.0, s.y * 1.5), 3) + 0.5 * (hash12(vec2(ci, float(i) + 9.0)) - 0.5);
    float fd = clamp((s.y + 0.06 * mn - mTop[i]) / mH[i], 0.0, 1.0);                  // 0 deep in the mist .. 1 clear of it
    fd = mix(1.0, fd, clamp(uMist * 1.6, 0.0, 1.0));
    float full = mix(toneD[i], toneN[i], uNight) * mix(0.9, 1.0, smoothstep(0.3, 0.95, tw.w)) * (0.95 + 0.1 * washBlot(vec2(q.x, s.y) * 1.3));
    float tone = mix(mistTone, full, smoothstep(0.0, 1.0, fd));                       // a graded wash: dark crown, pale foot
    float c = tw.x * smoothstep(-0.25, 0.2, fd - 0.35 * (1.0 - strand));              // and at the very foot, nothing
    d = mix(d, tone, c);
    d = mix(d, tone + mix(0.16, -0.12, uNight) * fd, c * tw.z * 0.8);                // unlit windows: mid ink
    d = mix(d, mix(0.06, 0.0, uNight), c * tw.y * mix(0.5, 1.0, uNight) * smoothstep(0.1, 0.5, fd));   // lit: reserved paper
    hue = mix(hue, vec3(1.0), c);
    if (c > 0.02) z = 300.0 / k;
  }

  // ---- the river: a pale wash; the far bank's ink bleeding down into it; a few dry ripples ----
  float shoreY = 0.336 + 0.003 * vnoise(vec2((uScroll * 0.8 + s.x) * 8.0, 2.0));
  float water = cov(s.y - shoreY, px * 2.5);
  if (water > 0.0) {
    float kR = mix(0.92, 0.8, clamp((s.y - 0.1) / 0.24, 0.0, 1.0));
    vec2 rp = vec2(uScroll * kR + s.x, s.y);
    float depthW = clamp((shoreY - s.y) / 0.24, 0.0, 1.0);
    float wn = fbm(rp * vec2(1.3, 8.0), 3);
    float wN = 0.225 + 0.10 * smoothstep(0.3, 0.55, depthW + 0.2 * wn) + 0.24 * smoothstep(0.66, 0.98, depthW + 0.2 * wn);
    float wD = mix(0.1, 0.2, depthW) + 0.04 * wn;
    float wd = mix(wD, wN, uNight);
    // reflection of the front row, pulled long and broken along the ripples
    vec2 rq = vec2(uScroll * K[3] + s.x + 0.003 * vnoise(vec2(s.y * 170.0, rp.x * 3.0)), (shoreY - s.y) * 0.6);
    vec4 rf = towerRow(rq, 26.0, 3, cw[3], hLo[3], hHi[3], fillF[3], tallF[3], podF[3], 0.0, uLit * 1.2, wwF[3], px * 5.0);
    float brk = dryBrush(rp, vec2(1.0, 0.0), 0.6) * (1.0 - 0.8 * depthW);
    wd = mix(wd, mix(toneD[3], toneN[3], uNight) * 0.7, rf.x * brk * 0.85);
    wd = mix(wd, 0.05, rf.y * uNight * 0.45 * brk);                                    // lit windows, as broken dashes
    // ripples: a few horizontal dry strokes
    float rip = smoothstep(0.62, 0.8, vnoise(vec2(rp.x * 2.6, rp.y * 150.0) + 9.0)) * smoothstep(0.1, 0.5, vnoise(vec2(rp.x * 22.0, rp.y * 700.0)) + 0.5);
    wd += rip * mix(0.16, 0.10, uNight) * smoothstep(0.35, 0.8, depthW);
    vec3 wh = vec3(1.0);
    // S15: one stroke of gold laid along the river, from under the slit toward us
    if (uGold > 0.0) {
      float xb = rp.x - kR * STATION_B;
      // ONE stroke: laid from under the slit toward the bridge, loaded where it lands, dry where it lifts;
      // a strip of grey water is left between it and the horizon, so slit and stroke are two marks
      float along = (xb + 1.0) / 1.5;                                                // 0 where the brush lands .. 1 at its dry tail
      float drawn = smoothstep(0.0, 0.06, uGold * 1.12 - along);                     // the brush travels left to right
      float mid = 0.300 - 0.004 * along, hwid = 0.0125 * (1.0 - 0.45 * along) * smoothstep(0.0, 0.05, along);
      float body = (1.0 - smoothstep(hwid - 0.003, hwid + 0.003, abs(s.y - mid))) * step(0.0, along) * step(along, 1.0);
      float load = mix(0.98, 0.08, pow(clamp(along, 0.0, 1.0), 1.4));
      float g = body * drawn * dryBrush(rp, vec2(1.0, 0.0), load);
      float sheen = 0.0;
      wd = mix(wd, 0.0, g);
      wd *= 1.0 - 0.3 * sheen;
      wh = mix(wh, uGoldRiver, clamp(g + sheen, 0.0, 1.0));
    }
    d = mix(d, wd, water);
    hue = mix(hue, wh, water);
    z = mix(z, 300.0 / kR, water);
  }
  // mist lying on the water under the far bank
  float veil = uMist * band(s.y, 0.30, 0.37, 0.03) * smoothstep(0.35, 0.75, strand + 0.25 * fbm(vec2((uScroll * 0.8 + s.x) * 1.3, s.y * 6.0) + 5.0, 3));
  d = mix(d, mistTone, clamp(veil, 0.0, 1.0) * 0.85);

  // ---- the bridge and its train ----
  vec2 bp = vec2(uScroll * 0.86 + s.x, s.y);
  float bc = bridge(bp, px * 1.2);
  float pierFade = smoothstep(0.175, 0.215, s.y + 0.02 * strand);                     // the piers are lost where they meet the water
  d = mix(d, mix(0.62, 0.88, uNight), bc * pierFade);
  if (bc * pierFade > 0.02) z = 300.0 / 0.86;
  vec2 tr = train(bp, uTrainX, px);
  d = mix(d, mix(0.9, 0.93, uNight), tr.x);
  d = mix(d, 0.0, tr.y);
  // the windows' light falls a little on the wash around them
  float trGlow = uNight * 0.5 * exp(-abs(bp.y - bridgeDeckY(bp.x) - 0.008) / 0.012) * band(bp.x - uTrainX, 0.0, 0.058 * 8.0, 0.02);
  d *= 1.0 - trGlow * (1.0 - tr.x);

  // ---- the near bank: sparse dark towers, the one the scroll stops on, rooftops along the bottom ----
  {
    vec2 q = vec2(uScroll * K[4] + s.x, s.y + 0.1);
    vec4 tw = towerRow(q, 51.0, 4, 0.15, 0.55, 1.05, 0.9, 0.3, 0.0, 1.0, uLit * 0.8, 0.0125, px);
    float tone = mix(0.74, 0.90, uNight) * mix(0.84, 1.0, smoothstep(0.0, 0.8, tw.w));
    d = mix(d, tone, tw.x);
    d = mix(d, tone + mix(0.14, -0.10, uNight), tw.x * tw.z * 0.7);
    d = mix(d, mix(0.05, 0.0, uNight), tw.x * tw.y * mix(0.55, 0.9, uNight));
    if (tw.x > 0.02) z = 300.0 / K[4];
  }
  {
    vec2 hp = vec2(uScroll * 0.93 + s.x, s.y);
    float bright;
    vec4 tw = heroTower(hp, px, uLit, bright);
    float tone = mix(0.80, 0.93, uNight);
    // the bright window's light soaks a little way into the wash of the wall
    float halo = uBright * exp(-length((hp - vec2(0.0, BRIGHT_Y)) * vec2(1.0, 1.1)) / 0.026);
    float wall = tone * (1.0 - 0.45 * halo);
    d = mix(d, wall, tw.x);
    d = mix(d, wall + mix(0.13, -0.11, uNight), tw.x * tw.z * 0.8);
    d = mix(d, mix(0.07, 0.12, uNight), tw.x * tw.y);                                 // lit, but not the brightest
    d = mix(d, 0.0, bright * uBright);
    if (tw.x > 0.02) z = 300.0 / 0.93;
    // the left edge: a dark unfinished tower and its crane
    float ll;
    float lc = leftTower(vec2(uScroll * 0.96 + s.x + 0.955, s.y), px, ll);
    d = mix(d, mix(0.86, 0.965, uNight), lc);
    d = mix(d, 0.16, ll * uNight);
    if (lc > 0.02) z = 300.0 / 0.96;
  }
  for (int i = 5; i < 7; i++) {
    vec2 q = vec2(uScroll * K[i] + s.x, s.y + 0.14);
    vec4 tw = towerRow(q, 60.0 + float(i) * 9.0, i, i == 5 ? 0.17 : 0.23, 0.2, i == 5 ? 0.36 : 0.31, 0.97, 0.0, 0.16, 1.0, uLit * 0.7, i == 5 ? 0.015 : 0.019, px);
    float tone = mix(0.88, 0.975, uNight) * (i == 5 ? 0.96 : 1.0);
    d = mix(d, tone, tw.x);
    d = mix(d, tone + mix(0.06, -0.14, uNight), tw.x * tw.z * 0.7);
    d = mix(d, mix(0.05, 0.0, uNight), tw.x * tw.y * mix(0.5, 0.85, uNight));
    if (tw.x > 0.02) z = 300.0 / K[i];
  }

  // ---- rain: three depths of ink strokes (S15) ----
  if (uRain > 0.0) {
    float r = 0.55 * rainStrokes(s, uTime, 0.45, uRain * 0.8, 1.0, 1.0, px) + 0.75 * rainStrokes(s, uTime, 0.7, uRain * 0.65, 1.0, 2.0, px) + rainStrokes(s, uTime, 1.0, uRain * 0.5, 1.0, 3.0, px);
    d = mix(d, max(d, 0.42) + 0.1, clamp(r, 0.0, 1.0) * 0.8);
  }
  // a little of the paper's strand in every wash, so tone meets tone along a broken line, not a contour
  d += 0.035 * (strand - 0.5) * smoothstep(0.02, 0.2, d) * (1.0 - smoothstep(0.85, 1.0, d));

  // ---- the black, and its dilution from the centre (S01, 2 s to 6 s) ----
  if (uWash > 0.0) {
    vec2 wv = (P - uWashCentre) * vec2(0.74, 1.0);
    vec2 wq = P * vec2(0.9, 1.7);
    float f1 = fbm(wq + 11.0, 4), f2 = fbm(wq * 2.3 + vec2(f1 * 1.2, -4.0), 3);
    float r = length(wv) * (1.0 + 0.42 * f1 + 0.22 * f2) + 0.10 * (strand - 0.5);
    float R = pow(1.0 - uWash, 2.0) * 3.2;                                            // the reach of the water
    float k = clamp((R - r) / (0.3 + 0.25 * R), 0.0, 1.0);                             // 0 = still solid .. 1 = clear
    float res = pow(1.0 - k, 2.2);
    res += 0.22 * k * (1.0 - k) * 4.0 * (f2 + 0.3);                                   // pigment carried and dropped unevenly
    res = mix(clamp(res, 0.0, 1.0), 1.0, step(k, 0.0));
    d = 1.0 - (1.0 - d) * (1.0 - res);
  }

  // ---- the inscription, by resist: the wash draws back from the strokes ----
  if (uTitle > 0.0) {
    vec2 tu = (P - uTitleRect.xy) / uTitleRect.zw;
    if (tu.x > 0.0 && tu.x < 1.0 && tu.y > 0.0 && tu.y < 1.0) {
      vec4 tm = texture(tTitle, tu);
      float fib = 0.5 + 0.5 * (0.6 * vnoise(P * vec2(38.0, 130.0)) + 0.4 * vnoise(P * 17.0));
      float th = mix(1.12, -0.18, uTitle);
      float rev = tm.r * smoothstep(th - 0.1, th + 0.1, tm.g * 0.85 + 0.3 * fib);
      // a breath of thinner wash just outside the strokes, where the alum crept
      float creep = (1.0 - tm.r) * tm.b * smoothstep(0.35, 1.0, uTitle) * 0.2;
      d = mix(d * (1.0 - creep), 0.0, rev);
    }
  }

  gl_FragColor = vec4(inkOutCol(clamp(d, 0.0, 1.0), hue), 1.0);
  gl_FragDepth = depthFor(z, uNear, uFar);
}`;

/** The T1 inscription as a mask: r = the glyphs, g = a blur that peaks on stroke centres, b = a wide blur. */
function makeTitleTexture() {
  const L = CARD_LAYOUT.T1;
  const S = 2;                                             // texels per 1080p pixel
  const zh = L.zhSize * S, en = L.enSize * S, pad = 40 * S;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const enFont = `400 ${en}px ${FONT_STACKS.en}`;
  ctx.font = enFont;
  ctx.letterSpacing = `${(L.enTracking * en).toFixed(2)}px`;
  const enText = 'THE DREAM OF THE BUTTERFLY';
  const enW = ctx.measureText(enText).width - L.enTracking * en;
  const W = Math.ceil(Math.max(enW, zh) + 2 * pad), H = Math.ceil(2 * zh + L.zhGap * S + L.enBelow * S + en + 2 * pad);
  c.width = W; c.height = H;
  const draw = () => {
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.font = `400 ${zh}px ${FONT_STACKS.zh}`;
    ctx.letterSpacing = '0px';
    ctx.fillText('梦', W - pad, pad);
    ctx.fillText('蝶', W - pad, pad + zh + L.zhGap * S);
    ctx.font = enFont;
    ctx.letterSpacing = `${(L.enTracking * en).toFixed(2)}px`;
    ctx.fillText(enText, W - pad + L.enTracking * en, pad + 2 * zh + L.zhGap * S + L.enBelow * S);
  };
  const layer = (blur) => {
    ctx.clearRect(0, 0, W, H);
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    draw();
    ctx.filter = 'none';
    return ctx.getImageData(0, 0, W, H).data;
  };
  const a = layer(0), b = layer(2.2 * S), e = layer(9 * S);
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = a[i * 4 + 3];
    out[i * 4 + 1] = Math.min(255, b[i * 4 + 3] * 1.9);    // normalised so thick stroke centres reach 1
    out[i * 4 + 2] = Math.min(255, e[i * 4 + 3] * 2.2);
    out[i * 4 + 3] = 255;
  }
  // flip rows: paper y runs up
  const flipped = new Uint8Array(out.length);
  for (let y = 0; y < H; y++) flipped.set(out.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  const tex = new THREE.DataTexture(flipped, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  // size in painting units (frame heights at 1080p), and where the block's right/top edge sits inside it
  return { tex, w: W / (1080 * S), h: H / (1080 * S), pad: pad / (1080 * S) };
}

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

export function createScroll(ctx) {
  // T1 is LOOK's resist card (shots/city.js). Our own drawing of it is kept as the fallback
  // (params.ownTitle): its mask is only built if it is asked for.
  let title = null;
  const L = CARD_LAYOUT.T1;
  // The inscription lies on the paper. Its block is right-aligned at 93% across and 12% from the top
  // of the frame at 9.0 s (the middle of its full display); it drifts with the scroll before and after.
  const aspect = ctx.aspect;
  const rightX = scrollS01(9.0) + (L.right - 0.5) * aspect;
  const topY = 1 - L.top;
  const titleRect = new THREE.Vector4(0, 0, 1, 1);
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;

  const uniforms = {
    uScroll: { value: 0 }, uZoom: { value: 1 }, uCentreY: { value: 0.5 }, uNight: { value: 1 }, uMist: { value: 0.6 }, uLit: { value: 0.12 },
    uWash: { value: 0 }, uWashCentre: { value: new THREE.Vector2(0, 0.5) }, uTitle: { value: 0 }, uTitleRect: { value: titleRect }, tTitle: { value: blank },
    uRain: { value: 0 }, uGold: { value: 0 }, uTime: { value: 0 }, uTrainX: { value: 99 }, uPx: { value: 1 / ctx.height }, uNear: { value: 1 }, uFar: { value: 6000 },
    uBright: { value: 1 }, uAspect: { value: aspect },
    uGoldSky: { value: new THREE.Vector3(...rgb(PALETTE.skySlot)) }, uGoldRiver: { value: new THREE.Vector3(...rgb(PALETTE.sunGold)) },
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({ name: 'city-scroll', uniforms, vertexShader: VERT, fragmentShader: FRAG, depthFunc: THREE.AlwaysDepth });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'city-scroll';
  group.add(mesh);

  // the wash is diluted from the centre of the frame as it stands at 4 s (it lies on the paper)
  uniforms.uWashCentre.value.set(scrollS01(4.2), 0.5);

  return {
    group,
    /** @returns post overrides for this frame */
    update(t, localT, shot, p, camera) {
      const u = uniforms;
      camera.near = 1; camera.far = 6000; camera.updateProjectionMatrix();
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uTime.value = t;
      u.uNight.value = p.night ?? 1;
      u.uMist.value = p.mist ?? 0.6;
      u.uLit.value = p.litWindows ?? 0.12;
      u.uRain.value = p.rain ?? 0;
      let scroll, zoom = 1, cy = 0.5;
      if (shot.id === 'S15') {
        scroll = STATION_B; zoom = p.zoom ?? 0.9; cy = p.centreY ?? 0.47;
        u.uWash.value = 0; u.uTitle.value = 0; u.uBright.value = 0.6;
        // the train crosses toward the gold: head at +0.9 of the frame at 138.0, gone left by the end
        u.uTrainX.value = STATION_B * 0.86 + 1.0 - (t - shot.start) * 0.36;
        // it opens at 142.0 and is there by 142.5: fast at first, like a blind lifted (0.9 s in all)
        const gu = Math.min(1, Math.max(0, (t - (p.goldSlit ?? 142)) / 0.9));
        u.uGold.value = 1 - (1 - gu) * (1 - gu);
      } else {
        scroll = scrollS01(t);
        u.uWash.value = p.wash ?? 0;
        if (p.ownTitle && !title) {
          title = makeTitleTexture();
          titleRect.set(rightX + title.pad - title.w, topY + title.pad - title.h, title.w, title.h);
          u.tTitle.value = title.tex;
        }
        u.uTitle.value = p.ownTitle ? smooth(p.title ?? 0) : 0;
        u.uBright.value = 1;
        u.uGold.value = 0;
        // the train comes in under the inscription at about 7 s and runs left along the bridge, calmly; at
        // 13 s its head reaches the tower the scroll stops on, and its lights go out behind it one by one
        const [, t1] = p.train || [7, 13];
        u.uTrainX.value = 0.062 + 0.14 * (t1 + 0.15 - t);
      }
      u.uScroll.value = scroll; u.uZoom.value = zoom; u.uCentreY.value = cy;
      // S15's gold is the human world's own first colour: where the slit opens the wash is let through whole
      const gold = u.uGold.value;
      const pools = shot.id === 'S15' && gold > 0 ? [{ x: 0.37, y: 0.37, r: 0.42, soft: 0.2, chroma: 0.85 * gold, rim: 0 }] : [];
      return {
        ink: { paperScroll: [scroll / aspect, 0], scrollDepth: 300, mist: 0, mistRange: [300, 640], pools },
      };
    },
    dispose() { geo.dispose(); mat.dispose(); blank.dispose(); if (title) title.tex.dispose(); },
  };
}
