/**
 * Live wallpapers: animated fragment shaders that run continuously behind
 * the desktop and react to the pointer and the time of day.
 *
 * WHY THESE ARE SEPARATE FROM THE STATIC SET
 * ------------------------------------------
 * A static wallpaper is rendered once to a PNG and handed to an <img>: it
 * costs nothing to keep on screen. A live one holds a WebGL context and
 * draws every frame, so it has obligations a static image does not:
 *
 *   * It must stop when nothing can see it. A wallpaper animating behind a
 *     maximised window is pure heat. `LiveWallpaper` pauses on
 *     `document.hidden`, when the desktop reports itself covered, and when
 *     the window is not focused.
 *   * It must cap its own frame rate. These are backgrounds; at 30fps they
 *     are indistinguishable from 120 and cost a quarter as much.
 *   * It must degrade. No WebGL2, reduced-motion, or battery saver → fall
 *     back to the static render of the same scene, so the desktop never
 *     loses its wallpaper.
 *
 * INTERACTION
 * -----------
 * The pointer feeds the shader as a slowly-followed position, not the raw
 * cursor. Raw cursor tracking in a background makes the whole desktop feel
 * twitchy; a heavily damped follow reads as the light responding to you,
 * which is the intent.
 *
 * TIME OF DAY
 * -----------
 * `uDaylight` runs 0 (midnight) → 1 (noon) → 0, and shaders use it to shift
 * their palette. The desktop at 7am genuinely differs from the same desktop
 * at 10pm, which is the kind of detail that makes a system feel alive
 * without ever asking for attention.
 */

export interface LiveWallpaper {
  id: string
  label: string
  description: string
  /** The static wallpaper rendered when this one cannot animate. */
  fallback: string
  /**
   * Fraction of the screen's resolution to render at, matched to what this
   * shader actually costs. Measured on the target machine at 50%: Mesh 3.7 ms,
   * Depths 3.3, Silk 7.0, Dawn 10.7, Aurora 15.0, Nebula 16.2, Drift 22.8 per
   * frame, against a 33 ms budget at 30 fps. These are defocused backdrops, so
   * resolution is the cheap thing to give up; each is set so a frame lands
   * near 8 ms, leaving the GPU to the compositor and the apps on top.
   */
  scale?: number
  fragment: string
  /** Base palette, fed to the shader as uniforms. */
  palette: string[]
  light?: boolean
}

const COMMON = `#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform float uTime;
/** Damped pointer position in 0..1, y up. */
uniform vec2  uPointer;
/** 0 at midnight, 1 at noon. */
uniform float uDaylight;
uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    sum += amp * noise(p);
    p = rot * p * 2.02;
    amp *= 0.5;
  }
  return sum;
}

/** Ordered dither — removes 8-bit banding without grain texture. */
vec3 dither(vec3 c, vec2 fc) {
  float d = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);
  return c + (d - 0.5) / 255.0 * 1.6;
}
`

/* ------------------------------------------------------------------ */

