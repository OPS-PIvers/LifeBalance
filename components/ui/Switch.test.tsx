import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Switch from './Switch';

describe('Switch', () => {
  it('renders correctly', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('renders checked state', () => {
    render(<Switch checked={true} onCheckedChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('calls onCheckedChange when clicked', () => {
    const handleChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={handleChange} />);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('does not call onCheckedChange when disabled', () => {
    const handleChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={handleChange} disabled />);

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();

    fireEvent.click(checkbox);

    expect(handleChange).not.toHaveBeenCalled();
  });

  it('applies custom className', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} className="custom-class" />);
    const label = screen.getByRole('checkbox').parentElement;
    expect(label).toHaveClass('custom-class');
  });

  it('is accessible by aria-label when no visible label is present', () => {
    render(
      <Switch
        checked={false}
        onCheckedChange={() => {}}
        aria-label="Enable notifications"
      />
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Enable notifications' });
    expect(checkbox).toBeInTheDocument();
  });

  it('uses the evergreen accent checked-track by default', () => {
    const { container } = render(<Switch checked onCheckedChange={() => {}} />);
    const track = container.querySelector('input + div');
    expect(track?.className).toContain('peer-checked:bg-accent-600');
    expect(track?.className).not.toContain('peer-checked:bg-warm-500');
  });

  it('uses the warm checked-track for tone="warm"', () => {
    const { container } = render(<Switch checked onCheckedChange={() => {}} tone="warm" />);
    const track = container.querySelector('input + div');
    expect(track?.className).toContain('peer-checked:bg-warm-500');
    expect(track?.className).not.toContain('peer-checked:bg-accent-600');
  });

  it('positions the knob against the track', () => {
    const { container } = render(<Switch checked={false} onCheckedChange={() => {}} />);
    const track = container.querySelector('input + div');
    const label = screen.getByRole('checkbox').parentElement;
    expect(track?.className).toContain('relative');
    expect(label?.className).not.toContain('py-2.5');
  });

  it('has a fixed 44px touch target that self-centers', () => {
    const label = (() => {
      render(<Switch checked={false} onCheckedChange={() => {}} />);
      return screen.getByRole('checkbox').parentElement;
    })();
    expect(label?.className).toContain('h-11');
    expect(label?.className).toContain('w-11');
    expect(label?.className).toContain('self-center');
  });

  it('caller alignment override replaces the default self-center', () => {
    // In a COLUMN stack (SubscriptionsView's amount-over-toggle column) the
    // default self-center acts horizontally and centers the toggle under its
    // amount text, so call sites pass self-end — cn's tailwind-merge must
    // drop self-center in favor of it or the override silently loses.
    render(<Switch checked={false} onCheckedChange={() => {}} className="self-end" />);
    const label = screen.getByRole('checkbox').parentElement;
    expect(label?.className).toContain('self-end');
    expect(label?.className).not.toContain('self-center');
  });

  it('track is not itself a peer', () => {
    const { container } = render(<Switch checked={false} onCheckedChange={() => {}} />);
    const track = container.querySelector('input + div');
    const classes = track?.className.split(/\s+/) ?? [];
    expect(classes).not.toContain('peer');
  });

  it('knob transition is scoped', () => {
    const { container } = render(<Switch checked={false} onCheckedChange={() => {}} />);
    const track = container.querySelector('input + div');
    expect(track?.className).not.toContain('after:transition-all');
  });

  it('track is decorative', () => {
    const { container } = render(<Switch checked={false} onCheckedChange={() => {}} />);
    const track = container.querySelector('input + div');
    expect(track).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks the input as a WebKit switch so user taps fire the iOS system haptic', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('switch');
  });
});
