import React from 'react';
import { Wallet, Receipt, Clock, PiggyBank, LayoutGrid } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';

interface MoneyModelPrimerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PrimerSection {
  icon: React.ReactNode;
  title: string;
  body: string;
}

/**
 * A short explainer of the pool + overlay money model behind Safe to Spend.
 * Every claim here is derived from the Safe-to-Spend section of CLAUDE.md and
 * utils/safeToSpendCalculator.ts:
 *   safeToSpend = Checking balance − Unpaid bills (this paycheck → next,
 *   plus overdue) − Pending spend (this period, income excluded).
 * Buckets are a display/tracking overlay on the checking pool, never envelopes.
 * Copy is plain and warm, no em dashes, no marketing language.
 */
const SECTIONS: PrimerSection[] = [
  {
    icon: <Wallet size={16} />,
    title: 'It starts with your checking pool',
    body: 'Safe to Spend begins with the cash in your checking accounts. Savings and credit are left out, because this number is about what you can actually spend right now.',
  },
  {
    icon: <Receipt size={16} />,
    title: 'Bills are reserved first',
    body: 'Bills due between this paycheck and your next one are set aside, so a bill you have not paid yet can never be spent twice. Overdue bills from the past month stay reserved until you pay them.',
  },
  {
    icon: <Clock size={16} />,
    title: 'Pending spend is subtracted',
    body: 'You enter your balances by hand, so they do not yet show purchases that have not cleared. Anything still in pending review is taken out, so Safe to Spend never runs ahead of reality.',
  },
  {
    icon: <PiggyBank size={16} />,
    title: 'What is left is Safe to Spend',
    body: 'Checking, minus reserved bills, minus pending. That is the figure in the toolbar. It is the money you can spend without reaching into a bill.',
  },
  {
    icon: <LayoutGrid size={16} />,
    title: 'Buckets are a lens, not envelopes',
    body: 'Budget buckets group your spending so you can see where it goes. They sit on top of the same checking pool. Every purchase lowers Safe to Spend the same way no matter which bucket it lands in. Going over a bucket adds no extra hit, and no other bucket has to cover the overage. A bucket is a target you set, not a wallet that empties.',
  },
];

export const MoneyModelPrimer: React.FC<MoneyModelPrimerProps> = ({ isOpen, onClose }) => (
  <Drawer isOpen={isOpen} onClose={onClose} title="How LifeBalance thinks about money">
    <p className="mb-5 text-sm leading-relaxed text-brand-600 dark:text-brand-300">
      One pool of money, viewed a few ways. Here is the whole idea in under a minute.
    </p>

    <ol className="space-y-5">
      {SECTIONS.map(section => (
        <li key={section.title} className="flex gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-brand-200 bg-brand-100 text-accent-600 dark:border-brand-700 dark:bg-brand-700/50 dark:text-accent-200">
            {section.icon}
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold tracking-tight text-brand-900 dark:text-brand-50">
              {section.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-brand-600 dark:text-brand-300">
              {section.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  </Drawer>
);

export default MoneyModelPrimer;
