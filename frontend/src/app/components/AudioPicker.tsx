'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

// ── Audio tracks ──────────────────────────────────────────────────────────────

export type PreloadedAudio =
  | { status: 'ready'; label: string; url: string; durationMs: number }
  | { status: 'loading'; label: string }
  | { status: 'error' };

export interface AudioPickerProps {
  preloadedAudios: PreloadedAudio[];
  audioTrack: { label: string; url: string; durationMs: number } | null;
  onSelectAudioTrack: (track: { label: string; url: string; durationMs: number }) => void;
  onDeleteAudio: (idx: number) => void;
  onAddAudio: (track: { label: string; url: string; durationMs: number }) => void;
  onRenameAudio: (idx: number, label: string) => void;
}

// Reusable "Audio" collapsible track picker. Shared by the Charts and Charts
// Image input cards so both pick narration the same way.
export function AudioPicker({
  preloadedAudios,
  audioTrack,
  onSelectAudioTrack,
  onDeleteAudio,
  onAddAudio,
  onRenameAudio,
}: AudioPickerProps) {
  const [audioOpen, setAudioOpen] = useState(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  useEffect(() => () => { previewRef.current?.pause(); }, []);

  const togglePreview = useCallback((url: string) => {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current.onended = null;
      previewRef.current = null;
    }
    if (previewUrl === url && isPreviewPlaying) {
      setPreviewUrl(null);
      setIsPreviewPlaying(false);
      return;
    }
    const audio = new Audio(url);
    audio.onended = () => setIsPreviewPlaying(false);
    previewRef.current = audio;
    setPreviewUrl(url);
    setIsPreviewPlaying(true);
    audio.play().catch(() => setIsPreviewPlaying(false));
  }, [previewUrl, isPreviewPlaying]);

  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback((idx: number, currentLabel: string) => {
    setRenamingIdx(idx);
    setRenameValue(currentLabel);
    setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 0);
  }, []);

  const commitRename = useCallback((idx: number) => {
    const trimmed = renameValue.trim();
    if (trimmed) onRenameAudio(idx, trimmed);
    setRenamingIdx(null);
  }, [renameValue, onRenameAudio]);

  const [addUrl, setAddUrl] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  const handleAddUrl = useCallback(async () => {
    const trimmed = addUrl.trim();
    if (!trimmed) return;
    setAddLoading(true);
    setAddError('');
    try {
      const res = await fetch('/api/charts/save-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json() as { url?: string; durationMs?: number; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || 'Failed');
      const label = `Track ${preloadedAudios.length + 1}`;
      onAddAudio({ label, url: data.url!, durationMs: data.durationMs! });
      setAddUrl('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to download');
    } finally {
      setAddLoading(false);
    }
  }, [addUrl, preloadedAudios.length, onAddAudio]);

  return (
    <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
      <button
        type="button"
        onClick={() => setAudioOpen(o => !o)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-zinc-900/60 transition-colors"
      >
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Audio</span>
        <div className="flex items-center gap-2">
          {audioTrack && <span className="text-[10px] text-emerald-400 truncate max-w-[120px]">{audioTrack.label}</span>}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-500 transition-transform ${audioOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </button>
      {audioOpen && <div className="border-t border-zinc-800 divide-y divide-zinc-800/50">
        {preloadedAudios.map((audio, i) => {
          const isSelected = audio.status === 'ready' && audioTrack?.url === audio.url;
          const isThisPlaying = audio.status === 'ready' && previewUrl === audio.url && isPreviewPlaying;
          return (
            <div key={i} className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${isSelected ? 'bg-zinc-800/80' : 'hover:bg-zinc-900/60'}`}>
              <button
                type="button"
                disabled={audio.status !== 'ready'}
                onClick={() => audio.status === 'ready' && togglePreview(audio.url)}
                className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 disabled:opacity-30 shrink-0 transition-colors"
                title={isThisPlaying ? 'Pause' : 'Preview'}
              >
                {audio.status === 'loading' ? (
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : audio.status === 'error' ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                ) : isThisPlaying ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                )}
              </button>

              {renamingIdx === i ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(i)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(i);
                    if (e.key === 'Escape') setRenamingIdx(null);
                  }}
                  className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-white outline-none"
                />
              ) : (
                <button
                  type="button"
                  disabled={audio.status !== 'ready'}
                  onClick={() => audio.status === 'ready' && onSelectAudioTrack({ label: audio.label, url: audio.url, durationMs: audio.durationMs })}
                  className="flex-1 flex items-center gap-2 text-left min-w-0 disabled:cursor-default"
                >
                  <span className={`text-xs truncate ${isSelected ? 'text-emerald-400 font-medium' : 'text-zinc-300'}`}>
                    {audio.status === 'ready' ? audio.label : `Track ${i + 1}`}
                  </span>
                  <span className="text-[10px] text-zinc-600 shrink-0">
                    {audio.status === 'ready' ? `${(audio.durationMs / 1000).toFixed(1)}s` : audio.status === 'error' ? 'error' : '…'}
                  </span>
                </button>
              )}

              {isSelected && renamingIdx !== i && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}

              {audio.status === 'ready' && renamingIdx !== i && (
                <button
                  type="button"
                  onClick={() => startRename(i, audio.label)}
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-700 hover:text-zinc-300 shrink-0 transition-colors"
                  title="Rename"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              )}

              {/* Only allow deleting custom tracks */}
              {audio.status === 'ready' && audio.url.includes('track-custom-') && (
                <button
                  type="button"
                  onClick={() => onDeleteAudio(i)}
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-700 hover:text-red-400 shrink-0 transition-colors"
                  title="Remove"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {/* Add track row */}
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              value={addUrl}
              onChange={e => { setAddUrl(e.target.value); setAddError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
              placeholder="Paste TikTok / Reel / X link…"
              disabled={addLoading}
              className="flex-1 min-w-0 bg-transparent text-[11px] text-zinc-400 placeholder-zinc-700 outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onClick={handleAddUrl}
              disabled={addLoading || !addUrl.trim()}
              className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 transition-colors"
              title="Download & add"
            >
              {addLoading ? (
                <svg className="animate-spin w-3 h-3 text-zinc-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-zinc-400">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )}
            </button>
          </div>
          {addError && <p className="text-[10px] text-red-400">{addError}</p>}
        </div>
      </div>}
    </div>
  );
}
