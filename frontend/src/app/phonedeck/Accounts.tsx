'use client';

import { useEffect, useMemo, useState } from "react";

const PHONEDECK_URL = process.env.NEXT_PUBLIC_PHONEDECK_URL ?? "http://localhost:8080";

export const PLATFORMS = ["ig", "x", "youtube", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

const PLATFORM_LABEL: Record<Platform, string> = {
  ig: "Instagram",
  x: "X / Twitter",
  youtube: "YouTube",
  tiktok: "TikTok",
};

export interface Phone {
  serial: string;
  name: string;
}

export interface Theme {
  id: string;
  name: string;
}

export interface Account {
  id: string;
  phoneSerial: string;
  platform: Platform;
  username: string;
  themeIds: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

interface NewAccountDraft {
  platform: Platform;
  username: string;
  themeIds: string[];
}

export function AccountsModal({ open, onClose }: Props) {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [drafts, setDrafts] = useState<Record<string, NewAccountDraft | undefined>>({});
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [phoneNameDraft, setPhoneNameDraft] = useState("");
  const [newThemeName, setNewThemeName] = useState("");
  const [editingTheme, setEditingTheme] = useState<string | null>(null);
  const [themeNameDraft, setThemeNameDraft] = useState("");

  const reload = async () => {
    const [p, a, t] = await Promise.all([
      fetch(`${PHONEDECK_URL}/api/phones`).then((r) => r.json()),
      fetch(`${PHONEDECK_URL}/api/accounts`).then((r) => r.json()),
      fetch(`${PHONEDECK_URL}/api/themes`).then((r) => r.json()),
    ]);
    setPhones(p);
    setAccounts(a);
    setThemes(t);
  };

  useEffect(() => {
    if (open) reload();
  }, [open]);

  const accountsByPhone = useMemo(() => {
    const m: Record<string, Account[]> = {};
    for (const p of phones) m[p.serial] = [];
    for (const a of accounts) {
      (m[a.phoneSerial] ??= []).push(a);
    }
    return m;
  }, [phones, accounts]);

  const themeAccountCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of accounts) {
      for (const tid of a.themeIds) c[tid] = (c[tid] ?? 0) + 1;
    }
    return c;
  }, [accounts]);

  if (!open) return null;

  const startDraft = (serial: string) => {
    setDrafts((d) => ({
      ...d,
      [serial]: { platform: "ig", username: "", themeIds: [] },
    }));
  };
  const cancelDraft = (serial: string) => {
    setDrafts((d) => ({ ...d, [serial]: undefined }));
  };
  const saveDraft = async (serial: string) => {
    const draft = drafts[serial];
    if (!draft || !draft.username.trim()) return;
    await fetch(`${PHONEDECK_URL}/api/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneSerial: serial,
        platform: draft.platform,
        username: draft.username.trim(),
        themeIds: draft.themeIds,
      }),
    });
    cancelDraft(serial);
    reload();
  };

  const updateAccount = async (id: string, patch: Partial<Account>) => {
    await fetch(`${PHONEDECK_URL}/api/accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    reload();
  };

  const deleteAccount = async (id: string) => {
    if (!confirm("Delete this account?")) return;
    await fetch(`${PHONEDECK_URL}/api/accounts/${id}`, { method: "DELETE" });
    reload();
  };

  const savePhoneName = async (serial: string) => {
    if (!phoneNameDraft.trim()) return;
    await fetch(`${PHONEDECK_URL}/api/phones/${serial}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: phoneNameDraft.trim() }),
    });
    setEditingPhone(null);
    reload();
  };

  const createTheme = async () => {
    if (!newThemeName.trim()) return;
    await fetch(`${PHONEDECK_URL}/api/themes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newThemeName.trim() }),
    });
    setNewThemeName("");
    reload();
  };

  const saveTheme = async (id: string) => {
    if (!themeNameDraft.trim()) return;
    await fetch(`${PHONEDECK_URL}/api/themes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: themeNameDraft.trim() }),
    });
    setEditingTheme(null);
    reload();
  };

  const deleteTheme = async (id: string) => {
    if (!confirm("Delete this theme? Accounts in it will be un-themed.")) return;
    await fetch(`${PHONEDECK_URL}/api/themes/${id}`, { method: "DELETE" });
    reload();
  };

  const themeName = (id: string | null) => (id ? themes.find((t) => t.id === id)?.name ?? "(deleted)" : "—");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Accounts</h2>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>

        <div className="accounts-section">
          {phones.map((p) => {
            const list = accountsByPhone[p.serial] ?? [];
            const draft = drafts[p.serial];
            return (
              <div className="phone-card" key={p.serial}>
                <div className="phone-card-header">
                  {editingPhone === p.serial ? (
                    <div className="row">
                      <input
                        autoFocus
                        value={phoneNameDraft}
                        onChange={(e) => setPhoneNameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") savePhoneName(p.serial); }}
                      />
                      <button onClick={() => savePhoneName(p.serial)}>Save</button>
                      <button className="secondary" onClick={() => setEditingPhone(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="phone-name">{p.name}</span>
                        <span className="device-serial">  {p.serial}</span>
                      </div>
                      <button className="secondary small" onClick={() => { setEditingPhone(p.serial); setPhoneNameDraft(p.name); }}>
                        Rename
                      </button>
                    </>
                  )}
                </div>

                {list.length === 0 && <div className="empty-inline">No accounts yet.</div>}

                {list.map((a) => {
                  const available = themes.filter((t) => !a.themeIds.includes(t.id));
                  return (
                    <div className="account-row" key={a.id}>
                      <select
                        value={a.platform}
                        onChange={(e) => updateAccount(a.id, { platform: e.target.value as Platform })}
                      >
                        {PLATFORMS.map((pl) => (
                          <option key={pl} value={pl}>{PLATFORM_LABEL[pl]}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={a.username}
                        onChange={(e) => setAccounts((s) => s.map((x) => x.id === a.id ? { ...x, username: e.target.value } : x))}
                        onBlur={(e) => updateAccount(a.id, { username: e.target.value })}
                        placeholder="@username"
                      />
                      <div className="theme-chips">
                        {a.themeIds.map((tid) => (
                          <span className="theme-chip" key={tid}>
                            {themeName(tid)}
                            <button
                              type="button"
                              onClick={() => updateAccount(a.id, { themeIds: a.themeIds.filter((x) => x !== tid) })}
                            >×</button>
                          </span>
                        ))}
                        {available.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              updateAccount(a.id, { themeIds: [...a.themeIds, e.target.value] });
                            }}
                          >
                            <option value="">+ theme</option>
                            {available.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <button className="danger small" onClick={() => deleteAccount(a.id)}>×</button>
                    </div>
                  );
                })}

                {draft ? (
                  (() => {
                    const available = themes.filter((t) => !draft.themeIds.includes(t.id));
                    return (
                      <div className="account-row draft">
                        <select
                          value={draft.platform}
                          onChange={(e) => setDrafts((d) => ({ ...d, [p.serial]: { ...draft, platform: e.target.value as Platform } }))}
                        >
                          {PLATFORMS.map((pl) => (
                            <option key={pl} value={pl}>{PLATFORM_LABEL[pl]}</option>
                          ))}
                        </select>
                        <input
                          autoFocus
                          type="text"
                          placeholder="username"
                          value={draft.username}
                          onChange={(e) => setDrafts((d) => ({ ...d, [p.serial]: { ...draft, username: e.target.value } }))}
                          onKeyDown={(e) => { if (e.key === "Enter") saveDraft(p.serial); }}
                        />
                        <div className="theme-chips">
                          {draft.themeIds.map((tid) => (
                            <span className="theme-chip" key={tid}>
                              {themeName(tid)}
                              <button
                                type="button"
                                onClick={() => setDrafts((d) => ({ ...d, [p.serial]: { ...draft, themeIds: draft.themeIds.filter((x) => x !== tid) } }))}
                              >×</button>
                            </span>
                          ))}
                          {available.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                setDrafts((d) => ({ ...d, [p.serial]: { ...draft, themeIds: [...draft.themeIds, e.target.value] } }));
                              }}
                            >
                              <option value="">+ theme</option>
                              {available.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        <button onClick={() => saveDraft(p.serial)}>Save</button>
                        <button className="secondary small" onClick={() => cancelDraft(p.serial)}>×</button>
                      </div>
                    );
                  })()
                ) : (
                  <button className="secondary small" onClick={() => startDraft(p.serial)}>+ Add account</button>
                )}
              </div>
            );
          })}
        </div>

        <h2 style={{ marginTop: 24 }}>Themes</h2>
        <div className="themes-section">
          {themes.length === 0 && <div className="empty-inline">No themes yet. Create one below.</div>}
          {themes.map((t) => (
            <div className="theme-row" key={t.id}>
              {editingTheme === t.id ? (
                <>
                  <input
                    autoFocus
                    value={themeNameDraft}
                    onChange={(e) => setThemeNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTheme(t.id); }}
                  />
                  <button onClick={() => saveTheme(t.id)}>Save</button>
                  <button className="secondary small" onClick={() => setEditingTheme(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="theme-name">{t.name}</span>
                  <span className="theme-count">{themeAccountCount[t.id] ?? 0} account(s)</span>
                  <button className="secondary small" onClick={() => { setEditingTheme(t.id); setThemeNameDraft(t.name); }}>Rename</button>
                  <button className="danger small" onClick={() => deleteTheme(t.id)}>Delete</button>
                </>
              )}
            </div>
          ))}
          <div className="theme-row">
            <input
              type="text"
              placeholder="New theme name..."
              value={newThemeName}
              onChange={(e) => setNewThemeName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createTheme(); }}
            />
            <button onClick={createTheme} disabled={!newThemeName.trim()}>Create theme</button>
          </div>
        </div>
      </div>
    </div>
  );
}
