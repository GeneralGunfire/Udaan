/**
 * The liquid-glass shader. One small fragment shader draws ONLY the bar's own rectangle (never the screen).
 *
 * Coordinates are logical px relative to the SCREEN, y down, so the dock and the top bar sample the same
 * field and the liquid flows as one surface. `uSc` is 1.0 for the dock and 0.42 for the top bar (it shrinks
 * the wavelength on the thin bar).
 *
 * Height field: six sines with incommensurate frequencies on a domain-warped plane, so the motion is
 * effectively non-periodic and never visibly repeats. The normal comes from central differences (4 extra
 * samples); there is NO bevel term, so the fluid runs flat all the way to the edge. A soft-box environment
 * map reflected in that normal gives the glossy liquid look. The only border is a 1 px highlight hairline.
 */
export const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`

export const FRAG = `
precision highp float;
uniform vec2  uSize;     // the bar, logical px
uniform vec2  uOrigin;   // the bar's top-left on the screen, logical px
uniform float uDpr;      // device px per logical px
uniform float uT;        // accumulated seconds
uniform float uSc;       // 1.0 dock, 0.42 top bar
uniform float uRadius;   // dock: half its height (a pill); top bar: 0
uniform float uAmp;      // look amplitude (7 chrome, 8 water, 5 frost) x the user's ripple size
uniform float uTimeMul;  // look time scale (1, 1.1, 0.6)
uniform float uSmooth;   // 1 for frost: drops the three highest-frequency waves
uniform float uBright;   // 1 dock, 0.6 top bar (menu text stays readable)
uniform float uContrast; // 1 = full highlight contrast; lower blends into the desktop
uniform float uEdge;     // edge hairline strength
uniform float uOpacity;  // how solid the liquid is
uniform int   uLook;     // 0 chrome, 1 water, 2 frost

float W(float kx, float ky, float w, float ph, float a, float wx, float wy, float tt) {
  return a * sin(kx * wx + ky * wy + w * tt + ph);
}

float H(vec2 s) {
  vec2 p = s / uSc;
  float wx = p.x + 38.0 * sin(p.y * 0.017 + uT * 0.55);   // domain warp
  float wy = p.y + 38.0 * sin(p.x * 0.013 - uT * 0.43);
  float tt = uT * uTimeMul;
  float k = 1.0 - uSmooth;                                 // waves 3, 4, 5 are the highest frequency
  float h = W( 0.011,  0.004, 0.9, 0.3, 1.00,     wx, wy, tt)
          + W(-0.007,  0.012, 0.7, 1.7, 0.80,     wx, wy, tt)
          + W( 0.016, -0.009, 1.3, 4.0, 0.55 * k, wx, wy, tt)
          + W( 0.004,  0.019, 1.1, 2.4, 0.45 * k, wx, wy, tt)
          + W(-0.021, -0.006, 0.8, 5.1, 0.35 * k, wx, wy, tt)
          + W( 0.009, -0.015, 1.5, 0.9, 0.50,     wx, wy, tt);
  return uAmp * h;
}

float G(float x, float cx, float sx, float y, float cy, float sy) {
  float a = (x - cx) / sx;
  float b = (y - cy) / sy;
  return exp(-(a * a + b * b));
}

// The soft-box reflection that makes the surface read as liquid.
float env(float rx, float ry, float rz) {
  float e = 0.05 + 0.10 * clamp(rz, 0.0, 1.0);
  e += 1.5  * G(rx, -0.5, 0.38, ry, -0.65, 0.28);
  e += 0.9  * G(rx,  0.6, 0.32, ry,  0.55, 0.30);
  float s = (ry - 0.08) / 0.05;
  e += 0.55 * exp(-s * s) * (0.5 + 0.5 * cos(rx * 7.0));
  e += 0.5  * G(rx,  0.1, 0.6,  ry, -0.2,  0.1);
  return e;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 s = uOrigin + p;

  // Shape: rounded box (dock radius = half height, bar radius 0). Fixed, never deforms.
  vec2 hs = uSize * 0.5;
  vec2 bq = abs(p - hs) - (hs - vec2(uRadius));
  float sdf = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0) - uRadius;
  float cov = clamp(0.5 - sdf * uDpr, 0.0, 1.0);
  if (cov <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float h0 = H(s);
  float hxp = H(s + vec2(1.0, 0.0));
  float hxm = H(s - vec2(1.0, 0.0));
  float hyp = H(s + vec2(0.0, 1.0));
  float hym = H(s - vec2(0.0, 1.0));
  float gx = (hxp - hxm) * 0.5;
  float gy = (hyp - hym) * 0.5;
  float lap = hxp + hxm + hyp + hym - 4.0 * h0;

  float nz = 1.0 / sqrt(1.0 + gx * gx + gy * gy);
  float nx = -gx * nz;
  float ny = -gy * nz;
  float rx = 2.0 * nz * nx;
  float ry = 2.0 * nz * ny;
  float rz = 2.0 * nz * nz - 1.0;
  vec3 L = normalize(vec3(-0.45, -0.62, 0.64));
  vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float nh = clamp(dot(vec3(nx, ny, nz), hv), 0.0, 1.0);
  float e = env(rx, ry, rz);

  vec3 col;
  if (uLook == 0) {
    col = e * vec3(0.80, 0.88, 1.0) * 0.92;                // chrome: liquid metal
  } else if (uLook == 1) {
    float K = 0.0042 / (uSc * uSc);                        // caustics cover ~15-25% of the surface
    float caust = pow(clamp(-lap / K, 0.0, 1.0), 1.5);
    col = vec3(0.035, 0.055, 0.075) + (0.05 + 0.5 * caust) * vec3(0.55, 0.78, 1.0) + pow(nh, 90.0) * 1.2 + e * 0.18;  // water
  } else {
    vec2 pp = s / uSc;
    float sheen = 0.5 + 0.5 * sin(pp.x * 0.008 + pp.y * 0.01 - 0.54 * uT + h0 * 0.3);
    col = vec3(0.075) + 0.055 * sheen * vec3(1.0, 1.0, 1.04) + e * 0.30 + pow(nh, 50.0) * 0.5;  // frost
  }

  // Blend in: pull the surface toward a dark mean so highlights are soft sheens, not bright streaks.
  col = clamp(col, 0.0, 1.0);
  col = vec3(0.045) + (col - vec3(0.045)) * uContrast;
  col = max(col, 0.0) * uBright;

  // The only border: a 1 px highlight hairline, brighter along the top edge than the bottom.
  float d = max(-sdf, 0.0);
  float edge = exp(-d / 1.1);
  float top = clamp(0.5 - 0.5 * (p.y - hs.y) / hs.y, 0.0, 1.0);
  float ea = edge * (0.35 + 0.5 * top) * 0.5 * uEdge;

  // Translucent: only uOpacity solid, so the desktop shows through. The hairline stays fully visible.
  vec3 surf = clamp(col - vec3(ea), 0.0, 1.0);
  float a = clamp(uOpacity + ea, 0.0, 1.0);
  gl_FragColor = vec4((surf * uOpacity + vec3(ea)) * cov, a * cov);   // premultiplied alpha
}
`

/** Per-look constants: wave amplitude, time scale, and whether the highest-frequency waves are dropped. */
export const LOOK_PARAMS = {
  chrome: { id: 0, amp: 7, time: 1.0, smooth: 0 },
  water: { id: 1, amp: 8, time: 1.1, smooth: 0 },
  frost: { id: 2, amp: 5, time: 0.6, smooth: 1 },
} as const
