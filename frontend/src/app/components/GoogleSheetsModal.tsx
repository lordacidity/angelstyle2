'use client';

interface GoogleSheetsModalProps {
  spreadsheetId: string;
  setSpreadsheetId: (v: string) => void;
  sheetName: string;
  setSheetName: (v: string) => void;
  startRow: string;
  setStartRow: (v: string) => void;
  endRow: string;
  setEndRow: (v: string) => void;
  loadingSheets: boolean;
  sheetsError: string;
  onClose: () => void;
  onImport: () => void;
}

export function GoogleSheetsModal({
  spreadsheetId, setSpreadsheetId, sheetName, setSheetName,
  startRow, setStartRow, endRow, setEndRow,
  loadingSheets, sheetsError, onClose, onImport,
}: GoogleSheetsModalProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Import from Google Sheets</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Spreadsheet ID</label>
            <input
              type="text"
              value={spreadsheetId}
              onChange={e => setSpreadsheetId(e.target.value)}
              placeholder="From URL: /d/SPREADSHEET_ID/edit"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-600 transition-colors"
            />
            <p className="mt-1 text-xs text-zinc-500">Find the ID in your sheet URL: /d/ID/edit</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Sheet Name</label>
            <input
              type="text"
              value={sheetName}
              onChange={e => setSheetName(e.target.value)}
              placeholder="Sheet1"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-600 transition-colors"
            />
            <p className="mt-1 text-xs text-zinc-500">The name of the tab (usually "Sheet1")</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Start Row</label>
              <input
                type="number" value={startRow} onChange={e => setStartRow(e.target.value)} min="1"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">End Row</label>
              <input
                type="number" value={endRow} onChange={e => setEndRow(e.target.value)} min="1"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
          </div>

          <div className="bg-zinc-800/50 rounded-lg px-3 py-2 text-xs text-zinc-400">
            <p className="font-medium text-zinc-300 mb-1">Expected format:</p>
            <p>• Column A: TikTok/Instagram/X URL</p>
            <p>• Column B: Caption</p>
            <p>• Column C: Tag (e.g., "film")</p>
          </div>

          {sheetsError && (
            <div className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
              {sheetsError}
            </div>
          )}

          <button
            onClick={onImport}
            disabled={loadingSheets || !spreadsheetId.trim()}
            className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingSheets ? 'Importing...' : 'Import Rows'}
          </button>
        </div>
      </div>
    </div>
  );
}