export const LIVE_WALLPAPERS: LiveWallpaper[] = [
  {
    id: 'live:mesh',
    label: 'Mesh',
    description: 'Soft pools of colour drifting and blending, with one that follows your pointer. The lightest of the live set.',
    fallback: 'gen:mesh',
    scale: 0.5,
    palette: ['#0e0b24', '#ff4d8d', '#7a5cff', '#22d3ee'],
    fragment: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * 0.12;

  // Four blobs on slow Lissajous paths. No noise at all, which is what makes
  // this several times cheaper than the ribbon shaders on the same GPU.
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(aspect * (0.5 + 0.38 * sin(t * (0.6 + 0.17 * fi) + fi * 2.1)),
                  0.5 + 0.36 * cos(t * (0.5 + 0.21 * fi) + fi * 1.3));
    float d = distance(p, c);
    float w = exp(-d * d * 3.6);
    vec3 colr = i == 0 ? uC1 : (i == 1 ? uC2 : (i == 2 ? uC3 : mix(uC1, uC3, 0.5)));
    acc += colr * w;
    ws += w;
  }
  // The pointer carries its own pool of light.
  float dp = distance(p, vec2(uPointer.x * aspect, uPointer.y));
  float wp = exp(-dp * dp * 9.0) * 0.55;
  acc += mix(uC2, uC3, 0.5) * wp;
  ws += wp;

  vec3 col = mix(uC0, acc / max(ws, 1e-4), clamp(ws * 1.35, 0.0, 1.0));
  col *= mix(vec3(0.86, 0.9, 1.06), vec3(1.06, 1.0, 0.95), uDaylight);
  float vig = 1.0 - length((uv - 0.5) * vec2(1.05, 1.0)) * 0.42;
  col *= 0.9 + vig * 0.14;
  fragColor = vec4(clamp(dither(col, gl_FragCoord.xy), 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'live:drift',
    label: 'Drift',
    description: 'Ribbons of light that fold slowly through the frame and bend toward the pointer.',
    fallback: 'gen:sequoia',
    scale: 0.3,
    palette: ['#04142e', '#2b7fd4', '#4aa8e8', '#8ed0f0'],
    fragment: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = vec2(uv.x * (uResolution.x / uResolution.y), uv.y);

  // The pointer bends the flow field rather than drawing anything: a
  // visible cursor blob would be a toy, a bend in the light is a material.
  vec2 toPointer = p - vec2(uPointer.x * (uResolution.x / uResolution.y), uPointer.y);
  float pull = exp(-dot(toPointer, toPointer) * 2.2) * 0.35;

  float t = uTime * 0.035;
  vec2 q = vec2(fbm(p * 1.3 + t), fbm(p * 1.3 + vec2(5.2, 1.3) - t * 0.7));
  vec2 r = vec2(
    fbm(p * 1.3 + 3.0 * q + vec2(1.7, 9.2) + pull),
    fbm(p * 1.3 + 3.0 * q + vec2(8.3, 2.8) - pull)
  );
  float f = fbm(p * 1.3 + 3.0 * r);

  vec3 col = mix(uC0, uC0 * 1.6, uv.y);
  float band = f * 2.4 + r.x * 1.2;
  float b0 = smoothstep(0.30, 0.62, band) * (1.0 - smoothstep(0.62, 0.95, band));
  float b1 = smoothstep(0.55, 0.88, band) * (1.0 - smoothstep(0.88, 1.25, band));
  float b2 = smoothstep(0.85, 1.18, band) * (1.0 - smoothstep(1.18, 1.60, band));
  col = mix(col, uC3, b2 * 0.5);
  col = mix(col, uC2, b1 * 0.62);
  col = mix(col, uC1, b0 * 0.74);

  // Daylight warms the whole image at noon and cools it at night.
  col *= mix(vec3(0.82, 0.86, 1.05), vec3(1.08, 1.02, 0.94), uDaylight);

  float light = 1.0 - length(uv - vec2(0.28, 0.12)) * 0.55;
  col *= 0.86 + light * 0.3;
  float vig = 1.0 - length((uv - 0.5) * vec2(1.1, 1.0)) * 0.42;
  col *= 0.90 + vig * 0.12;

  fragColor = vec4(clamp(dither(col, gl_FragCoord.xy), 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'live:aurora',
    label: 'Aurora',
    description: 'Curtains of polar light, rising and fading on their own rhythm.',
    fallback: 'gen:aurora',
    scale: 0.35,
    palette: ['#030a18', '#15c4a8', '#2d7fd4', '#7b4fd4'],
    fragment: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = vec2(uv.x * (uResolution.x / uResolution.y), uv.y);
  float t = uTime * 0.05;

  vec3 col = mix(uC0, uC0 * 2.2, uv.y * 0.6);

  // Each curtain drifts at its own speed, so they separate and recombine
  // instead of moving as one sheet.
  float h = 1.0 - smoothstep(0.05, 1.0, uv.y);
  float c0 = smoothstep(0.38, 0.74, fbm(vec2(p.x * 2.1 + t, p.y * 0.6))) * h;
  float c1 = smoothstep(0.46, 0.82, fbm(vec2(p.x * 1.7 - t * 1.4, p.y * 0.5 + 3.0))) * h;
  float c2 = smoothstep(0.52, 0.88, fbm(vec2(p.x * 2.6 + t * 0.6, p.y * 0.7 + 7.0))) * h * 0.8;

  // The pointer brightens the curtains near it, like a torch under silk.
  float glow = exp(-distance(uv, uPointer) * 3.5) * 0.25;

  col = mix(col, uC3, c2 * (0.42 + glow));
  col = mix(col, uC2, c1 * (0.50 + glow));
  col = mix(col, uC1, c0 * (0.58 + glow));

  // Stars, only in the upper frame and only at night.
  float night = 1.0 - uDaylight;
  float star = step(0.9985, hash(floor(gl_FragCoord.xy * 0.5)));
  col += star * night * smoothstep(0.25, 1.0, uv.y) * 0.55;

  col *= mix(vec3(0.9, 0.94, 1.1), vec3(1.05, 1.0, 0.95), uDaylight);
  float vig = 1.0 - length((uv - 0.5) * vec2(1.1, 1.0)) * 0.45;
  col *= 0.90 + vig * 0.12;

  fragColor = vec4(clamp(dither(col, gl_FragCoord.xy), 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'live:silk',
    label: 'Silk',
    description: 'A sheet of fabric catching light, rippling where the pointer passes.',
    fallback: 'gen:sonoma',
    scale: 0.5,
    palette: ['#1a0a2e', '#c2459b', '#7b3fd4', '#f08ab8'],
    fragment: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = vec2(uv.x * (uResolution.x / uResolution.y), uv.y);
  float t = uTime * 0.06;

  // Interference of three travelling waves gives the folded-fabric look;
  // the warp makes the folds irregular rather than a moiré pattern.
  float warp = fbm(p * 1.1 + t * 0.4) * 1.4;
  float w1 = sin((p.x * 3.2 + warp) * 2.0 + t * 1.4);
  float w2 = sin((p.y * 2.4 - warp * 0.8) * 2.6 - t * 1.1);
  float w3 = sin((p.x + p.y) * 2.1 + warp * 1.6 + t * 0.7);
  float fold = (w1 + w2 + w3) / 3.0;

  // A ripple spreading from the pointer, decaying with distance.
  float d = distance(p, vec2(uPointer.x * (uResolution.x / uResolution.y), uPointer.y));
  fold += sin(d * 14.0 - uTime * 2.2) * exp(-d * 3.0) * 0.45;

  float shade = fold * 0.5 + 0.5;
  vec3 col = mix(uC0, uC2, smoothstep(0.0, 0.85, shade));
  col = mix(col, uC1, smoothstep(0.45, 1.0, shade) * 0.8);
  // Specular: the crest of each fold catches a hard highlight.
  col += uC3 * pow(smoothstep(0.72, 1.0, shade), 3.0) * 0.6;

  col *= mix(vec3(0.84, 0.88, 1.06), vec3(1.08, 1.0, 0.92), uDaylight);
  float vig = 1.0 - length((uv - 0.5) * vec2(1.05, 1.0)) * 0.40;
  col *= 0.90 + vig * 0.14;

  fragColor = vec4(clamp(dither(col, gl_FragCoord.xy), 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'live:depths',
    label: 'Depths',
    description: 'Slow caustics, as light through moving water.',
    fallback: 'gen:tide',
    scale: 0.5,
    palette: ['#021a22', '#14b8a0', '#0e8fa8', '#4fd4c0'],
    fragment: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = vec2(uv.x * (uResolution.x / uResolution.y), uv.y) * 2.4;
  float t = uTime * 0.12;

  // Caustics: the classic trick is iterating a point through a small
  // rotating displacement and accumulating how close it stays to a grid.
  // The bright filaments that fall out are what light through water does.
  vec2 q = p;
  float acc = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    q += vec2(
      sin(q.y * 1.6 + t + fi * 1.3) * 0.38,
      cos(q.x * 1.4 - t * 0.8 + fi * 1.1) * 0.38
    );
    acc += 1.0 / (abs(sin(q.x) * cos(q.y)) * 6.0 + 0.55);
  }
  acc /= 5.0;

  // The pointer pushes the water, displacing the caustics around it.
  float d = distance(uv, uPointer);
  acc *= 1.0 + exp(-d * 5.0) * 0.5;

  float depth = 1.0 - uv.y * 0.55;
  vec3 col = mix(uC0, uC2, depth * 0.7);
  col += uC1 * pow(acc, 1.6) * 0.42;
  col += uC3 * pow(acc, 3.2) * 0.30;

  col *= mix(vec3(0.82, 0.9, 1.08), vec3(1.06, 1.02, 0.96), uDaylight);
  float vig = 1.0 - length((uv - 0.5) * vec2(1.1, 1.0)) * 0.44;
  col *= 0.88 + vig * 0.14;

  fragColor = vec4(clamp(dither(col, gl_FragCoord.xy), 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'live:dawn',
    label: 'Dawn',
    description: 'A soft gradient sky with drifting cloud banks. Light enough for light mode.',
    fallback: 'gen:dawn',
    scale: 0.42,
    palette: ['#fdf2e8', '#f0a070', '#e87a94', '#f5c48a'],
    light: true,
    fragment: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = vec2(uv.x * (uResolution.x / uResolution.y), uv.y);
  float t = uTime * 0.018;

  // Sky: a vertical gradient with the warm band low, as at sunrise.
  vec3 col = mix(uC1, uC0, smoothstep(0.0, 0.75, uv.y));
  col = mix(col, uC2, smoothstep(0.55, 0.0, uv.y) * 0.45);

  // Cloud banks: stretched fbm so they are wide and flat, not puffy.
  float c1 = fbm(vec2(p.x * 1.1 + t, p.y * 3.2));
  float c2 = fbm(vec2(p.x * 0.8 - t * 1.6, p.y * 2.6 + 4.0));
  float band1 = smoothstep(0.48, 0.78, c1) * smoothstep(0.9, 0.3, uv.y);
  float band2 = smoothstep(0.52, 0.84, c2) * smoothstep(0.75, 0.2, uv.y);

  col = mix(col, uC3, band2 * 0.40);
  col = mix(col, vec3(1.0), band1 * 0.30);

  // The pointer lifts a soft glow, like sun breaking through.
  col += uC3 * exp(-distance(uv, uPointer) * 4.0) * 0.16;

  col *= mix(vec3(0.90, 0.92, 1.02), vec3(1.04, 1.01, 0.97), uDaylight);
  float vig = 1.0 - length((uv - 0.5) * vec2(1.0, 1.0)) * 0.26;
  col *= 0.94 + vig * 0.08;

  fragColor = vec4(clamp(dither(col, gl_FragCoord.xy), 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'live:nebula',
    label: 'Nebula',
    description: 'Deep-space gas and starlight, slowly turning.',
    fallback: 'gen:graphite',
    scale: 0.34,
    palette: ['#050408', '#6b3fd4', '#2d5fd4', '#d44f9b'],
    fragment: `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * 2.2;
  float t = uTime * 0.012;

  // A slow rotation of the whole field: nebulae read as turning, not
  // scrolling, and rotation costs one mat2.
  float a = t * 0.5;
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;

  // Layered fbm at different scales gives the depth of real gas clouds.
  float n1 = fbm(p * 1.2 + t);
  float n2 = fbm(p * 2.6 - t * 1.4 + n1);
  float n3 = fbm(p * 5.2 + n2 * 1.5);

  vec3 col = uC0;
  col = mix(col, uC1, smoothstep(0.35, 0.85, n1) * 0.55);
  col = mix(col, uC2, smoothstep(0.45, 0.90, n2) * 0.45);
  col = mix(col, uC3, smoothstep(0.55, 0.95, n3) * 0.35);

  // Stars at three sizes so the field has depth rather than one flat layer.
  for (int i = 0; i < 3; i++) {
    float scale = 0.6 + float(i) * 0.7;
    vec2 g = floor(gl_FragCoord.xy * scale * 0.25);
    float s = step(0.9975 - float(i) * 0.0006, hash(g + float(i) * 31.7));
    // Twinkle: each star has its own phase from its grid cell.
    float tw = 0.65 + 0.35 * sin(uTime * 1.6 + hash(g) * 28.0);
    col += s * tw * (0.5 - float(i) * 0.12);
  }

  // The pointer is a faint gravitational brightening.
  col += uC2 * exp(-distance(uv, uPointer) * 4.5) * 0.18;

  float vig = 1.0 - length(uv - 0.5) * 0.72;
  col *= 0.82 + vig * 0.3;

  fragColor = vec4(clamp(dither(col, gl_FragCoord.xy), 0.0, 1.0), 1.0);
}`,
  },
]

export const isLive = (id: string) => id.startsWith('live:')
export const liveWallpaper = (id: string) => LIVE_WALLPAPERS.find((w) => w.id === id)

/** 0 at midnight, 1 at noon — a smooth cosine, not a step. */
export function daylight(now = new Date()): number {
  const hours = now.getHours() + now.getMinutes() / 60
  return 0.5 - 0.5 * Math.cos((hours / 24) * Math.PI * 2)
}

/* ------------------------------------------------------------------ */
/*  STILL FRAMES (for thumbnails)                                      */
/* ------------------------------------------------------------------ */

const stillCache = new Map<string, Promise<string | null>>()

/**
 * One frame of a live wallpaper, rendered offscreen to a blob URL.
 *
 * A gallery tile should show what the wallpaper really looks like. The
 * static fallback it carries is a different scene (and for most of them is
 * the same picture as a tile in the "Still" list), so thumbnails are drawn
 * from the live shader itself, frozen at a moment where it has developed
 * rather than at t=0 when most of them are still near-empty.
 *
 * Resolves null if WebGL2 is unavailable or the shader fails, and callers
 * fall back to the static frame.
 */
export function renderLiveStill(id: string, width: number, height: number): Promise<string | null> {
  const key = `${id}@${width}x${height}`
  const hit = stillCache.get(key)
  if (hit) return hit
  const job = (async () => {
    const def = liveWallpaper(id)
    if (!def) return null
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
    if (!gl) return null
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
    }
    const vs = compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 pos;void main(){gl_Position=vec4(pos,0.,1.);}')
    const fs = compile(gl.FRAGMENT_SHADER, def.fragment)
    if (!vs || !fs) return null
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const hex = (h: string): [number, number, number] => {
      const n = parseInt(h.replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
      return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
    }
    gl.uniform2f(gl.getUniformLocation(prog, 'uResolution'), canvas.width, canvas.height)
    // 42s in: far enough that drifting scenes have developed.
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), 42)
    gl.uniform2f(gl.getUniformLocation(prog, 'uPointer'), 0.62, 0.58)
    gl.uniform1f(gl.getUniformLocation(prog, 'uDaylight'), 0.6)
    ;['uC0', 'uC1', 'uC2', 'uC3'].forEach((name, i) => {
      const l = gl.getUniformLocation(prog, name)
      if (l) gl.uniform3fv(l, hex(def.palette[i] ?? def.palette[def.palette.length - 1]))
    })
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    gl.deleteBuffer(buf)
    gl.deleteProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    // Release the context now: browsers cap live contexts near sixteen.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return URL.createObjectURL(blob)
  })().catch(() => null)
  stillCache.set(key, job)
  return job
}
