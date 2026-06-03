'use client';

import { useState, useEffect } from 'react';
import type { VideoEntry } from '../types';
import { makeEmptyEntry } from '@/lib/entry';

function getGoogleTokensFromUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('google_access_token');
  const refreshToken = params.get('google_refresh_token');
  if (accessToken) {
    window.history.replaceState({}, '', window.location.pathname);
    return { accessToken, refreshToken: refreshToken || undefined };
  }
  return null;
}

interface UseGoogleSheetsOptions {
  onImport: (entries: VideoEntry[]) => void;
}

interface SheetRowResponse {
  url?: string;
  caption?: string;
}

export function useGoogleSheets({ onImport }: UseGoogleSheetsOptions) {
  const [googleToken, setGoogleToken] = useState<{ accessToken: string; refreshToken?: string } | null>(null);
  const [showSheetsModal, setShowSheetsModal] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('Sheet1');
  const [startRow, setStartRow] = useState('4');
  const [endRow, setEndRow] = useState('32');
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheetsError, setSheetsError] = useState('');

  useEffect(() => {
    const tokens = getGoogleTokensFromUrl();
    if (tokens) setGoogleToken(tokens);
  }, []);

  async function connectGoogle() {
    const res = await fetch('/api/google/auth');
    const data = await res.json() as { authUrl?: string };
    if (data.authUrl) window.location.href = data.authUrl;
  }

  async function importFromSheets() {
    if (!googleToken || !spreadsheetId.trim()) {
      setSheetsError('Please provide a spreadsheet ID');
      return;
    }
    setLoadingSheets(true);
    setSheetsError('');
    try {
      const params = new URLSearchParams({
        spreadsheet_id: spreadsheetId.trim(),
        start_row: startRow,
        end_row: endRow,
        sheet_name: sheetName.trim(),
      });
      const res = await fetch(`/api/google/sheets?${params}`, {
        headers: { Authorization: `Bearer ${googleToken.accessToken}` },
      });
      const data = await res.json() as { rows?: SheetRowResponse[]; error?: string };
      if (!res.ok) {
        setSheetsError(data.error ?? 'Failed to fetch spreadsheet data');
        return;
      }
      const rows = data.rows ?? [];
      const newEntries: VideoEntry[] = rows.map(row => ({
        ...makeEmptyEntry(crypto.randomUUID()),
        url: row.url ?? '',
        caption: row.caption ?? '',
      }));
      onImport(newEntries.length > 0 ? newEntries : [makeEmptyEntry('1')]);
      setShowSheetsModal(false);
    } catch {
      setSheetsError('Network error — please try again');
    } finally {
      setLoadingSheets(false);
    }
  }

  return {
    googleToken, setGoogleToken,
    showSheetsModal, setShowSheetsModal,
    spreadsheetId, setSpreadsheetId,
    sheetName, setSheetName,
    startRow, setStartRow,
    endRow, setEndRow,
    loadingSheets, sheetsError,
    connectGoogle, importFromSheets,
  };
}
