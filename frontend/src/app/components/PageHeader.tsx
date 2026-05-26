'use client';

interface PageHeaderProps {
  googleToken: { accessToken: string } | null;
  onConnectGoogle: () => void;
  onOpenSheetsModal: () => void;
  onDisconnectGoogle: () => void;
  onResetAll: () => void;
}

export function PageHeader({
  googleToken, onConnectGoogle, onOpenSheetsModal, onDisconnectGoogle, onResetAll,
}: PageHeaderProps) {
  return (
    <div className="mb-10 text-center">
      <div className="flex items-center justify-center gap-3 mb-3">
        <svg width="36" height="36" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="8" fill="#010101"/>
          <path d="M21.5 7h-3.2v12.3c0 1.6-1.3 2.9-2.9 2.9s-2.9-1.3-2.9-2.9 1.3-2.9 2.9-2.9c.3 0 .6 0 .9.1V13c-.3 0-.6-.1-.9-.1-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6V12.7c1.1.8 2.5 1.3 4 1.3v-3.2c-2.2 0-3.9-1.7-3.9-3.8z" fill="#fff"/>
        </svg>
        <h1 className="text-3xl font-bold tracking-tight">TikTok Downloader</h1>
      </div>
      <p className="text-zinc-400 text-sm max-w-sm">
        Download TikTok videos &amp; images — with or without watermark
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {googleToken ? (
          <>
            <span className="text-xs text-green-400">✓ Connected to Google Sheets</span>
            <button
              onClick={onOpenSheetsModal}
              className="rounded-lg border border-green-700 bg-green-950/20 px-4 py-2 text-xs font-semibold text-green-400 hover:bg-green-950/40 hover:border-green-600 transition-colors"
            >
              Import from Sheets
            </button>
            <button
              onClick={onDisconnectGoogle}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-400 hover:border-red-500 hover:text-red-400 transition-colors"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={onConnectGoogle}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.98 7.447c.078-.444-.137-.795-.382-1.077-.266-.308-.628-.464-1.021-.464l-6.57.003-2.048-6.095C12.011.346 11.77.174 11.495.174c-.277 0-.518.172-.564.64L8.882 6.91l-6.57.003c-.394 0-.755.156-1.021.464-.245.282-.46.633-.382 1.077l2.13 6.326-5.477 4.364c-.27.215-.384.528-.303.85.078.31.309.564.637.681l6.354 2.22 2.042 6.076c.085.25.29.419.527.419.236 0 .44-.17.527-.42l2.042-6.075 6.354-2.22c.328-.117.56-.372.637-.682.081-.322-.033-.635-.303-.85l-5.477-4.364 2.13-6.326zM11.495 18.17l-1.63 4.846-1.63-4.846-5.083-1.776 4.38-3.493-1.708-5.074h5.241v-.002l.001.002 1.63-4.846 1.629 4.846h5.241l-1.708 5.074 4.38 3.493-5.083 1.776z"/>
            </svg>
            Connect Google Sheets
          </button>
        )}
        <div className="w-px h-6 bg-zinc-800 mx-1" />
        <button
          onClick={onResetAll}
          className="rounded-lg border border-orange-700 bg-orange-950/20 px-4 py-2 text-xs font-semibold text-orange-400 hover:bg-orange-950/40 hover:border-orange-600 transition-colors"
        >
          Reset All
        </button>
      </div>
    </div>
  );
}
