import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaptureMenu } from './CaptureMenu';

const setup = () => {
  const onSelectImage = vi.fn();
  const onManual = vi.fn();
  render(
    <CaptureMenu
      onSelectImage={onSelectImage}
      onManual={onManual}
    />,
  );
  return { onSelectImage, onManual };
};

describe('CaptureMenu hierarchy', () => {
  it('renders the two primary capture methods', () => {
    setup();
    expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    expect(screen.getByText('Add from Image')).toBeInTheDocument();
  });

  it('orders Manual Entry ahead of Add from Image', () => {
    setup();
    const order = ['Manual Entry', 'Add from Image'].map(
      (label) => screen.getByText(label),
    );
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('wires Manual Entry to its handler', () => {
    const { onManual } = setup();
    fireEvent.click(screen.getByText('Manual Entry'));
    expect(onManual).toHaveBeenCalledTimes(1);
  });

  it('opens the file picker when Add from Image is clicked', () => {
    setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByText('Add from Image'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectImage with a valid image file', () => {
    const { onSelectImage } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelectImage).toHaveBeenCalledWith(file);
  });
});
