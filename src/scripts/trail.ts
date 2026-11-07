/**
 * Cursor "cloud trail" for hero images — a lightweight stand-in for the
 * original Unicorn Studio scene (mouse trail + liquify + diffuse + dispersion).
 *
 * Two passes, WebGL1:
 *  1. Trail field (ping-pong, low-res): stores pointer velocity (rg) and energy (b),
 *     self-advected so it drifts like smoke, decaying every frame.
 *  2. Display: samples the hero photo through the field — displacement,
 *     chromatic dispersion, smoky blur and a soft haze, plus a little grain.
 *
 * Renders only while there is energy on screen; idles at 0 GPU otherwise.
 */

const VERT = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const TRAIL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uMouse;
uniform vec2 uVel;
uniform float uAspect;
uniform float uRadius;
uniform float uDecay;
vec3 read(vec2 uv) {
  vec4 t = texture2D(uPrev, uv);
  return vec3(t.xy * 2.0 - 1.0, t.z);
}
void main() {
  vec3 here = read(vUv);
  // self-advection: pull the field along its own velocity so it billows
  vec3 s = read(vUv - here.xy * vec2(1.0 / uAspect, 1.0) * 0.012);
  vec2 v = s.xy * uDecay;
  float e = s.z * (uDecay - 0.012);
  vec2 d = vUv - uMouse;
  d.x *= uAspect;
  float f = exp(-dot(d, d) / uRadius);
  float speed = length(uVel);
  v += uVel * f * 4.0;
  e += f * clamp(speed * 16.0, 0.0, 0.7);
  // kill quantisation residue so the field returns to exactly zero
  // dead-zone kills 8-bit quantisation residue (no lattice pattern at rest)
  v *= step(0.02, length(v));
  e *= step(0.012, e);
  gl_FragColor = vec4(clamp(v * 0.5 + 0.5, 0.0, 1.0), clamp(e, 0.0, 1.0), 1.0);
}`;

const DISPLAY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImg;
uniform sampler2D uTrail;
uniform vec2 uScale;
uniform vec2 uPos;
uniform vec2 uRes;
uniform float uTime;
vec2 cover(vec2 uv) { return uv * uScale + (1.0 - uScale) * uPos; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 t = texture2D(uTrail, vUv);
  vec2 v = t.xy * 2.0 - 1.0;
  v *= step(0.02, length(v));
  float e = t.z;
  vec2 uv = vUv - v * 0.014;
  vec2 disp = v * 0.003;
  // smoky blur: a few taps whose radius grows with energy
  float r = e * 0.006;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + uTime * 0.6;
    vec2 o = vec2(cos(a), sin(a)) * r;
    col.r += texture2D(uImg, cover(uv + o - disp)).r;
    col.g += texture2D(uImg, cover(uv + o)).g;
    col.b += texture2D(uImg, cover(uv + o + disp)).b;
  }
  col /= 6.0;
  // cloud-like haze lifting the shadows along the trail
  col = mix(col, col * 0.85 + vec3(0.16, 0.15, 0.15), e * 0.11);
  col += (hash(vUv * uRes + uTime) - 0.5) * 0.012 * e;
  // only paint where the trail lives; elsewhere the crisp <img> shows through
  float a = smoothstep(0.0, 0.35, e + length(v) * 2.5);
  gl_FragColor = vec4(col * a, a);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}
function program(gl: WebGLRenderingContext, frag: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  const u = (n: string) => gl.getUniformLocation(p, n);
  return { p, u };
}
function target(gl: WebGLRenderingContext, w: number, h: number, type: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  // neutral field: zero velocity (0.5), zero energy
  gl.clearColor(0.5, 0.5, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fb };
}

/** Half-float field when the GPU can render to it (smooth, no 8-bit banding); 8-bit otherwise. */
function fieldType(gl: WebGLRenderingContext) {
  const half = gl.getExtension('OES_texture_half_float');
  if (half && gl.getExtension('OES_texture_half_float_linear')) {
    gl.getExtension('EXT_color_buffer_half_float');
    const t = target(gl, 4, 4, half.HALF_FLOAT_OES);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
    if (ok) return half.HALF_FLOAT_OES;
  }
  return gl.UNSIGNED_BYTE;
}

/** Downscale the hero photo once at idle: cheaper upload (no first-move hitch) and ~half the texture memory. */
export async function prepareSource(media: HTMLElement): Promise<HTMLCanvasElement | null> {
  const img = media.querySelector('img');
  if (!img) return null;
  if (!img.complete || !img.naturalWidth) await img.decode().catch(() => {});
  if (!img.naturalWidth) return null;
  const w = Math.min(1280, img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((img.naturalHeight / img.naturalWidth) * w);
  // CPU-backed canvas: uploading it to WebGL needs no GPU readback
  c.getContext('2d', { willReadFrequently: true })?.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function initTrail(media: HTMLElement, source: HTMLCanvasElement | null = null): () => void {
  const img = media.querySelector('img');
  const host = media.closest<HTMLElement>('section') ?? media;
  if (!img) return () => {};

  const canvas = document.createElement('canvas');
  canvas.className = 'trail-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  if (!gl) return () => {};

  let trailP: ReturnType<typeof program>, displayP: ReturnType<typeof program>;
  try {
    trailP = program(gl, TRAIL_FRAG);
    displayP = program(gl, DISPLAY_FRAG);
  } catch (err) {
    console.warn('[trail] disabled:', err);
    return () => {};
  }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const imgTex = gl.createTexture()!;
  let W = 0, H = 0, TW = 0, TH = 0;
  const FT = fieldType(gl);
  let a = target(gl, 4, 4, FT), b = target(gl, 4, 4, FT);
  const pos = (getComputedStyle(img).objectPosition || '50% 50%').split(' ').map((v) => parseFloat(v) / 100 || 0.5);

  function resize() {
    const r = media.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = W; // dpr 1 — matches the original embed and keeps it cheap
    canvas.height = H;
    TW = Math.ceil(W / 6);
    TH = Math.ceil(H / 6);
    for (const t of [a, b]) { gl!.deleteTexture(t.tex); gl!.deleteFramebuffer(t.fb); }
    a = target(gl!, TW, TH, FT);
    b = target(gl!, TW, TH, FT);
    draw(0);
  }

  function upload() {
    gl!.bindTexture(gl!.TEXTURE_2D, imgTex);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, source ?? img!);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  }

  // pointer state (uv space, y up)
  const mouse = { x: 0.5, y: 0.5, vx: 0, vy: 0, tx: 0.5, ty: 0.5, inside: false };
  let lastMove = 0;
  let raf = 0;
  let prev = 0;
  let dtScale = 1; // frame time relative to 60Hz, so the fade looks the same at any refresh rate
  let visible = true;
  const t0 = performance.now();

  function draw(time: number) {
    if (!gl) return;
    const aspect = W / H;
    // 1. trail field
    gl.useProgram(trailP.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
    gl.viewport(0, 0, TW, TH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.uniform1i(trailP.u('uPrev'), 0);
    gl.uniform2f(trailP.u('uMouse'), mouse.x, mouse.y);
    gl.uniform2f(trailP.u('uVel'), mouse.vx, mouse.vy);
    gl.uniform1f(trailP.u('uAspect'), aspect);
    gl.uniform1f(trailP.u('uRadius'), 0.0035);
    gl.uniform1f(trailP.u('uDecay'), Math.pow(0.972, dtScale));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [a, b] = [b, a];

    // 2. display
    const iw = source?.width || img!.naturalWidth || 1, ih = source?.height || img!.naturalHeight || 1;
    const ia = iw / ih;
    gl.useProgram(displayP.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.uniform1i(displayP.u('uImg'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.uniform1i(displayP.u('uTrail'), 1);
    gl.uniform2f(displayP.u('uScale'), aspect > ia ? 1 : aspect / ia, aspect > ia ? ia / aspect : 1);
    gl.uniform2f(displayP.u('uPos'), pos[0] ?? 0.5, 1 - (pos[1] ?? 0.5));
    gl.uniform2f(displayP.u('uRes'), W, H);
    gl.uniform1f(displayP.u('uTime'), time / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function frame(now: number) {
    raf = 0;
    dtScale = prev ? Math.min(4, (now - prev) / 16.667) : 1;
    prev = now;
    // momentum-smoothed pointer (original used mouseMomentum ≈ 0.47)
    const nx = mouse.x + (mouse.tx - mouse.x) * 0.35;
    const ny = mouse.y + (mouse.ty - mouse.y) * 0.35;
    const vx = mouse.inside ? nx - mouse.x : 0;
    const vy = mouse.inside ? ny - mouse.y : 0;
    mouse.vx = mouse.vx * 0.5 + vx * 0.5;
    mouse.vy = mouse.vy * 0.5 + vy * 0.5;
    mouse.x = nx;
    mouse.y = ny;
    const moving = Math.hypot(mouse.vx, mouse.vy) > 1e-5 || Math.hypot(mouse.tx - nx, mouse.ty - ny) > 5e-4;
    if (moving) lastMove = now;
    draw(now - t0);
    // keep rendering ~2.5s after the pointer stops (any refresh rate) so the trail dissolves, then idle at 0 GPU
    if (visible && now - lastMove < 2500) raf = requestAnimationFrame(frame);
  }
  const kick = () => { lastMove = performance.now(); if (!raf && visible) { prev = 0; raf = requestAnimationFrame(frame); } };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    if (!mouse.inside) { mouse.x = mouse.tx = x; mouse.y = mouse.ty = y; }
    mouse.tx = x;
    mouse.ty = y;
    mouse.inside = true;
    kick();
  };
  const onLeave = () => { mouse.inside = false; };

  // only pointer movement starts rendering; leaving the viewport stops it
  const io = new IntersectionObserver(([en]) => {
    visible = !!en?.isIntersecting;
    if (!visible) { cancelAnimationFrame(raf); raf = 0; }
  });

  let ro: ResizeObserver | null = null;
  const start = () => {
    upload();
    resize();
    media.appendChild(canvas);
    requestAnimationFrame(() => canvas.classList.add('is-ready'));
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerleave', onLeave);
    io.observe(host);
    ro = new ResizeObserver(() => resize());
    ro.observe(media);
  };
  const onLost = (e: Event) => { e.preventDefault(); destroy(); };
  canvas.addEventListener('webglcontextlost', onLost);

  if (img.complete && img.naturalWidth) start();
  else img.addEventListener('load', start, { once: true });

  function destroy() {
    cancelAnimationFrame(raf);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerleave', onLeave);
    img!.removeEventListener('load', start);
    io.disconnect();
    ro?.disconnect();
    canvas.remove();
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return destroy;
}
