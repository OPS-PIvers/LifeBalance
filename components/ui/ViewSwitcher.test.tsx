import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewSwitcher } from '@/components/ui/ViewSwitcher';

type View = 'transactions' | 'trends';

const OPTIONS: { value: View; label: string }[] = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'trends', label: 'Trends' },
];

describe('ViewSwitcher', () => {
  it('renders a select named via `name` with every option', () => {
    render(
      <ViewSwitcher name="Activity view" options={OPTIONS} value="transactions" onChange={() => {}} />
    );
    const select = screen.getByRole('combobox', { name: 'Activity view' });
    expect(select).toHaveValue('transactions');
    expect(screen.getByRole('option', { name: 'Transactions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Trends' })).toBeInTheDocument();
  });

  it('fires onChange with the typed option value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(v: View) => void>();
    render(
      <ViewSwitcher name="Activity view" options={OPTIONS} value="transactions" onChange={onChange} />
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Activity view' }), 'trends');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('trends');
  });

  it('defaults to the accent tone and switches to warm classes via `tone`', () => {
    const { rerender } = render(
      <ViewSwitcher name="View" options={OPTIONS} value="trends" onChange={() => {}} />
    );
    expect(screen.getByRole('combobox')).toHaveClass('text-accent-700');

    rerender(
      <ViewSwitcher name="View" options={OPTIONS} value="trends" onChange={() => {}} tone="warm" />
    );
    expect(screen.getByRole('combobox')).toHaveClass('text-warm-700');
  });

  it('renders nothing when fewer than two options remain (flag-gated lists)', () => {
    const { container } = render(
      <ViewSwitcher
        name="Progress view"
        options={[{ value: 'history', label: 'History' }]}
        value="history"
        onChange={() => {}}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
