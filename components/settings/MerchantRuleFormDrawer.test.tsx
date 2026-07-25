import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import MerchantRuleFormDrawer from './MerchantRuleFormDrawer';
import type { MerchantRule } from '@/types/schema';

function makeRule(overrides: Partial<MerchantRule> & { pattern: string }): MerchantRule {
  return {
    id: overrides.id ?? `rule-${overrides.pattern}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const BASE_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  rules: [] as MerchantRule[],
  categoryOptions: ['Groceries', 'Subscriptions'],
  billOptions: [{ id: 'bill-1', title: 'Electric Bill' }],
  onSave: vi.fn(),
};

const patternField = () => screen.getByRole('textbox', { name: 'Bank description contains' });
const amountField = () => screen.getByRole('textbox', { name: 'Only at this amount' });
const nameField = () => screen.getByRole('textbox', { name: 'Show it as' });

describe('MerchantRuleFormDrawer', () => {
  it('refuses to save a blank pattern and explains why', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={onSave} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText('Enter the text to look for in the bank description.')
    ).toBeInTheDocument();
  });

  it('treats a whitespace-only pattern as blank', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={onSave} onClose={vi.fn()} />);

    await user.type(patternField(), '   ');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={onSave} onClose={vi.fn()} />);

    await user.type(patternField(), 'APPLE.COM');
    await user.type(amountField(), 'lots');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText('Enter an amount like 2.99, or leave this blank to match any amount.')
    ).toBeInTheDocument();
  });

  it('accepts $0 as an amount qualifier (Apple Pay pre-auth stubs)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={onSave} onClose={vi.fn()} />);

    await user.type(patternField(), 'APPLE.COM');
    await user.type(amountField(), '0');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ pattern: 'APPLE.COM', amount: 0 });
  });

  it('omits every optional field that was left blank', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={onSave} onClose={onClose} />);

    await user.type(patternField(), 'NETFLIX');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // No `name: ''`, no `amount: NaN`, no `exempt: false` — absent, not empty.
    expect(onSave).toHaveBeenCalledWith({ pattern: 'NETFLIX' });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends every effect the user set', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={onSave} onClose={vi.fn()} />);

    await user.type(patternField(), 'APPLE.COM');
    await user.type(amountField(), '2.99');
    await user.type(nameField(), 'Apple');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Subscriptions');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Link to a bill' }), 'bill-1');
    await user.click(screen.getByRole('checkbox', { name: 'Ignore on no-spend days' }));
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      pattern: 'APPLE.COM',
      amount: 2.99,
      name: 'Apple',
      category: 'Subscriptions',
      billId: 'bill-1',
      exempt: true,
    });
  });

  it('prefills an existing rule and omits the fields the user clears', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const rule = makeRule({
      id: 'apple',
      pattern: 'APPLE.COM',
      amount: 2.99,
      name: 'Apple',
      category: 'Subscriptions',
      billId: 'bill-1',
      exempt: true,
    });
    render(
      <MerchantRuleFormDrawer
        {...BASE_PROPS}
        rule={rule}
        rules={[rule]}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    expect(patternField()).toHaveValue('APPLE.COM');
    expect(amountField()).toHaveValue('2.99');
    expect(nameField()).toHaveValue('Apple');

    await user.clear(nameField());
    await user.clear(amountField());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), '');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Link to a bill' }), '');
    await user.click(screen.getByRole('checkbox', { name: 'Ignore on no-spend days' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ pattern: 'APPLE.COM' });
  });

  it('keeps the sheet open when saving fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('offline'));
    const onClose = vi.fn();
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={onSave} onClose={onClose} />);

    await user.type(patternField(), 'NETFLIX');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(patternField()).toHaveValue('NETFLIX');
  });

  it('warns that a duplicate pattern can never fire, naming the rule that wins', async () => {
    const user = userEvent.setup();
    const existing = makeRule({ id: 'apple', pattern: 'APPLE.COM', name: 'Apple' });
    render(
      <MerchantRuleFormDrawer
        {...BASE_PROPS}
        rules={[existing]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText(/Duplicate pattern/)).not.toBeInTheDocument();

    await user.type(patternField(), 'apple.com');

    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('Duplicate pattern.');
    expect(warning).toHaveTextContent('Apple');
    expect(warning).toHaveTextContent(/never fire/);
  });

  it('does not warn when an existing rule is merely broader', async () => {
    const user = userEvent.setup();
    const broad = makeRule({ id: 'broad', pattern: 'APPLE' });
    render(
      <MerchantRuleFormDrawer {...BASE_PROPS} rules={[broad]} onSave={vi.fn()} onClose={vi.fn()} />
    );

    await user.type(patternField(), 'APPLE.COM/BILL');

    expect(screen.queryByText(/Duplicate pattern/)).not.toBeInTheDocument();
  });

  it('offers to trim a pasted descriptor down to its stable prefix', async () => {
    const user = userEvent.setup();
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={vi.fn()} onClose={vi.fn()} />);

    await user.type(patternField(), 'APPLE.COM/BILL 866-712-7753 CA');

    const trim = await screen.findByRole('button', { name: 'Trim to APPLE.COM/BILL' });
    await user.click(trim);

    expect(patternField()).toHaveValue('APPLE.COM/BILL');
    expect(screen.queryByRole('button', { name: /^Trim to/ })).not.toBeInTheDocument();
  });

  it('deletes only after the confirm dialog is accepted', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const rule = makeRule({ id: 'apple', pattern: 'APPLE.COM', name: 'Apple' });
    render(
      <MerchantRuleFormDrawer
        {...BASE_PROPS}
        rule={rule}
        rules={[rule]}
        onSave={vi.fn()}
        onDelete={onDelete}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this rule?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no delete affordance when authoring a new rule', () => {
    render(<MerchantRuleFormDrawer {...BASE_PROPS} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Delete rule' })).not.toBeInTheDocument();
  });
});
