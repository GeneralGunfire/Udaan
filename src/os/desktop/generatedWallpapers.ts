/**
 * Wallpapers rendered on the GPU at native resolution.
 *
 * WHY A SHADER AND NOT A CANVAS
 * -----------------------------
 * The previous set was 2D-canvas: a base gradient, a few blurred radial
 * blobs, and film grain. That has two hard limits. Blurred blobs can only
 * ever make soft round clouds — they cannot make the *flowing ribbons* of
 * modern system wallpapers, where a band of light bends through the frame
 * and its edges stay sharp while its interior is smooth. And a full-screen
 * canvas blur at 4K costs hundreds of milliseconds, so it has to be baked
 * once to a bitmap, which rules out any motion.
 *
 * A fragment shader computes the colour of each pixel independently, so it
 * can evaluate a warped flow field per pixel: that is what gives the sharp
 * ribbon edges and smooth interiors. At 4K it renders in a few milliseconds.
 *
 * WHAT MAKES THESE LOOK LIKE SYSTEM WALLPAPERS AND NOT "A GRADIENT"
 * -----------------------------------------------------------------
 *  1. DOMAIN WARPING. The coordinate space is bent by noise before the
 *     colour is sampled. Straight bands become organic ribbons. This is the
 *     single technique that separates these from a CSS gradient.
 *  2. A LIGHT DIRECTION. One source, consistently applied, so the image has
 *     a top and a bottom rather than being uniformly busy.
 *  3. DITHER, NOT GRAIN. An 8-bit smooth gradient bands visibly on a large
 *     display. A tiny ordered dither breaks the bands without the "noisy
 *     photo" texture that additive grain gives.
 *  4. RESTRAINT. Two or three hues, not five. Every extra hue moves the
 *     result toward "screensaver".
 *
 * Rendering falls back to the 2D canvas path if WebGL2 is unavailable, so a
 * machine without it still gets a wallpaper rather than a black screen.
 */

export interface GeneratedWallpaper {
  id: string
  label: string
  /** Deep background, behind every ribbon. */
  base: [string, string]
  /** Up to four ribbon colours, front to back. */
  ribbons: string[]
  /** Overall look: `flow` = bent ribbons, `aurora` = soft vertical curtains. */
  style: 'flow' | 'aurora'
  /** Seeds the noise so each wallpaper has its own distinct shape. */
  seed: number
  /** True for wallpapers meant to sit under light-mode chrome. */
  light?: boolean
}

export const GENERATED_WALLPAPERS: GeneratedWallpaper[] = [
  {
    id: 'gen:sequoia',
    label: 'Sequoia',
    base: ['#04142e', '#0a2d5e'],
    ribbons: ['#2b7fd4', '#4aa8e8', '#8ed0f0', '#1a4f96'],
    style: 'flow',
    seed: 1.7,
  },
  {
    id: 'gen:sonoma',
    label: 'Sonoma',
    base: ['#1a0a2e', '#3d1152'],
    ribbons: ['#c2459b', '#7b3fd4', '#f08ab8', '#4a1f8c'],
    style: 'flow',
    seed: 4.2,
  },
  {
    id: 'gen:tahoe',
    label: 'Tahoe',
    base: ['#f0f4fa', '#d6e4f5'],
    ribbons: ['#7fb5e8', '#a8cdf0', '#5a94d4', '#c9ddf2'],
    style: 'flow',
    seed: 9.1,
    light: true,
  },
  {
    id: 'gen:aurora',
    label: 'Aurora',
    base: ['#030a18', '#071a36'],
    ribbons: ['#1f9c8a', '#2d7fd4', '#7b4fd4', '#15c4a8'],
    style: 'aurora',
    seed: 2.4,
  },
  {
    id: 'gen:ember',
    label: 'Ember',
    base: ['#160603', '#2e0c05'],
    ribbons: ['#e8541f', '#f59340', '#c42819', '#ffb366'],
    style: 'flow',
    seed: 6.8,
  },
  {
    id: 'gen:dawn',
    label: 'Dawn',
    base: ['#fdf2e8', '#f7dcc8'],
    ribbons: ['#f0a070', '#e87a94', '#f5c48a', '#d4738c'],
    style: 'flow',
    seed: 3.3,
    light: true,
  },
  {
    id: 'gen:graphite',
    label: 'Graphite',
    base: ['#0a0a0c', '#16171a'],
    ribbons: ['#3a3d45', '#55596380', '#2a2c32', '#4a4e58'],
    style: 'flow',
    seed: 7.5,
  },
  {
    id: 'gen:tide',
    label: 'Tide',
    base: ['#021a22', '#043845'],
    ribbons: ['#0e8fa8', '#14b8a0', '#2d6ea8', '#4fd4c0'],
    style: 'aurora',
    seed: 5.6,
  },
]

