import { memo, useEffect, useRef } from 'react'

/**
 * The animated backdrop behind the boot sequence.
 *
 * WHY A SHADER RATHER THAN A STATIC COLOUR
 * ----------------------------------------
 * The boot screen is the first thing anyone sees, and it is on screen for
 * two to three seconds doing nothing but waiting. A flat `#0b0c0f` makes
 * that wait feel like a freeze — there is no evidence the machine is alive.
 * A slow, continuous motion behind the logo reads as a system warming up,
 * and costs a few milliseconds a frame at the reduced resolution used here.
 *
 * WHAT IT DRAWS
 * -------------
 * Light gathering toward the centre: a dark field with faint energy
 * converging on where the logo sits, growing as boot progresses. The
 * `progress` uniform drives that convergence, so the backdrop visibly
 * *resolves* as the work completes rather than looping indifferently.
 *
 * At `progress` 1 the field has fully gathered and begins to bloom
 * outward, which is the visual beat the reveal transition lands on.
 */
export const BootCanvas = memo(function BootCanvas({ progress }: { progress: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Read inside the loop without re-running the effect on every tick.
  const progressRef = useRef(progress)
  progressRef.current = progress

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' })
    // No WebGL2: the CSS background behind this canvas carries the screen.
    if (!gl) return

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[boot] shader', gl.getShaderInfoLog(s))
        return null
      }
      return s
    }

    const vs = compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 pos;void main(){gl_Position=vec4(pos,0.,1.);}')
    const fs = compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
precision highp float;
uniform vec2  uResolution;
uniform float uTime;
/** 0 at the start of boot, 1 when everything is ready. */
uniform float uProgress;
out vec4 fragColor;

float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  vec2 u=f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p){
  float s=0.,a=.5;
  mat2 r=mat2(.8,-.6,.6,.8);
  for(int i=0;i<4;i++){s+=a*noise(p);p=r*p*2.02;a*=.5;}
  return s;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;
  // Centre-relative, aspect-corrected: the gather must be circular on any
  // display, not an ellipse on a wide one.
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float r = length(p);
  float t = uTime * 0.09;

  // Filaments drawn in polar space, so they run toward the centre rather
  // than across the frame — the motion reads as convergence.
  float angle = atan(p.y, p.x);
  float strands = fbm(vec2(angle * 1.6, r * 3.2 - t * 2.2));

  // The gather: energy concentrates as progress rises.
  float focus = mix(0.22, 0.95, uProgress);
  float field = exp(-r * r * mix(7.0, 2.4, uProgress)) * focus;

  // Deep base, barely above black, warming very slightly as it resolves.
  vec3 col = mix(vec3(0.035, 0.040, 0.055), vec3(0.055, 0.065, 0.085), uProgress);

  // The converging light itself, in the accent blue.
  vec3 energy = mix(vec3(0.15, 0.42, 0.85), vec3(0.45, 0.72, 1.0), uProgress);
  col += energy * field * (0.30 + strands * 0.75);

  // A thin ring that tightens as boot completes, then blooms outward at
  // the end — the beat the reveal transition lands on.
  float ringR = mix(0.62, 0.20, smoothstep(0.0, 0.92, uProgress));
  float bloom = smoothstep(0.92, 1.0, uProgress);
  ringR += bloom * 0.9;
  float ring = exp(-pow(abs(r - ringR) * 26.0, 2.0)) * (0.16 + uProgress * 0.3) * (1.0 - bloom * 0.45);
  col += energy * ring;

  // Vignette, so the edges stay out of the way of the chrome.
  col *= 1.0 - smoothstep(0.35, 1.05, r) * 0.55;

  // Dither against banding — a near-black gradient bands badly at 8 bits,
  // and this screen is almost entirely near-black.
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (d - 0.5) / 255.0 * 2.0;

  fragColor = vec4(max(col, 0.0), 1.0);
}`,
    )
    if (!vs || !fs) return

    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[boot] link', gl.getProgramInfoLog(prog))
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, 'uResolution')
    const uTime = gl.getUniformLocation(prog, 'uTime')
    const uProgress = gl.getUniformLocation(prog, 'uProgress')

    // Rendered well below native: this is a soft, defocused field, so the
    // resolution is invisible, and boot is exactly when the machine is
    // busiest with real work.
    const SCALE = 0.5
    let width = 0
    let height = 0
    const resize = () => {
      const w = Math.max(1, Math.round(window.innerWidth * SCALE))
      const h = Math.max(1, Math.round(window.innerHeight * SCALE))
      if (w === width && h === height) return
      width = w
      height = h
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uRes, w, h)
    }
    resize()
    window.addEventListener('resize', resize)

    // Eased toward the target so a stage completing does not snap the
    // backdrop forward — the gather should glide.
    let shown = 0
    const start = performance.now()
    let raf = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      shown += (progressRef.current - shown) * 0.045
      gl.uniform1f(uTime, (now - start) / 1000)
      gl.uniform1f(uProgress, shown)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" style={{ display: 'block' }} />
})
