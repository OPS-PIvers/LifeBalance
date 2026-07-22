import { Input } from 'lifebalance';

const Svg = ({ children, size = 18 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const Search = () => <Svg><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>;
const Dollar = () => <Svg><path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></Svg>;

const col: React.CSSProperties = { display: 'grid', gap: 16, maxWidth: 320 };

export const WithLabel = () => (
  <div style={col}>
    <Input label="Merchant" defaultValue="Trader Joe's" placeholder="Where did you spend?" />
  </div>
);

export const WithIcon = () => (
  <div style={col}>
    <Input icon={<Search />} placeholder="Search transactions" />
    <Input label="Amount" icon={<Dollar />} defaultValue="42.80" inputMode="decimal" />
  </div>
);

export const WithCount = () => (
  <div style={col}>
    <Input label="Note" defaultValue="Weekly grocery run" showCount maxLength={60} />
  </div>
);

export const Error = () => (
  <div style={col}>
    <Input label="Amount" defaultValue="-5" error="Amount must be greater than zero" required />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Input label="Account" defaultValue="Joint Checking" disabled />
  </div>
);
