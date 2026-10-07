// Whether an export can write its sound track (AAC, in the MP4) on this
// browser. Most can with their own encoder. Some can't: an iPhone before iOS
// 26 has none, and Chromium on Android and Linux often has none for AAC. Those
// used to get a silent file with no warning, so no keyboard, room tone or
// music, whatever the phone's volume. They now get Mediabunny's own AAC
// encoder (FFmpeg's, built to WASM, about 1MB), loaded only on a browser that
// needs it and only the first time an export asks.
//
// Browser-only. Takes the caller's canEncodeAudio so it is asked of the same
// copy of mediabunny the export writes with.

let ready: Promise<boolean> | null = null;

export function canWriteAac(canEncodeAudio: (codec: 'aac') => Promise<boolean>): Promise<boolean> {
  ready ??= (async () => {
    if (await canEncodeAudio('aac')) return true;
    try {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      return await canEncodeAudio('aac');
    } catch (err) {
      console.error('[export] no AAC encoder could be loaded; the file will be silent:', err);
      return false;
    }
  })();
  return ready;
}
