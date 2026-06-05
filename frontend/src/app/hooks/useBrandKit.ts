'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { BrandProps, BrandLogo, BrandCategory } from '../types';

// The Pauv logo ships as a static asset in frontend/public, so the brand kit
// always has a working logo with zero Supabase/auth dependency. Any logos that
// DO load from the shared account are appended after this one. The `static:`
// id prefix marks it as non-deletable — it isn't a Supabase row.
const STATIC_LOGOS: BrandLogo[] = [
  { id: 'static:pauv', url: '/pauv-favicon.png', label: 'Pauv', position: -1 },
];

const EMPTY_BRAND: BrandProps = {
  logoSrc: STATIC_LOGOS[0].url,
  logos: STATIC_LOGOS,
  displayName: '',
  handle: '',
  category: 'artists',
};

function toDbHandle(h: string) { return h.replace(/^@+/, ''); }
function toDisplayHandle(h: string) { return h.startsWith('@') ? h : `@${h}`; }
function toCategory(v: string | null): BrandCategory { return v === 'athletes' ? 'athletes' : 'artists'; }

// Logos are shared (Supabase, under the one Pauv account) so everyone pulls from
// the same logo library. Display name + handle are PER-PERSON: each machine
// keeps its own in localStorage, so one person can brand as "Pauv Artists" and
// another as "Pauv Athletes" off the same shared account. The Supabase
// brand_kit name/handle columns are only a fallback seed for a machine that has
// never set them locally.
const LS_DISPLAY_NAME = 'brandkit.displayName';
const LS_HANDLE       = 'brandkit.handle';
const LS_CATEGORY     = 'brandkit.category';

function readLocalIdentity(): { displayName: string | null; handle: string | null; category: string | null } {
  if (typeof window === 'undefined') return { displayName: null, handle: null, category: null };
  try {
    return {
      displayName: window.localStorage.getItem(LS_DISPLAY_NAME),
      handle:      window.localStorage.getItem(LS_HANDLE),
      category:    window.localStorage.getItem(LS_CATEGORY),
    };
  } catch { return { displayName: null, handle: null, category: null }; }
}

function writeLocalIdentity(displayName: string, dbHandle: string, category: BrandCategory): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_DISPLAY_NAME, displayName);
    window.localStorage.setItem(LS_HANDLE,       dbHandle);
    window.localStorage.setItem(LS_CATEGORY,     category);
  } catch { /* localStorage disabled — silent no-op, UI state still updates */ }
}

