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

// There's a single shared "Pauv" identity (no login), so the display name +
// handle live in Supabase on the brand_kit row alongside the logos — set once,
// shared across every machine. (Previously these were per-computer localStorage
// so multiple logins could brand differently; that's no longer needed.)
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

      // Identity (display name + handle) comes straight from the shared row.
      const displayName = kit.display_name ?? '';
      const handleRaw   = kit.handle ?? '';

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
    if (!userId) return false;
    setSaving(true);
    const dbHandle = toDbHandle(handle);
    try {
      let id = brandKitIdRef.current;
      if (!id) {
        // First save with no logos uploaded yet — create the shared row.
        const { data, error: insertErr } = await supabase
          .from('brand_kit')
          .insert({ display_name: displayName, handle: dbHandle, user_id: userId })
          .select('id')
          .single();
        if (insertErr || !data) throw new Error(insertErr?.message ?? 'Failed to create brand');
        id = data.id;
        brandKitIdRef.current = id;
      } else {
        const { error: updateErr } = await supabase
          .from('brand_kit')
          .update({ display_name: displayName, handle: dbHandle })
          .eq('id', id);
        if (updateErr) throw new Error(updateErr.message);
      }
      setBrand(prev => ({ ...prev, displayName, handle: toDisplayHandle(dbHandle) }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save brand');
      return false;
    } finally {
      setSaving(false);
    }
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
