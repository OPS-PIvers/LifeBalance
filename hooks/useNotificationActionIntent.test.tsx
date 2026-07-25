import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useNotificationActionIntent } from './useNotificationActionIntent';
import { SW_NAVIGATE_MESSAGE } from '@/utils/swNavigation';

/**
 * F-NOTIF-05 / F-HABITS-03 — the deep-link intent the notification tap produces.
 * Focused on the two arrival paths and on the guard that decides what counts as
 * an intent at all; the URL round-trip itself is covered by
 * utils/notificationActions.test.ts.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: '/' }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ householdId: 'hh1' }),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/firebase.config', () => ({ db: {} }));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const track = vi.fn();
vi.mock('@/services/analytics', () => ({ track: (...args: unknown[]) => track(...args) }));

/** Renders the hook and exposes the latest value it returned. */
const renderIntent = () => {
  const seen: { logHabitId: string | null; clearLogHabit: () => void }[] = [];
  const Probe = () => {
    seen.push(useNotificationActionIntent());
    return null;
  };
  render(<Probe />);
  return {
    get latest() {
      return seen[seen.length - 1]!;
    },
  };
};

const setUrl = (href: string) => {
  window.history.replaceState(null, '', href);
};

const postSwMessage = (url: string) => {
  act(() => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', { data: { type: SW_NAVIGATE_MESSAGE, url } })
    );
  });
};

describe('useNotificationActionIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setUrl('/');
    // jsdom has no serviceWorker container; a bare EventTarget is enough to
    // exercise the message path.
    if (!navigator.serviceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: new EventTarget(),
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes no pending habit when the URL carries no deep link', () => {
    const intent = renderIntent();
    expect(intent.latest.logHabitId).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('surfaces the habit target of a log-habit tap and lands on the habits page', () => {
    setUrl('/?nact=log-habit&nhabit=h7');
    const intent = renderIntent();
    expect(intent.latest.logHabitId).toBe('h7');
    expect(navigate).toHaveBeenCalledWith('/habits');
  });

  it('strips both params from the address bar', () => {
    setUrl('/?nact=log-habit&nhabit=h7');
    renderIntent();
    expect(window.location.search).not.toContain('nact');
    expect(window.location.search).not.toContain('nhabit');
  });

  it('clears the pending habit once the dispatching child reports back', () => {
    setUrl('/?nact=log-habit&nhabit=h7');
    const intent = renderIntent();
    act(() => intent.latest.clearLogHabit());
    expect(intent.latest.logHabitId).toBeNull();
  });

  it('ignores a habit target that arrives without an action (a body tap)', () => {
    setUrl('/?nhabit=h7');
    const intent = renderIntent();
    expect(intent.latest.logHabitId).toBeNull();
  });

  // Regression: a body tap consumed while a log-habit intent is still pending
  // used to bump the nonce with an empty intent and drop the queued log.
  it('does not let a later body tap displace a still-pending log', () => {
    setUrl('/?nact=log-habit&nhabit=h7');
    const intent = renderIntent();
    expect(intent.latest.logHabitId).toBe('h7');

    postSwMessage('/habits?nhabit=h9');
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(intent.latest.logHabitId).toBe('h7');
  });

  describe('service-worker NAVIGATE arrivals', () => {
    it('routes the app and picks up the intent the message carried', () => {
      const intent = renderIntent();
      expect(intent.latest.logHabitId).toBeNull();

      postSwMessage('/habits?due=h9&nact=log-habit&nhabit=h9&nsrc=habit_reminder');
      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(intent.latest.logHabitId).toBe('h9');
      // The filter param survives; only the dispatch params are consumed.
      expect(window.location.hash).toContain('due=h9');
      expect(window.location.hash).not.toContain('nact');
      expect(window.location.hash).not.toContain('nhabit');
    });

    it('records the open, which this arrival path would otherwise never fire', () => {
      renderIntent();
      postSwMessage('/habits?nact=log-habit&nhabit=h9&nsrc=habit_reminder');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(track).toHaveBeenCalledWith('notification_opened', { type: 'habit_reminder' });
    });

    it('ignores a message that is not a navigation', () => {
      const intent = renderIntent();
      act(() => {
        navigator.serviceWorker.dispatchEvent(
          new MessageEvent('message', { data: { type: 'SOMETHING_ELSE', url: '/habits' } })
        );
        vi.advanceTimersByTime(1);
      });
      expect(intent.latest.logHabitId).toBeNull();
    });
  });
});
