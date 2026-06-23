// Shared client-side video export helpers for the canvas-recording features
// (Charts compare videos + Charts Image animated videos). Both record a canvas
// with MediaRecorder, then mux in a chosen audio track and rewrite a clean MP4
// container ENTIRELY in the browser so the result works the same on localhost
// and on Vercel (no server ffmpeg).

// Phonedeck server runs on the user's OWN machine (default localhost:8080).
// The export upload must go DIRECTLY from the browser — routing it through a
// same-origin Next.js route breaks on Vercel, where "localhost" is Vercel's
// server, not the user's PC. Override with NEXT_PUBLIC_PHONEDECK_URL if Phonedeck
// runs on a peer machine.
export const PHONEDECK_URL = typeof process !== 'undefined'
  ? (process.env.NEXT_PUBLIC_PHONEDECK_URL ?? 'http://localhost:8080')
  : 'http://localhost:8080';

// Strip characters multer/Windows can't put in a filename.
export function safeExportName(raw: string) {
  return raw.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70).replace(/[. ]+$/g, '').trim() || 'charts';
}

// Mux the recorded canvas video together with the chosen audio track ENTIRELY
// in the browser (mediabunny demux/remux + WebCodecs AudioEncoder). The old path
// POSTed the raw recording to a server-side ffmpeg route — which works on
// localhost but SILENTLY FAILS on Vercel: there's no ffmpeg binary in the
// serverless runtime, and the audio file lives on an ephemeral fs. Doing it here
// is host-independent and rewrites a correct moov, fixing both the missing-audio
// and broken-duration bugs at once.
//
// Audio is trimmed to the video's duration (mirrors ffmpeg `-shortest`). Returns
// hasAudio=false when no track was chosen or audio encoding failed, so the caller
// can still ship a (correctly-muxed, silent) clip rather than abort.
export async function muxClientSide(
  videoBlob: Blob,
  audioUrl: string | null,
  onStatus: (status: string) => void,
): Promise<{ blob: Blob; hasAudio: boolean }> {
  const {
    Output, Mp4OutputFormat, BufferTarget,
    EncodedAudioPacketSource, EncodedVideoPacketSource, EncodedPacketSink, EncodedPacket,
    Input, BlobSource, ALL_FORMATS,
  } = await import('mediabunny');

  // ── Demux the recorded video track ────────────────────────────────────────
  const vidBuf = await videoBlob.arrayBuffer();
  const vInput = new Input({ source: new BlobSource(new Blob([vidBuf], { type: 'video/mp4' })), formats: ALL_FORMATS });
  const vTrack = await vInput.getPrimaryVideoTrack();
  if (!vTrack) throw new Error('No video track in recording');
  const vConfig = await vTrack.getDecoderConfig();

  const vPackets: any[] = [];
  let maxEnd = 0;
  for await (const p of new EncodedPacketSink(vTrack).packets()) {
    vPackets.push(p);
    const end = p.timestamp + (p.duration || 0);
    if (end > maxEnd) maxEnd = end;
  }
  if (vPackets.length === 0) throw new Error('No video packets in recording');
  const videoDuration = maxEnd;

  // ── Decode + re-encode the audio to AAC, trimmed to the video length ───────
  let audioPackets: any[] = [];
  let audioConfig: any = null;
  if (audioUrl) {
    onStatus('Encoding audio…');
    try {
      if (typeof AudioEncoder === 'undefined' || typeof AudioContext === 'undefined')
        throw new Error('WebCodecs / Web Audio API unavailable');

      const SR = 44100, AFRAME = 1024;
      const aRes = await fetch(audioUrl);
      if (!aRes.ok) throw new Error(`audio fetch ${aRes.status}`);
      const aBuf = await aRes.arrayBuffer();

      const actx = new AudioContext({ sampleRate: SR });
      let decoded: AudioBuffer;
      try { decoded = await actx.decodeAudioData(aBuf.slice(0)); }
      finally { await actx.close(); }

      const ch = Math.min(2, decoded.numberOfChannels) || 1;
      const endF = Math.min(decoded.length, Math.ceil(videoDuration * SR)); // -shortest

      const chunks: EncodedAudioChunk[] = [];
      let cfg: AudioDecoderConfig | null = null;
      let encErr: Error | null = null;
      const enc = new AudioEncoder({
        output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
          chunks.push(chunk);
          if (meta?.decoderConfig && !cfg) cfg = meta.decoderConfig;
        },
        error: (e: Error) => { encErr = e; },
      });
      enc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: ch, bitrate: 192_000 });

      const chData = Array.from({ length: ch }, (_, c) => decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1)));
      let tMicros = 0;
      for (let off = 0; off < endF; off += AFRAME) {
        const fc = Math.min(AFRAME, endF - off);
        const planar = new Float32Array(fc * ch);
        for (let c = 0; c < ch; c++) { const s = chData[c]; for (let i = 0; i < fc; i++) planar[c * fc + i] = s[off + i] ?? 0; }
        const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: fc, numberOfChannels: ch, timestamp: tMicros, data: planar });
        enc.encode(ad); ad.close();
        tMicros += Math.round((fc / SR) * 1_000_000);
      }
      await enc.flush(); enc.close();
      if (encErr) throw encErr;

      if (chunks.length > 0) {
        if (!cfg) {
          const sfIdx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(SR);
          const si = sfIdx >= 0 ? sfIdx : 4;
          cfg = { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: ch, description: new Uint8Array([(2 << 3) | (si >> 1), ((si & 1) << 7) | (ch << 3)]) };
        }
        audioConfig = cfg;
        audioPackets = chunks.map((c) => EncodedPacket.fromEncodedChunk(c));
      }
    } catch (e) {
      console.error('[charts mux] audio encode failed — muxing silent:', e);
    }
  }

  // ── Remux into a clean MP4 (rewrites the moov → fixes the broken duration) ─
  onStatus('Finalizing…');
  const out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const vSrc = new EncodedVideoPacketSource(vTrack.codec as any);
  out.addVideoTrack(vSrc);
  let aSrc: any = null;
  if (audioPackets.length > 0) {
    aSrc = new EncodedAudioPacketSource('aac');
    out.addAudioTrack(aSrc);
  }
  await out.start();
  for (let i = 0; i < vPackets.length; i++) {
    await vSrc.add(vPackets[i], i === 0 && vConfig ? { decoderConfig: vConfig } : undefined);
  }
  if (aSrc) {
    for (let i = 0; i < audioPackets.length; i++) {
      await aSrc.add(audioPackets[i], i === 0 ? { decoderConfig: audioConfig } : undefined);
    }
  }
  await out.finalize();
  const buf = out.target.buffer;
  if (!buf) throw new Error('No buffer from mux output');
  return { blob: new Blob([buf], { type: 'video/mp4' }), hasAudio: audioPackets.length > 0 };
}
