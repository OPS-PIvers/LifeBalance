import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('renders the title and hides children by default', () => {
    render(
      <CollapsibleSection title="Manage rewards">
        <div>Hidden content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Manage rewards')).toBeInTheDocument();
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage rewards/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('expands on click: children appear and aria-expanded flips', () => {
    render(
      <CollapsibleSection title="More details">
        <div>Now visible</div>
      </CollapsibleSection>
    );
    const toggle = screen.getByRole('button', { name: /More details/i });
    expect(toggle).toHaveAttribute('type', 'button');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Now visible')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Now visible')).not.toBeInTheDocument();
  });

  it('points aria-controls at the content container id', () => {
    render(
      <CollapsibleSection title="Section" defaultOpen>
        <div>Content</div>
      </CollapsibleSection>
    );
    const toggle = screen.getByRole('button', { name: /Section/i });
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    const content = document.getElementById(controlsId as string);
    expect(content).not.toBeNull();
    expect(content).toHaveTextContent('Content');
  });

  it('respects defaultOpen', () => {
    render(
      <CollapsibleSection title="Open by default" defaultOpen>
        <div>Visible content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Visible content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open by default/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('shows the summary only while collapsed', () => {
    render(
      <CollapsibleSection title="Rewards" summary="4">
        <div>List</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Rewards/i }));
    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('renders an optional subtitle under the title', () => {
    render(
      <CollapsibleSection title="Add details" subtitle="Store, account, habits & recurring">
        <div>Fields</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Store, account, habits & recurring')).toBeInTheDocument();
  });

  it('supports controlled mode: defers to `open` and reports via onOpenChange', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CollapsibleSection title="Controlled" open={false} onOpenChange={onOpenChange}>
        <div>Controlled content</div>
      </CollapsibleSection>
    );
    const toggle = screen.getByRole('button', { name: /Controlled/i });
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Still closed — parent owns the state.
    expect(screen.queryByText('Controlled content')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <CollapsibleSection title="Controlled" open onOpenChange={onOpenChange}>
        <div>Controlled content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Controlled content')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('works end-to-end when a parent wires controlled state', () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <CollapsibleSection title="Wired" open={open} onOpenChange={setOpen}>
          <div>Wired content</div>
        </CollapsibleSection>
      );
    };
    render(<Harness />);
    expect(screen.queryByText('Wired content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Wired/i }));
    expect(screen.getByText('Wired content')).toBeInTheDocument();
  });

  it('renders the action slot outside the toggle so clicking it does not toggle', () => {
    const onAdd = vi.fn();
    render(
      <CollapsibleSection
        title="Manage rewards"
        action={
          <button type="button" onClick={onAdd}>
            Add reward
          </button>
        }
      >
        <div>Reward list</div>
      </CollapsibleSection>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add reward' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    // Section stayed collapsed.
    expect(screen.queryByText('Reward list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage rewards/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });
});
