import { SubViewHint } from 'lifebalance';

// One-time coach hint: it latches itself "seen" in localStorage the moment it
// dismisses, so clear the latch on load or the card renders empty on a repeat
// visit. Preview-only concern — the real app wants the latch.
try {
  localStorage.removeItem('lifebalance-subview-hint-seen');
} catch {
  // Storage unavailable — the hint shows anyway.
}

export const FirstVisit = () => (
  <div style={{ width: 340 }}>
    <SubViewHint menuOpened={false} />
  </div>
);
