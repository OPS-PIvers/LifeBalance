import React, { useState } from 'react';
import { format } from 'date-fns';
import { Copy } from 'lucide-react';
import { Account, CalendarItem } from '../../types/schema';
import { Button } from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { SegmentedControl } from '../ui/SegmentedControl';

interface CalendarEventFormProps {
  initialData?: CalendarItem | null;
  selectedDate: Date;
  accounts: Account[];
  onSave: (data: CalendarItem) => Promise<void>;
  onCancel: () => void;
}

export const CalendarEventForm: React.FC<CalendarEventFormProps> = ({
  initialData,
  selectedDate,
  accounts,
  onSave,
  onCancel: _onCancel,
}) => {
  const [title, setTitle] = useState(initialData?.title || '');
  const [amount, setAmount] = useState(initialData?.amount?.toString() || '');
  const [type, setType] = useState<'income' | 'expense'>(initialData?.type || 'expense');
  const [date, setDate] = useState(initialData?.date || format(selectedDate, 'yyyy-MM-dd'));
  const [accountId, setAccountId] = useState(initialData?.accountId || '');
  const [isRecurring, setIsRecurring] = useState(!!initialData?.isRecurring);
  const [frequency, setFrequency] = useState<'monthly' | 'bi-weekly' | 'weekly'>(initialData?.frequency || 'monthly');

  const handleSubmit = async () => {
    if (!title || !amount || !date) return;

    const newItem: CalendarItem = {
      id: initialData ? initialData.id : crypto.randomUUID(),
      title,
      amount: parseFloat(amount),
      date: date,
      type,
      isPaid: initialData ? initialData.isPaid : false,
      isRecurring,
      frequency: isRecurring ? frequency : undefined,
      accountId: accountId || undefined
    };

    await onSave(newItem);
  };

  const handleDuplicate = async () => {
    if (!title || !amount || !date) return;

    const newItem: CalendarItem = {
      id: crypto.randomUUID(),
      title: `${title} (Copy)`,
      amount: parseFloat(amount),
      date: date,
      type,
      isPaid: false, // Reset status for duplicate
      isRecurring,
      frequency: isRecurring ? frequency : undefined,
      accountId: accountId || undefined
    };

    await onSave(newItem);
  };

  return (
    <div className="space-y-4">
      {/* Type Toggle */}
      <SegmentedControl
        value={type}
        onChange={(val) => setType(val as 'income' | 'expense')}
        name="Transaction Type"
        options={[
          { value: 'expense', label: 'Expense', activeClassName: 'text-money-neg' },
          { value: 'income', label: 'Income', activeClassName: 'text-money-pos' },
        ]}
        className="mb-4"
        showBorder={false}
      />

      <Input
        label="Title"
        type="text"
        placeholder="Title (e.g. Rent)"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

      <Input
        label="Amount"
        type="number"
        placeholder="Amount"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        className="font-mono"
      />

      <Input
        label="Date"
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="font-medium"
      />

      <Select
        label="Account (Optional)"
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
      >
        <option value="">(None)</option>
        {accounts.map(a => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </Select>

      <div className="flex items-center justify-between">
        <label id="recurring-label" className="text-sm font-bold text-slate-700">Recurring?</label>
        <button
          role="switch"
          aria-checked={isRecurring}
          aria-labelledby="recurring-label"
          onClick={() => setIsRecurring(!isRecurring)}
          className={`w-11 h-6 rounded-full relative transition-colors ${isRecurring ? 'bg-slate-900' : 'bg-slate-200'}`}
        >
          <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${isRecurring ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {isRecurring && (
        <Select
          label="Frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as 'monthly' | 'bi-weekly' | 'weekly')}
        >
          <option value="monthly">Monthly</option>
          <option value="bi-weekly">Bi-Weekly</option>
          <option value="weekly">Weekly</option>
        </Select>
      )}

      <div className="flex gap-2 mt-2 pt-2">
        {initialData && (
          <Button
            variant="secondary"
            onClick={handleDuplicate}
            className="flex-1 py-3 h-auto"
            leftIcon={<Copy size={18} />}
          >
            Duplicate
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleSubmit}
          className="flex-1 py-3 h-auto shadow-lg"
        >
          {initialData ? 'Save Changes' : 'Add Event'}
        </Button>
      </div>
    </div>
  );
};
