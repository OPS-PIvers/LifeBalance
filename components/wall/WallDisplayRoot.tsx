import React, { useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { setWallDevice } from '@/utils/wall/wallDevice';
import WallFirestoreProvider from './data/WallFirestoreProvider';
import WallApp from './WallApp';

/**
 * The whole app for a paired display (plan §4.2): only the wall, on the
 * display-safe data provider. Revoked → signed out → back to pairing.
 */
const WallDisplayRoot: React.FC = () => {
  const { signOut } = useAuth();
  const leaving = useRef(false);

  // Revoked on the phone: sign out but keep the wall-device flag, so the
  // signed-out launch shows the pairing screen again.
  const onRevoked = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    window.location.hash = '#/wall/pair';
    void signOut();
  }, [signOut]);

  // Unpaired from the gear menu: this iPad stops being a wall.
  const onUnpair = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setWallDevice(false);
    window.location.hash = '#/login';
    void signOut();
  }, [signOut]);

  return (
    <WallFirestoreProvider onRevoked={onRevoked}>
      <WallApp onLeave={onUnpair} />
    </WallFirestoreProvider>
  );
};

export default WallDisplayRoot;
