'use client';

// Video Editor (Studio > Audio Editor > Video) — temporary. Drop a video, rough it up
// until it stops looking AI-clean (lower resolution, compression blocks, blur,
// grain, washed colour), zoom in to check it pixel by pixel, export it.
//
// Every frame goes through one WebGL shader, so changes show live while the
// clip plays. Scroll to zoom (around the cursor), drag to pan, double-click to
// fit. Export re-records the clip in real time through MediaRecorder; its
// bitrate slider is real codec compression on top of the shader's.

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent, type WheelEvent } from 'react';

type Key =
  | 'resolution' | 'smear' | 'compression' | 'blur' | 'sharpness' | 'grain' | 'banding'
  | 'saturation' | 'contrast' | 'brightness' | 'warmth' | 'fade' | 'chroma' | 'vignette'
  | 'smudge' | 'scanlines' | 'wobble' | 'bleed' | 'stamp' | 'bitrate';

type Settings = Record<Key, number>;

const CONTROLS: { id: Key; label: string; hint: string }[] = [
  { id: 'resolution', label: 'Resolution', hint: 'Real downscale to this height, played back full size' },
  { id: 'smear', label: 'Detail loss', hint: 'Re-upload smoothing: pores and hair go waxy, edges stay' },
  { id: 'compression', label: 'Compression', hint: '8×8 JPEG-style blocks' },
  { id: 'blur', label: 'Blur', hint: 'Soft focus' },
  { id: 'sharpness', label: 'Oversharpen', hint: 'Cheap phone halos on edges' },
  { id: 'grain', label: 'Grain', hint: 'Sensor noise, moves every frame' },
  { id: 'banding', label: 'Banding', hint: 'Fewer brightness steps (colours kept)' },
  { id: 'saturation', label: 'Saturation', hint: '50 = unchanged' },
  { id: 'contrast', label: 'Contrast', hint: '50 = unchanged' },
  { id: 'brightness', label: 'Brightness', hint: '50 = unchanged' },
  { id: 'warmth', label: 'Warmth', hint: '50 = neutral, up = yellow, down = blue' },
  { id: 'fade', label: 'Fade', hint: 'Lifted, milky blacks' },
  { id: 'chroma', label: 'Colour fringing', hint: 'Red and blue split apart' },
  { id: 'vignette', label: 'Vignette', hint: 'Dark corners' },
  { id: 'smudge', label: 'Lens smudge', hint: 'Greasy lens: everything soft, light smears and streaks' },
  { id: 'scanlines', label: 'Scanlines', hint: 'Interlaced TV lines' },
  { id: 'wobble', label: 'Tape wobble', hint: 'Wavy lines and a rolling tracking band' },
  { id: 'bleed', label: 'Colour bleed', hint: 'VHS colour smearing to the right' },
  { id: 'stamp', label: 'Date stamp', hint: 'PLAY ▶ and a 1990s date, 0 = off' },
  { id: 'bitrate', label: 'Export quality', hint: 'Real codec bitrate on export (not in preview)' },
];

const DEFAULTS: Settings = {
  resolution: 100, smear: 0, compression: 0, blur: 0, sharpness: 0, grain: 0, banding: 0,
  saturation: 50, contrast: 50, brightness: 50, warmth: 50, fade: 0, chroma: 0, vignette: 0, smudge: 0,
  scanlines: 0, wobble: 0, bleed: 0, stamp: 0, bitrate: 100,
};

const PHONE_REPOST: Settings = {
  resolution: 55, smear: 30, compression: 35, blur: 12, sharpness: 30, grain: 28, banding: 15,
  saturation: 50, contrast: 54, brightness: 50, warmth: 50, fade: 12, chroma: 0, vignette: 15, smudge: 0,
  scanlines: 0, wobble: 0, bleed: 0, stamp: 0, bitrate: 25,
};

// Aiden's own mix (2026-10-02): ~600p on 1080p-tall footage, a little soft, a
// touch less saturated and contrasty. Saved exactly as he set it.
const QUALITY_FILTER: Settings = {
  resolution: 52.2, smear: 5, compression: 0, blur: 7, sharpness: 0, grain: 0, banding: 0,
  saturation: 43, contrast: 47, brightness: 50, warmth: 50, fade: 0, chroma: 0, vignette: 0, smudge: 1,
  scanlines: 0, wobble: 0, bleed: 0, stamp: 0, bitrate: 100,
};

