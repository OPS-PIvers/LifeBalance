import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InlineMerchantRename from '@/components/transactions/InlineMerchantRename';
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

describe('InlineMerchantRename', () => {
  const OFFER = 'Always call this something else';

  it('offers a rename for a raw bank descriptor', () => {
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} />);
    expect(screen.getByRole('button', { name: OFFER })).toBeInTheDocument();
  });

  it('renders nothing for a merchant a person typed', () => {
    const { container } = render(
      <InlineMerchantRename merchant="Trader Joe's" source="manual" amount={22} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a manual row even when it reads like a descriptor', () => {
    // The gate is provenance, not spelling: the user typed this name, so it is
    // already what they wanted no matter how shouty it looks.
    const { container } = render(
      <InlineMerchantRename merchant="AMEX ACH PAYMENT" source="manual" amount={412.5} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a recurring row generated from a calendar item', () => {
    const { container } = render(
      <InlineMerchantRename merchant="NETFLIX.COM 123" source="recurring" amount={15.49} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a rename for a tidily-spelled machine capture', () => {
    // The bug this gate fixes: the receipt parser title-cases its merchant, so
    // "St. Louis Park" is neither all-caps, digit-bearing nor marked up — the
    // old appearance test never fired on exactly the row it existed for.
    render(<InlineMerchantRename merchant="St. Louis Park" source="image-capture" amount={41.2} />);
    expect(screen.getByRole('button', { name: OFFER })).toBeInTheDocument();
  });

  it('retires once a rule already names the row', () => {
    // The end state this control exists to reach — the host form's "Your bank
    // calls this …" caption takes over from here.
    storedRules = [
      { id: 'r1', pattern: 'AMEX', name: 'AmEx payment', createdAt: '2026-07-01T00:00:00.000Z' },
    ];
    const { container } = render(
      <InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still offers a rename when the matching rule only sets a category', () => {
    // A category-only rule leaves the descriptor unnamed, so the row is still
    // showing raw bank text and the offer must stand.
    storedRules = [
      { id: 'r1', pattern: 'AMEX', category: 'Bills', createdAt: '2026-07-01T00:00:00.000Z' },
    ];
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} />);
    expect(screen.getByRole('button', { name: OFFER })).toBeInTheDocument();
  });

  it('saves a name-only rule against the seeded pattern, not the whole descriptor', async () => {
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="APPLE.COM/BILL 866-712-7753 CA" source="bank-sync" amount={2.99} />);

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
    render(<InlineMerchantRename merchant="APPLE.COM/BILL 866-712-7753 CA" source="bank-sync" amount={2.99} />);
    await user.click(screen.getByRole('button', { name: OFFER }));
    expect(screen.getByText('APPLE.COM/BILL')).toBeInTheDocument();
  });

  it('refuses a blank name without writing', async () => {
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} />);

    await user.click(screen.getByRole('button', { name: OFFER }));
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(addRule).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the name you want to see instead.')).toBeInTheDocument();
  });

  it('keeps the typed name when the write fails, so a retry starts where they left off', async () => {
    const user = userEvent.setup();
    addRule.mockRejectedValue(new Error('offline'));
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} />);

    await user.click(screen.getByRole('button', { name: OFFER }));
    const field = screen.getByLabelText('Show this merchant as');
    await user.type(field, 'AmEx payment');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => expect(screen.getByText("That didn't save. Try again.")).toBeInTheDocument());
    expect(screen.getByLabelText('Show this merchant as')).toHaveValue('AmEx payment');
  });

  it('moves focus to the field when the panel opens', async () => {
    // The Drawer's `data-autofocus` convention does not reach this panel — the
    // sheet is already open by the time it expands — so the focus move is ours
    // to make. Without it a keyboard user has to hunt for the field they asked
    // for.
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} />);

    await user.click(screen.getByRole('button', { name: OFFER }));

    await waitFor(() =>
      expect(screen.getByLabelText('Show this merchant as')).toHaveFocus(),
    );
  });

  it('closes without writing on cancel', async () => {
    const user = userEvent.setup();
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} />);

    await user.click(screen.getByRole('button', { name: OFFER }));
    await user.type(screen.getByLabelText('Show this merchant as'), 'AmEx payment');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(addRule).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: OFFER })).toBeInTheDocument();
  });

  it('does not offer a rename while the host form is saving', () => {
    render(<InlineMerchantRename merchant="AMEX ACH PAYMENT" source="bank-sync" amount={412.5} disabled />);
    expect(screen.getByRole('button', { name: OFFER })).toBeDisabled();
  });
});
