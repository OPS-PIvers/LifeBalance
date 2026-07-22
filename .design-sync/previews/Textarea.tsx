import { Textarea } from 'lifebalance';

const col: React.CSSProperties = { display: 'grid', gap: 16, maxWidth: 340 };

export const WithLabel = () => (
  <div style={col}>
    <Textarea label="Notes" defaultValue="Split this dinner with Alex — reimburse $18." />
  </div>
);

export const WithCount = () => (
  <div style={col}>
    <Textarea label="Recipe steps" showCount maxLength={280} defaultValue="Roast the squash at 400°F for 25 min, then toss with sage butter." />
  </div>
);

export const Error = () => (
  <div style={col}>
    <Textarea label="Reason" error="Please add a short note before saving." placeholder="Why are you editing this transaction?" />
  </div>
);
