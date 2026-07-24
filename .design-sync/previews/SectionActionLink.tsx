// SectionActionLink renders a router <Link>, so it needs a Router in context.
// AppProviders (exported from the bundle) supplies one — wrap it the same way
// in a design, or wrap the whole design once.
import { AppProviders, Section, SectionActionLink, SurfaceList, Row } from 'lifebalance';

const name: React.CSSProperties = { fontSize: 14, color: 'var(--color-brand-800, #332f2a)' };
const due: React.CSSProperties = {
  marginLeft: 'auto', fontSize: 13, color: 'var(--color-brand-500, #857e6f)',
};

export const ViewAll = () => (
  <AppProviders>
    <div style={{ width: 360 }}>
      <Section title="Upcoming bills" action={<SectionActionLink to="/budget">View all</SectionActionLink>}>
        <SurfaceList>
          <Row><span style={name}>Rent</span><span style={due}>Aug 1</span></Row>
          <Row><span style={name}>Xcel Energy</span><span style={due}>Aug 4</span></Row>
        </SurfaceList>
      </Section>
    </div>
  </AppProviders>
);

export const Details = () => (
  <AppProviders>
    <div style={{ width: 360 }}>
      <Section
        title="Habits"
        action={<SectionActionLink to="/habits" state={{ tab: 'progress' }}>Details</SectionActionLink>}
      >
        <SurfaceList>
          <Row><span style={name}>Make your bed</span><span style={due}>12-day streak</span></Row>
        </SurfaceList>
      </Section>
    </div>
  </AppProviders>
);
