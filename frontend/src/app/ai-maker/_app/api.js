// Tiny API client. The Aier STUDIO backend runs on the user's LOCAL machine (the full Aier
// app, launched via the "Launch Aier server" button), NOT the Vercel domain — that's how the
// YouTube download avoids datacenter bot-blocks/python3 and how render/export reach the local
// disk. So every call is absolute to LOCAL, and every media URL the server returns (a
// "/media/..." path that would otherwise resolve against the Vercel origin) is rewritten to
// LOCAL too, so <video>/<img> load from the local server. The local server accepts these same
// /api/aier/* paths (it strips the "aier" segment) so it's a drop-in for the old cloud backend.
const LOCAL = (process.env.NEXT_PUBLIC_AIER_LOCAL_URL || 'http://localhost:3010').replace(/\/+$/, '');

function absMedia(u) {
  if (typeof u !== 'string') return u;
  if (u.startsWith('/media/')) return LOCAL + u;
  if (u.startsWith('/api/aier/media/')) return LOCAL + u.slice('/api/aier'.length);
  return u;
}
// Walk a parsed response and absolutize any media path so it points at the local server.
// Server-relative "/media/..." stays canonical in the EDL the editor sends back — the
// renderer's resolveMediaPath() tolerates these absolute URLs.
function absolutize(v) {
  if (typeof v === 'string') return absMedia(v);
  if (Array.isArray(v)) return v.map(absolutize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k in v) out[k] = absolutize(v[k]);
    return out;
  }
  return v;
}

async function jsonFetch(path, opts = {}) {
  const res = await fetch(LOCAL + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return absolutize(data);
}

// Same as jsonFetch but for FormData uploads (no JSON content-type, no body stringify).
async function formFetch(path, fd) {
  const res = await fetch(LOCAL + path, { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return absolutize(data);
}

export const api = {
  health: () => jsonFetch('/api/aier/health'),

  // --- studio flow ---
  download: (url) => jsonFetch('/api/aier/youtube/download', { method: 'POST', body: JSON.stringify({ url }) }),
  frame: (projectId, time) => jsonFetch('/api/aier/frame', { method: 'POST', body: JSON.stringify({ projectId, time }) }),
  // Save a browser-decoded frame (canvas grab) as the seed — pixel-matches the <video>.
  saveFrame: (projectId, time, blob) => {
    const fd = new FormData();
    fd.append('image', blob, 'frame.png');
    fd.append('projectId', projectId);
    fd.append('time', String(time));
    return formFetch('/api/aier/frame/save', fd);
  },
  // Gemini drafts the Kling prompt from the Admin instruction + the freeze frame.
  draftPrompt: (projectId) =>
    jsonFetch('/api/aier/prompt', { method: 'POST', body: JSON.stringify({ projectId }) }),
  generate: (body) => jsonFetch('/api/aier/generate', { method: 'POST', body: JSON.stringify(body) }),
  export: (body) => jsonFetch('/api/aier/export', { method: 'POST', body: JSON.stringify(body) }),
  // Render just the full movie scene (trimmed + cropped) for download; the AI clip already exists.
  exportMovie: (body) => jsonFetch('/api/aier/export/movie', { method: 'POST', body: JSON.stringify(body) }),

  // --- timeline editor ---
  // Render a full EDL (trims, splits, speed, extra clips, detached/added audio, gains, moves).
  render: (body) => jsonFetch('/api/aier/render', { method: 'POST', body: JSON.stringify(body) }),
  // What the editor can drop on the timeline: project clips + the global admin audio library.
  renderAssets: (projectId) => jsonFetch(`/api/aier/render/assets/${projectId}`),

  // --- testing helpers (skip download / Kling) ---
  devProjects: () => jsonFetch('/api/aier/dev/projects'),
  devPlaceholder: (body) => jsonFetch('/api/aier/dev/placeholder', { method: 'POST', body: JSON.stringify(body) }),

  // --- admin ---
  getSettings: () => jsonFetch('/api/aier/admin/settings'),
  saveSettings: (patch) => jsonFetch('/api/aier/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  deleteRef: (id) => jsonFetch(`/api/aier/admin/refs/${id}`, { method: 'DELETE' }),
  deleteAudio: (id) => jsonFetch(`/api/aier/admin/audio/${id}`, { method: 'DELETE' }),
  uploadAudio: (file, label) => {
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('label', label || '');
    return formFetch('/api/aier/admin/audio', fd);
  },
  reorderRefs: (ids) => jsonFetch('/api/aier/admin/refs/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  uploadRef: (file, label) => {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('label', label || '');
    return formFetch('/api/aier/admin/refs', fd);
  },
};

/**
 * Poll a background job until it finishes.
 * @param {string} jobId
 * @param {(job)=>void} onUpdate called each poll with the job (progress, log, status)
 * @returns {Promise<any>} the job result
 */
export function pollJob(jobId, onUpdate) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await jsonFetch(`/api/aier/jobs/${jobId}`);
        onUpdate?.(job);
        if (job.status === 'done') return resolve(job.result);
        if (job.status === 'error') return reject(new Error(job.error || 'Job failed'));
        setTimeout(tick, 1200);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}

// seconds -> "m:ss.mmm"
export function fmt(t) {
  if (t == null || isNaN(t)) return '0:00.000';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
