'use client';

// "Shared Board" — a full main-area section (reached from the left nav) with
// three Excel-like tables (Markets / Athletes / Artists) for compiling lots of
// video links + info, later used to build templates. Persists to Railway
// Postgres via the /api/board routes.
//
// Entry is spreadsheet-style: a permanent blank row pinned at the top — type a
// link (+ optional caption/context/notes), hit Enter or the far-right Post
// button, and it commits to the list below and clears for the next one. Existing
// rows edit inline (autosave on blur); the Posted / Unusable checkboxes save
// immediately.
//
// All the data + table behavior lives in useBoard + BoardGrid (shared with the
// floating media-tab BoardWidget); this is just the page chrome around them.

import React from 'react';
import { useBoard } from '../hooks/useBoard';
import { BoardGrid } from './BoardGrid';

export function BoardSection() {
  const board = useBoard();

  return (
    <div className="flex h-full flex-col text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-lg font-semibold">Shared Board</h1>
        <p className="text-xs text-zinc-500">Compile video links &amp; info — type in the top row and post</p>
      </div>

      <BoardGrid board={board} />
    </div>
  );
}
