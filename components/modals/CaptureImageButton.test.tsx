import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';
import { CaptureImageButton } from './CaptureImageButton';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const setup = () => {
  const onSelectImage = vi.fn();
  render(<CaptureImageButton onSelectImage={onSelectImage} />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  return { onSelectImage, input };
};

describe('CaptureImageButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the scan affordance and flags that it goes to review', () => {
    setup();
    expect(screen.getByText('Scan a receipt or screenshot')).toBeInTheDocument();
    expect(screen.getByText('REVIEW')).toBeInTheDocument();
  });

  it('opens the file picker when clicked', () => {
    const { input } = setup();
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('accepts images only', () => {
    const { input } = setup();
    expect(input).toHaveAttribute('accept', 'image/*');
  });

  it('calls onSelectImage with a valid image file', () => {
    const { onSelectImage, input } = setup();
    const file = new File(['data'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelectImage).toHaveBeenCalledWith(file);
  });

  it('rejects a non-image file', () => {
    const { onSelectImage, input } = setup();
    const file = new File(['data'], 'statement.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelectImage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Please upload an image file');
  });

  it('rejects an image over 10MB', () => {
    const { onSelectImage, input } = setup();
    const file = new File(['data'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelectImage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Image too large (max 10MB)');
  });
});
