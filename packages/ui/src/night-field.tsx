"use client";

import { useEffect, useRef } from "react";

/*
 * The ambient background behind the holding page: a night sky over the brand's own
 * horizon — two parallaxed star layers, a low dawn glow, and film grain.
 *
 * It is deliberately ADDITIVE and aria-hidden, and that is a correctness constraint
 * rather than a style preference. `coming-soon.tsx` documents why the holding page may
 * not hide its own content behind JS: portal's layout has no <head>, so nothing can undo
 * a server-rendered hidden state, and a client without JS would get a blank page. This
 * component sidesteps that entirely by never owning any content. If the script never
 * runs, if WebGL is missing, if the shader fails to compile, or if the visitor is a
 * crawler, what remains is the ink background and the whole text — which is exactly what
 * renders today. There is no fallback to write because the fallback is the page itself.
 *
 * Raw WebGL rather than a library. A fullscreen quad needs one shader, one triangle and
 * five uniforms; ogl would have saved roughly fifteen of the lines below and brought a
 * scene graph and projection matrices that nothing here uses. Measured against
 * AGENTS.md's preference for not adding a dependency that carries less than it costs,
 * it does not pay for itself.
 *
 * On motion: nothing in the shader beats on a sine or drifts at a constant velocity.
 * A regular period is discoverable in about two passes, and once the eye finds it the
 * whole scene reads as a mechanism rather than as weather. So the glow breathes by
 * sampling noise along time, the warp adds a noise wander to its slow advance, and every
 * star draws its own frequency, size and magnitude from a different hash — several of
 * them barely twinkle at all.
 */

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;

/*
 * How much of the dawn actually lands. Chosen on a live preview rather than by taste:
 * at this value the stars carry the composition and the light is only an implication,
 * which is the point of a page that says the thing has not arrived yet.
 */
const float DAWN = 0.1;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

/*
 * One star per grid cell, placed by hash. \`step\` rather than \`if\` so the shader does
 * not branch. The jitter is nearly a full cell wide: at 0.7 the stars came out roughly
 * equidistant and the grid itself became visible, which no real sky does.
 */
float starLayer(vec2 st, float t, float scale, float density, float bright){
  vec2 g = st * scale;
  vec2 id = floor(g), f = fract(g) - 0.5;
  float h = hash(id);
  float present = step(density, h);
  vec2 jitter = (vec2(hash(id + 11.0), hash(id + 23.0)) - 0.5) * 0.94;
  float d = length(f - jitter);
  float size = 0.026 + hash(id + 31.0) * 0.058;
  float mag = 0.30 + hash(id + 47.0) * 0.70;
  float rate = 0.10 + hash(id + 59.0) * 0.72;
  float depth = 0.20 + hash(id + 71.0) * 0.60;
  float twinkle = 1.0 - depth * (0.5 + 0.5 * sin(t * rate + h * 63.0));
  return present * smoothstep(size, 0.0, d) * mag * twinkle * bright;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 st = vec2(uv.x * aspect, uv.y);

  // The dawn: a flattened ellipse low in the frame, breathing on noise, drifting sideways.
  float cx = 0.5 * aspect + (noise(vec2(uTime * 0.014, 5.2)) - 0.5) * 0.20;
  float d = length((st - vec2(cx, 0.30)) * vec2(0.62, 1.75));
  float glow = exp(-d * 2.15) * (0.84 + 0.24 * noise(vec2(uTime * 0.055, 3.7)));

  vec2 wander = vec2(noise(vec2(uTime * 0.021, 0.0)) - 0.5,
                     noise(vec2(0.0, uTime * 0.017)) - 0.5) * 0.55;
  vec2 q = vec2(st.x * 1.4, st.y * 2.0) + wander - vec2(0.0, uTime * 0.013);
  float warp = fbm(q + fbm(q * 0.6 + uTime * 0.012));
  glow *= 0.55 + 0.75 * warp;

  float bandY = 0.52 + (noise(vec2(uTime * 0.030, 9.1)) - 0.5) * 0.11;
  float aurora = exp(-pow((uv.y - bandY) * 4.2, 2.0)) * warp * 0.16;

  vec3 ink = vec3(0.0784, 0.0784, 0.0745);
  vec3 cream = vec3(0.9804, 0.9765, 0.9608);

  vec3 col = ink;

  // Two layers at different scales and speeds: the parallax reads as depth, and the two
  // overlapping grids destroy the regularity that gave a single layer away.
  float sky = starLayer(st + vec2(uTime * 0.0034, 0.0), uTime, 26.0, 0.952, 1.00)
            + starLayer(st + vec2(uTime * 0.0011, 0.0), uTime, 61.0, 0.936, 0.50);

  /*
   * Stars wash out near the glow, as they do at a real dawn — but the wash has to scale
   * with DAWN. Without that factor a glow too faint to see still erased the stars across
   * half the screen: a hole with no visible cause.
   */
  float wash = clamp(1.0 - glow * 6.5 * DAWN, 0.0, 1.0);
  col += cream * sky * 0.85 * wash;

  col = mix(col, cream, clamp(glow * DAWN, 0.0, 1.0));
  col = mix(col, cream, clamp(aurora * DAWN, 0.0, 1.0));

  // A gentle vignette so the headline always wins against the field behind it.
  col *= 0.72 + 0.28 * smoothstep(1.15, 0.25, length(uv - 0.5));

  // Film grain — what separates this from a CSS gradient.
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.022;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function NightField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");

    /*
     * Reduced motion draws ONE frame at a fixed time and never schedules another, rather
     * than collapsing the duration the way globals.css does for the CSS animations. A
     * duration of 0.01ms is meaningless to a render loop; the honest reading of "reduce"
     * for ambient motion is a still image.
     */
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, still ? 8 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!still) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas ref={ref} aria-hidden="true" className="absolute inset-0 z-0 block h-full w-full" />
  );
}
