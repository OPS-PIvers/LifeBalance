import React from 'react';
import { useNavigate } from 'react-router-dom';
import WallSlicesProvider from './data/WallSlicesProvider';
import WallApp from './WallApp';

/** #/wall for a signed-in member: preview, a spare iPad, Test Mode (plan §4.2). */
const WallMemberRoot: React.FC = () => {
  const navigate = useNavigate();
  return (
    <WallSlicesProvider>
      <WallApp onLeave={() => navigate('/')} />
    </WallSlicesProvider>
  );
};

export default WallMemberRoot;
