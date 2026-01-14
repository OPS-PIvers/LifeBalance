import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import AnalyticsModal from './AnalyticsModal';

// Mock the household context
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    habits: [
      {
        id: '1',
        title: 'Drink Water',
        category: 'Health',
        basePoints: 10,
        period: 'daily',
        streakDays: 5,
        completedDates: ['2023-01-01', '2023-01-02'],
      }
    ],
    transactions: [
      {
        id: 't1',
        amount: 100,
        category: 'Food',
        date: '2023-01-01',
      }
    ],
  }),
}));

// Mock Recharts to avoid DOM dependency issues
vi.mock('recharts', async () => {
  const Original = await vi.importActual('recharts');
  return {
    ...Original,
    ResponsiveContainer: ({ children }: any) => <div className="recharts-responsive-container">{children}</div>,
    BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
    PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
    AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
    RadarChart: ({ children }: any) => <div data-testid="radar-chart">{children}</div>,
    ComposedChart: ({ children }: any) => <div data-testid="composed-chart">{children}</div>,
    // Mock child components that expect context
    XAxis: () => <div data-testid="x-axis" />,
    YAxis: () => <div data-testid="y-axis" />,
    CartesianGrid: () => <div data-testid="cartesian-grid" />,
    Tooltip: () => <div data-testid="tooltip" />,
    Legend: () => <div data-testid="legend" />,
    Bar: () => <div data-testid="bar" />,
    Area: () => <div data-testid="area" />,
    Line: () => <div data-testid="line" />,
    Radar: () => <div data-testid="radar" />,
    PolarGrid: () => <div data-testid="polar-grid" />,
    PolarAngleAxis: () => <div data-testid="polar-angle-axis" />,
    PolarRadiusAxis: () => <div data-testid="polar-radius-axis" />,
    Pie: () => <div data-testid="pie" />,
    Cell: () => <div data-testid="cell" />,
  };
});

describe('AnalyticsModal', () => {
  it('renders nothing when closed', () => {
    render(<AnalyticsModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('Analytics & Insights')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(<AnalyticsModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Analytics & Insights')).toBeInTheDocument();
    expect(screen.getByText('Track your progress and financial health')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(<AnalyticsModal isOpen={true} onClose={handleClose} />);

    // The close button is the one with the X icon in the header.
    // It's the only button in the header div aside from tabs which are in a separate div.
    // But let's just find by icon if we can, or iterate buttons.
    // Actually, simply clicking the backdrop also calls onClose in the current implementation.

    // Let's try to find the button.
    const buttons = screen.getAllByRole('button');
    // Find the one that doesn't have text (tabs have text)
    const closeBtn = buttons.find(b => !b.textContent);

    if (closeBtn) {
        fireEvent.click(closeBtn);
        expect(handleClose).toHaveBeenCalledTimes(1);
    } else {
        // Maybe the X icon has a role? No.
        // Let's use the backdrop click test instead if specific button selection is hard.
        // But we really should find that button.
        // Inspecting the code:
        // <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors text-slate-600">
        //   <X size={20} />
        // </button>

        // We can look for the button with the class 'rounded-full' as tabs don't have that usually.
        const headerClose = buttons.find(b => b.className.includes('rounded-full'));
        if (headerClose) {
            fireEvent.click(headerClose);
            expect(handleClose).toHaveBeenCalledTimes(1);
        } else {
             throw new Error("Close button not found");
        }
    }
  });

  it('switches tabs', () => {
    render(<AnalyticsModal isOpen={true} onClose={() => {}} />);

    // Default is overview
    expect(screen.getByText('Points This Week')).toBeInTheDocument();

    // Switch to Habits
    fireEvent.click(screen.getByText('habits'));
    expect(screen.getByText('Consistency Heatmap')).toBeInTheDocument();

    // Switch to Spending
    fireEvent.click(screen.getByText('spending'));
    expect(screen.getByText('Income vs Expense (6 Months)')).toBeInTheDocument();
  });
});
