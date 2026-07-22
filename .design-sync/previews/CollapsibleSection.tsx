import { CollapsibleSection } from 'lifebalance';

const line: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 };

export const Open = () => (
  <div style={{ width: 360 }}>
    <CollapsibleSection title="How is this calculated?" subtitle="Safe-to-Spend breakdown" defaultOpen>
      <div style={line}><span>Checking balance</span><span>$1,284.10</span></div>
      <div style={line}><span>Unpaid bills</span><span>−$620.00</span></div>
      <div style={line}><span>Pending transactions</span><span>−$251.50</span></div>
    </CollapsibleSection>
  </div>
);

export const Collapsed = () => (
  <div style={{ width: 360 }}>
    <CollapsibleSection title="Recently redeemed" summary="3 rewards">
      <div style={line}><span>Movie night</span><span>−500 pts</span></div>
    </CollapsibleSection>
  </div>
);
