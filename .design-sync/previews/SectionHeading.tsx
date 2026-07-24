import { SectionHeading } from 'lifebalance';

const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between',
  padding: '10px 0', fontSize: 14, color: 'var(--color-brand-700, #4a4539)',
};

const link: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--color-brand-500, #857e6f)',
};

export const WithDescription = () => (
  <div style={{ width: 340 }}>
    <SectionHeading description="Everyone who can see this household's money.">
      Members
    </SectionHeading>
    <div style={row}><span>Paul</span><span>Admin</span></div>
    <div style={row}><span>Sam</span><span>Member</span></div>
  </div>
);

export const WithAction = () => (
  <div style={{ width: 340 }}>
    <SectionHeading action={<span style={link}>View all</span>}>This week</SectionHeading>
    <div style={row}><span>Groceries</span><span>$142.18</span></div>
    <div style={row}><span>Dining out</span><span>$61.00</span></div>
  </div>
);

export const Plain = () => (
  <div style={{ width: 340 }}>
    <SectionHeading as="h2">Backups &amp; Import</SectionHeading>
  </div>
);
