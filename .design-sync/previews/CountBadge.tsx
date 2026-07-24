import { CountBadge } from 'lifebalance';

// CountBadge is positioned absolutely — the host must establish a positioning
// context. These stand-ins mirror the real BottomNav / TopToolbar hosts.
const IconButton = ({ children }: { children: React.ReactNode }) => (
  <span
    style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 40, height: 40, borderRadius: 10,
      color: 'var(--color-brand-600, #6b6558)', background: 'var(--color-brand-100, #f2eee4)',
    }}
  >
    {children}
  </span>
);

const Bell = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /></svg>
);

const Receipt = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M8 9h8" /><path d="M8 13h6" /></svg>
);

const Gift = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v9h14v-9" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></svg>
);

export const Overlay = () => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
    <IconButton>
      <Bell />
      <CountBadge count={3} />
    </IconButton>
    <IconButton>
      <Receipt />
      <CountBadge count={14} />
    </IconButton>
    <IconButton>
      <Bell />
      <CountBadge count={2} icon={Gift} />
    </IconButton>
  </div>
);

export const Inline = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, color: 'var(--color-brand-700, #4a4539)' }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      To-dos <CountBadge count={7} variant="inline" max={99} />
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      Shopping <CountBadge count={128} variant="inline" max={99} />
    </span>
  </div>
);
