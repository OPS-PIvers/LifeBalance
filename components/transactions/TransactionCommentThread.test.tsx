import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TransactionComment, HouseholdMember } from '@/types/schema';

const {
  mockGetTransactionComments,
  mockAddTransactionComment,
  mockDeleteTransactionComment,
} = vi.hoisted(() => ({
  mockGetTransactionComments: vi.fn(),
  mockAddTransactionComment: vi.fn(),
  mockDeleteTransactionComment: vi.fn(),
}));

let mockMembers: HouseholdMember[] = [];
let mockCurrentUser: HouseholdMember | null = null;

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    getTransactionComments: mockGetTransactionComments,
    addTransactionComment: mockAddTransactionComment,
    deleteTransactionComment: mockDeleteTransactionComment,
  }),
  useHouseholdCore: () => ({
    members: mockMembers,
    currentUser: mockCurrentUser,
  }),
}));

vi.mock('lucide-react', () => ({
  MessageSquare: () => <div data-testid="icon-message-square" />,
  Send: () => <div data-testid="icon-send" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Loader2: () => <div data-testid="icon-loader" />,
}));

import { TransactionCommentThread } from './TransactionCommentThread';

const member = (uid: string, displayName: string): HouseholdMember =>
  ({ uid, displayName, email: `${uid}@example.com`, role: 'admin' } as HouseholdMember);

describe('TransactionCommentThread', () => {
  beforeEach(() => {
    mockGetTransactionComments.mockReset().mockResolvedValue([]);
    mockAddTransactionComment.mockReset();
    mockDeleteTransactionComment.mockReset();
    mockMembers = [member('uid-1', 'Alex')];
    mockCurrentUser = member('uid-1', 'Alex');
  });

  it('fetches comments ON OPEN (not before) via a one-shot call', async () => {
    const { rerender } = render(<TransactionCommentThread transactionId="tx1" isOpen={false} />);
    expect(mockGetTransactionComments).not.toHaveBeenCalled();

    rerender(<TransactionCommentThread transactionId="tx1" isOpen={true} />);
    await waitFor(() => expect(mockGetTransactionComments).toHaveBeenCalledWith('tx1'));
    expect(mockGetTransactionComments).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-state copy when there are no comments', async () => {
    render(<TransactionCommentThread transactionId="tx1" isOpen={true} />);
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument();
  });

  it('renders a fetched comment with author name and text', async () => {
    const comments: TransactionComment[] = [
      { id: 'c1', authorUid: 'uid-1', text: 'What was this for?', createdAt: new Date().toISOString() },
    ];
    mockGetTransactionComments.mockResolvedValue(comments);

    render(<TransactionCommentThread transactionId="tx1" isOpen={true} />);

    expect(await screen.findByText('What was this for?')).toBeInTheDocument();
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
  });

  it('falls back to "Someone" for an unknown author uid', async () => {
    mockGetTransactionComments.mockResolvedValue([
      { id: 'c1', authorUid: 'uid-unknown', text: 'hey', createdAt: new Date().toISOString() },
    ]);

    render(<TransactionCommentThread transactionId="tx1" isOpen={true} />);

    expect(await screen.findByText(/Someone/)).toBeInTheDocument();
  });

  it('posts a new comment and re-fetches the thread', async () => {
    const user = userEvent.setup();
    mockAddTransactionComment.mockResolvedValue(undefined);
    render(<TransactionCommentThread transactionId="tx1" isOpen={true} />);

    await waitFor(() => expect(mockGetTransactionComments).toHaveBeenCalledTimes(1));

    const input = await screen.findByLabelText(/add a comment/i);
    await user.type(input, 'A new comment');
    await user.click(screen.getByLabelText(/post comment/i));

    await waitFor(() => expect(mockAddTransactionComment).toHaveBeenCalledWith('tx1', 'A new comment'));
    await waitFor(() => expect(mockGetTransactionComments).toHaveBeenCalledTimes(2));
  });

  it('shows a delete affordance only for the current user\'s own comment', async () => {
    mockGetTransactionComments.mockResolvedValue([
      { id: 'c-mine', authorUid: 'uid-1', text: 'mine', createdAt: new Date().toISOString() },
      { id: 'c-other', authorUid: 'uid-2', text: 'not mine', createdAt: new Date().toISOString() },
    ]);
    mockMembers = [member('uid-1', 'Alex'), member('uid-2', 'Sam')];

    render(<TransactionCommentThread transactionId="tx1" isOpen={true} />);

    await screen.findByText('mine');
    expect(screen.getAllByLabelText('Delete comment')).toHaveLength(1);
  });
});
