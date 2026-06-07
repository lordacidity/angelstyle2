// Shared video normalization. The real and AI segments must encode with
// IDENTICAL params so concatenated parts share codec/fps/dims and join seamlessly.

export const FPS = 30;

// Output resolution policy: deliver as much as the source actually has, up to 4K,
// and never below 1080p. We anchor the SHORT side (so a 16:9 4K source → 3840×2160,
// a 1080p source stays 1080p, a low-res source is upscaled to a 1080p floor). The
// AI/Kling clip is normalized to these same dims so the two halves match exactly —
// note Kling's native output is ~1080p, so in a 4K project it's upscaled to fit.
const MIN_SHORT = 1080;  // never deliver below 1080p
const MAX_SHORT = 2160;  // 4K ceiling (avoid pulling 8K-sized renders)

// Target dimensions that preserve the (optionally cropped) source orientation.
// `crop` is fractions trimmed off each edge: { top, right, bottom, left }.
export function targetDims(project, crop = {}) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = crop || {};
  const w = (project.width || 1920) * Math.max(0.05, 1 - left - right);
  const h = (project.height || 1080) * Math.max(0.05, 1 - top - bottom);
  // Anchor the short side to the source's own short side, clamped into [1080, 2160].
  const short = Math.min(MAX_SHORT, Math.max(MIN_SHORT, Math.round(Math.min(w, h))));
  let W, H;
  if (w >= h) { H = short; W = Math.round((short * w) / h); }
  else { W = short; H = Math.round((short * h) / w); }
  W -= W % 2; H -= H % 2;
  return { W, H };
}

// ffmpeg crop filter trimming the given fractions off each edge; null if no crop.
export function cropFilter(crop = {}) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = crop || {};
  if (!(top || right || bottom || left)) return null;
  const cw = Math.max(0.05, 1 - left - right);
  const ch = Math.max(0.05, 1 - top - bottom);
  return `crop=in_w*${cw.toFixed(4)}:in_h*${ch.toFixed(4)}:in_w*${left.toFixed(4)}:in_h*${top.toFixed(4)}`;
}

export const vfFor = (W, H) =>
  `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
  `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},format=yuv420p`;

// Full encode (video + audio) — used for parts that carry an audio track.
// High-quality H.264: crf 16 is visually transparent (near-lossless); `preset slow`
// gives better detail retention / compression than veryfast. `-pix_fmt yuv420p` +
// high profile keep it universally playable. Audio at 320k AAC. Slower to render,
// but this is a one-off local render and quality is the priority.
export const ENC = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
  '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart'];
