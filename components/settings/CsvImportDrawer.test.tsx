import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CsvImportDrawer from './CsvImportDrawer';
import type { Transaction } from '@/types/schema';

const { mockAddTransaction, mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockAddTransaction: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

let mockTransactions: Transaction[] = [];

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    addTransaction: mockAddTransaction,
    get transactions() {
      return mockTransactions;
    },
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: mockToastSuccess, error: mockToastError },
}));

/** A minimal File-like object with a `.text()`-free FileReader-compatible shape. */
function makeCsvFile(contents: string, name = 'transactions.csv'): File {
  return new File([contents], name, { type: 'text/csv' });
}

describe('CsvImportDrawer', () => {
  beforeEach(() => {
    mockAddTransaction.mockReset();
    mockAddTransaction.mockResolvedValue(undefined);
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockTransactions = [];
  });

  it('shows a file picker when no file has been chosen yet', () => {
    render(<CsvImportDrawer isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /choose csv file/i })).toBeInTheDocument();
  });

  it('parses an uploaded CSV, auto-detects columns, and previews mapped rows', async () => {
    const user = userEvent.setup();
    render(<CsvImportDrawer isOpen onClose={vi.fn()} />);

    const csv = 'Date,Description,Amount\n2026-07-01,Coffee Shop,-4.50\n2026-07-02,Paycheck,1200.00\n';
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await waitFor(() => expect(screen.getByText('Coffee Shop')).toBeInTheDocument());
    expect(screen.getByText('Paycheck')).toBeInTheDocument();
    expect(screen.getByText('2 row(s) parsed')).toBeInTheDocument();

    // Column selects were auto-populated from the header.
    expect(screen.getByRole('combobox', { name: 'Date column' })).toHaveValue('0');
    expect(screen.getByRole('combobox', { name: 'Description column' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: 'Amount column' })).toHaveValue('2');
  });

  it('re-previews rows when the column mapping is changed', async () => {
    const user = userEvent.setup();
    render(<CsvImportDrawer isOpen onClose={vi.fn()} />);

    // Header order deliberately mismatched with content so detection picks the
    // wrong description column, and we can prove changing it re-derives the preview.
    const csv = 'Amount,Date,Memo\n10.00,2026-07-01,Groceries\n';
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument());

    // Deliberately point "Description column" at the Amount column instead —
    // the merchant text should now read the raw amount cell ("10.00").
    await user.selectOptions(screen.getByRole('combobox', { name: 'Description column' }), '0');

    await waitFor(() => expect(screen.getByText('10.00')).toBeInTheDocument());
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });

  it('collects unparseable rows into an error count instead of crashing', async () => {
    const user = userEvent.setup();
    render(<CsvImportDrawer isOpen onClose={vi.fn()} />);

    const csv = 'Date,Description,Amount\nnot-a-date,Bad Row,10.00\n2026-07-01,Good Row,5.00\n';
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await waitFor(() => expect(screen.getByText('Good Row')).toBeInTheDocument());
    expect(screen.getByText('1 error(s)')).toBeInTheDocument();
  });

  it('flags a possible duplicate against an existing pending transaction and skips it by default', async () => {
    mockTransactions = [
      {
        id: 'tx1',
        amount: 4.5,
        merchant: 'Coffee Shop',
        category: 'Uncategorized',
        date: '2026-07-01',
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
      },
    ];
    const user = userEvent.setup();
    render(<CsvImportDrawer isOpen onClose={vi.fn()} />);

    const csv = 'Date,Description,Amount\n2026-07-01,Coffee Shop,-4.50\n';
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await waitFor(() => expect(screen.getByText('1 possible duplicate(s)')).toBeInTheDocument());

    const checkbox = screen.getByRole('checkbox', { name: /include coffee shop/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Import 0 transactions' })).toBeInTheDocument();
  });

  it('imports only the selected rows as pending_review file-upload transactions', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CsvImportDrawer isOpen onClose={onClose} />);

    const csv = 'Date,Description,Amount\n2026-07-01,Coffee Shop,-4.50\n2026-07-02,Direct Deposit,1200.00\n';
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    await waitFor(() => expect(screen.getByText('Coffee Shop')).toBeInTheDocument());

    const importButton = screen.getByRole('button', { name: 'Import 2 transactions' });
    await user.click(importButton);

    await waitFor(() => expect(mockAddTransaction).toHaveBeenCalledTimes(2));
    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant: 'Coffee Shop',
        amount: 4.5,
        category: 'Uncategorized',
        date: '2026-07-01',
        status: 'pending_review',
        source: 'file-upload',
        isRecurring: false,
      })
    );
    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant: 'Direct Deposit',
        amount: 1200,
        category: 'Income',
        date: '2026-07-02',
        status: 'pending_review',
        source: 'file-upload',
      })
    );
    expect(mockToastSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('lets the user re-include a flagged possible-duplicate row via its checkbox', async () => {
    mockTransactions = [
      {
        id: 'tx1',
        amount: 4.5,
        merchant: 'Coffee Shop',
        category: 'Uncategorized',
        date: '2026-07-01',
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
      },
    ];
    const user = userEvent.setup();
    render(<CsvImportDrawer isOpen onClose={vi.fn()} />);

    const csv = 'Date,Description,Amount\n2026-07-01,Coffee Shop,-4.50\n';
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, makeCsvFile(csv));

    const checkbox = await screen.findByRole('checkbox', { name: /include coffee shop/i });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByRole('button', { name: 'Import 1 transaction' })).toBeInTheDocument();
  });
});