// Measured pixel by pixel from Aiden's before/after pair (2026-10-02): the
// original was shrunk to ~480 lines and played back full size, everything ~7
// levels darker with the blacks crushed hardest, saturation -8%, red a hair
// down. No grain, no 8x8 blocks. Resolution is set from the clip's height so
// it lands on 480p whatever the source (see the Reference match button).
const REFERENCE_MATCH: Settings = {
  ...DEFAULTS, resolution: 40.9, sharpness: 8, saturation: 46, contrast: 52, brightness: 45, warmth: 45,
};
const TARGET_P: Partial<Record<string, number>> = { reference: 480 };

// A clip saved and re-uploaded a few times: smaller, fine texture smoothed
// away, edges a touch crunchy, contrast a little flat. Colours untouched. No grain.
const REUPLOAD: Settings = {
  resolution: 48, smear: 70, compression: 18, blur: 6, sharpness: 22, grain: 0, banding: 0,
  saturation: 50, contrast: 45, brightness: 53, warmth: 50, fade: 8, chroma: 0, vignette: 0, smudge: 0,
  scanlines: 0, wobble: 0, bleed: 0, stamp: 0, bitrate: 20,
};

// A phone lens someone wiped with a thumb: the whole frame soft and hazy, light
// smearing out of every bright area.
const SMUDGED: Settings = {
  ...DEFAULTS, resolution: 72, smear: 30, sharpness: 10, grain: 8,
  contrast: 46, smudge: 70, bitrate: 50,
};

// Old-school camcorder: ~240-line tape, soft but edge-enhanced, warm and a bit
// hot on colour, smeared chroma, wobbly tracking, the date burned in.
const CAMCORDER: Settings = {
  resolution: 38, smear: 25, compression: 0, blur: 22, sharpness: 40, grain: 32, banding: 0,
  saturation: 60, contrast: 57, brightness: 52, warmth: 62, fade: 16, chroma: 22, vignette: 22, smudge: 0,
  scanlines: 35, wobble: 30, bleed: 55, stamp: 100, bitrate: 40,
};

const VERT = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 uv;
uniform sampler2D tex, ovl;
uniform vec2 res;
uniform float smudge, scale, smear, block, blur, sharp, grain, bands, sat, con, bri, warm, fade, chroma, vig, time, scan, wob, bleed, stamp;

vec2 low() { return max(floor(res * scale), vec2(2.0)); }
// tex already holds the frame at the target resolution (area-averaged by the
// browser's downscale); LINEAR sampling is the player's bilinear upscale.
vec3 S(vec2 t) { return texture2D(tex, clamp(t, 0.0, 1.0)).rgb; }
vec3 B(vec2 t, float r) {
  vec2 px = r / low();
  vec3 c = vec3(0.0);
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) c += S(t + vec2(float(x), float(y)) * px);
  return c / 9.0;
}
float hash(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 q) { return 0.5 * vnoise(q) + 0.3 * vnoise(q * 2.1) + 0.2 * vnoise(q * 4.3); }
// Wide soft blur in frame units (two rings of 12 taps), for the smudge.
vec3 G(vec2 t, float r) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    vec2 o = vec2(cos(a), sin(a) * res.x / res.y) * r;
    c += S(t + o) + S(t + o * 0.45);
  }
  return c / 24.0;
}

