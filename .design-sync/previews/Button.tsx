import { Button } from 'lifebalance';

const Svg = ({ children, size = 16 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const Plus = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
const ArrowRight = () => <Svg><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const Trash = () => <Svg size={18}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>;

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' };

export const Variants = () => (
  <div style={row}>
    <Button variant="primary">Add expense</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="subtle">Add bucket</Button>
    <Button variant="success">Approve paycheck</Button>
    <Button variant="outline">Details</Button>
    <Button variant="ghost">Skip</Button>
  </div>
);

export const Destructive = () => (
  <div style={row}>
    <Button variant="destructive">Delete account</Button>
    <Button variant="danger">Delete</Button>
    <Button variant="ghost-danger">Remove</Button>
    <Button variant="warning">Reset streak</Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button size="lg">Large</Button>
    <Button size="md">Medium</Button>
    <Button size="sm">Small</Button>
  </div>
);

export const WithIcons = () => (
  <div style={row}>
    <Button variant="primary" leftIcon={<Plus />}>New habit</Button>
    <Button variant="secondary" rightIcon={<ArrowRight />}>Continue</Button>
    <Button variant="ghost-destructive" size="icon" aria-label="Delete"><Trash /></Button>
    <Button variant="dashed">Add another</Button>
  </div>
);

export const States = () => (
  <div style={row}>
    <Button variant="primary" isLoading>Saving</Button>
    <Button variant="primary" disabled>Disabled</Button>
    <Button variant="link">View all transactions</Button>
  </div>
);
