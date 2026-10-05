import React from 'react';
import { Check, Mic } from 'lucide-react';
import type { VoiceTarget } from '@/utils/wall/wallVoice';
import type { WallVoiceState } from './useWallVoice';
import WallSpotlight from '@/components/wall/WallSpotlight';

interface WallVoiceBannerProps {
  state: WallVoiceState;
  onFinish: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onUndo: () => void;
  onShow: (target: VoiceTarget) => void;
}

const BARS = [0.1, 0.3, 0.5, 0.2, 0.6, 0.35, 0.15, 0.45, 0.25];

/**
 * The voice banner at bottom center (plan §3 "Voice"): Listening → Heard
 * (working) → Result with Undo + Show list, or "Didn't catch that" + Try again.
 * A result or error first opens as the big centered card (plan §12), so
 * whoever spoke from across the room can see it landed, then shrinks here.
 */
const WallVoiceBanner: React.FC<WallVoiceBannerProps> = ({ state, onFinish, onCancel, onRetry, onUndo, onShow }) => {
  if ((state.phase === 'result' || state.phase === 'error') && state.big) {
    const ok = state.phase === 'result';
    const show = ok ? state.show : undefined;
    return (
      <WallSpotlight
        tone={ok ? 'ok' : 'error'}
        icon={ok ? <Check className="wi" size="1em" /> : <Mic className="wi" size="1em" />}
        kicker={ok ? state.title : 'Voice'}
        title={ok ? state.text : state.title}
        label="Voice"
        onClose={onCancel}
        actions={
          ok ? (
            <>
              {state.undo && (
                <button type="button" className="btn" onClick={onUndo}>
                  Undo
                </button>
              )}
              {show && (
                <button type="button" className="btn" onClick={() => onShow(show)}>
                  Show list
                </button>
              )}
            </>
          ) : (
            <>
              {state.retry && (
                <button type="button" className="btn pri" onClick={onRetry}>
                  Try again
                </button>
              )}
              <button type="button" className="btn" onClick={onCancel}>
                Close
              </button>
            </>
          )
        }
      >
        {!ok && <div className="spot-d">{state.text}</div>}
      </WallSpotlight>
    );
  }
  let orb: React.ReactNode;
  let orbClass: string;
  let kicker: string;
  let body: React.ReactNode;
  let actions: React.ReactNode = null;

  if (state.phase === 'listening') {
    orbClass = 'listen';
    orb = <Mic className="wi" size="1em" aria-hidden="true" />;
    kicker = 'Listening';
    body = (
      <>
        <div className="h">{state.interim ? <q>{state.interim}</q> : 'Say a command, like “add milk to the list”'}</div>
        <div className="lv" aria-hidden="true">
          {BARS.map(d => (
            <i key={d} style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
      </>
    );
    actions = (
      <>
        <button type="button" className="btn" onClick={onFinish}>
          Done
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </>
    );
  } else if (state.phase === 'working') {
    orbClass = 'work';
    orb = <span className="spin" aria-hidden="true" />;
    kicker = state.heard ? 'Heard' : 'Working';
    body = <div className="h">{state.heard ? <q>{state.heard}</q> : 'Working out what you said…'}</div>;
  } else if (state.phase === 'result') {
    orbClass = 'ok';
    orb = <Check className="wi" size="1em" aria-hidden="true" />;
    kicker = state.title;
    body = <div className="h">{state.text}</div>;
    const { show } = state;
    actions = (
      <>
        {state.undo && (
          <button type="button" className="btn" onClick={onUndo}>
            Undo
          </button>
        )}
        {show && (
          <button type="button" className="btn" onClick={() => onShow(show)}>
            Show list
          </button>
        )}
      </>
    );
  } else {
    orbClass = 'err';
    orb = <Mic className="wi" size="1em" aria-hidden="true" />;
    kicker = state.title;
    body = <div className="h">{state.text}</div>;
    actions = (
      <>
        {state.retry && (
          <button type="button" className="btn pri" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          Close
        </button>
      </>
    );
  }

  return (
    <div className="vb" role="status" aria-label="Voice">
      <div className={`orb ${orbClass}`}>{orb}</div>
      <div className="mid">
        <div className="k">{kicker}</div>
        {body}
      </div>
      <div className="a">{actions}</div>
    </div>
  );
};

export default WallVoiceBanner;
