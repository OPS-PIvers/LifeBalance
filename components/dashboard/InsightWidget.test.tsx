import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Insight, ModuleKey } from '@/types/schema';
import { InsightWidget } from './InsightWidget';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: vi.fn(),
}));

vi.mock('@/hooks/useInsightActions', () => ({
  useInsightActions: () => ({ handleAction: vi.fn() }),
}));

vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
  });
};

/** Configure the household-core mock with a shown insight + its history entry. */
const setInsight = (insight: string, latest: Insight | null) => {
  vi.mocked(useHouseholdCore).mockReturnValue({
    insight,
    refreshInsight: vi.fn(),
    isGeneratingInsight: false,
    insightsHistory: latest ? [latest] : [],
  } as unknown as ReturnType<typeof useHouseholdCore>);
};

const makeInsight = (overrides: Partial<Insight>): Insight => ({
  id: 'i-1',
  text: 'Some insight',
  generatedAt: '2026-06-16T00:00:00.000Z',
  type: 'general',
  ...overrides,
});

const noop = () => {};

describe('InsightWidget (Plan 090 degradation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['money', 'habits', 'lists', 'todos', 'meals', 'shopping']);
  });

  it('shows a spending insight when money is on', () => {
    const text = 'You spent a lot on dining.';
    setInsight(text, makeInsight({ text, type: 'spending' }));
    render(<InsightWidget onOpenArchive={noop} />);
    expect(screen.getByText(`“${text}”`)).toBeInTheDocument();
  });

  it('hides a spending insight when money is off', () => {
    const text = 'You spent a lot on dining.';
    setInsight(text, makeInsight({ text, type: 'spending' }));
    setEnabledModules(['habits', 'lists', 'todos']);
    const { container } = render(<InsightWidget onOpenArchive={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides a habits insight when habits is off', () => {
    const text = 'Your streak is on fire.';
    setInsight(text, makeInsight({ text, type: 'habits' }));
    setEnabledModules(['money', 'lists', 'todos']);
    const { container } = render(<InsightWidget onOpenArchive={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a general insight regardless of disabled modules', () => {
    const text = 'Welcome to your household.';
    setInsight(text, makeInsight({ text, type: 'general' }));
    setEnabledModules([]); // everything off
    render(<InsightWidget onOpenArchive={noop} />);
    expect(screen.getByText(`“${text}”`)).toBeInTheDocument();
  });

  it('opens the archive from the demoted History text link', () => {
    const text = 'Welcome to your household.';
    setInsight(text, makeInsight({ text, type: 'general' }));
    const onOpenArchive = vi.fn();
    render(<InsightWidget onOpenArchive={onOpenArchive} />);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it('drops a money action pill when money is off but keeps the (general) insight', () => {
    const text = 'A general nudge.';
    setInsight(
      text,
      makeInsight({
        text,
        type: 'general',
        actions: [
          { type: 'update_bucket', label: 'Raise Groceries', payload: { bucketName: 'Groceries', newLimit: 500 } },
          { type: 'create_habit', label: 'Add Habit', payload: { title: 'Walk', category: 'Health' } },
        ],
      }),
    );
    setEnabledModules(['habits', 'lists', 'todos']); // money off
    render(<InsightWidget onOpenArchive={noop} />);
    expect(screen.getByText(`“${text}”`)).toBeInTheDocument();
    expect(screen.queryByText('Raise Groceries')).not.toBeInTheDocument();
    expect(screen.getByText('Add Habit')).toBeInTheDocument();
  });
});
