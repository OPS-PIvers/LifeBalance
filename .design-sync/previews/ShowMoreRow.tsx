import { ShowMoreRow, SurfaceList, Row } from 'lifebalance';

const habit: React.CSSProperties = { fontSize: 14, color: 'var(--color-brand-800, #332f2a)' };
const pts: React.CSSProperties = {
  marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13,
  color: 'var(--color-brand-500, #857e6f)',
};

export const Collapsed = () => (
  <div style={{ width: 340 }}>
    <SurfaceList>
      <Row><span style={habit}>Make your bed</span><span style={pts}>+10</span></Row>
      <Row><span style={habit}>Read 30 minutes</span><span style={pts}>+25</span></Row>
      <Row><span style={habit}>Walk the dog</span><span style={pts}>+15</span></Row>
      <ShowMoreRow hiddenCount={4} expanded={false} onToggle={() => {}} noun="habit" />
    </SurfaceList>
  </div>
);

export const Expanded = () => (
  <div style={{ width: 340 }}>
    <SurfaceList>
      <Row><span style={habit}>Make your bed</span><span style={pts}>+10</span></Row>
      <Row><span style={habit}>Read 30 minutes</span><span style={pts}>+25</span></Row>
      <ShowMoreRow hiddenCount={0} expanded onToggle={() => {}} noun="habit" />
    </SurfaceList>
  </div>
);

export const SingleHidden = () => (
  <div style={{ width: 340 }}>
    <SurfaceList>
      <Row><span style={habit}>Oat milk</span></Row>
      <ShowMoreRow hiddenCount={1} expanded={false} onToggle={() => {}} noun="item" />
    </SurfaceList>
  </div>
);
