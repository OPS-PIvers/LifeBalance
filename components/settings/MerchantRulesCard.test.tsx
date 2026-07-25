import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MerchantRulesCard from './MerchantRulesCard';
import { MAX_MERCHANT_RULES, type BudgetBucket, type CalendarItem, type MerchantRule } from '@/types/schema';

const { mockAddRule, mockUpdateRule, mockDeleteRule } = vi.hoisted(() => ({
  mockAddRule: vi.fn(),
  mockUpdateRule: vi.fn(),
  mockDeleteRule: vi.fn(),
}));

let mockRules: MerchantRule[] = [];
let mockSaving = false;
let mockBuckets: BudgetBucket[] = [];
let mockCalendarItems: CalendarItem[] = [];

vi.mock('@/hooks/useMerchantRules', () => ({
  useMerchantRules: () => ({
    rules: mockRules,
    saving: mockSaving,
    addRule: mockAddRule,
    updateRule: mockUpdateRule,
    deleteRule: mockDeleteRule,
    displayNameFor: (row: { merchant: string }) => row.merchant,
    ruleFor: () => null,
    searchTermsFor: (row: { merchant: string }) => [row.merchant],
  }),
}));

// The card reads buckets/calendar items directly, and `useFormatCurrency`
// (a real hook, deliberately not mocked) reads the household currency — so the
// factory must export BOTH slices the component tree reaches.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    get buckets() {
      return mockBuckets;
    },
    get calendarItems() {
      return mockCalendarItems;
    },
  }),
  useHouseholdCore: () => ({ householdSettings: { currency: 'USD' } }),
}));

