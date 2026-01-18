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
    BarChart: ({ children }: any) => <svg data-testid="bar-chart">{children}</svg>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PieChart: ({ children }: any) => <svg data-testid="pie-chart">{children}</svg>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AreaChart: ({ children }: any) => <svg data-testid="area-chart">{children}</svg>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    RadarChart: ({ children }: any) => <svg data-testid="radar-chart">{children}</svg>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ComposedChart: ({ children }: any) => <svg data-testid="composed-chart">{children}</svg>,
    // Mock child components that expect context
    XAxis: () => <g data-testid="x-axis" />,
    YAxis: () => <g data-testid="y-axis" />,
    CartesianGrid: () => <g data-testid="cartesian-grid" />,
    Tooltip: () => <g data-testid="tooltip" />,
    Legend: () => <g data-testid="legend" />,
    Bar: () => <g data-testid="bar" />,
    Area: () => <g data-testid="area" />,
    Line: () => <g data-testid="line" />,
    Radar: () => <g data-testid="radar" />,
    PolarGrid: () => <g data-testid="polar-grid" />,
    PolarAngleAxis: () => <g data-testid="polar-angle-axis" />,
    PolarRadiusAxis: () => <g data-testid="polar-radius-axis" />,
    Pie: () => <g data-testid="pie" />,
    Cell: () => <g data-testid="cell" />,
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
