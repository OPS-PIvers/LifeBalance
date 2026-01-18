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
    buckets: [
      { id: 'b1', limit: 1000, name: 'Groceries' }
    ],
    currentPeriodId: '2023-01-01'
  }),
}));

// Mock Recharts to avoid DOM dependency issues
vi.mock('recharts', async () => {
  const Original = await vi.importActual('recharts');
  return {
    ...Original,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ResponsiveContainer: ({ children }: any) => <div className="recharts-responsive-container">{children}</div>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    RadarChart: ({ children }: any) => <div data-testid="radar-chart">{children}</div>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const closeButton = screen.getByLabelText('Close modal');
    fireEvent.click(closeButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('switches tabs', () => {
    render(<AnalyticsModal isOpen={true} onClose={() => {}} />);

    // Default is Pulse
    expect(screen.getByText('Points This Week')).toBeInTheDocument();

    // Switch to Behavior
    fireEvent.click(screen.getByText('Behavior'));
    expect(screen.getByText('Consistency Heatmap (90 Days)')).toBeInTheDocument();

    // Switch to Wallet
    fireEvent.click(screen.getByText('Wallet'));
    expect(screen.getByText('Budget Burn-Down')).toBeInTheDocument();
  });
});
