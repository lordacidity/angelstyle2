/** Format seconds as M:SS */
export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Strip characters Windows can't put in a filename, for a download name. */
export function safeExportName(raw: string) {
  return raw.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70).replace(/[. ]+$/g, '').trim() || 'vid';
}
