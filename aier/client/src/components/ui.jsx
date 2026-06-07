import { useEffect } from 'react';
import { setGenerating } from '../trollBus.js';

export function Banner({ kind = 'warn', children }) {
  if (!children) return null;
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function Stepper({ steps, current, onStep }) {
  return (
    <div className="steps">
      {steps.map((label, i) => (
        <button key={i} type="button" disabled={!onStep}
          className={`step-pill ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}
          onClick={() => onStep?.(i)}>
          <span className="n">{i < current ? '✓' : i + 1}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProgressOverlay({ title, progress, log, json }) {
  // This overlay is only mounted while a generation/build is running, so its
  // lifetime IS the "generating" window — flip the shared flag accordingly.
  // (The troll itself now lives at the app shell, not inside the overlay.)
  useEffect(() => {
    setGenerating(true);
    return () => setGenerating(false);
  }, []);

  return (
    <div className="overlay">
      <div className={`box card ${json ? 'with-aside' : ''}`}>
        <div className="ov-main">
          <h2>{title}</h2>
          <div className="bar"><div style={{ width: `${Math.max(4, progress || 0)}%` }} /></div>
          <div className="logbox">
            {(log || []).slice(-40).join('\n') || 'Working…'}
          </div>
        </div>
        {json && (
          <div className="ov-aside">
            <h3>Request sent to Kling</h3>
            <pre className="jsonbox">{JSON.stringify(json, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
