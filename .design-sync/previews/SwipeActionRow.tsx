// SwipeActionRow reads the resolved theme to paint its swipe rails, so it needs
// AppProviders (exported from the bundle) in context.
//
// The revealed rails are gesture-driven — they only exist mid-drag or while the
// row is stuck open, neither of which a static render can reach. The card
// therefore shows the row at rest, which is exactly what a user sees before
// touching it. Every swipe action must also be reachable from a visible
// control; swipes are shortcuts, never the only path.
import { AppProviders, SwipeActionRow, SurfaceList, Row } from 'lifebalance';

const Check = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

const Trash = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
);

const Clock = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

const label: React.CSSProperties = { fontSize: 14, color: 'var(--color-brand-800, #332f2a)' };
const meta: React.CSSProperties = {
  marginLeft: 'auto', fontSize: 13, color: 'var(--color-brand-500, #857e6f)',
};

export const SwipeableToDos = () => (
  <AppProviders>
    <div style={{ width: 340 }}>
      <SurfaceList>
        <SwipeActionRow
          startActions={[{ icon: Check, label: 'Done', tone: 'positive', onAction: () => {} }]}
          endActions={[
            { icon: Trash, label: 'Delete', ariaLabel: 'Delete Book the dog sitter', tone: 'destructive', onAction: () => {} },
            { icon: Clock, label: 'Snooze', tone: 'warm', onAction: () => {} },
          ]}
        >
          <Row><span style={label}>Book the dog sitter</span><span style={meta}>Due Fri</span></Row>
        </SwipeActionRow>
        <SwipeActionRow
          startActions={[{ icon: Check, label: 'Done', tone: 'positive', onAction: () => {} }]}
          endActions={[{ icon: Trash, label: 'Delete', ariaLabel: 'Delete Renew library books', tone: 'destructive', onAction: () => {} }]}
        >
          <Row><span style={label}>Renew library books</span><span style={meta}>Overdue</span></Row>
        </SwipeActionRow>
      </SurfaceList>
    </div>
  </AppProviders>
);