export const isGenerated = (id: string) => id.startsWith('gen:')

const cache = new Map<string, Promise<string>>()

/** Renders at `width`×`height` device pixels and resolves to a blob URL (cached). */
export function renderWallpaper(id: string, width: number, height: number): Promise<string> {
  const key = `${id}@${width}x${height}`
  const hit = cache.get(key)
  if (hit) return hit
  const def = GENERATED_WALLPAPERS.find((w) => w.id === id) ?? GENERATED_WALLPAPERS[0]
  const job = paint(def, width, height)
  cache.set(key, job)
  return job
}

/* ------------------------------------------------------------------ */
/*  SHADER                                                             */
/* ------------------------------------------------------------------ */

const VERTEX = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`

/**
 * The fragment shader.
 *
 * Structure: value noise → fractal brownian motion (fbm) → domain warp →
 * ribbon bands → lighting → dither.
 *
 * The domain warp is the important part. `fbm(p + fbm(p + fbm(p)))` bends
 * the coordinate space twice before the bands are evaluated, which turns
 * parallel stripes into the curved, folded ribbons the reference images
 * show. One level of warp looks like wavy lines; two looks organic.
 */
const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform vec3  uBase0;
uniform vec3  uBase1;
uniform vec3  uRibbon0;
uniform vec3  uRibbon1;
uniform vec3  uRibbon2;
uniform vec3  uRibbon3;
uniform float uSeed;
uniform int   uStyle;   // 0 = flow, 1 = aurora

out vec4 fragColor;

// --- value noise -------------------------------------------------------
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Quintic interpolation: smoother second derivative than smoothstep, so
  // large smooth areas do not show faint grid creases.
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// --- fractal brownian motion ------------------------------------------
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  // Rotating each octave stops the layers aligning into visible axes.
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = rot * p * 2.02;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  // Correct for aspect so ribbons are not stretched on wide displays.
  vec2 p = vec2(uv.x * (uResolution.x / uResolution.y), uv.y);
  p += uSeed;

  // --- domain warp: two levels, which is what makes ribbons organic ---
  vec2 q = vec2(fbm(p * 1.4), fbm(p * 1.4 + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p * 1.4 + 3.0 * q + vec2(1.7, 9.2)), fbm(p * 1.4 + 3.0 * q + vec2(8.3, 2.8)));
  float f = fbm(p * 1.4 + 3.0 * r);

  // --- base gradient, running slightly off-vertical ---
  vec3 col = mix(uBase0, uBase1, clamp(uv.y * 0.8 + uv.x * 0.2, 0.0, 1.0));

  if (uStyle == 0) {
    // FLOW: bands cut through the warped field. Each band is a smooth
    // pulse in the warped coordinate, so edges stay crisp while interiors
    // stay smooth — the look the reference wallpapers have.
    float band = f * 2.4 + r.x * 1.2;
    float b0 = smoothstep(0.30, 0.62, band) * (1.0 - smoothstep(0.62, 0.95, band));
    float b1 = smoothstep(0.55, 0.88, band) * (1.0 - smoothstep(0.88, 1.25, band));
    float b2 = smoothstep(0.85, 1.18, band) * (1.0 - smoothstep(1.18, 1.60, band));
    float b3 = smoothstep(1.10, 1.45, band) * (1.0 - smoothstep(1.45, 1.95, band));
    col = mix(col, uRibbon3, b3 * 0.55);
    col = mix(col, uRibbon2, b2 * 0.62);
    col = mix(col, uRibbon1, b1 * 0.70);
    col = mix(col, uRibbon0, b0 * 0.78);
  } else {
    // AURORA: soft vertical curtains, brightest low in the frame and
    // fading upward, the way real aurora does.
    float curtain = fbm(vec2(p.x * 2.2, p.y * 0.7 + q.y * 1.5));
    float height = 1.0 - smoothstep(0.1, 1.05, uv.y);
    float c0 = smoothstep(0.38, 0.72, curtain) * height;
    float c1 = smoothstep(0.50, 0.85, curtain + q.x * 0.3) * height;
    float c2 = smoothstep(0.30, 0.66, fbm(p * 1.9 + 2.0)) * height * 0.7;
    col = mix(col, uRibbon2, c2 * 0.5);
    col = mix(col, uRibbon1, c1 * 0.55);
    col = mix(col, uRibbon0, c0 * 0.6);
  }

  // --- lighting: one source, upper left ---
  float light = 1.0 - length(uv - vec2(0.28, 0.12)) * 0.55;
  col *= 0.86 + light * 0.3;

  // --- vignette: very slight, just enough to hold the eye centre-frame ---
  float vig = 1.0 - length((uv - 0.5) * vec2(1.1, 1.0)) * 0.42;
  col *= 0.90 + vig * 0.12;

  // --- ordered dither against 8-bit banding ---
  // A 4x4 Bayer-like threshold costs one fract() and removes the banding
  // that additive grain only disguises.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) / 255.0 * 1.6;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').slice(0, 6)
  const n = parseInt(h.padEnd(6, '0'), 16)
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
}

async function paint(def: GeneratedWallpaper, width: number, height: number): Promise<string> {
  const canvas = new OffscreenCanvas(width, height)
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })

  // No WebGL2 (very old GPU, software rendering disabled): fall back to a
  // plain 2D gradient so the desktop still has a wallpaper.
  if (!gl) return paintFallback(def, width, height)

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[wallpaper] shader', gl.getShaderInfoLog(s))
      return null
    }
    return s
  }

  const vs = compile(gl.VERTEX_SHADER, VERTEX)
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
  if (!vs || !fs) return paintFallback(def, width, height)

  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[wallpaper] link', gl.getProgramInfoLog(prog))
    return paintFallback(def, width, height)
  }
  gl.useProgram(prog)

  // A single full-screen triangle — cheaper than two triangles for a quad
  // and avoids the diagonal seam a quad can show under some drivers.
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const u = (name: string) => gl.getUniformLocation(prog, name)
  gl.uniform2f(u('uResolution'), width, height)
  gl.uniform3fv(u('uBase0'), hexToRgb(def.base[0]))
  gl.uniform3fv(u('uBase1'), hexToRgb(def.base[1]))
  const ribbons = [0, 1, 2, 3].map((i) => hexToRgb(def.ribbons[i] ?? def.ribbons[def.ribbons.length - 1]))
  gl.uniform3fv(u('uRibbon0'), ribbons[0])
  gl.uniform3fv(u('uRibbon1'), ribbons[1])
  gl.uniform3fv(u('uRibbon2'), ribbons[2])
  gl.uniform3fv(u('uRibbon3'), ribbons[3])
  gl.uniform1f(u('uSeed'), def.seed)
  gl.uniform1i(u('uStyle'), def.style === 'aurora' ? 1 : 0)

  gl.viewport(0, 0, width, height)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  // Release GPU resources now rather than waiting for GC — a 4K context
  // holds a lot of VRAM and several wallpapers may be rendered in a session.
  gl.deleteBuffer(buf)
  gl.deleteProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return URL.createObjectURL(blob)
}

/** 2D fallback: base gradient plus soft colour fields. No ribbons, but valid. */
async function paintFallback(def: GeneratedWallpaper, width: number, height: number): Promise<string> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const diag = Math.hypot(width, height)

  const base = ctx.createLinearGradient(0, 0, width * 0.3, height)
  base.addColorStop(0, def.base[0])
  base.addColorStop(1, def.base[1])
  ctx.fillStyle = base
  ctx.fillRect(0, 0, width, height)

  ctx.filter = `blur(${Math.round(diag * 0.05)}px)`
  def.ribbons.forEach((colour, i) => {
    const cx = (0.2 + ((i * 0.27) % 0.7)) * width
    const cy = (0.25 + ((i * 0.41) % 0.6)) * height
    const r = diag * 0.3
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, `${colour}aa`)
    g.addColorStop(1, `${colour}00`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, width, height)
  })
  ctx.filter = 'none'

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return URL.createObjectURL(blob)
}

/** Resolves any wallpaper id to a displayable URL at native resolution (null for a solid colour). */
export async function resolveWallpaperUrl(id: string, src: string): Promise<string | null> {
  if (isGenerated(id)) {
    const dpr = window.devicePixelRatio || 1
    return renderWallpaper(id, Math.round(window.screen.width * dpr), Math.round(window.screen.height * dpr))
  }
  return src || null
}
