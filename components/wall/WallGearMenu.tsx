import React, { useEffect, useRef, useState } from 'react';
import { verifyKidPin } from '@/utils/kidPin';

interface WallGearMenuProps {
  title: string;
  pinHash?: string;
  /** Paired display: "Unpair this iPad". Member preview: "Leave the wall". */
  isDisplay: boolean;
  onClose: () => void;
  onReload: () => void;
  onUnpair: () => void;
  onSyncCalendars: () => Promise<{ failed: number }>;
}

const MAX_TRIES = 5;
const LOCKOUT_MS = 60_000;

/**
 * The wall's only settings surface (plan §3): behind the family (Kid Mode)
 * PIN when one is set. Everything else is configured on the phone.
 */
const WallGearMenu: React.FC<WallGearMenuProps> = ({ title, pinHash, isDisplay, onClose, onReload, onUnpair, onSyncCalendars }) => {
  const [unlocked, setUnlocked] = useState(!pinHash);
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  const [locked, setLocked] = useState(false);
  const unlockTimer = useRef<number | undefined>(undefined);
  const [syncNote, setSyncNote] = useState('Pulls the latest from every calendar');
  const [syncing, setSyncing] = useState(false);

  const syncCalendars = async () => {
    setSyncing(true);
    setSyncNote('Syncing…');
    try {
      const { failed } = await onSyncCalendars();
      setSyncNote(failed > 0 ? `Synced. ${failed} calendar${failed === 1 ? '' : 's'} couldn't be read; see Settings on a phone.` : 'Synced');
    } catch (e) {
      setSyncNote(e instanceof Error && e.message ? e.message : "Couldn't sync. Try again in a minute.");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => () => window.clearTimeout(unlockTimer.current), []);

  const press = async (d: string) => {
    if (locked || digits.length >= 6) return;
    const next = digits + d;
    setDigits(next);
    setError('');
    if (next.length < 4) return;
    if (await verifyKidPin(next, pinHash)) {
      setUnlocked(true);
      return;
    }
    // PINs are 4–6 digits: only a full 6 is definitely wrong.
    if (next.length === 6) {
      const n = tries + 1;
      setTries(n);
      setDigits('');
      if (n >= MAX_TRIES) {
        setLocked(true);
        unlockTimer.current = window.setTimeout(() => {
          setLocked(false);
          setError('');
        }, LOCKOUT_MS);
        setTries(0);
        setError('Too many tries. Wait a minute.');
      } else {
        setError("That's not the PIN.");
      }
    }
  };

  if (!unlocked) {
    return (
      <div className="full center">
        <div className="pin">
          <h2>Enter family PIN</h2>
          <div className="dots4" aria-label={`${digits.length} digits entered`}>
            {Array.from({ length: Math.max(4, digits.length) }, (_, i) => (
              <i key={i} className={i < digits.length ? 'f' : ''} />
            ))}
          </div>
          <div className="perr" role="alert">{error}</div>
          <div className="pad">
            {'123456789'.split('').map(n => (
              <button key={n} type="button" disabled={locked} onClick={() => void press(n)}>{n}</button>
            ))}
            <button type="button" className="k2" onClick={onClose}>Cancel</button>
            <button type="button" disabled={locked} onClick={() => void press('0')}>0</button>
            <button type="button" className="k2" onClick={() => setDigits(s => s.slice(0, -1))}>Delete</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="full center">
      <div className="pin">
        <h2>{title}</h2>
        <div className="gmenu">
          <button type="button" onClick={onReload}>
            <span>Reload display</span>
            <span>Fixes a stuck screen</span>
          </button>
          <button type="button" disabled={syncing} onClick={() => void syncCalendars()}>
            <span>Sync calendars now</span>
            <span role="status">{syncNote}</span>
          </button>
          <button type="button" className="danger" onClick={onUnpair}>
            <span>{isDisplay ? 'Unpair this iPad' : 'Leave the wall'}</span>
            <span>{isDisplay ? 'Signs the display out' : 'Back to LifeBalance'}</span>
          </button>
          <button type="button" onClick={onClose}>
            <span>Close</span>
            <span>{pinHash ? '' : 'Set a family PIN in Settings → Household to lock this menu'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default WallGearMenu;
