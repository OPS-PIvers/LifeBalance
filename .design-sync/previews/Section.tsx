import { Section, SurfaceList, Row, DisclosureRow, Stat, StatGroup } from 'lifebalance';

const Wallet = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" /><path d="M17 12h.01" /></svg>
);

const Bell = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /></svg>
);

const Trash = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
);

const name: React.CSSProperties = { fontSize: 14, color: 'var(--color-brand-800, #332f2a)' };
const amount: React.CSSProperties = {
  marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600,
};

export const ListSection = () => (
  <div style={{ width: 360 }}>
    <Section title="Recent activity">
      <SurfaceList>
        <Row>
          <span style={name}>Trader Joe&apos;s</span>
          <span style={{ ...amount, color: 'var(--color-money-neg, #a8392c)' }}>−$62.14</span>
        </Row>
        <Row>
          <span style={name}>Paycheck</span>
          <span style={{ ...amount, color: 'var(--color-money-pos, #2f6f4f)' }}>+$1,842.00</span>
        </Row>
        <Row interactive>
          <span style={name}>Shell — gas</span>
          <span style={{ ...amount, color: 'var(--color-money-neg, #a8392c)' }}>−$41.80</span>
        </Row>
      </SurfaceList>
    </Section>
  </div>
);

export const SettingsSection = () => (
  <div style={{ width: 360 }}>
    <Section title="Household">
      <SurfaceList>
        <DisclosureRow icon={<Wallet />} title="Accounts" subtitle="3 connected" value="Joint" onClick={() => {}} />
        <DisclosureRow icon={<Bell />} title="Notifications" value="On" onClick={() => {}} />
        <DisclosureRow icon={<Trash />} title="Delete household" destructive onClick={() => {}} />
      </SurfaceList>
    </Section>
  </div>
);

export const Stats = () => (
  <div style={{ width: 360 }}>
    <Section title="This week">
      <StatGroup>
        <Stat label="Points earned" value="480" />
        <Stat label="Longest streak" value="12d" />
        <Stat label="Left to spend" value="$412" valueClassName="text-money-pos" />
      </StatGroup>
    </Section>
  </div>
);
