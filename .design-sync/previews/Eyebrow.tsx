import { Eyebrow } from 'lifebalance';

const field: React.CSSProperties = { display: 'grid', gap: 4 };
const value: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600,
  color: 'var(--color-brand-900, #211f1c)',
};

export const Tones = () => (
  <div style={{ display: 'grid', gap: 18, width: 300 }}>
    <div style={field}>
      <Eyebrow>Safe to spend</Eyebrow>
      <span style={value}>$412.60</span>
    </div>
    <div style={field}>
      <Eyebrow tone="warm">Current streak</Eyebrow>
      <span style={value}>12 days</span>
    </div>
    <div style={field}>
      <Eyebrow tone="accent">This paycheck</Eyebrow>
      <span style={value}>Jul 15 – Jul 29</span>
    </div>
  </div>
);

export const AsFieldLabel = () => (
  <div style={{ display: 'grid', gap: 6, width: 300 }}>
    <Eyebrow as="h3">Notification timing</Eyebrow>
    <p style={{ fontSize: 14, color: 'var(--color-brand-600, #6b6558)', margin: 0 }}>
      Habit reminders go out at 8:00 PM in your local timezone.
    </p>
  </div>
);
