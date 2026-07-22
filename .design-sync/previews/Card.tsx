import { Card } from 'lifebalance';

export const Surface = () => (
  <Card className="p-5" style={{ maxWidth: 320 }}>
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-brand-500, #8a8579)' }}>Safe to spend</div>
    <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 600, marginTop: 4 }}>$412.60</div>
    <div style={{ fontSize: 13, color: 'var(--color-brand-500, #8a8579)', marginTop: 4 }}>through Jul 29 · 2 bills unpaid</div>
  </Card>
);

export const Interactive = () => (
  <Card interactive className="p-4" style={{ maxWidth: 320 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontWeight: 600 }}>Joint Checking</div>
        <div style={{ fontSize: 13, color: 'var(--color-brand-500, #8a8579)' }}>Tap to view activity</div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>$1,284.10</div>
    </div>
  </Card>
);
