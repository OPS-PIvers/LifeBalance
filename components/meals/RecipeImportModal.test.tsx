/**
 * Tests for RecipeImportModal's URL-import flow (Plan 19): the "Fetch from
 * link" button calls the `fetchrecipepage` callable and fills the textarea,
 * and a parse that originated from a URL fetch overwrites `recipeUrl` with the
 * actual fetched URL (code-owned, never trusted from the model).
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeImportModal } from './RecipeImportModal';

// Stub the Drawer so the test stays off framer-motion (BudgetAccounts.test.tsx style).
vi.mock('@/components/ui/Drawer', () => {
  interface MockDrawerProps {
    children: React.ReactNode;
    isOpen: boolean;
    title?: string;
  }
  return {
    Drawer: ({ children, isOpen, title }: MockDrawerProps) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          {children}
        </div>
      ) : null,
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const { callableInvokeMock, httpsCallableMock, parseRecipeMock } = vi.hoisted(() => ({
  callableInvokeMock: vi.fn(),
  httpsCallableMock: vi.fn(),
  parseRecipeMock: vi.fn(),
}));

vi.mock('@/firebase.config', () => ({
  getFunctionsInstance: vi.fn().mockResolvedValue({ __isFunctions: true }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: httpsCallableMock,
}));

vi.mock('@/services/geminiService', () => ({
  parseRecipe: parseRecipeMock,
}));

const renderModal = (onConfirm = vi.fn(), onClose = vi.fn()) => {
  render(
    <RecipeImportModal
      isOpen={true}
      onClose={onClose}
      householdId="hh-1"
      onConfirm={onConfirm}
    />
  );
  return { onConfirm, onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
  httpsCallableMock.mockReturnValue(callableInvokeMock);
});

describe('RecipeImportModal URL import', () => {
  it('disables "Fetch from link" until a URL is entered', async () => {
    renderModal();
    const fetchButton = screen.getByRole('button', { name: /fetch from link/i });
    expect(fetchButton).toBeDisabled();

    await userEvent.type(
      screen.getByRole('textbox', { name: /recipe link/i }),
      'https://example.com/chili'
    );
    expect(fetchButton).toBeEnabled();
  });

  it('fetches the page via the fetchrecipepage callable and fills the textarea', async () => {
    callableInvokeMock.mockResolvedValue({
      data: { text: 'Weeknight Chili\nIngredients:\n- beans', usedJsonLd: true },
    });
    renderModal();

    await userEvent.type(
      screen.getByRole('textbox', { name: /recipe link/i }),
      'https://example.com/chili'
    );
    await userEvent.click(screen.getByRole('button', { name: /fetch from link/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/paste recipe here/i)).toHaveValue(
        'Weeknight Chili\nIngredients:\n- beans'
      );
    });
    expect(httpsCallableMock).toHaveBeenCalledWith(
      { __isFunctions: true },
      'fetchrecipepage'
    );
    expect(callableInvokeMock).toHaveBeenCalledWith({
      url: 'https://example.com/chili',
    });
  });

  it('overwrites recipeUrl with the fetched URL after a URL-originated parse', async () => {
    callableInvokeMock.mockResolvedValue({
      data: { text: 'Weeknight Chili', usedJsonLd: true },
    });
    parseRecipeMock.mockResolvedValue({
      name: 'Weeknight Chili',
      recipeUrl: 'https://model-hallucinated.example/wrong',
    });
    const { onConfirm } = renderModal();

    await userEvent.type(
      screen.getByRole('textbox', { name: /recipe link/i }),
      'https://example.com/chili'
    );
    await userEvent.click(screen.getByRole('button', { name: /fetch from link/i }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/paste recipe here/i)).toHaveValue(
        'Weeknight Chili'
      )
    );

    await userEvent.click(screen.getByRole('button', { name: /parse recipe/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Weeknight Chili',
        recipeUrl: 'https://example.com/chili',
      })
    );
  });

  it('leaves recipeUrl alone for a plain paste-text parse', async () => {
    parseRecipeMock.mockResolvedValue({
      name: 'Pasted Soup',
      recipeUrl: 'https://in-the-text.example/soup',
    });
    const { onConfirm } = renderModal();

    await userEvent.type(
      screen.getByPlaceholderText(/paste recipe here/i),
      'Pasted Soup with steps'
    );
    await userEvent.click(screen.getByRole('button', { name: /parse recipe/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ recipeUrl: 'https://in-the-text.example/soup' })
    );
    expect(callableInvokeMock).not.toHaveBeenCalled();
  });

  it('toasts and keeps the modal usable when the fetch fails', async () => {
    const toast = (await import('react-hot-toast')).default;
    callableInvokeMock.mockRejectedValue(new Error('unavailable'));
    renderModal();

    await userEvent.type(
      screen.getByRole('textbox', { name: /recipe link/i }),
      'https://example.com/broken'
    );
    await userEvent.click(screen.getByRole('button', { name: /fetch from link/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(/paste recipe here/i)).toHaveValue('');
    expect(
      screen.getByRole('button', { name: /fetch from link/i })
    ).toBeEnabled();
  });
});
