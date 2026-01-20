import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomTooltip } from './CustomTooltip';

describe('CustomTooltip', () => {
  const mockPayload = [
    { name: 'Dataset 1', value: 100, color: '#ff0000' },
    { name: 'Dataset 2', value: 200, fill: '#00ff00' },
  ];

  it('renders nothing when inactive', () => {
    const { container } = render(<CustomTooltip active={false} payload={mockPayload} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when payload is empty', () => {
    const { container } = render(<CustomTooltip active={true} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders correctly with data', () => {
    render(<CustomTooltip active={true} payload={mockPayload} label="Test Label" />);

    expect(screen.getByText('Test Label')).toBeInTheDocument();
    expect(screen.getByText('Dataset 1:')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Dataset 2:')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('applies formatter', () => {
    const formatter = (val: any) => `$${val}`;
    render(<CustomTooltip active={true} payload={mockPayload} formatter={formatter} />);

    expect(screen.getByText('$100')).toBeInTheDocument();
    expect(screen.getByText('$200')).toBeInTheDocument();
  });

  it('applies suffix', () => {
    render(<CustomTooltip active={true} payload={mockPayload} suffix=" kg" />);

    expect(screen.getByText('100 kg')).toBeInTheDocument();
  });
});