export function useBrandKit(userId: string | null) {
  const [brand, setBrandState] = useState<BrandProps>(EMPTY_BRAND);
  const setBrand = useCallback((updater: BrandProps | ((prev: BrandProps) => BrandProps)) => {
    setBrandState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      brandRef.current = next;
      return next;
    });
  }, []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brandKitIdRef = useRef<string | null>(null);
  const brandRef = useRef<BrandProps>(EMPTY_BRAND);

  useEffect(() => {
    if (!userId) {
      // No shared Supabase session (e.g. creds not configured). Name/@ live in
      // localStorage per-machine, so still surface them — along with the bundled
      // static Pauv logo — so the kit is fully usable with no auth at all.
      const local = readLocalIdentity();
      setBrand({
        displayName: local.displayName ?? '',
        handle: local.handle ? toDisplayHandle(local.handle) : '',
        category: toCategory(local.category),
        logos: STATIC_LOGOS,
        logoSrc: STATIC_LOGOS[0].url,
      });
      brandKitIdRef.current = null;
      return;
    }

    async function load() {
      setLoading(true);
      const local = readLocalIdentity();

      const { data: kit, error: fetchErr } = await supabase
        .from('brand_kit')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchErr) {
        setError(`DB error: ${fetchErr.message}`);
        setLoading(false);
        return;
      }

      if (!kit) {
        // No shared row yet (no logos uploaded). Still surface this machine's
        // local identity plus the static Pauv logo so the kit is usable offline.
        setBrand({
          displayName: local.displayName ?? '',
          handle: local.handle ? toDisplayHandle(local.handle) : '',
          category: toCategory(local.category),
          logos: STATIC_LOGOS,
          logoSrc: STATIC_LOGOS[0].url,
        });
        setLoading(false);
        return;
      }

      brandKitIdRef.current = kit.id;

      const { data: logoRows } = await supabase
        .from('brand_kit_logos')
        .select('*')
        .eq('brand_kit_id', kit.id)
        .order('position');

      // Static Pauv logo first, then any logos uploaded to the shared account.
      const logos: BrandLogo[] = [
        ...STATIC_LOGOS,
        ...(logoRows ?? []).map(l => ({
          id: l.id,
          url: l.url,
          label: l.label ?? undefined,
          position: l.position,
        })),
      ];

      // Identity (display name + handle): localStorage wins so each machine
      // keeps its own brand; the Supabase columns are only a fallback seed.
      const displayName = local.displayName ?? (kit.display_name ?? '');
      const handleRaw   = local.handle      ?? (kit.handle      ?? '');

      setBrand({
        displayName,
        handle: handleRaw ? toDisplayHandle(handleRaw) : '',
        category: toCategory(local.category),
        logos,
        logoSrc: logos[0]?.url ?? '',
      });

      setLoading(false);
    }

    load();
  }, [userId]);

  const save = useCallback(async (displayName: string, handle: string, category: BrandCategory): Promise<boolean> => {
    // Per-machine identity: write localStorage only, with NO auth dependency.
    // Supabase is intentionally NOT updated (each machine keeps its own name/
    // handle/category off the shared account), and we deliberately do NOT require
    // a signed-in userId — these are purely local, so they save even when the
    // shared Supabase account is unavailable (e.g. creds not configured).
    // uploadLogo() still creates the brand_kit row when it's needed for the
    // (shared) logo library.
    setSaving(true);
    const dbHandle = toDbHandle(handle);
    writeLocalIdentity(displayName, dbHandle, category);
    setBrand(prev => ({ ...prev, displayName, handle: toDisplayHandle(dbHandle), category }));
    setSaving(false);
    return true;
  }, [setBrand]);

  const uploadLogo = useCallback(async (file: File) => {
    if (!userId) return;
    setUploading(true);

    // Auto-create record if first action before saving
    if (!brandKitIdRef.current) {
      const { data, error: insertErr } = await supabase
        .from('brand_kit')
        .insert({ display_name: 'My Brand', handle: 'handle', user_id: userId })
        .select()
        .single();

      if (insertErr) {
        setError(`Error: ${insertErr.message}`);
        setUploading(false);
        return;
      }
      brandKitIdRef.current = data.id;
      setBrand(prev => ({
        ...prev,
        displayName: prev.displayName || data.display_name,
        handle: prev.handle || toDisplayHandle(data.handle),
      }));
    }

    const id = brandKitIdRef.current!;
    // Use userId as folder so storage RLS policy matches auth.uid()
    const path = `${userId}/${Date.now()}_${file.name}`;

    const { error: uploadErr } = await supabase.storage
      .from('brand-kit-logos')
      .upload(path, file);

    if (uploadErr) {
      setError(`Upload error: ${uploadErr.message}`);
      setUploading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('brand-kit-logos')
      .getPublicUrl(path);

    const { data: logo, error: logoInsertErr } = await supabase
      .from('brand_kit_logos')
      .insert({ brand_kit_id: id, url: publicUrl, position: 0 })
      .select()
      .single();

    if (logoInsertErr) {
      setError(`Logo save error: ${logoInsertErr.message}`);
    } else if (logo) {
      const newLogo: BrandLogo = { id: logo.id, url: publicUrl, position: logo.position };
      setBrand(prev => ({
        ...prev,
        logos: [...prev.logos, newLogo],
        logoSrc: prev.logoSrc || publicUrl,
      }));
    }

    setUploading(false);
  }, [userId]);

  const deleteLogo = useCallback(async (logoId: string) => {
    // The bundled Pauv logo isn't a Supabase row — never delete it.
    if (logoId.startsWith('static:')) return;
    const logo = brandRef.current.logos.find(l => l.id === logoId);
    if (!logo) return;

    // Optimistic UI update
    setBrand(prev => {
      const logos = prev.logos.filter(l => l.id !== logoId);
      const logoSrc = prev.logoSrc === logo.url ? (logos[0]?.url ?? '') : prev.logoSrc;
      return { ...prev, logos, logoSrc };
    });

    // Delete DB row
    const { error: dbErr } = await supabase
      .from('brand_kit_logos')
      .delete()
      .eq('id', logoId);

    if (dbErr) {
      setError(`Delete error: ${dbErr.message}`);
      // Revert optimistic update
      setBrand(prev => ({
        ...prev,
        logos: [...prev.logos, logo].sort((a, b) => a.position - b.position),
        logoSrc: prev.logoSrc || logo.url,
      }));
      return;
    }

    // Delete from storage — path is everything after /brand-kit-logos/
    const storagePath = logo.url.split('/brand-kit-logos/')[1];
    if (storagePath) {
      const { error: storageErr } = await supabase.storage
        .from('brand-kit-logos')
        .remove([storagePath]);
      if (storageErr) console.error('[BrandKit] storage delete error:', storageErr);
    }
  }, []);

  const selectLogo = useCallback((url: string) => {
    setBrand(prev => ({ ...prev, logoSrc: url }));
  }, []);

  return { brand, setBrand, saving, uploading, loading, error, setError, save, uploadLogo, deleteLogo, selectLogo };
}
