import { ProgressRing } from 'lifebalance';

const centerLabel = (pct: number): React.CSSProperties => ({
  fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700,
});

export const Habits = () => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
    <ProgressRing percent={100} className="w-16 h-16" barClassName="text-money-pos" ringLabel="All habits done">
      <span style={centerLabel(100)}>✓</span>
    </ProgressRing>
    <ProgressRing percent={72} className="w-16 h-16">
      <span style={centerLabel(72)}>72%</span>
    </ProgressRing>
    <ProgressRing percent={30} className="w-16 h-16" barClassName="text-warm-500">
      <span style={centerLabel(30)}>3/10</span>
    </ProgressRing>
  </div>
);

export const Small = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <ProgressRing percent={60} className="w-10 h-10" ringLabel="60 percent" />
    <ProgressRing percent={90} className="w-10 h-10" barClassName="text-money-pos" ringLabel="90 percent" />
  </div>
);
