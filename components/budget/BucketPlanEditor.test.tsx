import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BucketPlanEditor from './BucketPlanEditor';
import { type BudgetBucket } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';

// Only `useFormatCurrency` → `useHouseholdCore` is reached from this component.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ householdSettings: { currency: 'USD' } }),
}));

const bucket = (id: string, name: string, limit: number): BudgetBucket => ({
  id,
  name,
  limit,
  color: 'green',
  isVariable: true,
  isCore: false,
});

const spentMap = (entries: Record<string, BucketSpent>): Map<string, BucketSpent> =>
  new Map(Object.entries(entries));

/**
 * The editor is CONTROLLED — the parent owns the drafts (that split is the
 * whole point of the extraction), so every test drives it through a parent
 * that actually holds the state, exactly as both real consumers do.
 */
const Harness: React.FC<{
  buckets: BudgetBucket[];
  available: number;
  initial?: Record<string, string>;
  bucketSpentMap?: Map<string, BucketSpent>;
  suggestions?: Map<string, number>;
}> = ({ buckets, available, initial, bucketSpentMap, suggestions }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>(
    initial ?? Object.fromEntries(buckets.map(b => [b.id, String(b.limit)])),
  );
  return (
    <BucketPlanEditor
      buckets={buckets}
      drafts={drafts}
      onDraftsChange={setDrafts}
      bucketSpentMap={bucketSpentMap ?? new Map()}
      available={available}
      suggestions={suggestions}
    />
  );
};

const meter = () => screen.getByTestId('bucket-plan-meter');

describe('BucketPlanEditor fit meter', () => {
  it('reads as fitting when the plan claims less than the available cash', () => {
    render(<Harness buckets={[bucket('b1', 'Groceries', 300)]} available={500} />);

    expect(meter()).toHaveTextContent('$200.00 left unplanned');
    expect(meter()).not.toHaveTextContent('Short by');
  });

  it('reads as SHORT when the plan claims more than the available cash', () => {
    render(<Harness buckets={[bucket('b1', 'Groceries', 423.76)]} available={356.22} />);

    expect(meter()).toHaveTextContent('Short by $67.54');
    expect(meter()).not.toHaveTextContent('left unplanned');
  });

  it('shows the claimed total against the available cash', () => {
    render(
      <Harness
        buckets={[bucket('b1', 'Groceries', 300), bucket('b2', 'Gas', 120)]}
        available={500}
      />,
    );

    expect(meter()).toHaveTextContent('$420.00 of $500.00');
  });

  it('subtracts a bucket’s spend from what it claims', () => {
    render(
      <Harness
        buckets={[bucket('b1', 'Groceries', 400)]}
        available={300}
        bucketSpentMap={spentMap({ b1: { verified: 150, pending: 25 } })}
      />,
    );

    // 400 − 175 = 225 claimed against 300 → fits with $75 spare, even though
    // the raw $400 limit alone would have read as short.
    expect(meter()).toHaveTextContent('$225.00 of $300.00');
    expect(meter()).toHaveTextContent('$75.00 left unplanned');
  });

  it('flips the verdict from fits to short as a limit is typed', async () => {
    const user = userEvent.setup();
    render(<Harness buckets={[bucket('b1', 'Groceries', 100)]} available={356.22} />);

    expect(meter()).toHaveTextContent('$256.22 left unplanned');

    const field = screen.getByLabelText('Groceries budget for this period');
    await user.clear(field);
    await user.type(field, '500');

    expect(meter()).toHaveTextContent('Short by $143.78');
    expect(meter()).not.toHaveTextContent('left unplanned');
  });

  it('flips the verdict from short back to fits as a limit is trimmed', async () => {
    const user = userEvent.setup();
    render(<Harness buckets={[bucket('b1', 'Groceries', 500)]} available={356.22} />);

    expect(meter()).toHaveTextContent('Short by $143.78');

    const field = screen.getByLabelText('Groceries budget for this period');
    await user.clear(field);
    await user.type(field, '200');

    expect(meter()).toHaveTextContent('$156.22 left unplanned');
  });

  it('leaves every control enabled while short — the meter warns, it does not gate', () => {
    render(
      <Harness
        buckets={[bucket('b1', 'Groceries', 900)]}
        available={100}
        suggestions={new Map([['b1', 50]])}
      />,
    );

    expect(meter()).toHaveTextContent('Short by $800.00');
    const buttons = screen.getAllByRole('button');
    // Positive control: the affordances this asserts about actually exist.
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach(button => expect(button).toBeEnabled());
    expect(screen.getByLabelText('Groceries budget for this period')).toBeEnabled();
  });

  it('measures the last valid plan (not $0) while a field holds unparseable text', async () => {
    const user = userEvent.setup();
    render(<Harness buckets={[bucket('b1', 'Groceries', 400)]} available={100} />);

    const field = screen.getByLabelText('Groceries budget for this period');
    await user.clear(field);

    // Emptying the field must not flatter the plan into "fits".
    expect(meter()).toHaveTextContent('Short by $300.00');
  });

  it('reports fully planned when the plan claims exactly the available cash', () => {
    render(<Harness buckets={[bucket('b1', 'Groceries', 356.22)]} available={356.22} />);

    expect(meter()).toHaveTextContent('Fully planned');
    expect(meter()).not.toHaveTextContent('Short by');
  });
});

describe('BucketPlanEditor editing behaviour', () => {
  it('applies a per-bucket suggestion when its chip is tapped', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        buckets={[bucket('b1', 'Groceries', 100)]}
        available={1000}
        suggestions={new Map([['b1', 245]])}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Suggested: \$245/ }));

    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(245);
    expect(meter()).toHaveTextContent('$245.00 of $1,000.00');
  });

  it('applies every suggestion at once, then restores the saved limits', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        buckets={[bucket('b1', 'Groceries', 100), bucket('b2', 'Gas', 60)]}
        available={1000}
        suggestions={
          new Map([
            ['b1', 245],
            ['b2', 80],
          ])
        }
      />,
    );

    // "Reset to last" only appears once something has changed.
    expect(screen.queryByRole('button', { name: /Reset to last/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Use suggestions/ }));
    expect(meter()).toHaveTextContent('$325.00 of $1,000.00');

    await user.click(screen.getByRole('button', { name: /Reset to last/ }));
    expect(meter()).toHaveTextContent('$160.00 of $1,000.00');
    expect(screen.queryByRole('button', { name: /Reset to last/ })).toBeNull();
  });

  it('renders no suggestion affordances at all when no suggestions are supplied', () => {
    render(<Harness buckets={[bucket('b1', 'Groceries', 100)]} available={1000} />);

    expect(screen.queryByRole('button', { name: /Use suggestions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Suggested:/ })).toBeNull();
  });

  it('falls back to a bucket’s saved limit when it has no draft yet (added after mount)', () => {
    render(
      <Harness
        buckets={[bucket('b1', 'Groceries', 100), bucket('late', 'Newly added', 75)]}
        available={1000}
        // `late` deliberately absent from the initial drafts.
        initial={{ b1: '100' }}
      />,
    );

    expect(screen.getByLabelText('Newly added budget for this period')).toHaveValue(75);
    expect(meter()).toHaveTextContent('$175.00 of $1,000.00');
  });
});
