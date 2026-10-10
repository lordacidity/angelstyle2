import { QR_ROWS } from './qr';

// What anyone who is not on an iPhone sees: a closed door with a QR code on
// it. The page itself is tuned for a 6-inch screen held in one hand, and
// Claude would rather send you to the right device than show you a stretched
// version of the wrong one.

function Qr({ size = 220 }: { size?: number }) {
  const n = QR_ROWS.length;
  const cell = size / n;
  const rects: React.ReactNode[] = [];
  QR_ROWS.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      if (row[x] === '1') rects.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.2} height={cell + 0.2} />);
    }
  });
  return (
    <svg className="gate-qr" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="QR code for angelstyle.com/Sloan">
      <rect width={size} height={size} fill="#efe9dc" />
      <g fill="#0b0f1a">{rects}</g>
    </svg>
  );
}

export default function Gate({ ua }: { ua: string }) {
  const what = /iPad|Macintosh/.test(ua) ? (/iPad/.test(ua) ? 'an iPad' : 'a Mac') : /Android/.test(ua) ? 'an Android' : /Windows/.test(ua) ? 'a Windows machine' : 'something that is not an iPhone';
  return (
    <main className="gate">
      <div className="gate-card">
        <div className="eyebrow">angelstyle.com/Sloan</div>
        <h1 className="gate-title">iPhone <em>only.</em></h1>
        <p className="gate-text">
          Hey. I&rsquo;m Claude. I built this page for Dr.&nbsp;E, and I built it for a six-inch screen held in one hand. You are on {what}. Point an iPhone camera at this and the door opens.
        </p>
        <Qr />
        <p className="gate-foot mono">Dr. E: borrow Aiden&rsquo;s.</p>
      </div>
    </main>
  );
}
