'use client';

// Page state for the Carousel section. Pages are VideoEntry-shaped (mode
// 'carousel') so CarouselCanvas and the input card work unchanged, but the
// hook is carousel-only: no caption requirement, no twitter/charts helpers.
// Unlike the media grid there is no forced "always one row" — an empty section
// just shows the add-page picker.

import { useState, useRef, useEffect } from 'react';
import type { VideoEntry, SlideType, VideoData } from '../../types';
import { makeEmptyEntry } from '@/lib/entry';

export function useCarouselPages() {
  const [pages, setPages] = useState<VideoEntry[]>([]);

  // When the current draft was last touched — shown on the "Continue editing"
  // prompt so a draft is identified by its time, not a page count. Stamped on any
  // change to the pages; cleared when the draft is emptied.
  const [lastEditedAt, setLastEditedAt] = useState<number | null>(null);
  useEffect(() => {
    setLastEditedAt(pages.length > 0 ? Date.now() : null);
  }, [pages]);

  // Always-current snapshot used inside async callbacks to avoid stale closures
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  function addPage(slideType: SlideType): string {
    const id = Date.now().toString();
    setPages(prev => [...prev, makeEmptyEntry(id, 'carousel', slideType)]);
    return id; // caller can seed the new page's settings (styling) off this id
  }

  function removePage(id: string) {
    setPages(prev => prev.filter(p => p.id !== id));
  }

  // Duplicate a page: clone its entry (text, url, image/video, mode, slide type)
  // under a new id and drop it right AFTER the source. Returns the new id so the
  // caller can also clone the page's settings / per-slide state. Content-identical
  // by design — a literal copy the user then tweaks.
  function duplicatePage(srcId: string): string | null {
    const src = pagesRef.current.find(p => p.id === srcId);
    if (!src) return null;
    const id = Date.now().toString();
    const clone: VideoEntry = { ...src, id };
    setPages(prev => {
      const i = prev.findIndex(p => p.id === srcId);
      const next = [...prev];
      next.splice(i === -1 ? prev.length : i + 1, 0, clone);
      return next;
    });
    return id;
  }

  // Reorder: swap a page with its neighbour (dir -1 = up/earlier, +1 = down/later).
  // No-op at the ends. Lets a slide added at the end be moved in between others.
  function movePage(id: string, dir: -1 | 1) {
    setPages(prev => {
      const i = prev.findIndex(p => p.id === id);
      if (i === -1) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function replacePages(next: VideoEntry[]) {
    setPages(next);
  }

  function clearAll() {
    setPages([]);
  }

  function updatePage(id: string, field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) {
    setPages(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  function updateUrl(id: string, url: string) {
    setPages(prev => prev.map(p => p.id === id ? { ...p, url } : p));
  }

  function setSubMode(id: string, subMode: 'image' | 'video') {
    setPages(prev => prev.map(p => p.id === id ? { ...p, carouselSubMode: subMode } : p));
  }

  function updateLocalVideo(id: string, src: string, name: string) {
    setPages(prev => prev.map(p =>
      p.id === id ? { ...p, localVideoSrc: src || undefined, localVideoName: name || undefined, data: null, error: '', videoFailed: false } : p
    ));
  }

  // Fetch a page's video-background source from a TikTok/IG/X URL.
  async function fetchVideo(id: string): Promise<VideoData | null> {
    const current = pagesRef.current.find(p => p.id === id);
    if (!current || !current.url.trim()) {
      setPages(prev => prev.map(p => p.id === id ? { ...p, error: 'URL is required' } : p));
      return null;
    }

    setPages(prev => prev.map(p =>
      p.id === id ? { ...p, loading: true, error: '', data: null, videoFailed: false } : p
    ));

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: current.url.trim() }),
      });
      const json = await res.json() as { error?: string };
      const errorMsg = typeof json.error === 'string' ? json.error : 'Something went wrong';
      const data = res.ok ? (json as VideoData) : null;
      setPages(prev => prev.map(p =>
        p.id === id ? { ...p, loading: false, error: res.ok ? '' : errorMsg, data, videoFailed: false } : p
      ));
      return data;
    } catch {
      setPages(prev => prev.map(p =>
        p.id === id ? { ...p, loading: false, error: 'Network error — please try again' } : p
      ));
      return null;
    }
  }

  function handleVideoError(id: string) {
    setPages(prev => prev.map(p => p.id === id ? { ...p, videoFailed: true } : p));
  }

  return {
    pages, lastEditedAt, addPage, duplicatePage, removePage, movePage, replacePages, clearAll,
    updatePage, updateUrl, setSubMode, updateLocalVideo, fetchVideo, handleVideoError,
  };
}

export type CarouselPagesApi = ReturnType<typeof useCarouselPages>;
