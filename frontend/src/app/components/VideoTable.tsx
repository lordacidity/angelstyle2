'use client';

import { useRef } from 'react';
import type { VideoEntry } from '../types';

interface VideoTableProps {
  entries: VideoEntry[];
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onFetchAllVideos: () => void;
  onFetchVideo: (id: string) => void;
  onUpdateEntry: (id: string, field: 'url' | 'caption' | 'context', value: string) => void;
  onUpdateCarouselEntry: (id: string, field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) => void;
  onUpdateLocalVideo: (id: string, src: string, name: string) => void;
}

function VideoRow({
  entry, index, showRemove,
  onRemove, onUpdateField, onFetch, onUpdateLocalVideo,
}: {
  entry: VideoEntry;
  index: number;
  showRemove: boolean;
  onRemove: () => void;
  onUpdateField: (field: 'url' | 'caption', value: string) => void;
  onFetch: () => void;
  onUpdateLocalVideo: (src: string, name: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasLocal = !!entry.localVideoSrc;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onUpdateLocalVideo(url, file.name);
    onUpdateField('url', '');
    if (fileRef.current) fileRef.current.value = '';
  }

  function clearLocalVideo() {
    if (entry.localVideoSrc) URL.revokeObjectURL(entry.localVideoSrc);
    onUpdateLocalVideo('', '');
  }

  const isReady = hasLocal
    ? !!entry.caption.trim()
    : !!entry.data && !entry.videoFailed;

  return (
    <div className="group relative rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors px-4 pt-3 pb-4">
      <span className="absolute top-3 left-4 text-[11px] font-medium text-zinc-600 select-none">
        {index + 1}
      </span>

      {showRemove && (
        <button
          onClick={onRemove}
          className="absolute top-3 right-3 text-zinc-700 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13"/>
          </svg>
        </button>
      )}

      <div className="flex flex-col gap-0 pl-6">
        {/* Source row: URL input OR local file chip */}
        {hasLocal ? (
          <div className="flex items-center gap-2 py-1 border-b border-zinc-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
            <span className="text-sm text-zinc-300 truncate flex-1">{entry.localVideoName || 'Uploaded video'}</span>
            <button
              onClick={clearLocalVideo}
              className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M1 1l12 12M13 1L1 13"/>
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-zinc-800 focus-within:border-zinc-600 transition-colors">
            <input
              type="url"
              value={entry.url}
              onChange={e => onUpdateField('url', e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault(); }}
              placeholder="Paste TikTok, Instagram or X URL…"
              className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none py-1"
            />
            <button
              onClick={() => fileRef.current?.click()}
              title="Upload video file"
              className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors py-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFile}
        />

        {/* Caption */}
        <textarea
          value={entry.caption}
          onChange={e => onUpdateField('caption', e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault(); }}
          placeholder="Caption…"
          rows={2}
          className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none pt-2 leading-relaxed"
        />
      </div>

      {/* Bottom: status + action */}
      <div className="flex items-center justify-between mt-2 pl-6">
        <div className="text-xs">
          {entry.error && !hasLocal && <span className="text-red-400">{entry.error}</span>}
          {isReady && <span className="text-zinc-600">✓ Ready</span>}
        </div>

        {hasLocal ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="text-xs font-medium px-3 py-1 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Change
          </button>
        ) : (
          <button
            onClick={onFetch}
            disabled={entry.loading || !entry.url.trim() || (!!entry.data && !entry.videoFailed)}
            className={`text-xs font-medium px-3 py-1 rounded-lg transition-colors disabled:cursor-not-allowed ${
              entry.data && !entry.videoFailed
                ? 'text-zinc-600 disabled:opacity-100'
                : 'text-white bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40'
            }`}
          >
            {entry.loading ? 'Fetching…' : entry.videoFailed ? 'Retry' : entry.data ? 'Fetched' : 'Fetch'}
          </button>
        )}
      </div>
    </div>
  );
}

function CarouselRow({
  entry, index, showRemove,
  onRemove, onUpdateCarousel,
}: {
  entry: VideoEntry;
  index: number;
  showRemove: boolean;
  onRemove: () => void;
  onUpdateCarousel: (field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onUpdateCarousel('imageSrc', url);
  }

  return (
    <div className="group relative rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors px-4 pt-3 pb-4">
      <span className="absolute top-3 left-4 text-[11px] font-medium text-zinc-600 select-none">{index + 1}</span>

      {showRemove && (
        <button
          onClick={onRemove}
          className="absolute top-3 right-3 text-zinc-700 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13"/>
          </svg>
        </button>
      )}

      <div className="flex flex-col gap-2 pl-6">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors py-1 border-b border-zinc-800"
        >
          {entry.imageSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={entry.imageSrc} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          )}
          <span className={entry.imageSrc ? 'text-zinc-300' : ''}>
            {entry.imageSrc ? 'Image selected — click to change' : 'Upload image…'}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

        <textarea
          value={entry.headline ?? ''}
          onChange={e => onUpdateCarousel('headline', e.target.value)}
          placeholder="Headline…"
          rows={2}
          className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none pt-1 leading-relaxed border-b border-zinc-800"
        />
        <textarea
          value={entry.subheadline ?? ''}
          onChange={e => onUpdateCarousel('subheadline', e.target.value)}
          placeholder="Sub-headline (optional)…"
          rows={1}
          className="w-full bg-transparent text-sm text-zinc-400 placeholder-zinc-700 outline-none resize-none pt-2 leading-relaxed"
        />
      </div>

      <div className="pl-6 mt-1">
        {entry.imageSrc && entry.headline?.trim() && (
          <span className="text-xs text-zinc-600">✓ Ready</span>
        )}
      </div>
    </div>
  );
}

export function VideoTable({
  entries,
  onAddRow, onRemoveRow, onFetchAllVideos,
  onFetchVideo, onUpdateEntry, onUpdateCarouselEntry, onUpdateLocalVideo,
}: VideoTableProps) {
  const isCarousel = entries.length > 0 && entries[0].mode === 'carousel';
  const allFetched = entries.every(e =>
    e.localVideoSrc || !e.url.trim() || !e.caption.trim() || e.data || e.loading
  );

  return (
    <div className="w-full max-w-2xl flex flex-col gap-3">

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onAddRow}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-full border border-zinc-700 text-xs leading-none hover:border-zinc-500 transition-colors">+</span>
          Add row
        </button>
        {!isCarousel && (
          <button
            onClick={onFetchAllVideos}
            disabled={allFetched}
            className="text-xs font-medium text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Fetch all
          </button>
        )}
      </div>

      {/* Entry cards */}
      <div className="flex flex-col gap-2">
        {entries.map((entry, index) => {
          if (isCarousel) {
            return (
              <CarouselRow
                key={entry.id}
                entry={entry}
                index={index}
                showRemove={entries.length > 1}
                onRemove={() => onRemoveRow(entry.id)}
                onUpdateCarousel={(field, value) => onUpdateCarouselEntry(entry.id, field, value)}
              />
            );
          }

          return (
            <VideoRow
              key={entry.id}
              entry={entry}
              index={index}
              showRemove={entries.length > 1}
              onRemove={() => onRemoveRow(entry.id)}
              onUpdateField={(field, value) => onUpdateEntry(entry.id, field, value)}
              onFetch={() => onFetchVideo(entry.id)}
              onUpdateLocalVideo={(src, name) => onUpdateLocalVideo(entry.id, src, name)}
            />
          );
        })}
      </div>
    </div>
  );
}