function makeRule(overrides: Partial<MerchantRule> & { pattern: string }): MerchantRule {
  return {
    id: overrides.id ?? `rule-${overrides.pattern}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBill(id: string, title: string): CalendarItem {
  return { id, title, amount: 90, date: '2026-07-01', type: 'expense', isPaid: false };
}

describe('MerchantRulesCard', () => {
  beforeEach(() => {
    mockAddRule.mockReset().mockResolvedValue(undefined);
    mockUpdateRule.mockReset().mockResolvedValue(undefined);
    mockDeleteRule.mockReset().mockResolvedValue(undefined);
    mockRules = [];
    mockSaving = false;
    mockBuckets = [
      { id: 'b1', name: 'Subscriptions', limit: 50, color: 'evergreen', isVariable: false, isCore: true },
    ];
    mockCalendarItems = [makeBill('bill-1', 'Electric Bill')];
  });

  it('shows an empty state with a create affordance when no rules exist', () => {
    render(<MerchantRulesCard />);

    expect(screen.getByText('No merchant rules yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a rule' })).toBeInTheDocument();
  });

  it('renders the friendly name over the raw pattern, plus every action the rule performs', () => {
    mockRules = [
      makeRule({
        id: 'apple',
        pattern: 'APPLE.COM/BILL',
        amount: 2.99,
        name: 'Apple',
        category: 'Subscriptions',
        billId: 'bill-1',
        exempt: true,
        matchCount: 14,
        lastMatchedAt: '2026-07-22T12:00:00.000Z',
      }),
    ];
    render(<MerchantRulesCard />);

    const row = screen.getByRole('button', { name: 'Edit merchant rule Apple' });
    expect(within(row).getByText('Apple')).toBeInTheDocument();
    expect(within(row).getByText(/APPLE\.COM\/BILL/)).toBeInTheDocument();
    expect(within(row).getByText(/\$2\.99/)).toBeInTheDocument();
    expect(within(row).getByText('Renames')).toBeInTheDocument();
    expect(within(row).getByText('Subscriptions')).toBeInTheDocument();
    expect(within(row).getByText('Electric Bill')).toBeInTheDocument();
    expect(within(row).getByText('No-spend exempt')).toBeInTheDocument();
    expect(within(row).getByText('Matched 14 times · last on Jul 22')).toBeInTheDocument();
  });

  it('falls back to the pattern as the headline for a rule that only classifies', () => {
    mockRules = [makeRule({ id: 'ach', pattern: 'AMERICAN EXPRESS ACH PMT', category: 'Subscriptions' })];
    render(<MerchantRulesCard />);

    const row = screen.getByRole('button', { name: 'Edit merchant rule AMERICAN EXPRESS ACH PMT' });
    expect(within(row).queryByText('Renames')).not.toBeInTheDocument();
    expect(within(row).getByText('Subscriptions')).toBeInTheDocument();
  });

  it('flags a rule that has never matched anything', () => {
    mockRules = [makeRule({ id: 'dead', pattern: 'NEVERMATCHES', name: 'Ghost' })];
    render(<MerchantRulesCard />);

    expect(screen.getByText('Has not matched anything yet')).toBeInTheDocument();
  });

  it('singularises a single match', () => {
    mockRules = [makeRule({ id: 'one', pattern: 'NETFLIX', name: 'Netflix', matchCount: 1 })];
    render(<MerchantRulesCard />);

    expect(screen.getByText('Matched 1 time')).toBeInTheDocument();
  });

  it('calls out a rule that performs no action at all', () => {
    mockRules = [makeRule({ id: 'noop', pattern: 'APPLE.COM' })];
    render(<MerchantRulesCard />);

    expect(screen.getByText('Does nothing yet')).toBeInTheDocument();
  });

  it('hides the cap count until the household is close to the limit', () => {
    mockRules = [makeRule({ id: 'a', pattern: 'A' })];
    const { unmount } = render(<MerchantRulesCard />);
    expect(screen.queryByText(new RegExp(`of ${MAX_MERCHANT_RULES} rules used`))).not.toBeInTheDocument();
    unmount();

    mockRules = Array.from({ length: MAX_MERCHANT_RULES }, (_, i) =>
      makeRule({ id: `r${i}`, pattern: `P${i}` })
    );
    render(<MerchantRulesCard />);
    expect(
      screen.getByText(`${MAX_MERCHANT_RULES} of ${MAX_MERCHANT_RULES} rules used — delete one to add another.`)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New rule' })).toBeDisabled();
  });

  it('creates a rule through the form sheet', async () => {
    const user = userEvent.setup();
    render(<MerchantRulesCard />);

    await user.click(screen.getByRole('button', { name: 'New rule' }));
    expect(await screen.findByText('New merchant rule')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Bank description contains' }), 'NETFLIX');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(mockAddRule).toHaveBeenCalledWith({ pattern: 'NETFLIX' }));
    expect(mockUpdateRule).not.toHaveBeenCalled();
  });

  it('edits the rule whose row was tapped', async () => {
    const user = userEvent.setup();
    mockRules = [makeRule({ id: 'apple', pattern: 'APPLE.COM', name: 'Apple' })];
    render(<MerchantRulesCard />);

    await user.click(screen.getByRole('button', { name: 'Edit merchant rule Apple' }));
    expect(await screen.findByText('Edit merchant rule')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Show it as' }), ' Inc');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(mockUpdateRule).toHaveBeenCalledWith('apple', {
        pattern: 'APPLE.COM',
        name: 'Apple Inc',
      })
    );
    expect(mockAddRule).not.toHaveBeenCalled();
  });

  it('deletes the edited rule after confirmation', async () => {
    const user = userEvent.setup();
    mockRules = [makeRule({ id: 'apple', pattern: 'APPLE.COM', name: 'Apple' })];
    render(<MerchantRulesCard />);

    await user.click(screen.getByRole('button', { name: 'Edit merchant rule Apple' }));
    await user.click(await screen.findByRole('button', { name: 'Delete rule' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteRule).toHaveBeenCalledWith('apple'));
  });

  it('keeps the sheet open with the input intact when the write rejects', async () => {
    const user = userEvent.setup();
    // The mutation layer owns the error toast and rejects; the card lets that
    // rejection through so the sheet does not close on a failed save.
    mockAddRule.mockRejectedValue(new Error('offline'));
    render(<MerchantRulesCard />);

    await user.click(screen.getByRole('button', { name: 'New rule' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Bank description contains' }),
      'NETFLIX'
    );
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(mockAddRule).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: 'Bank description contains' })).toHaveValue('NETFLIX');
  });
});
