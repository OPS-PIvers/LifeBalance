import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase config to prevent crash
vi.mock('@/firebase.config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ aiEnabled: true, aiUsage: { dailyCount: 0, lastResetDate: new Date().toISOString().split('T')[0] } })
  }),
  updateDoc: vi.fn(),
  increment: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  getDocs: vi.fn(),
}));

describe('geminiService', () => {
  beforeEach(() => {
     vi.resetModules();
     process.env.VITE_GEMINI_API_KEY = 'test-key';
  });

  describe('reorganizeHabits', () => {
    it('should return a plan when habits are provided', async () => {
      // Import after setting env
      const { reorganizeHabits } = await import('./geminiService');

      const mockHabits: any[] = [
        { id: '1', title: 'Habit 1', category: 'Old', order: 1 },
        { id: '2', title: 'Habit 2', category: 'Old', order: 2 },
      ];

      const mockResponse = {
        habits: [
          { id: '1', category: 'New', order: 0 },
          { id: '2', category: 'New', order: 1 },
        ],
        reasoning: 'Better flow'
      };

      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify(mockResponse)
      });

      const mockClient = {
        models: {
          generateContent: mockGenerateContent
        }
      };

      const result = await reorganizeHabits('household-1', mockHabits, mockClient as any);

      expect(result).toEqual(mockResponse);
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should handle empty habits', async () => {
       const { reorganizeHabits } = await import('./geminiService');
       const result = await reorganizeHabits('household-1', []);
       expect(result.habits).toEqual([]);
    });
  });
});
