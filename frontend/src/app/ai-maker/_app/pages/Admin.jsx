import { useEffect, useRef, useState } from 'react';
import { api, fmt } from '../api.js';
import { Banner } from '../components/ui.jsx';

export default function Admin() {
  const [state, setState] = useState(null); // { settings, env, klingModels }
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const audioRef = useRef(null);
  const [audioLabel, setAudioLabel] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);

  // local editable copy of tunable settings
  const [form, setForm] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    try {
      const s = await api.getSettings();
      setState(s);
      setForm({
        klingModel: s.settings.klingModel,
        defaultDuration: s.settings.defaultDuration,
        cfgScale: s.settings.cfgScale,
        promptTemplate: s.settings.promptTemplate,
        negativePrompt: s.settings.negativePrompt,
      });
    } catch (e) { setError(e.message); }
  }

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const s = await api.uploadRef(file, label);
      setState(s); setLabel('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  }

  async function del(id) {
    try { setState(await api.deleteRef(id)); } catch (e) { setError(e.message); }
  }

  async function onPickAudio(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioBusy(true); setError(null);
    try {
      const s = await api.uploadAudio(file, audioLabel);
      setState(s); setAudioLabel('');
      if (audioRef.current) audioRef.current.value = '';
    } catch (e2) { setError(e2.message); } finally { setAudioBusy(false); }
  }

  async function delAudio(id) {
    try { setState(await api.deleteAudio(id)); } catch (e) { setError(e.message); }
  }

  async function move(id, dir) {
    const ids = state.settings.refs.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { setState(await api.reorderRefs(ids)); } catch (e) { setError(e.message); }
  }

  async function makeFrontal(id) {
    const ids = state.settings.refs.map((r) => r.id).filter((x) => x !== id);
    try { setState(await api.reorderRefs([id, ...ids])); } catch (e) { setError(e.message); }
  }

  async function saveForm(patch) {
    setError(null);
    try {
      const next = { ...form, ...patch };
      setForm(next);
      const s = await api.saveSettings(patch);
      setState(s);
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e) { setError(e.message); }
  }

  if (!state || !form) return <p className="sub">Loading…</p>;
  const { settings, env, klingModels } = state;
  const refs = settings.refs || [];
  const audio = settings.audio || [];

  return (
    <div>
      <h1>Admin</h1>
      <p className="sub">Set up “you” (Element 1) and tune how clips are generated.</p>
      {error && <Banner kind="err">{error}</Banner>}
      {saved && <Banner kind="ok">Saved.</Banner>}

      {/* keys + model */}
      <div className="card">
        <h2>Keys & model</h2>
        <div className="kv">
          <span>fal.ai key</span><span className={env.fal ? 'pill-ok' : 'pill-bad'}>{env.fal ? '● loaded' : '○ missing (.env)'}</span>
          <span>Gemini key</span><span className={env.gemini ? 'pill-ok' : 'pill-bad'}>{env.gemini ? '● loaded' : '○ missing (.env)'}</span>
          <span>Gemini model</span><span>{env.geminiModel}</span>
        </div>
        <label style={{ marginTop: 18 }}>Kling model</label>
        <div className="row">
          <label className="toggle">
            <input type="radio" name="model" checked={form.klingModel === klingModels.testing}
              onChange={() => saveForm({ klingModel: klingModels.testing })} />
            Testing — standard (cheaper)
          </label>
          <label className="toggle">
            <input type="radio" name="model" checked={form.klingModel === klingModels.prod}
              onChange={() => saveForm({ klingModel: klingModels.prod })} />
            Production — pro
          </label>
        </div>
        <p className="note" style={{ marginTop: 8 }}>Active: <b>{form.klingModel}</b></p>
      </div>

      {/* reference images = Element 1 (you) */}
      <div className="card">
        <h2>Your reference images — “#Element1” (you / Aiden)</h2>
        <p className="sub">First image = frontal/face. Add full-body and other angles as extra references. Up to 4 total work best.</p>
        <div className="refs-grid">
          {refs.map((r, i) => (
            <div className="ref-card" key={r.id}>
              <img src={r.url} alt={r.label} />
              <div className="meta">
                <div>
                  <div style={{ fontSize: 13 }}>{r.label}</div>
                  <div className="tag">{i === 0 ? '#Element1 · frontal' : 'reference angle'}</div>
                </div>
              </div>
              <div className="meta" style={{ paddingTop: 0 }}>
                <button className="btn ghost" title="move left" onClick={() => move(r.id, -1)}>←</button>
                {i !== 0 && <button className="btn ghost" onClick={() => makeFrontal(r.id)}>frontal</button>}
                <button className="btn ghost" title="move right" onClick={() => move(r.id, 1)}>→</button>
                <button className="btn danger" onClick={() => del(r.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>

        <label style={{ marginTop: 18 }}>Add a reference image</label>
        <div className="row">
          <input type="text" value={label} placeholder="label (e.g. face, full body)" style={{ maxWidth: 240 }}
            onChange={(e) => setLabel(e.target.value)} />
          <div className="dropzone" onClick={() => fileRef.current?.click()} style={{ flex: 1 }}>
            {busy ? 'Uploading…' : 'Click to choose an image (jpg / png / webp)'}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
        </div>
      </div>

      {/* audio library = music / sfx / voice for the timeline editor */}
      <div className="card">
        <h2>Audio library — music, sfx & voice</h2>
        <p className="sub">These appear in the editor's “Add audio”. Drop in music beds, sound effects, or voice-over to layer onto the final cut.</p>
        {audio.length > 0 && (
          <div className="audio-list">
            {audio.map((a) => (
              <div className="audio-item" key={a.id}>
                <span className="ai-name">♪ {a.label}</span>
                <audio src={a.url} controls preload="none" />
                <span className="readout">{a.duration ? fmt(a.duration) : ''}</span>
                <button className="btn danger" onClick={() => delAudio(a.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <label style={{ marginTop: 18 }}>Add audio</label>
        <div className="row">
          <input type="text" value={audioLabel} placeholder="label (e.g. intro music)" style={{ maxWidth: 240 }}
            onChange={(e) => setAudioLabel(e.target.value)} />
          <div className="dropzone" onClick={() => audioRef.current?.click()} style={{ flex: 1 }}>
            {audioBusy ? 'Uploading…' : 'Click to choose audio (mp3 / wav / m4a)'}
          </div>
          <input ref={audioRef} type="file" accept="audio/*" hidden onChange={onPickAudio} />
        </div>
      </div>

      {/* generation settings */}
      <div className="card">
        <h2>Generation defaults</h2>
        <label>Default clip length: <b>{form.defaultDuration}s</b></label>
        <input type="range" min={3} max={15} step={1} value={form.defaultDuration}
          onChange={(e) => setForm({ ...form, defaultDuration: Number(e.target.value) })}
          onMouseUp={(e) => saveForm({ defaultDuration: Number(e.target.value) })} />

        <label>Prompt adherence (cfg_scale): <b>{form.cfgScale}</b></label>
        <input type="range" min={0} max={1} step={0.05} value={form.cfgScale}
          onChange={(e) => setForm({ ...form, cfgScale: Number(e.target.value) })}
          onMouseUp={(e) => saveForm({ cfgScale: Number(e.target.value) })} />

        <label style={{ marginTop: 16 }}>Negative prompt — what Kling should avoid. Sent as <b>negative_prompt</b> on every generation, shared by both projects.</label>
        <textarea value={form.negativePrompt} style={{ minHeight: 70 }}
          placeholder="blur, distort, and low quality"
          onChange={(e) => setForm({ ...form, negativePrompt: e.target.value })} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => saveForm({ negativePrompt: form.negativePrompt })}>Save negative prompt</button>
        </div>

        <label style={{ marginTop: 16 }}>Gemini instruction — what Gemini reads (with the freeze frame) to draft the Kling prompt. Tell it to use <b>#Element1</b> for you, <b>#start_image</b> for the seed frame.</label>
        <textarea value={form.promptTemplate} style={{ minHeight: 140 }}
          onChange={(e) => setForm({ ...form, promptTemplate: e.target.value })} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => saveForm({ promptTemplate: form.promptTemplate })}>Save instruction</button>
        </div>
      </div>
    </div>
  );
}
