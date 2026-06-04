'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { BrandProps, BrandLogo } from '../types';

const EMPTY_BRAND: BrandProps = {
  logoSrc: '',
  logos: [],
  displayName: '',
  handle: '',
};

function toDbHandle(h: string) { return h.replace(/^@+/, ''); }
function toDisplayHandle(h: string) { return h.startsWith('@') ? h : `@${h}`; }

// Display name + handle are stored PER-COMPUTER in localStorage, not in
// Supabase. Multiple machines logged in as the same user need different
// branding (e.g. "Pauv Artists" on Levin vs "Pauv Athletes" on Holden).
// Logos still come from Supabase so the logo library stays shared.
const LS_DISPLAY_NAME = 'brandkit.displayName';
const LS_HANDLE       = 'brandkit.handle';

function readLocalIdentity(): { displayName: string | null; handle: string | null } {
  if (typeof window === 'undefined') return { displayName: null, handle: null };
  try {
    return {
      displayName: window.localStorage.getItem(LS_DISPLAY_NAME),
      handle:      window.localStorage.getItem(LS_HANDLE),
    };
  } catch { return { displayName: null, handle: null }; }
}

function writeLocalIdentity(displayName: string, dbHandle: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_DISPLAY_NAME, displayName);
    window.localStorage.setItem(LS_HANDLE,       dbHandle);
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
      setBrand(EMPTY_BRAND);
      brandKitIdRef.current = null;
      return;
    }

    async function load() {
      setLoading(true);

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
        setLoading(false);
        return;
      }

      brandKitIdRef.current = kit.id;

      const { data: logoRows } = await supabase
        .from('brand_kit_logos')
        .select('*')
        .eq('brand_kit_id', kit.id)
        .order('position');

      const logos: BrandLogo[] = (logoRows ?? []).map(l => ({
        id: l.id,
        url: l.url,
        label: l.label ?? undefined,
        position: l.position,
      }));

      // Identity (display name + handle): localStorage wins so each computer
      // keeps its own brand. Supabase row's columns are only used as a fallback
      // seed for first-time setups on a new machine.
      const local = readLocalIdentity();
      const displayName = local.displayName ?? (kit.display_name ?? '');
      const handleRaw   = local.handle      ?? (kit.handle      ?? '');

      setBrand({
        displayName,
        handle: handleRaw ? toDisplayHandle(handleRaw) : '',
        logos,
        logoSrc: logos[0]?.url ?? '',
      });

      setLoading(false);
    }

    load();
  }, [userId]);

  const save = useCallback(async (displayName: string, handle: string): Promise<boolean> => {
    // Per-computer save: localStorage only. Supabase is intentionally NOT
    // updated so other machines logged in as the same user keep their own
    // brand. uploadLogo() handles creating the brand_kit row when needed for
    // the logo library.
    if (!userId) return false;
    setSaving(true);
    const dbHandle = toDbHandle(handle);
    writeLocalIdentity(displayName, dbHandle);
    setBrand(prev => ({ ...prev, displayName, handle: toDisplayHandle(dbHandle) }));
    setSaving(false);
    return true;
  }, [userId]);

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
