// The visual that gets exported. 1080×1350 portrait — fits Instagram feed
// natively and crops cleanly to 1080×1080 if needed. Kept self-contained
// (inline styles, no external classes) so html-to-image can serialize it
// without relying on stylesheet rules.

export interface CardData {
  photoUrl: string;
  headline: string;
  source: string | null;
  pubDate: string | null;
  pauvAngle: string;
  talent: {
    name: string;
    ticker: string;
    industry: string | null;
    subcategory: string | null;
    location: string | null;
    bio: string | null;
    price: {
      usd: number | null;
      lifetimeChangePct: number | null;
      holders: number | null;
      volumeLifetimeUsd: number | null;
    };
  };
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtDate(s: string | null): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return s; }
}

export function NewsCardTemplate({ data, refEl }: {
  data: CardData;
  refEl?: React.Ref<HTMLDivElement>;
}) {
  const changePos = (data.talent.price.lifetimeChangePct ?? 0) >= 0;
  const accent = changePos ? "#22c55e" : "#ef4444";

  return (
    <div
      ref={refEl}
      style={{
        width: 1080,
        height: 1350,
        background: "#0a0a0b",
        color: "#fafafa",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {/* HERO photo */}
      <div style={{ position: "relative", width: "100%", height: 720, overflow: "hidden" }}>
        <img
          src={data.photoUrl}
          alt=""
          crossOrigin="anonymous"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {/* dark gradient at bottom of photo so headline reads */}
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: 320,
          background: "linear-gradient(to top, rgba(10,10,11,1) 0%, rgba(10,10,11,0.85) 35%, rgba(10,10,11,0) 100%)",
        }} />
        {/* corner badge */}
        <div style={{
          position: "absolute", top: 32, right: 32,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
          padding: "10px 16px", borderRadius: 999,
          fontSize: 22, fontWeight: 700, letterSpacing: 1,
        }}>
          PAUV · NEWS CARD
        </div>
        {/* headline overlay */}
        <div style={{ position: "absolute", left: 48, right: 48, bottom: 36 }}>
          <div style={{ fontSize: 16, opacity: 0.7, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>
            {data.source ?? "news"} · {fmtDate(data.pubDate)}
          </div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15, textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
            {data.headline}
          </div>
        </div>
      </div>

      {/* PAUV ANGLE block */}
      <div style={{ padding: "32px 48px 8px" }}>
        <div style={{ fontSize: 14, color: accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>
          Why this matters for {data.talent.name.split(" ")[0]}'s NPSI
        </div>
        <div style={{ fontSize: 24, lineHeight: 1.35, color: "#e5e5e5", fontStyle: "italic" }}>
          "{data.pauvAngle}"
        </div>
      </div>

      {/* divider */}
      <div style={{ height: 1, background: "#1f1f22", margin: "28px 48px 24px" }} />

      {/* TALENT STATS block */}
      <div style={{ padding: "0 48px 48px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{data.talent.name}</div>
            <div style={{ fontSize: 18, color: "#9ca3af", marginTop: 6, letterSpacing: 0.5 }}>
              ${data.talent.ticker.toUpperCase()} · {data.talent.industry ?? ""}{data.talent.subcategory ? ` · ${data.talent.subcategory}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {fmtUsd(data.talent.price.usd)}
            </div>
            <div style={{ fontSize: 22, color: accent, marginTop: 6, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {fmtPct(data.talent.price.lifetimeChangePct)} lifetime
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 8 }}>
          <Stat label="Holders" value={String(data.talent.price.holders ?? 0)} />
          <Stat label="Lifetime volume" value={fmtUsd(data.talent.price.volumeLifetimeUsd)} />
          <Stat label="Based in" value={data.talent.location ?? "—"} />
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 18, borderTop: "1px solid #1f1f22" }}>
          <div style={{ fontSize: 18, color: "#6b7280", letterSpacing: 0.5 }}>
            pauv.com/${data.talent.ticker}
          </div>
          <div style={{ fontSize: 14, color: "#6b7280", letterSpacing: 1.5, textTransform: "uppercase" }}>
            Net Public Sentiment Index
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#141416", border: "1px solid #1f1f22", borderRadius: 14, padding: "16px 20px" }}>
      <div style={{ fontSize: 13, color: "#9ca3af", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fafafa" }}>{value}</div>
    </div>
  );
}
