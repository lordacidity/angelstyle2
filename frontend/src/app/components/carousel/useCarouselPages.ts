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

  function addPage(slideType: SlideType) {
    setPages(prev => [...prev, makeEmptyEntry(Date.now().toString(), 'carousel', slideType)]);
  }

  function removePage(id: string) {
    setPages(prev => prev.filter(p => p.id !== id));
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
    pages, lastEditedAt, addPage, removePage, replacePages, clearAll,
    updatePage, updateUrl, setSubMode, updateLocalVideo, fetchVideo, handleVideoError,
  };
}

export type CarouselPagesApi = ReturnType<typeof useCarouselPages>;
