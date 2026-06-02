'use client';

import { useRef, useState, useCallback } from 'react';
import type { VideoMode } from '../types';
import type { BrandProps, BrandLogo } from '../types';
import { AuthForm } from './AuthForm';
import CarouselCanvas, { CAROUSEL_PREVIEW_W, CAROUSEL_PREVIEW_H } from './CarouselCanvas';
import { useCarouselTemplates } from '../hooks/useCarouselTemplates';
import { defaultCarouselSettings } from './carouselTypes';

const POPUP_SCALE = 0.48;
const POPUP_CANVAS_W = Math.round(CAROUSEL_PREVIEW_W * POPUP_SCALE); // ~197
const POPUP_CANVAS_H = Math.round(CAROUSEL_PREVIEW_H * POPUP_SCALE); // ~246

function TwitterPreview() {
  return (
    <div className="w-full h-full bg-zinc-950 flex flex-col p-3 gap-2.5 overflow-hidden">
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-[5px] bg-zinc-600 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1">
            <div className="h-[5px] bg-zinc-200 rounded-full w-14" />
            <div className="w-[9px] h-[9px] rounded-full bg-yellow-400 shrink-0" />
          </div>
          <div className="h-[4px] bg-zinc-600 rounded-full w-10" />
        </div>
      </div>
      <div className="flex flex-col gap-[5px]">
        <div className="h-[4px] bg-zinc-600 rounded-full w-full" />
        <div className="h-[4px] bg-zinc-600 rounded-full w-5/6" />
        <div className="h-[4px] bg-zinc-600 rounded-full w-4/5" />
      </div>
      <div className="flex-1 bg-zinc-800 rounded-md" />
    </div>
  );
}

function CaptionPreview() {
  return (
    <div className="w-full h-full bg-white flex flex-col p-3 gap-2.5 overflow-hidden">
      <div className="flex flex-col gap-[6px] pt-1">
        <div className="h-[5px] bg-zinc-300 rounded-full w-full" />
        <div className="h-[5px] bg-zinc-300 rounded-full w-4/5" />
        <div className="h-[5px] bg-zinc-300 rounded-full w-3/4" />
      </div>
      <div className="flex-1 bg-zinc-200 rounded-md mt-1" />
    </div>
  );
}

function CarouselPreview() {
  return (
    <div className="w-full h-full bg-zinc-800 flex flex-col overflow-hidden relative" style={{ aspectRatio: '1/1' }}>
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-600 to-zinc-900" />
      <div className="absolute bottom-0 left-0 right-0 h-2/3 bg-gradient-to-t from-black/80 to-transparent" />
      <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-1.5">
        <div className="h-[7px] bg-white rounded-full w-full" />
        <div className="h-[7px] bg-white rounded-full w-4/5" />
        <div className="h-[7px] bg-white/70 rounded-full w-3/5" />
      </div>
    </div>
  );
}

const TEMPLATES: { mode: VideoMode; label: string; description: string; preview: React.ReactNode; aspect?: string }[] = [
  {
    mode: 'twitter',
    label: 'Twitter / X',
    description: 'Header with avatar, name & caption',
    preview: <TwitterPreview />,
  },
  {
    mode: 'caption',
    label: 'Caption',
    description: 'Clean white background with text',
    preview: <CaptionPreview />,
  },
  {
    mode: 'carousel',
    label: 'Carousel',
    description: 'Image with bold headline · 1:1',
    preview: <CarouselPreview />,
    aspect: 'square',
  },
];

interface TemplateSelectorProps {
  selected: VideoMode | null;
  onSelect: (mode: VideoMode) => void;
  onSelectWithAi: () => void;
  onGoToBuilder: () => void;
  brand: BrandProps;
  loading?: boolean;
  saving?: boolean;
  uploading?: boolean;
  error?: string | null;
  user: { id: string; email?: string } | null;
  authLoading?: boolean;
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignUp: (email: string, password: string) => Promise<string | null>;
  onResetPassword: (email: string) => Promise<string | null>;
  onChangePassword: (current: string, next: string) => Promise<string | null>;
  onSignOut: () => void;
  onSave: (displayName: string, handle: string) => Promise<boolean>;
  onUploadLogo: (file: File) => void;
  onDeleteLogo: (id: string) => void;
  onSelectLogo: (url: string) => void;
  onClearError?: () => void;
}