void main() {
  vec2 uv0 = uv;
  vec2 uv = uv0;
  if (wob > 0.0) {
    float line = floor(uv.y * res.y / max(1.0, res.y / 480.0));
    uv.x += wob * 0.0025 * sin(uv.y * 40.0 + time * 3.0);
    uv.x += wob * 0.0015 * (hash(vec2(line, floor(time * 30.0))) - 0.5);
    float band = fract(time * 0.06) * 1.3 - 0.15;
    float inBand = smoothstep(0.06, 0.0, abs(uv.y - band));
    uv.x += inBand * wob * 0.02 * (hash(vec2(line, time)) - 0.3);
  }
  vec2 off = vec2(chroma * 0.006, 0.0);
  vec3 c = blur > 0.0
    ? vec3(B(uv + off, blur).r, B(uv, blur).g, B(uv - off, blur).b)
    : vec3(S(uv + off).r, S(uv).g, S(uv - off).b);

  if (smear > 0.0) {
    // Edge-aware: flatten areas that barely vary (skin, hair, walls), leave real edges.
    vec3 m = B(uv, 2.0);
    float diff = length(c - m);
    c = mix(c, m, smear * smoothstep(0.05 + smear * 0.12, 0.0, diff));
  }

  if (sharp > 0.0) c += sharp * (c - B(uv, 1.0));

  if (smudge > 0.0) {
    // A greasy film over the whole lens: uneven softness everywhere, and light
    // smears out of every bright area, streaking along the wipe direction.
    float k = smudge * clamp(0.7 + 0.6 * (fbm(uv * 3.0 + 3.1) - 0.5) + 0.3 * (fbm(uv * 11.0) - 0.5), 0.0, 1.0);
    // Brightness only: the pixel keeps its own colour (chroma), so the smudge
    // never shifts hue or saturation.
    vec3 W = vec3(0.299, 0.587, 0.114);
    float y = dot(c, W);
    vec3 chromaPart = c - y;
    float yg = dot(G(uv, 0.03 * smudge), W);
    float st = 0.0;
    vec2 dir = normalize(vec2(1.0, 0.35)) * 0.012 * smudge;
    for (int i = -6; i <= 6; i++) st += max(dot(S(uv + dir * float(i)), W) - 0.5, 0.0);
    float glow = max(dot(G(uv, 0.06 * smudge), W) - 0.5, 0.0) * 1.4 + st / 13.0 * 1.6;
    float y2 = mix(y, yg, k * 0.7) + glow * k;
    y2 = mix(y2, 0.86, k * 0.1);
    c = y2 + chromaPart;
  }

  if (bleed > 0.0) {
    // Keep the brightness, smear the colour (YIQ) along the line, trailing right.
    mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    mat3 toR = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toY * c;
    vec2 iq = vec2(0.0);
    for (int k = 0; k < 6; k++) iq += (toY * S(uv - vec2(float(k) * bleed * 0.004, 0.0))).yz;
    yiq.yz = mix(yiq.yz, iq / 6.0, min(1.0, bleed * 1.5));
    c = toR * yiq;
  }

  if (block > 0.0) {
    vec2 l = low() / 8.0;
    vec2 cell = (floor(uv * l) + 0.5) / l;
    vec3 avg = B(cell, 2.5);
    // Steps brightness only, so blocks never shift hue.
    float qn = 40.0 - block * 34.0, yq = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 q = c + (floor(yq * qn) / qn - yq);
    c = mix(c, mix(avg, q, 0.5), block * 0.85);
  }

  c = (c - 0.5) * con + 0.5 + bri;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, sat);
  c += vec3(warm, warm * 0.3, -warm);
  c = fade + c * (1.0 - fade);

  if (bands > 0.0) {
    // Brightness steps only: banding without hue shifts.
    float n = 64.0 - bands * 58.0, yb = dot(c, vec3(0.299, 0.587, 0.114));
    c += floor(yb * n + 0.5) / n - yb;
  }

  if (grain > 0.0) {
    vec2 g = floor(gl_FragCoord.xy / max(1.0, res.y / 720.0));
    c += (hash(g + fract(time) * 913.0) - 0.5) * grain * 0.5;
  }

  if (scan > 0.0) {
    float l = floor(gl_FragCoord.y / max(1.0, res.y / 480.0));
    c *= 1.0 - scan * 0.4 * mod(l, 2.0);
  }

  if (stamp > 0.0) {
    vec4 o = texture2D(ovl, uv0);
    c = mix(c, o.rgb, o.a * stamp);
  }

  vec2 d = uv0 - 0.5;
  c *= 1.0 - vig * smoothstep(0.25, 0.75, length(d) * 1.2);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function uniformsFrom(s: Settings) {
  const n = (v: number) => v / 100;
  const mid = (v: number) => (v - 50) / 50; // -1..1
  return {
    scale: 0.06 + n(s.resolution) * 0.94,
    smear: n(s.smear),
    smudge: n(s.smudge),
    block: n(s.compression),
    blur: n(s.blur) * 6,
    sharp: n(s.sharpness) * 3,
    grain: n(s.grain),
    bands: n(s.banding),
    sat: 1 + mid(s.saturation),
    con: 1 + mid(s.contrast) * 0.6,
    bri: mid(s.brightness) * 0.25,
    warm: mid(s.warmth) * 0.12,
    fade: n(s.fade) * 0.35,
    chroma: n(s.chroma),
    vig: n(s.vignette),
    scan: n(s.scanlines),
    wob: n(s.wobble),
    bleed: n(s.bleed),
    stamp: n(s.stamp),
  };
}

