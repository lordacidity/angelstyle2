'use client';

// Per-page input card for the Carousel editor — source toggle (Photo / Video /
// Chart), image upload/paste, video URL fetch or upload, headline/subheadline,
// and the main slide's source-article link. Moved out of CanvasGrid when the
// carousel got its own Studio section.

import { useRef, useState, useEffect } from 'react';
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
  const videoFileRef = useRef<HTMLInputElement>(null);
  const hasLocalVideo = !!entry.localVideoSrc;
  const [dragOver, setDragOver] = useState(false);

  // Headline / subheadline auto-grow so the full (often long, AI-written) copy is
  // visible instead of being clipped inside a fixed-height box.
  const headlineRef = useRef<HTMLTextAreaElement>(null);
  const subRef = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => { grow(headlineRef.current); }, [entry.headline]);
  useEffect(() => { grow(subRef.current); }, [entry.subheadline]);

  function handleVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    loadVideoFile(file);
    if (videoFileRef.current) videoFileRef.current.value = '';
  }

  // Load a video file as this slide's background, flipping the source to Video.
  function loadVideoFile(file: File) {
    onSetBgSource('video');
    if (entry.localVideoSrc?.startsWith('blob:')) URL.revokeObjectURL(entry.localVideoSrc);
    onUpdateLocalVideo(URL.createObjectURL(file), file.name);
    onUpdateUrl('');
  }

  // Drag a photo OR video file straight onto the card — auto-switches the source
  // so adding a short clip is a single drop, no need to toggle to Video first.
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith('video/')) loadVideoFile(file);
    else if (file.type.startsWith('image/')) { onSetBgSource('photo'); setImageFromBlob(file); }
  }

  function clearLocalVideo() {
    if (entry.localVideoSrc) URL.revokeObjectURL(entry.localVideoSrc);
    onUpdateLocalVideo('', '');
  }

  // Set the photo from a dropped/blob image, revoking any previous blob URL first.
  function setImageFromBlob(blob: Blob) {
    if (entry.imageSrc?.startsWith('blob:')) URL.revokeObjectURL(entry.imageSrc);
    onUpdateCarousel('imageSrc', URL.createObjectURL(blob));
  }

  return (
    <div
      className={`relative rounded-lg bg-zinc-950 border overflow-hidden transition-colors ${dragOver ? 'border-white ring-2 ring-white/40' : 'border-zinc-800'}`}
      style={{ width: CARD_W }}
      onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-black/70 text-center">
          <VideoIcon className="text-white" size={20} />
          <span className="text-sm font-medium text-white">Drop photo or video</span>
          <span className="text-[11px] text-zinc-400">Video switches this slide to Video automatically</span>
        </div>
      )}

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

      {/* Discoverability hint for the drag-and-drop drop zone above. */}
      {bgSource !== 'chart' && (
        <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 border-b border-zinc-800 text-[11px] text-zinc-600">
          <UploadIcon size={12} />
          Drag &amp; drop a photo or video here
        </div>
      )}

      {/* Video input row — photo mode uses drag-and-drop + the Swap Photo grid
          below instead of a dedicated upload/paste bar. Hidden for Chart. */}
      {bgSource === 'video' && (
      <div className="flex items-center gap-2 px-3 py-3 border-b border-zinc-800">
        {hasLocalVideo ? (
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
        <textarea ref={headlineRef} value={entry.headline ?? ''}
          onChange={e => { onUpdateCarousel('headline', e.target.value); grow(e.currentTarget); }}
          placeholder="Headline…" rows={2}
          className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none overflow-hidden leading-relaxed"
        />
      </div>

      {/* Sub-headline */}
      <div className="px-3 py-2">
        <textarea ref={subRef} value={entry.subheadline ?? ''}
          onChange={e => { onUpdateCarousel('subheadline', e.target.value); grow(e.currentTarget); }}
          placeholder="Sub-headline (optional)…" rows={1}
          className="w-full bg-transparent text-sm text-zinc-400 placeholder-zinc-700 outline-none resize-none overflow-hidden leading-relaxed"
        />
      </div>

    </div>
  );
}
