'use client';

// Per-page input card for the Carousel editor — source toggle (Photo / Video /
// Chart), image upload/paste, video URL fetch or upload, headline/subheadline,
// and the main slide's source-article link. Moved out of CanvasGrid when the
// carousel got its own Studio section.

import { useRef } from 'react';
import { CAROUSEL_PREVIEW_W } from '../CarouselCanvas';
import type { VideoEntry } from '../../types';
import {
  UploadIcon, ArrowRightIcon, SpinnerIcon,
  TrashIcon, CloseIcon, VideoIcon, LinkIcon,
} from '@/lib/icons';

const CARD_W = CAROUSEL_PREVIEW_W;

export function CarouselInputCard({
  entry,
  onUpdateCarousel,
  onUpdateUrl,
  onUpdateLocalVideo,
  onFetch,
  bgSource,
  onSetBgSource,
  onRemove,
}: {
  entry: VideoEntry;
  onUpdateCarousel: (field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) => void;
  onUpdateUrl: (url: string) => void;
  onUpdateLocalVideo: (src: string, name: string) => void;
  onFetch: () => void;
  bgSource: 'photo' | 'video' | 'chart';
  onSetBgSource: (source: 'photo' | 'video' | 'chart') => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const hasLocalVideo = !!entry.localVideoSrc;

  function handleVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onUpdateLocalVideo(URL.createObjectURL(file), file.name);
    onUpdateUrl('');
    if (videoFileRef.current) videoFileRef.current.value = '';
  }

  function clearLocalVideo() {
    if (entry.localVideoSrc) URL.revokeObjectURL(entry.localVideoSrc);
    onUpdateLocalVideo('', '');
  }

  // Set the photo from a pasted/blob image, revoking any previous blob URL first.
  function setImageFromBlob(blob: Blob) {
    if (entry.imageSrc?.startsWith('blob:')) URL.revokeObjectURL(entry.imageSrc);
    onUpdateCarousel('imageSrc', URL.createObjectURL(blob));
  }

  // Ctrl/⌘+V inside the image input.
  function handleImagePaste(e: React.ClipboardEvent) {
    for (const it of Array.from(e.clipboardData?.items ?? [])) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); setImageFromBlob(f); return; }
      }
    }
  }

  // Explicit "Paste" button — reads the clipboard directly (needs the click gesture).
  async function pasteImageFromClipboard() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) return;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) { setImageFromBlob(await item.getType(type)); return; }
      }
    } catch { /* clipboard blocked / no image — ignore */ }
  }

  return (
    <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden" style={{ width: CARD_W }}>

      {/* Source toggle row — Photo / Video / Chart background */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
        {([['photo', 'Photo'], ['video', 'Video'], ['chart', 'Chart']] as const).map(([m, label]) => (
          <button key={m} onClick={() => onSetBgSource(m)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              bgSource === m ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >{label}</button>
        ))}
        <button onClick={onRemove} className="ml-auto flex items-center justify-center w-7 h-7 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors" title="Delete row">
          <TrashIcon size={13} />
        </button>
      </div>

      {/* Image / Video input row — hidden for Chart (the chart card below picks the market) */}
      {bgSource !== 'chart' && (
      <div className="flex items-center gap-2 px-3 py-3 border-b border-zinc-800">
        {bgSource === 'photo' ? (
          <>
            {entry.imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.imageSrc} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
            ) : (
              // Focusable so the user can click it and paste (Ctrl/⌘+V) an image straight in.
              <div
                tabIndex={0}
                onPaste={handleImagePaste}
                title="Click then paste (⌘/Ctrl+V), or use the Paste button"
                className="flex items-center gap-2 flex-1 min-w-0 border border-zinc-700 rounded-md px-2.5 h-9 text-zinc-500 outline-none focus:border-zinc-500 cursor-text"
              >
                <ImagePlaceholderIcon />
                <span className="text-sm text-zinc-600">Upload or paste image…</span>
              </div>
            )}
            <button onClick={pasteImageFromClipboard} title="Paste image from clipboard"
              className="flex items-center justify-center h-9 px-2.5 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0 text-[11px] font-medium text-black">
              Paste
            </button>
            <button onClick={() => fileRef.current?.click()} title="Upload image"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <UploadIcon stroke="black" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (entry.imageSrc?.startsWith('blob:')) URL.revokeObjectURL(entry.imageSrc);
                onUpdateCarousel('imageSrc', URL.createObjectURL(f));
              }}
            />
          </>
        ) : hasLocalVideo ? (
          <>
            <VideoIcon className="text-zinc-400 shrink-0" size={13} />
            <span className="text-sm text-zinc-300 truncate flex-1 min-w-0">{entry.localVideoName || 'Uploaded video'}</span>
            <button onClick={() => videoFileRef.current?.click()} title="Change video"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <UploadIcon stroke="black" />
            </button>
            <button onClick={clearLocalVideo} title="Remove video"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <CloseIcon size={13} stroke="black" />
            </button>
            <input ref={videoFileRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0 border border-zinc-700 rounded-md px-2.5 h-9">
              <LinkIcon size={13} className="text-zinc-500 shrink-0" />
              <input
                value={entry.url}
                onChange={e => onUpdateUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onFetch(); }}
                placeholder="Paste TikTok, Instagram or X URL…"
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0"
              />
            </div>
            <button onClick={() => videoFileRef.current?.click()} title="Upload video file"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0">
              <UploadIcon stroke="black" />
            </button>
            <button
              onClick={onFetch}
              disabled={entry.loading || !entry.url.trim()}
              title="Fetch video"
              className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {entry.loading
                ? <SpinnerIcon stroke="black" style={{ animation: 'spin 1s linear infinite' }} />
                : <ArrowRightIcon stroke="black" />}
            </button>
            <input ref={videoFileRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />
            {entry.error && <span className="text-[11px] text-red-400 ml-1">{entry.error}</span>}
          </>
        )}
      </div>
      )}

      {/* Source article — small + muted, sits above the headline so the user
          keeps track of the story this card was built from. Main slide only —
          supporting slides inherit the same article and don't need the field
          repeated. Always editable; clickable ↗ icon appears once a URL is in. */}
      {(entry.carouselSlideType ?? 'main') === 'main' && (
        <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center gap-2">
          <LinkIcon size={11} className="text-zinc-600 shrink-0" />
          <input
            type="text"
            value={entry.articleUrl ?? ''}
            onChange={e => onUpdateCarousel('articleUrl', e.target.value)}
            placeholder="Source article link (optional)…"
            className="flex-1 bg-transparent text-[11px] text-zinc-500 placeholder-zinc-700 outline-none min-w-0"
          />
          {entry.articleUrl && (
            <a
              href={entry.articleUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
              title="Open article in new tab"
              onClick={e => e.stopPropagation()}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          )}
        </div>
      )}

      {/* Headline */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <textarea value={entry.headline ?? ''} onChange={e => onUpdateCarousel('headline', e.target.value)}
          placeholder="Headline…" rows={2}
          className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none leading-relaxed"
        />
      </div>

      {/* Sub-headline */}
      <div className="px-3 py-2">
        <textarea value={entry.subheadline ?? ''} onChange={e => onUpdateCarousel('subheadline', e.target.value)}
          placeholder="Sub-headline (optional)…" rows={1}
          className="w-full bg-transparent text-sm text-zinc-400 placeholder-zinc-700 outline-none resize-none leading-relaxed"
        />
      </div>

    </div>
  );
}

// Small inline SVG used only inside this file — not exported
function ImagePlaceholderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  );
}
