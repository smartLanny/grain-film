// Global, story-agnostic constants. Change with care: everything downstream assumes these.

export const FPS = 30;             // timeline frame rate (offline renders use t = frame / FPS)
export const WIDTH = 1920;         // reference frame size (16:9). Offline --scale multiplies this.
export const HEIGHT = 1080;
export const REF_HEIGHT = 1080;    // all pixel-sized post/title params are expressed at 1080p
export const SAMPLE_RATE = 48000;  // score sample rate (stereo)
export const FILM_SEED = 0x5eed2026; // root seed; derive per-world seeds with hashString(name) ^ FILM_SEED
