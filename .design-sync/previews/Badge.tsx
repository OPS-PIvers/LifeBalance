import { Badge } from 'lifebalance';

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };

export const Variants = () => (
  <div style={row}>
    <Badge variant="default">On track</Badge>
    <Badge variant="success">Paid</Badge>
    <Badge variant="warning">Due soon</Badge>
    <Badge variant="danger">Overdue</Badge>
    <Badge variant="neutral">Pending</Badge>
    <Badge variant="outline">Draft</Badge>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Badge variant="success" size="md">7-day streak</Badge>
    <Badge variant="default" size="sm">+15 pts</Badge>
  </div>
);