export function VideoEditorSection({ active, tabs }: { active: boolean; tabs?: React.ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<{ gl: WebGLRenderingContext; prog: WebGLProgram; tex: WebGLTexture; ovl: WebGLTexture } | null>(null);
  const lowRef = useRef<HTMLCanvasElement | null>(null);
  const stampRef = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);
  const settingsRef = useRef<Settings>(DEFAULTS);
  const audioRef = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null);

  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [playing, setPlaying] = useState(false);
  const [before, setBefore] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(0); // 0 = idle, else progress 0..1
  const beforeRef = useRef(false);
  settingsRef.current = settings;
  beforeRef.current = before;

  // ── View: zoom is in screen pixels per video pixel ──
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const fit = useCallback(() => {
    const el = viewRef.current;
    if (!el || !size.w) return;
    const r = el.getBoundingClientRect();
    const zoom = Math.min(r.width / size.w, r.height / size.h) * 0.95;
    setView({ zoom, x: (r.width - size.w * zoom) / 2, y: (r.height - size.h * zoom) / 2 });
  }, [size]);

  useEffect(() => { fit(); }, [fit]);

  const onWheel = (e: WheelEvent) => {
    const el = viewRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView((v) => {
      const zoom = Math.min(80, Math.max(0.05, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      const k = zoom / v.zoom;
      return { zoom, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });
  };

  const onPointerDown = (e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    panRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = panRef.current;
    if (p) setView((v) => ({ ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y }));
  };
  const onPointerUp = () => { panRef.current = null; };

  // ── WebGL ──
  const setupGl = () => {
    const canvas = canvasRef.current;
    if (!canvas || glRef.current) return;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) { setError('WebGL is not available in this browser.'); return; }
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const ovl = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ovl);
    for (const [p, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(prog, 'tex'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'ovl'), 1);
    glRef.current = { gl, prog, tex, ovl };
  };

  const draw = useCallback(() => {
    const g = glRef.current, video = videoRef.current;
    if (!g || !video || video.readyState < 2) return;
    const { gl, prog, tex, ovl } = g;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (settingsRef.current.stamp > 0) {
      const W = video.videoWidth, H = video.videoHeight;
      // The tape clock starts at 10:42:07 PM and runs with the clip.
      const secs = 22 * 3600 + 42 * 60 + 7 + Math.floor(video.currentTime);
      const hh = Math.floor(secs / 3600) % 12 || 12, mm = Math.floor(secs / 60) % 60, ss = secs % 60;
      const pad = (x: number) => String(x).padStart(2, '0');
      const clockText = `PM ${hh}:${pad(mm)}:${pad(ss)}`;
      const key = `${W}x${H} ${clockText} ${video.paused ? 'P' : 'R'}`;
      if (stampRef.current?.key !== key) {
        const cv = stampRef.current?.canvas ?? document.createElement('canvas');
        cv.width = W; cv.height = H;
        const x = cv.getContext('2d')!;
        x.clearRect(0, 0, W, H);
        const fs = Math.round(H * 0.055);
        x.font = `bold ${fs}px "Courier New", monospace`;
        x.textBaseline = 'top';
        const txt = (t: string, tx: number, ty: number, align: CanvasTextAlign) => {
          x.textAlign = align;
          x.fillStyle = 'rgba(0,0,0,0.85)';
          x.fillText(t, tx + fs * 0.08, ty + fs * 0.08);
          x.fillStyle = '#f2f2e8';
          x.fillText(t, tx, ty);
        };
        const m = Math.round(H * 0.06);
        txt(video.paused ? 'PAUSE ❚❚' : 'PLAY ▶', m, m, 'left');
        txt('SP', W - m, m, 'right');
        txt('SEP 12 1998', W - m, H - m - fs * 2.2, 'right');
        txt(clockText, W - m, H - m - fs, 'right');
        stampRef.current = { canvas: cv, key };
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, ovl);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        gl.activeTexture(gl.TEXTURE0);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const u = beforeRef.current ? uniformsFrom(DEFAULTS) : uniformsFrom(settingsRef.current);
    // Real downscale: the browser's high-quality resize averages every source
    // pixel into the smaller frame, like an encoder exporting at 480p would.
    const lw = Math.max(2, Math.round(video.videoWidth * u.scale)), lh = Math.max(2, Math.round(video.videoHeight * u.scale));
    if (u.scale < 0.999) {
      const lc = lowRef.current ?? (lowRef.current = document.createElement('canvas'));
      if (lc.width !== lw || lc.height !== lh) { lc.width = lw; lc.height = lh; }
      const x = lc.getContext('2d')!;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(video, 0, 0, lw, lh);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, lc);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    }
    const set1 = (name: string, v: number) => gl.uniform1f(gl.getUniformLocation(prog, name), v);
    for (const [k, v] of Object.entries(u)) set1(k, v);
    set1('time', performance.now() / 1000);
    gl.uniform2f(gl.getUniformLocation(prog, 'res'), video.videoWidth, video.videoHeight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, []);

  // Redraw every frame while the section is open, so slider moves show at once
  // even on a paused frame.
  useEffect(() => {
    if (!active || !file) return;
    let id = 0;
    const loop = () => { draw(); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active, file, draw]);

  useEffect(() => { if (!active) { videoRef.current?.pause(); } }, [active]);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  // ── Loading ──
  const load = (f: File) => {
    if (!f.type.startsWith('video/')) { setError(`${f.name} is not a video.`); return; }
    setError('');
    setFile((old) => { if (old) URL.revokeObjectURL(old.url); return { name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }; });
  };

  const onMeta = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    setSize({ w: v.videoWidth, h: v.videoHeight });
    try { setupGl(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    void v.play().then(() => setPlaying(true), () => setPlaying(false));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) load(f);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) load(f);
    e.target.value = '';
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    audioRef.current?.ctx.resume();
    if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  // ── Export: replay the clip from the start and record the canvas plus the audio ──
  const exportVideo = async () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !file) return;
    if (!audioRef.current) {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(v);
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      src.connect(ctx.destination);
      audioRef.current = { ctx, dest };
    }
    await audioRef.current.ctx.resume();
    setBefore(false);
    const stream = new MediaStream([
      ...c.captureStream(30).getVideoTracks(),
      ...audioRef.current.dest.stream.getAudioTracks(),
    ]);
    const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const bps = Math.round((0.15 + (settings.bitrate / 100) ** 2 * 11.85) * 1_000_000); // 0.15 to 12 Mbps
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: bps });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || 'video/webm';
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.name}-lowfi.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setExporting(0);
      v.loop = true;
    };
    v.loop = false;
    v.pause();
    v.currentTime = 0;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    setExporting(0.001);
    rec.start(250);
    await v.play();
    setPlaying(true);
    const tick = () => {
      if (rec.state !== 'recording') return;
      if (v.ended) { rec.stop(); setPlaying(false); return; }
      setExporting(Math.max(0.001, v.currentTime / (v.duration || 1)));
      requestAnimationFrame(tick);
    };
    tick();
  };

  const set = (id: Key, value: number) => setSettings((s) => ({ ...s, [id]: value }));
  const actual = Math.round(view.zoom * 100);

  return (
    <div
      className="flex h-screen flex-col bg-black text-white"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={onPick} />

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Video Editor</h1>
          <p className="text-xs text-zinc-500">Temporary. Drop a video, make it look less AI and more phone. Scroll to zoom, drag to pan, double-click to fit.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {file && (
          <>
            <button type="button" onClick={() => setSettings(DEFAULTS)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Reset</button>
            <button type="button" onClick={() => {
              // Resolution aimed at 480 lines of this clip, not a fixed percentage.
              const p = TARGET_P.reference!;
              const res = size.h ? Math.min(100, Math.max(0, Math.round(((p / size.h - 0.06) / 0.94) * 1000) / 10)) : REFERENCE_MATCH.resolution;
              setSettings({ ...REFERENCE_MATCH, resolution: res });
            }} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Reference match</button>
            <button type="button" onClick={() => setSettings(QUALITY_FILTER)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Quality filter</button>
            <button type="button" onClick={() => setSettings(PHONE_REPOST)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Phone repost</button>
            <button type="button" onClick={() => setSettings(REUPLOAD)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Re-upload</button>
            <button type="button" onClick={() => setSettings(SMUDGED)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Smudged lens</button>
            <button type="button" onClick={() => setSettings(CAMCORDER)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Camcorder</button>
            <button type="button" onClick={() => inputRef.current?.click()} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white">Replace</button>
            <button type="button" onClick={() => void exportVideo()} disabled={exporting > 0} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-40">
              {exporting > 0 ? `Exporting ${Math.round(exporting * 100)}%` : 'Export'}
            </button>
          </>
        )}
        {tabs}
        </div>
      </div>

      {error && <p className="px-6 pt-3 text-xs text-red-400">{error}</p>}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {!file ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={`absolute inset-6 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors ${
                dragging ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <span className="text-sm text-zinc-300">Drop a video here</span>
              <span className="text-xs text-zinc-600">or click to choose one</span>
            </button>
          ) : (
            <>
              <div
                ref={viewRef}
                className={`absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing ${dragging ? 'bg-zinc-900' : 'bg-zinc-950'}`}
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={fit}
              >
                <canvas
                  ref={canvasRef}
                  style={{
                    position: 'absolute', left: 0, top: 0, transformOrigin: '0 0',
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                    imageRendering: view.zoom > 1 ? 'pixelated' : 'auto',
                  }}
                />
              </div>
              <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs tabular-nums text-zinc-300">
                {actual}% · {size.w}×{size.h}
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-lg bg-black/70 px-3 py-2">
                <button type="button" onClick={togglePlay} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black" title={playing ? 'Pause' : 'Play'}>
                  {playing ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
                  )}
                </button>
                <Scrubber video={videoRef} onSeek={(t) => { if (videoRef.current) videoRef.current.currentTime = t; }} />
                <div className="flex shrink-0 rounded-md border border-zinc-800 p-0.5 text-xs">
                  {(['Before', 'After'] as const).map((label) => {
                    const on = (label === 'Before') === before;
                    return (
                      <button key={label} type="button" onClick={() => setBefore(label === 'Before')}
                        className={`rounded px-2.5 py-1 ${on ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button type="button" onClick={fit} className="shrink-0 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:text-white">Fit</button>
                <button type="button" onClick={() => {
                  const r = viewRef.current?.getBoundingClientRect();
                  if (!r) return;
                  setView({ zoom: 1, x: (r.width - size.w) / 2, y: (r.height - size.h) / 2 });
                }} className="shrink-0 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:text-white">1:1</button>
              </div>
            </>
          )}
          <video ref={videoRef} src={file?.url} loop playsInline muted={false} onLoadedMetadata={onMeta} className="hidden" />
        </div>

        <div className="w-80 shrink-0 overflow-y-auto border-l border-zinc-900 p-4">
          <div className="flex flex-col gap-4">
            {CONTROLS.map(({ id, label, hint }) => (
              <div key={id}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-zinc-200">{label}</span>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {id === 'resolution' && size.h ? `${Math.round(size.h * uniformsFrom(settings).scale)}p · ${settings[id]}` : settings[id]}
                  </span>
                </div>
                <input
                  type="range" min={0} max={100} step={id === 'resolution' ? 0.1 : 1} value={settings[id]}
                  onChange={(e) => set(id, Number(e.target.value))}
                  onDoubleClick={() => set(id, DEFAULTS[id])}
                  className="mt-1 w-full accent-white"
                />
                <p className="text-[11px] text-zinc-600">{hint}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Scrubber({ video, onSeek }: { video: React.RefObject<HTMLVideoElement | null>; onSeek: (t: number) => void }) {
  const [t, setT] = useState({ pos: 0, dur: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const v = video.current;
      if (v) setT({ pos: v.currentTime, dur: v.duration || 0 });
    }, 100);
    return () => clearInterval(id);
  }, [video]);
  return (
    <>
      <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{clock(t.pos)}</span>
      <input
        type="range" min={0} max={t.dur || 1} step={0.01} value={Math.min(t.pos, t.dur)}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="min-w-0 flex-1 accent-white"
      />
      <span className="w-10 text-xs tabular-nums text-zinc-500">{clock(t.dur)}</span>
    </>
  );
}
