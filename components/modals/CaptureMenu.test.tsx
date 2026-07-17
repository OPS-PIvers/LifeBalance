import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaptureMenu } from './CaptureMenu';

// The magic-action card reads household context; stub it so this test focuses
// on the capture-method hierarchy (primary rows vs. the quieter secondary).
vi.mock('./CaptureMagicAction', () => ({
  CaptureMagicAction: () => <div data-testid="magic-action" />,
}));

const setup = () => {
  const onScan = vi.fn();
  const onFileSelect = vi.fn();
  const onManual = vi.fn();
  render(
    <CaptureMenu
      onScan={onScan}
      onFileSelect={onFileSelect}
      onManual={onManual}
      householdId="h1"
      dynamicCategories={['Groceries']}
      onMagicSuccess={vi.fn()}
    />,
  );
  return { onScan, onFileSelect, onManual };
};

describe('CaptureMenu hierarchy', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders the two primary methods and the quieter secondary group', () => {
    setup();
    // Primary methods.
    expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    expect(screen.getByText('Scan Receipt')).toBeInTheDocument();
    // Secondary method sits under a soft "More" label, not as an equal card.
    expect(screen.getByText('More ways to add')).toBeInTheDocument();
    expect(screen.getByText('Upload image')).toBeInTheDocument();
  });

  it('orders Manual Entry and Scan Receipt ahead of the Upload secondary', () => {
    setup();
    const order = ['Manual Entry', 'Scan Receipt', 'Upload image'].map(
      (label) => screen.getByText(label),
    );
    // Document order: primary pair first, then the secondary upload row.
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('wires each capture method to its handler', () => {
    const { onScan, onManual } = setup();
    fireEvent.click(screen.getByText('Manual Entry'));
    expect(onManual).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Scan Receipt'));
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});
