// Tiny API client. Same-origin: Vite proxies /api + /media to the backend.

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  health: () => jsonFetch('/api/health'),

  // --- studio flow ---
  download: (url) => jsonFetch('/api/youtube/download', { method: 'POST', body: JSON.stringify({ url }) }),
  frame: (projectId, time) => jsonFetch('/api/frame', { method: 'POST', body: JSON.stringify({ projectId, time }) }),
  // Save a browser-decoded frame (canvas grab) as the seed — pixel-matches the <video>.
  saveFrame: async (projectId, time, blob) => {
    const fd = new FormData();
    fd.append('image', blob, 'frame.png');
    fd.append('projectId', projectId);
    fd.append('time', String(time));
    const res = await fetch('/api/frame/save', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to save frame');
    return data;
  },
  // Gemini drafts the Kling prompt from the Admin instruction + the freeze frame.
  draftPrompt: (projectId) =>
    jsonFetch('/api/prompt', { method: 'POST', body: JSON.stringify({ projectId }) }),
  generate: (body) => jsonFetch('/api/generate', { method: 'POST', body: JSON.stringify(body) }),
  export: (body) => jsonFetch('/api/export', { method: 'POST', body: JSON.stringify(body) }),
  // Render just the full movie scene (trimmed + cropped) for download; the AI clip already exists.
  exportMovie: (body) => jsonFetch('/api/export/movie', { method: 'POST', body: JSON.stringify(body) }),

  // --- timeline editor ---
  // Render a full EDL (trims, splits, speed, extra clips, detached/added audio, gains, moves).
  render: (body) => jsonFetch('/api/render', { method: 'POST', body: JSON.stringify(body) }),
  // What the editor can drop on the timeline: project clips + the global admin audio library.
  renderAssets: (projectId) => jsonFetch(`/api/render/assets/${projectId}`),

  // --- testing helpers (skip download / Kling) ---
  devProjects: () => jsonFetch('/api/dev/projects'),
  devPlaceholder: (body) => jsonFetch('/api/dev/placeholder', { method: 'POST', body: JSON.stringify(body) }),

  // --- admin ---
  getSettings: () => jsonFetch('/api/admin/settings'),
  saveSettings: (patch) => jsonFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  deleteRef: (id) => jsonFetch(`/api/admin/refs/${id}`, { method: 'DELETE' }),
  deleteAudio: (id) => jsonFetch(`/api/admin/audio/${id}`, { method: 'DELETE' }),
  uploadAudio: async (file, label) => {
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('label', label || '');
    const res = await fetch('/api/admin/audio', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },
  reorderRefs: (ids) => jsonFetch('/api/admin/refs/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  uploadRef: async (file, label) => {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('label', label || '');
    const res = await fetch('/api/admin/refs', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
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
        const job = await jsonFetch(`/api/jobs/${jobId}`);
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
