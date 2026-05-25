import chokidar from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import * as filesStore from "./filesStore.js";

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".3gp"]);

// Bridges the filesystem to filesStore. No internal state — the store is the
// single source of truth.
export class IncomingWatcher {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  start(): void {
    const watcher = chokidar.watch(this.dir, {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
      depth: 0,
    });
    watcher.on("add", (p) => this.handleAdd(p));
    watcher.on("change", (p) => this.handleAdd(p));
    watcher.on("unlink", (p) => this.handleRemove(p));
  }

  private async handleAdd(filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    if (!VIDEO_EXT.has(ext)) return;
    try {
      const stat = await fs.stat(filePath);
      filesStore.onFilePresent(path.basename(filePath), stat.size);
    } catch {
      // file disappeared between event and stat — ignore
    }
  }

  private handleRemove(filePath: string): void {
    filesStore.onFileMissing(path.basename(filePath));
  }

  // Resolves a name to an on-disk path (used by push endpoints).
  filePath(name: string): string {
    return path.join(this.dir, name);
  }

  async remove(name: string): Promise<boolean> {
    const full = this.filePath(name);
    let removed = false;
    try {
      await fs.unlink(full);
      removed = true;
    } catch { /* not on disk */ }
    filesStore.deleteRecord(name);
    return removed;
  }
}
