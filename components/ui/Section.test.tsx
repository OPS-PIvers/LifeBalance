import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Section, SurfaceList, Row, DisclosureRow, StatGroup, Stat } from './Section';

describe('Section', () => {
  it('renders children', () => {
    render(
      <Section>
        <div>Section content</div>
      </Section>
    );
    expect(screen.getByText('Section content')).toBeInTheDocument();
  });

  it('renders a title and action when provided', () => {
    render(
      <Section title="My section" action={<button>Edit</button>}>
        <div>Content</div>
      </Section>
    );
    expect(screen.getByText('My section')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('omits the header row when no title or action is given', () => {
    const { container } = render(
      <Section>
        <div>Content</div>
      </Section>
    );
    expect(container.querySelector('h2')).not.toBeInTheDocument();
  });
});

describe('SurfaceList / Row', () => {
  it('renders rows inside a surface with hairline-divider suppression on the first child', () => {
    const { container } = render(
      <SurfaceList>
        <Row>Row one</Row>
        <Row>Row two</Row>
      </SurfaceList>
    );
    const surface = container.firstElementChild;
    expect(surface).toHaveClass('surface-section');
    expect(surface).toHaveClass('[&>*:first-child]:border-t-0');
    expect(screen.getByText('Row one')).toBeInTheDocument();
    expect(screen.getByText('Row two')).toBeInTheDocument();
  });

  it('applies interactive and dense styles to Row', () => {
    render(
      <SurfaceList>
        <Row interactive dense data-testid="row">
          Interactive row
        </Row>
      </SurfaceList>
    );
    const row = screen.getByTestId('row');
    expect(row).toHaveClass('cursor-pointer');
    expect(row).toHaveClass('py-2.5');
  });
});

describe('DisclosureRow', () => {
  it('renders a real button with title, subtitle, value, and icon', () => {
    render(
      <SurfaceList>
        <DisclosureRow
          icon={<span data-testid="icon">icon</span>}
          title="Notifications"
          subtitle="Push and email"
          value="On"
          onClick={() => {}}
        />
      </SurfaceList>
    );
    const button = screen.getByRole('button', { name: /Notifications/i });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Push and email')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<DisclosureRow title="Row title" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Row title' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('carries the hairline-divider class at the top level of the button', () => {
    render(<DisclosureRow title="Row title" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Row title' })).toHaveClass('hairline-divider');
  });

  it('supports a disabled state that blocks interaction', () => {
    const onClick = vi.fn();
    render(<DisclosureRow title="Disabled row" onClick={onClick} disabled />);
    const button = screen.getByRole('button', { name: 'Disabled row' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies destructive title/icon treatment', () => {
    render(
      <DisclosureRow
        icon={<span data-testid="icon">icon</span>}
        title="Delete household"
        destructive
        onClick={() => {}}
      />
    );
    expect(screen.getByText('Delete household')).toHaveClass('text-money-neg');
    expect(screen.getByTestId('icon').parentElement).toHaveClass('text-money-neg');
  });
});

describe('StatGroup / Stat', () => {
  it('renders label and value typography for each Stat', () => {
    render(
      <StatGroup>
        <Stat label="Daily" value="120" />
        <Stat label="Weekly" value="840" />
      </StatGroup>
    );
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('840')).toBeInTheDocument();
  });

  it('applies tabular-nums typography to the value and muted styling to the label', () => {
    render(<Stat label="Total" value="1,024" />);
    expect(screen.getByText('1,024')).toHaveClass('font-mono', 'tabular-nums', 'text-lg', 'font-semibold');
    expect(screen.getByText('Total')).toHaveClass('text-xs', 'text-brand-500');
  });

  it('allows overriding value styling via valueClassName', () => {
    render(<Stat label="Net" value="-40" valueClassName="text-money-neg" />);
    expect(screen.getByText('-40')).toHaveClass('text-money-neg');
  });

  it('renders StatGroup with no background/border, just a flex row', () => {
    const { container } = render(
      <StatGroup>
        <Stat label="A" value="1" />
      </StatGroup>
    );
    const group = container.firstElementChild;
    expect(group).toHaveClass('flex', 'flex-wrap', 'justify-between');
    expect(group).not.toHaveClass('border');
    expect(group).not.toHaveClass('bg-white');
  });
});
