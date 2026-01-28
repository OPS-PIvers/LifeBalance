import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscribeToCollection } from './firestoreHelpers';
import * as firestore from 'firebase/firestore';

// Mock Firestore functions
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn(),
}));

describe('subscribeToCollection', () => {
  const mockDb = {} as firestore.Firestore;
  const mockCallback = vi.fn();
  const mockUnsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firestore.onSnapshot).mockReturnValue(mockUnsubscribe);
  });

  it('subscribes to the correct collection path', () => {
    subscribeToCollection(mockDb, 'test/path', mockCallback);

    expect(firestore.collection).toHaveBeenCalledWith(mockDb, 'test/path');
    expect(firestore.query).toHaveBeenCalled();
    expect(firestore.onSnapshot).toHaveBeenCalled();
  });

  it('calls callback with transformed data when snapshot updates', () => {
    const mockData = { name: 'Test Item' };
    const mockDoc = {
      id: 'doc-1',
      data: () => mockData,
    };
    const mockSnapshot = {
      docs: [mockDoc],
    };

    // Setup onSnapshot to call the callback immediately
    vi.mocked(firestore.onSnapshot).mockImplementation((_query, onNext) => {
      // @ts-expect-error - Mocking the callback
      onNext(mockSnapshot);
      return mockUnsubscribe;
    });

    subscribeToCollection(mockDb, 'test/path', mockCallback);

    expect(mockCallback).toHaveBeenCalledWith([
      { ...mockData, id: 'doc-1' }
    ]);
  });

  it('uses custom transform function if provided', () => {
    const mockData = { name: 'Test Item' };
    const mockDoc = {
      id: 'doc-1',
      data: () => mockData,
    };
    const mockSnapshot = {
      docs: [mockDoc],
    };

    vi.mocked(firestore.onSnapshot).mockImplementation((_query, onNext) => {
      // @ts-expect-error - Mocking the callback
      onNext(mockSnapshot);
      return mockUnsubscribe;
    });

    const customTransform = (doc: any) => ({
      customId: doc.id,
      customName: doc.data().name.toUpperCase(),
    });

    subscribeToCollection(mockDb, 'test/path', mockCallback, { transform: customTransform });

    expect(mockCallback).toHaveBeenCalledWith([
      { customId: 'doc-1', customName: 'TEST ITEM' }
    ]);
  });

  it('calls onError if provided', () => {
    const mockError = new Error('Permission denied');
    const mockOnError = vi.fn();

    vi.mocked(firestore.onSnapshot).mockImplementation((_query, _onNext, onError) => {
      if (onError) onError(mockError as any);
      return mockUnsubscribe;
    });

    subscribeToCollection(mockDb, 'test/path', mockCallback, { onError: mockOnError });

    expect(mockOnError).toHaveBeenCalledWith(mockError);
  });

  it('returns the unsubscribe function', () => {
    const result = subscribeToCollection(mockDb, 'test/path', mockCallback);
    expect(result).toBe(mockUnsubscribe);
  });
});