export function TemplateSelector({
  selected, onSelect, onSelectWithAi, onGoToBuilder,
  brand, loading, saving, uploading, error,
  user, authLoading, onSignIn, onSignUp, onResetPassword, onChangePassword, onSignOut,
  onSave, onUploadLogo, onDeleteLogo, onSelectLogo, onClearError,
}: TemplateSelectorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [carouselStep, setCarouselStep] = useState<null | 'template' | 'content'>(null);
  const [displayName, setDisplayName] = useState(brand.displayName);
  const [handle, setHandle] = useState(brand.handle);
  const [hoveredLogo, setHoveredLogo] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    if (pwNew !== pwConfirm) { setPwError('New passwords do not match'); return; }
    setPwError(null);
    setPwLoading(true);
    const err = await onChangePassword(pwCurrent, pwNew);
    if (err) { setPwError(err); } else { setPwDone(true); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
    setPwLoading(false);
  }

  function closePwForm() {
    setShowChangePw(false);
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwError(null); setPwDone(false);
  }
  const { savedSlides, loading: slidesLoading } = useCarouselTemplates(user?.id ?? null);

  // Sync local fields when brand loads from Supabase
  const prevDisplayName = useRef(brand.displayName);
  if (brand.displayName !== prevDisplayName.current) {
    prevDisplayName.current = brand.displayName;
    setDisplayName(brand.displayName);
  }
  const prevHandle = useRef(brand.handle);
  if (brand.handle !== prevHandle.current) {
    prevHandle.current = brand.handle;
    setHandle(brand.handle);
  }

  const isDirty = displayName !== brand.displayName || handle !== brand.handle;
  const canSave = isDirty && displayName.trim().length > 0 && handle.trim().length > 0;

  const handleSave = useCallback(async () => {
    const ok = await onSave(displayName, handle);
    if (ok) {
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
    }
  }, [onSave, displayName, handle]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadLogo(file);
    e.target.value = '';
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center pt-16 gap-10">
        <AuthForm onSignIn={onSignIn} onSignUp={onSignUp} onResetPassword={onResetPassword} />
      </div>
    );
  }

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
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white mb-1 tracking-tight">Brand Kit</h2>
            <p className="text-sm text-zinc-500">Set your identity once, used on every post</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => { setShowChangePw(v => !v); setPwError(null); setPwDone(false); }}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Change password
            </button>
            <button
              onClick={onSignOut}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {showChangePw && (
          <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-4">
            {pwDone ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-300">Password updated successfully.</p>
                <button onClick={closePwForm} className="text-xs text-zinc-500 hover:text-white transition-colors">Close</button>
              </div>
            ) : (
              <form onSubmit={handleChangePw} className="flex flex-col gap-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Change password</span>
                  <button type="button" onClick={closePwForm} className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">✕</button>
                </div>
                <input
                  type="password"
                  value={pwCurrent}
                  onChange={e => setPwCurrent(e.target.value)}
                  placeholder="Current password"
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
                />
                <input
                  type="password"
                  value={pwNew}
                  onChange={e => setPwNew(e.target.value)}
                  placeholder="New password"
                  required
                  minLength={6}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
                />
                <input
                  type="password"
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  minLength={6}
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
                />
                {pwError && (
                  <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">{pwError}</p>
                )}
                <button
                  type="submit"
                  disabled={pwLoading}
                  className="w-full py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {pwLoading ? 'Updating…' : 'Update password'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Logos grid */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Logos</label>
          <div className="flex flex-wrap gap-3">
            {brand.logos.map((logo: BrandLogo) => {
              const isActive = brand.logoSrc === logo.url;
              return (
                <div
                  key={logo.id}
                  className="relative"
                  onMouseEnter={() => setHoveredLogo(logo.id)}
                  onMouseLeave={() => setHoveredLogo(null)}
                >
                  <button
                    onClick={() => onSelectLogo(logo.url)}
                    className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${
                      isActive ? 'border-white' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo.url} alt="" className="w-full h-full object-cover" />
                  </button>

                  {isActive && (
                    <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white flex items-center justify-center shadow">
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}

                  {hoveredLogo === logo.id && (
                    <button
                      onClick={() => onDeleteLogo(logo.id)}
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

            {/* Upload button */}
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
          </div>
          {brand.logos.length > 0 && (
            <p className="text-[11px] text-zinc-600">Click a logo to use it on posts</p>
          )}
        </div>

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
              onChange={e => setHandle(e.target.value)}
              placeholder="e.g. @Pauv"
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
            />
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

      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">Template builder</h2>
        <p className="text-sm text-zinc-500">Select a style — you can change it later</p>
      </div>

      <div className="flex gap-6 flex-wrap justify-center">
        {TEMPLATES.map(({ mode, label, description, preview, aspect }) => {
          const isSelected = selected === mode;
          const isSquare = aspect === 'square';
          return (
            <button
              key={mode}
              onClick={() => mode === 'carousel' ? setCarouselStep('template') : onSelect(mode)}
              className="group relative flex flex-col items-center gap-4 focus:outline-none transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
            >
              <div
                className={`relative rounded-2xl overflow-hidden transition-all duration-150 ${
                  isSelected
                    ? 'ring-2 ring-white shadow-[0_0_32px_rgba(255,255,255,0.12)]'
                    : 'ring-1 ring-zinc-700 group-hover:ring-zinc-500'
                }`}
                style={isSquare ? { width: 148, height: 148 } : { width: 148, height: 263 }}
              >
                {preview}
                {isSelected && (
                  <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </div>
              <div className="text-center">
                <p className={`text-sm font-semibold transition-colors ${isSelected ? 'text-white' : 'text-zinc-300 group-hover:text-white'}`}>
                  {label}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {selected && !carouselStep && (
        <p className="text-xs text-zinc-500 animate-pulse">Continuing to Media…</p>
      )}

      {/* Carousel setup popup */}
      {carouselStep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setCarouselStep(null)}
        >
          <div
            className="relative bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-2xl mx-4 p-6 flex flex-col gap-6"
            onClick={e => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setCarouselStep(null)}
              className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 1l12 12M13 1L1 13"/>
              </svg>
            </button>

            {/* Slide previews */}
            <div>
              <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider font-medium">Carousel slides</p>
              {slidesLoading ? (
                <div className="flex items-center justify-center h-[246px]">
                  <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
                </div>
              ) : (
                <div className="flex gap-3 justify-center">
                  {(['main', 'supporting_1', 'supporting_2'] as const).map((type, index) => {
                    const slide = savedSlides?.[type];
                    const label = ['Main', 'Supporting 1', 'Supporting 2'][index];
                    return (
                      <div key={type} className="flex flex-col gap-2 items-center">
                        <div
                          className="rounded-md overflow-hidden ring-1 ring-zinc-800 pointer-events-none"
                          style={{ width: POPUP_CANVAS_W, height: POPUP_CANVAS_H, flexShrink: 0 }}
                        >
                          <div style={{ width: CAROUSEL_PREVIEW_W, height: CAROUSEL_PREVIEW_H, transform: `scale(${POPUP_SCALE})`, transformOrigin: 'top left' }}>
                            <CarouselCanvas
                              imageSrc=""
                              headline={slide?.headline ?? 'Headline text'}
                              subheadline={slide?.subheadline ?? 'Subheadline'}
                              settings={slide?.settings ?? defaultCarouselSettings()}
                              rectMode={true}
                              invertedSlots={index === 2}
                              staticMode={true}
                            />
                          </div>
                        </div>
                        <p className="text-[11px] text-zinc-500">{label}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="w-full h-px bg-zinc-800" />

            {/* Step 1: edit or continue */}
            {carouselStep === 'template' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100 mb-0.5">Edit the template?</p>
                  <p className="text-xs text-zinc-500">Customise fonts, colours and layout before filling in content.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setCarouselStep(null); onGoToBuilder(); }}
                    className="flex-1 px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700 hover:text-white text-sm font-medium transition-colors"
                  >
                    Edit template
                  </button>
                  <button
                    onClick={() => setCarouselStep('content')}
                    className="flex-1 px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 text-sm font-semibold transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: standard or with AI */}
            {carouselStep === 'content' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100 mb-0.5">How do you want to fill the slides?</p>
                  <p className="text-xs text-zinc-500">Standard lets you upload your own content. With AI fetches news and generates headlines for you.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setCarouselStep(null); onSelect('carousel'); }}
                    className="flex-1 px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700 hover:text-white text-sm font-medium transition-colors"
                  >
                    Standard
                  </button>
                  <button
                    onClick={() => { setCarouselStep(null); onSelectWithAi(); }}
                    className="flex-1 px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 text-sm font-semibold transition-colors"
                  >
                    With AI ✦
                  </button>
                </div>
                <button
                  onClick={() => setCarouselStep('template')}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors text-left"
                >
                  Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
