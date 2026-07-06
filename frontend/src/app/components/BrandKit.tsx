'use client';

// BrandKit — the app's landing section. There's no login (the app is a single
// shared "Pauv" identity, auto-signed-in via usePauvSession), so this is just
// the brand setup: a logo library plus display name + handle. Whatever's chosen
// here feeds straight into the Media generator (passed down as `brand`). Logos
// are shared via Supabase; the display name + handle are saved locally per
// machine (localStorage), so each person keeps their own and no login is needed.

import { useRef, useState, useCallback } from 'react';
import type { BrandProps, BrandLogo, BrandLogoKind, BrandCategory } from '../types';

interface BrandKitProps {
  brand: BrandProps;
  loading?: boolean;
  saving?: boolean;
  uploading?: boolean;
  error?: string | null;
  onSave: (displayName: string, handle: string, category: BrandCategory) => Promise<boolean>;
  onUploadLogo: (file: File) => void;
  onDeleteLogo: (id: string) => void;
  onSelectLogo: (url: string) => void;
  onSelectFullLogo: (url: string) => void;
  onClearError?: () => void;
}

function logoKind(logo: BrandLogo): BrandLogoKind { return logo.kind ?? 'favicon'; }

// One labelled logo slot: a grid of its logos (click to select, hover to delete
// non-static ones), plus an upload button when the slot accepts uploads. Reused
// for the Favicon-logo slot (uploadable) and the Logo slot (a bundled static
// asset, no upload) so both stay pixel-identical.
function LogoSection({
  label, hint, logos, activeUrl, uploading, fit = 'cover', onSelect, onUpload, onDelete,
}: {
  label: string;
  hint?: string;
  logos: BrandLogo[];
  activeUrl: string;
  uploading?: boolean;
  // 'cover' fills the square (good for icons); 'contain' shows a wide logo whole.
  fit?: 'cover' | 'contain';
  onSelect: (url: string) => void;
  onUpload?: (file: File) => void;
  onDelete: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [hoveredLogo, setHoveredLogo] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    onUpload(file);
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</label>
      <div className="flex flex-wrap gap-3">
        {logos.map(logo => {
          const isActive = activeUrl === logo.url;
          return (
            <div
              key={logo.id}
              className="relative"
              onMouseEnter={() => setHoveredLogo(logo.id)}
              onMouseLeave={() => setHoveredLogo(null)}
            >
              <button
                onClick={() => onSelect(logo.url)}
                className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${
                  isActive ? 'border-white' : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo.url} alt="" className={`w-full h-full ${fit === 'contain' ? 'object-contain bg-zinc-900 p-1' : 'object-cover'}`} />
              </button>

              {isActive && (
                <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white flex items-center justify-center shadow">
                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}

              {hoveredLogo === logo.id && !logo.id.startsWith('static:') && (
                <button
                  onClick={() => onDelete(logo.id)}
                  className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center shadow hover:bg-red-400 transition-colors"
                >
                  <svg width="7" height="7" viewBox="0 0 12 12" fill="none">
                    <path d="M2 2l8 8M10 2l-8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {/* Upload button — only for slots that accept uploads (the favicon slot) */}
        {onUpload && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-16 h-16 rounded-xl border-2 border-dashed border-zinc-700 hover:border-zinc-500 flex items-center justify-center transition-colors disabled:opacity-40"
            >
              {uploading ? (
                <div className="w-4 h-4 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              )}
            </button>

            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </>
        )}
      </div>
      {hint && logos.length > 0 && <p className="text-[11px] text-zinc-600">{hint}</p>}
    </div>
  );
}

export function BrandKit({
  brand, loading, saving, uploading, error,
  onSave, onUploadLogo, onDeleteLogo, onSelectLogo, onSelectFullLogo, onClearError,
}: BrandKitProps) {
  const [displayName, setDisplayName] = useState(brand.displayName);
  const [handle, setHandle] = useState(brand.handle);
  const [category, setCategory] = useState<BrandCategory>(brand.category);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed the editable fields whenever the saved brand changes (e.g. after it
  // loads from Supabase) — React's "adjust state during render" pattern, keyed
  // off the last brand we synced from.
  const [syncedFrom, setSyncedFrom] = useState({ displayName: brand.displayName, handle: brand.handle, category: brand.category });
  if (syncedFrom.displayName !== brand.displayName || syncedFrom.handle !== brand.handle || syncedFrom.category !== brand.category) {
    setSyncedFrom({ displayName: brand.displayName, handle: brand.handle, category: brand.category });
    setDisplayName(brand.displayName);
    setHandle(brand.handle);
    setCategory(brand.category);
  }

  const isDirty = displayName !== brand.displayName || handle !== brand.handle || category !== brand.category;
  const canSave = isDirty && displayName.trim().length > 0 && handle.trim().length > 0;

  const handleSave = useCallback(async () => {
    const ok = await onSave(displayName, handle, category);
    if (ok) {
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
    }
  }, [onSave, displayName, handle, category]);

  const faviconLogos = brand.logos.filter(l => logoKind(l) === 'favicon');
  const fullLogos = brand.logos.filter(l => logoKind(l) === 'logo');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-10 gap-10">
      {error && (
        <div className="w-full max-w-sm flex items-start gap-3 bg-red-950/60 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          <span className="flex-1">{error}</span>
          <button onClick={onClearError} className="text-red-500 hover:text-red-300 shrink-0">✕</button>
        </div>
      )}

      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold text-white mb-1 tracking-tight">Brand Kit</h2>
          <p className="text-sm text-zinc-500">Set your identity once — used on every post</p>
        </div>

        {/* Favicon logo — the small square avatar/icon used on posts today.
            Uploadable (Supabase-backed) plus the bundled static Pauv "p". */}
        <LogoSection
          label="Favicon logo"
          hint="Click a logo to use it on posts"
          logos={faviconLogos}
          activeUrl={brand.logoSrc}
          uploading={uploading}
          onSelect={onSelectLogo}
          onUpload={onUploadLogo}
          onDelete={onDeleteLogo}
        />

        {/* Logo — the full logo, a bundled static asset (public/pauvlogo.png).
            No upload/backend; it just displays as the brand's full logo. */}
        <LogoSection
          label="Logo"
          logos={fullLogos}
          activeUrl={brand.logoFullSrc}
          fit="contain"
          onSelect={onSelectFullLogo}
          onDelete={onDeleteLogo}
        />

        {/* Fields */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. Pauv"
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Handle</label>
            <input
              type="text"
              value={handle}
              readOnly
              title="The handle is fixed to @pauv_inc"
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-400 outline-none cursor-not-allowed"
            />
            <span className="text-[11px] text-zinc-600">Always @pauv_inc</span>
          </div>

          {/* Category — drives the bio CTA wording ("pauv.com to trade Artists"
              vs "…Athletes") in the Media generator. */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {(['artists', 'athletes', 'gamers'] as const).map(cat => {
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`py-2.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                      active
                        ? 'bg-white text-black'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            saved
              ? 'bg-zinc-800 text-zinc-300 disabled:opacity-100'
              : 'bg-white text-black hover:bg-zinc-100 disabled:opacity-30'
          }`}
        >
          {saved ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              Saved
            </>
          ) : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
