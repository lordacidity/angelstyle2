'use client';

// Fit a rendered MP4 under what Hyper Attention will actually take.
//
// Their docs say 100 MB per video. But an import by URL lands in a Supabase
// bucket of their own ("video-bank" in the URLs they hand back) that is
// still on Supabase's 50 MB default, and a rejection there comes back as a
// bare 500 "Upload failed. Try again." — not the documented 413
// UPLOAD_REJECTED. Measured 2026-09-25: 49.5 MB imports, 54.9 MB does not
// (their request ids req_muh698jk_6c0eb23521d5, req_muh6alz0_ea394a8b5a72).
// Until they raise it, anything published has to land under 50 MB.
//
// Only the publish path pays for this. Download and Phonedeck keep the
// render as it came out of the compose; a copy is squeezed here, in the
// browser, just before it goes up to the library for Hyper Attention to
// fetch. The video track is re-encoded at the bitrate the budget leaves for
// the clip's length; the audio is copied through untouched.
//
// Quality: a 30-second 1080x1920 clip still gets ~12 Mbps at 45 MB, and
// Instagram re-encodes whatever it is given down to a few Mbps, so the
// squeeze is invisible for anything under a minute or two.

/** Aim here: their ceiling less room for the encoder to overshoot. */
export const PUBLISH_BUDGET_BYTES = 45 * 1024 * 1024;
/** Where Hyper Attention's import actually stops. */
export const PUBLISH_CEILING_BYTES = 50 * 1024 * 1024;
/** A result over this is sent round again at a lower rate. */
const ACCEPT_BYTES = PUBLISH_CEILING_BYTES - 1.5 * 1024 * 1024;

export const fmtMB = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

export interface FitResult {
  blob: Blob;
  /** False when the render already fit and went through untouched. */
  compressed: boolean;
  /** The video bitrate the squeeze was encoded at, bits per second. */
  bitrate: number | null;
}

export interface FitOptions {
  budget?: number;
  /** 0..1 through the re-encode. Not called when nothing needs doing. */
  onProgress?: (frac: number) => void;
}

export async function fitForPublish(blob: Blob, opts: FitOptions = {}): Promise<FitResult> {
  const budget = opts.budget ?? PUBLISH_BUDGET_BYTES;
  if (blob.size <= budget) return { blob, compressed: false, bitrate: null };

  const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, Conversion } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const duration = await input.computeDuration();
    if (!(duration > 0)) throw new Error("Can't read the render's length to fit it under the publish cap.");

    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('The render has no video track.');
    if (!(await video.canDecode())) throw new Error("This browser can't decode the render to compress it.");
    const audio = await input.getPrimaryAudioTrack();
    const audioStats = audio ? await audio.computePacketStats().catch(() => null) : null;
    const videoStats = await video.computePacketStats().catch(() => null);
    const sourceBitrate = videoStats?.averageBitrate ?? (blob.size * 8) / duration;

    // The audio goes through as is, so its bytes come off the top; the
    // container is well under 2% of the budget for a clip this length.
    const audioBits = (audioStats?.averageBitrate ?? 0) * duration;
    const videoBits = budget * 8 * 0.98 - audioBits;
    if (videoBits <= 0) throw new Error(`The audio alone is over the ${fmtMB(budget)} publish budget.`);
    let bitrate = Math.min(sourceBitrate, videoBits / duration);

    // One pass, and a second only when the encoder overshot its target.
    for (let pass = 0; pass < 2; pass++) {
      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new BufferTarget(),
      });
      const conversion = await Conversion.init({
        input,
        output,
        video: { codec: 'avc', bitrate: Math.round(bitrate), forceTranscode: true },
        showWarnings: false,
      });
      if (!conversion.isValid) {
        const why = conversion.discardedTracks.map((d) => d.reason).join(', ');
        throw new Error(`Can't re-encode the render in this browser (${why || 'unknown'}).`);
      }
      conversion.onProgress = (p) => opts.onProgress?.(p);
      await conversion.execute();
      const buf = output.target.buffer;
      if (!buf) throw new Error('The re-encode produced nothing.');
      const out = new Blob([buf], { type: 'video/mp4' });
      if (out.size <= ACCEPT_BYTES) return { blob: out, compressed: true, bitrate: Math.round(bitrate) };
      bitrate *= (budget / out.size) * 0.92;
    }
    throw new Error(`Couldn't get the render under ${fmtMB(PUBLISH_CEILING_BYTES)} for Hyper Attention.`);
  } finally {
    input.dispose();
  }
}
