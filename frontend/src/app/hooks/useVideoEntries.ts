'use client';

import { useState, useRef } from 'react';
import type { TikTokCanvasRef } from '../components/TikTokCanvas';
import type { CarouselCanvasRef } from '../components/carouselTypes';
import type { VideoEntry, VideoMode, SlideType, VideoData } from '../types';
import { makeEmptyEntry } from '@/lib/entry';

export function useVideoEntries() {
  const [entries, setEntries] = useState<VideoEntry[]>([makeEmptyEntry('1')]);
  const canvasRefsMap = useRef<Map<string, TikTokCanvasRef>>(new Map());
  const carouselRefsMap = useRef<Map<string, CarouselCanvasRef>>(new Map());

  // Always-current snapshot used inside async callbacks to avoid stale closures
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  function addRow(carouselSlideType?: SlideType) {
    setEntries(prev => [...prev, makeEmptyEntry(Date.now().toString(), prev[0]?.mode ?? 'twitter', carouselSlideType)]);
  }

  function removeRow(id: string) {
    setEntries(prev => {
      // If the user clicks delete on the only remaining row, reset it to a
      // fresh empty entry instead of silently doing nothing. Keeps the UI
      // contract (always >=1 row) while making the click feel responsive.
      if (prev.length === 1 && prev[0].id === id) {
        return [makeEmptyEntry(Date.now().toString(), prev[0].mode)];
      }
      return prev.filter(e => e.id !== id);
    });
  }

  function resetEverything() {
    setEntries([makeEmptyEntry('1')]);
  }

  function handleVideoError(id: string) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, videoFailed: true } : e));
  }

  function setMode(id: string, mode: VideoMode) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, mode } : e));
  }

  function updateEntry(id: string, field: 'url' | 'caption' | 'context', value: string) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  function updateCarouselEntry(id: string, field: 'imageSrc' | 'headline' | 'subheadline' | 'articleUrl', value: string) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  function setCarouselSubMode(id: string, subMode: 'image' | 'video') {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, carouselSubMode: subMode } : e));
  }

  function updateLocalVideo(id: string, src: string, name: string) {
    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, localVideoSrc: src || undefined, localVideoName: name || undefined, data: null, error: '', videoFailed: false } : e
    ));
  }

  // Returns the fetched VideoData on success (or null on any failure) so callers
  // can chain follow-up work off a successful fetch — e.g. the media tab's
  // "Next" arrow auto-generating the caption + CTA once the video is in.
  async function fetchVideo(id: string): Promise<VideoData | null> {
    const currentEntry = entriesRef.current.find(e => e.id === id);
    if (!currentEntry || !currentEntry.url.trim()) {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, error: 'URL is required' } : e));
      return null;
    }
    if (currentEntry.mode !== 'carousel' && !currentEntry.caption.trim()) {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, error: 'Caption is required' } : e));
      return null;
    }

    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, loading: true, error: '', data: null, videoFailed: false } : e
    ));

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentEntry.url.trim() }),
      });
      const json = await res.json() as { error?: string };
      const errorMsg = typeof json.error === 'string' ? json.error : 'Something went wrong';
      const data = res.ok ? (json as VideoData) : null;
      setEntries(prev => prev.map(e =>
        e.id === id ? {
          ...e, loading: false,
          error: res.ok ? '' : errorMsg,
          data, videoFailed: false,
        } : e
      ));
      return data;
    } catch {
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, loading: false, error: 'Network error — please try again' } : e
      ));
      return null;
    }
  }

  async function fetchAllVideos() {
    const toFetch = entriesRef.current.filter(e => e.url.trim() && e.caption.trim() && !e.data && !e.loading);
    if (toFetch.length === 0) {
      const missing = entriesRef.current.filter(e => e.url.trim() && !e.caption.trim());
      if (missing.length > 0) {
        setEntries(prev => prev.map(e =>
          missing.some(m => m.id === e.id) ? { ...e, error: 'Caption is required' } : e
        ));
      }
      return;
    }
    for (const entry of toFetch) {
      await fetchVideo(entry.id);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  async function downloadAll() {
    const toDownload = entriesRef.current.filter(e => e.data && !e.loading && !(e.data.images && e.data.images.length > 0));
    for (const entry of toDownload) {
      const canvasRef = canvasRefsMap.current.get(entry.id);
      if (canvasRef) {
        try {
          await canvasRef.startDownload();
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          console.error(`Failed to download video ${entry.id}:`, err);
        }
      }
    }
  }

  return {
    entries, setEntries, canvasRefsMap, carouselRefsMap,
    addRow, removeRow, resetEverything, updateEntry, updateCarouselEntry, updateLocalVideo, setMode, handleVideoError,
    fetchVideo, fetchAllVideos, downloadAll, setCarouselSubMode,
  };
}
