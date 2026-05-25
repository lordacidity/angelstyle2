import { useRef, useState } from "react";

interface UploadJob {
  id: number;
  name: string;
  size: number;
  loaded: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

function formatSize(bytes: number): string {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function SenderView() {
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const uploadOne = (file: File) => {
    const id = nextId.current++;
    setUploads((u) => [...u, { id, name: file.name, size: file.size, loaded: 0, status: "uploading" }]);
    const form = new FormData();
    form.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      setUploads((u) => u.map((j) => (j.id === id ? { ...j, loaded: e.loaded } : j)));
    };
    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      setUploads((u) =>
        u.map((j) =>
          j.id === id
            ? { ...j, loaded: file.size, status: ok ? "done" : "error", error: ok ? undefined : xhr.statusText }
            : j,
        ),
      );
      if (ok) {
        // Auto-clear successful uploads after a few seconds.
        setTimeout(() => setUploads((u) => u.filter((j) => j.id !== id)), 4000);
      }
    };
    xhr.onerror = () => {
      setUploads((u) => u.map((j) => (j.id === id ? { ...j, status: "error", error: "network error" } : j)));
    };
    xhr.send(form);
  };

  const onFilesPicked = (fileList: FileList | null) => {
    if (!fileList) return;
    for (const f of Array.from(fileList)) uploadOne(f);
  };

  return (
    <div className="sender-root">
      <div
        className={`sender-drop${dragOver ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFilesPicked(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="sender-drop-title">Drop video files here</div>
        <div className="sender-drop-sub">or click to browse</div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => { onFilesPicked(e.target.files); e.target.value = ""; }}
        />
      </div>

      {uploads.length > 0 && (
        <div className="sender-uploads">
          {uploads.map((u) => {
            const pct = u.size > 0 ? Math.round((u.loaded / u.size) * 100) : 0;
            return (
              <div className={`upload upload-${u.status}`} key={u.id}>
                <div className="upload-row">
                  <span className="upload-name">{u.name}</span>
                  <span className="upload-meta">
                    {u.status === "done"
                      ? "Sent ✓"
                      : u.status === "error"
                      ? `Failed: ${u.error}`
                      : `${pct}% · ${formatSize(u.loaded)} / ${formatSize(u.size)}`}
                  </span>
                </div>
                <div className="upload-bar"><div className="upload-bar-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
