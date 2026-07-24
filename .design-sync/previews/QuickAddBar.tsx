import { QuickAddBar, SurfaceList, Row } from 'lifebalance';

const item: React.CSSProperties = { fontSize: 14, color: 'var(--color-brand-800, #332f2a)' };

export const Standalone = () => (
  <div style={{ width: 340 }}>
    <QuickAddBar
      value=""
      onChange={() => {}}
      onSubmit={(e) => e.preventDefault()}
      placeholder="Add a to-do…"
      submitLabel="Add to-do"
    />
  </div>
);

export const WithValue = () => (
  <div style={{ width: 340 }}>
    <QuickAddBar
      value="Book the dog sitter"
      onChange={() => {}}
      onSubmit={(e) => e.preventDefault()}
      placeholder="Add a to-do…"
      submitLabel="Add to-do"
    />
  </div>
);

export const AttachedToList = () => (
  <div style={{ width: 340 }}>
    <SurfaceList>
      <QuickAddBar
        attached
        value=""
        onChange={() => {}}
        onSubmit={(e) => e.preventDefault()}
        placeholder="Add an item…"
        submitLabel="Add item"
      />
      <Row><span style={item}>Oat milk</span></Row>
      <Row><span style={item}>Sourdough loaf</span></Row>
    </SurfaceList>
  </div>
);
