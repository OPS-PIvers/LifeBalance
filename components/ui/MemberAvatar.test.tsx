// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MemberAvatar from './MemberAvatar';

describe('MemberAvatar', () => {
  it('renders the photo when photoURL is present', () => {
    render(
      <MemberAvatar
        name="Paul"
        photoURL="https://example.com/paul.jpg"
        color="#285742"
        size={30}
        data-testid="avatar"
      />
    );
    const img = screen.getByTestId('avatar');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://example.com/paul.jpg');
  });

  it('falls back to an initial circle in the given color when there is no photo', () => {
    render(<MemberAvatar name="Jen" color="#b87a29" size={30} data-testid="avatar" />);
    const avatar = screen.getByTestId('avatar');
    expect(avatar.tagName).toBe('SPAN');
    expect(avatar).toHaveTextContent('J');
    expect(avatar).toHaveStyle({ backgroundColor: '#b87a29' });
  });

  it('falls back to the initial circle when the photo fails to load', () => {
    render(
      <MemberAvatar
        name="Paul"
        photoURL="https://example.com/broken.jpg"
        color="#285742"
        size={30}
        data-testid="avatar"
      />
    );
    const img = screen.getByTestId('avatar');
    fireEvent.error(img);

    const fallback = screen.getByTestId('avatar');
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback).toHaveTextContent('P');
    expect(fallback).toHaveStyle({ backgroundColor: '#285742' });
  });

  it('is decorative (aria-hidden) with no alt, and labeled when alt is given', () => {
    const { rerender } = render(
      <MemberAvatar name="Paul" color="#285742" size={16} data-testid="avatar" />
    );
    expect(screen.getByTestId('avatar')).toHaveAttribute('aria-hidden', 'true');

    rerender(
      <MemberAvatar name="Paul" color="#285742" size={16} alt="Paul" data-testid="avatar" />
    );
    expect(screen.getByRole('img', { name: 'Paul' })).toBeInTheDocument();
  });

  it('sizes the fallback circle from the size prop', () => {
    render(<MemberAvatar name="Paul" color="#285742" size={22} data-testid="avatar" />);
    expect(screen.getByTestId('avatar')).toHaveStyle({ width: '22px', height: '22px' });
  });

  it('renders a squircle instead of a circle when shape is not "circle", on both the photo and fallback branches', () => {
    const { rerender } = render(
      <MemberAvatar name="Kid" color="#b87a29" size={36} shape="rounded-card" data-testid="avatar" />
    );
    let avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('rounded-card');
    expect(avatar).not.toHaveClass('rounded-full');

    rerender(
      <MemberAvatar
        name="Kid"
        photoURL="https://example.com/kid.jpg"
        color="#b87a29"
        size={48}
        shape="rounded-2xl"
        data-testid="avatar"
      />
    );
    avatar = screen.getByTestId('avatar');
    expect(avatar.tagName).toBe('IMG');
    expect(avatar).toHaveClass('rounded-2xl');
    expect(avatar).not.toHaveClass('rounded-full');
  });
});
