import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isPWA } from '@/utils/platform';
import { pairingErrorMessage, redeemPairingCode } from './wallPairingService';
import './wall.css';

/**
 * First-launch pairing screen (plan §4.1). Public route: the only screen a
 * signed-out wall shows. Pairing must happen in the Home Screen app, because
 * iPadOS keeps its storage (and so its sign-in) separate from Safari's.
 */
const WallPairing: React.FC = () => {
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const standalone = isPWA();
  const navigate = useNavigate();

  const submit = async (code: string) => {
    setBusy(true);
    setError('');
    try {
      await redeemPairingCode(code);
      // AuthContext picks up the display claims and swaps in the wall.
      navigate('/wall', { replace: true });
    } catch (e) {
      setError(pairingErrorMessage(e));
      setDigits('');
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy || digits.length >= 6) return;
    const next = digits + d;
    setDigits(next);
    setError('');
    if (next.length === 6) void submit(next);
  };

  return (
    <div className="wall" style={{ gridTemplateColumns: '1fr' }}>
      <div className="full">
        <div className="ptext">
          <h2>Pair this iPad with your household</h2>
          <p>
            On your phone, open LifeBalance and go to Settings → Wall display → Add a wall display. Enter the 6-digit
            code it shows.
          </p>
          <ol>
            <li className={standalone ? undefined : 'warn'}>
              Open this from the Home Screen icon, not Safari. They keep separate sign-ins.
            </li>
            <li>The code works once and expires after 10 minutes.</li>
          </ol>
        </div>
        <div style={{ display: 'grid', gap: 22, justifyItems: 'center' }}>
          <div className="code" aria-label={`${digits.length} of 6 digits entered`}>
            {Array.from({ length: 6 }, (_, i) => (
              <React.Fragment key={i}>
                {i === 3 && <i />}
                <span className={digits[i] ? 'f' : ''}>{digits[i] ?? ''}</span>
              </React.Fragment>
            ))}
          </div>
          <div className="perr" role="alert">{busy ? 'Pairing…' : error}</div>
          <div className="pad">
            {'123456789'.split('').map(n => (
              <button key={n} type="button" disabled={busy} onClick={() => press(n)}>{n}</button>
            ))}
            <button type="button" className="k2" disabled={busy} onClick={() => setDigits('')}>Clear</button>
            <button type="button" disabled={busy} onClick={() => press('0')}>0</button>
            <button type="button" className="k2" disabled={busy} onClick={() => setDigits(s => s.slice(0, -1))}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WallPairing;
