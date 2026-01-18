import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInsightActions } from './useInsightActions';
import * as HouseholdContext from '../contexts/FirebaseHouseholdContext';
import toast from 'react-hot-toast';

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock useHousehold
const mockUpdateBucketLimit = vi.fn();
const mockAddHabit = vi.fn();
const mockAddToDo = vi.fn();

const mockBuckets = [
  { id: 'b1', name: 'Rent', limit: 2000, color: 'red', isVariable: false, isCore: true }
];

const mockCurrentUser = { uid: 'user123' };

vi.mock('../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

describe('useInsightActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (HouseholdContext.useHousehold as Mock).mockReturnValue({
      updateBucketLimit: mockUpdateBucketLimit,
      addHabit: mockAddHabit,
      addToDo: mockAddToDo,
      buckets: mockBuckets,
      currentUser: mockCurrentUser,
    });
  });

  it('should handle update_bucket action', async () => {
    const { result } = renderHook(() => useInsightActions());

    const action = {
      type: 'update_bucket' as const,
      label: 'Increase Limit',
      payload: {
        bucketName: 'Rent',
        newLimit: 2500,
      },
    };

    await act(async () => {
      await result.current.handleAction(action);
    });

    expect(mockUpdateBucketLimit).toHaveBeenCalledWith('b1', 2500);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should handle update_bucket action with case insensitivity', async () => {
    const { result } = renderHook(() => useInsightActions());

    const action = {
      type: 'update_bucket' as const,
      label: 'Increase Limit',
      payload: {
        bucketName: 'rEnT', // Mixed case
        newLimit: 2500,
      },
    };

    await act(async () => {
      await result.current.handleAction(action);
    });

    expect(mockUpdateBucketLimit).toHaveBeenCalledWith('b1', 2500);
  });

  it('should show error if bucket not found', async () => {
    const { result } = renderHook(() => useInsightActions());

    const action = {
      type: 'update_bucket' as const,
      label: 'Increase Limit',
      payload: {
        bucketName: 'Groceries',
        newLimit: 500,
      },
    };

    await act(async () => {
      await result.current.handleAction(action);
    });

    expect(mockUpdateBucketLimit).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Bucket "Groceries" not found.');
  });

  it('should handle create_habit action', async () => {
    const { result } = renderHook(() => useInsightActions());

    const action = {
      type: 'create_habit' as const,
      label: 'New Habit',
      payload: {
        title: 'Drink Water',
        category: 'Health',
      },
    };

    await act(async () => {
      await result.current.handleAction(action);
    });

    expect(mockAddHabit).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Drink Water',
      category: 'Health',
      type: 'positive',
      period: 'daily',
      basePoints: 10,
    }));
  });

  it('should handle create_todo action', async () => {
    const { result } = renderHook(() => useInsightActions());

    const action = {
      type: 'create_todo' as const,
      label: 'New Task',
      payload: {
        text: 'Buy Milk',
        completeByDate: '2024-01-01',
      },
    };

    await act(async () => {
      await result.current.handleAction(action);
    });

    expect(mockAddToDo).toHaveBeenCalledWith({
      text: 'Buy Milk',
      completeByDate: '2024-01-01',
      assignedTo: 'user123',
      isCompleted: false,
    });
    expect(toast.success).toHaveBeenCalledWith('Added to To-Do List');
  });

  it('should handle missing payload', async () => {
    const { result } = renderHook(() => useInsightActions());

    const action = {
      type: 'create_todo' as const,
      label: 'New Task',
      payload: null,
    };

    await act(async () => {
      await result.current.handleAction(action);
    });

    expect(toast.error).toHaveBeenCalledWith('Invalid action data.');
  });

  it('should handle execution errors', async () => {
    // Suppress console.error for this test as we expect it
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

     (HouseholdContext.useHousehold as Mock).mockReturnValue({
      updateBucketLimit: mockUpdateBucketLimit,
      addHabit: mockAddHabit,
      addToDo: vi.fn().mockRejectedValue(new Error('Network error')),
      buckets: mockBuckets,
      currentUser: mockCurrentUser,
    });

    const { result } = renderHook(() => useInsightActions());

     const action = {
      type: 'create_todo' as const,
      label: 'New Task',
      payload: {
        text: 'Buy Milk',
        completeByDate: '2024-01-01',
      },
    };

    await act(async () => {
      await result.current.handleAction(action);
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to execute action: Network error');

    // Restore console.error
    consoleSpy.mockRestore();
  });
});
