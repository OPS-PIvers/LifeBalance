import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InlineMerchantRename, { looksLikeBankDescriptor } from '@/components/transactions/InlineMerchantRename';
import type { MerchantRule } from '@/types/schema';

const addRule = vi.fn<(draft: { pattern: string; name?: string }) => Promise<void>>();
let storedRules: MerchantRule[] = [];

vi.mock('@/hooks/useMerchantRules', () => ({
  useMerchantRules: () => ({
    rules: storedRules,
    addRule,
    saving: false,
    ruleFor: ({ merchant }: { merchant: string }) =>
      storedRules.find(r => merchant.toUpperCase().includes(r.pattern.toUpperCase())) ?? null,
    displayNameFor: ({ merchant }: { merchant: string }) => merchant,
    searchTermsFor: ({ merchant }: { merchant: string }) => [merchant],
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
  }),
}));

beforeEach(() => {
  addRule.mockReset();
  addRule.mockResolvedValue(undefined);
  storedRules = [];
});

describe('looksLikeBankDescriptor', () => {
  it.each([
    ['AMERICAN EXPRESS ACH PMT', true, 'all-caps with no trailing noise'],
    ['AMEX ACH PAYMENT', true, 'the motivating example'],
    ['APPLE.COM/BILL 866-712-7753 CA', true, 'all-caps with digits'],
    ['sq *blue bottle', true, 'lowercase but carries a * marker'],
    ['7-Eleven 22371', true, 'mixed case with digits'],
    ['Target', false, 'a name someone typed'],
    ["Trader Joe's", false, 'apostrophes are not descriptor markers'],
    ['Coffee', false, 'a hand-entered merchant'],
    ['', false, 'blank'],
    ['A', false, 'too short to judge'],
  ])('%s → %s (%s)', (merchant, expected) => {
    expect(looksLikeBankDescriptor(merchant)).toBe(expected);
  });
});

describe('InlineMerchantRename', () => {
  const OFFER = 'Always call this something else';

  it('offers a rename for a raw bank descriptor', () => {
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" amount={412.5} />);
    expect(screen.getByRole('button', { name: OFFER })).toBeInTheDocument();
  });

  it('renders nothing for a merchant a person typed', () => {
    const { container } = render(<InlineMerchantRename merchant="Trader Joe's" amount={22} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('retires once a rule already names the row', () => {
    // The end state this control exists to reach — the host form's "Your bank
    // calls this …" caption takes over from here.
    storedRules = [
      { id: 'r1', pattern: 'AMEX', name: 'AmEx payment', createdAt: '2026-07-01T00:00:00.000Z' },
    ];
    const { container } = render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" amount={412.5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still offers a rename when the matching rule only sets a category', () => {
    // A category-only rule leaves the descriptor unnamed, so the row is still
    // showing raw bank text and the offer must stand.
    storedRules = [
      { id: 'r1', pattern: 'AMEX', category: 'Bills', createdAt: '2026-07-01T00:00:00.000Z' },
    ];
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" amount={412.5} />);
    expect(screen.getByRole('button', { name: OFFER })).toBeInTheDocument();
  });

  it('saves a name-only rule against the seeded pattern, not the whole descriptor', async () => {
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="APPLE.COM/BILL 866-712-7753 CA" amount={2.99} />);

    await user.click(screen.getByRole('button', { name: OFFER }));
    await user.type(screen.getByLabelText('Show this merchant as'), 'iCloud storage');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => expect(addRule).toHaveBeenCalledTimes(1));
    // Trailing phone number and state code stripped — a pattern pinned to this
    // one charge's reference digits would never match next month's.
    expect(addRule).toHaveBeenCalledWith({ pattern: 'APPLE.COM/BILL', name: 'iCloud storage' });
  });

  it('shows the pattern it will match on, so the scope is never a surprise', async () => {
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="APPLE.COM/BILL 866-712-7753 CA" amount={2.99} />);
    await user.click(screen.getByRole('button', { name: OFFER }));
    expect(screen.getByText('APPLE.COM/BILL')).toBeInTheDocument();
  });

  it('refuses a blank name without writing', async () => {
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" amount={412.5} />);

    await user.click(screen.getByRole('button', { name: OFFER }));
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(addRule).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the name you want to see instead.')).toBeInTheDocument();
  });

  it('keeps the typed name when the write fails, so a retry starts where they left off', async () => {
    const user = userEvent.setup();
    addRule.mockRejectedValue(new Error('offline'));
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" amount={412.5} />);

    await user.click(screen.getByRole('button', { name: OFFER }));
    const field = screen.getByLabelText('Show this merchant as');
    await user.type(field, 'AmEx payment');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => expect(screen.getByText("That didn't save. Try again.")).toBeInTheDocument());
    expect(screen.getByLabelText('Show this merchant as')).toHaveValue('AmEx payment');
  });

  it('closes without writing on cancel', async () => {
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" amount={412.5} />);

    await user.click(screen.getByRole('button', { name: OFFER }));
    await user.type(screen.getByLabelText('Show this merchant as'), 'AmEx payment');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(addRule).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: OFFER })).toBeInTheDocument();
  });

  it('does not offer a rename while the host form is saving', () => {
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" amount={412.5} disabled />);
    expect(screen.getByRole('button', { name: OFFER })).toBeDisabled();
  });
});
