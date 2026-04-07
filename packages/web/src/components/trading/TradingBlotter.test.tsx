import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradingBlotter } from './TradingBlotter';

describe('TradingBlotter', () => {
  it('renders the blotter header', () => {
    render(<TradingBlotter />);
    expect(screen.getByText(/live trade blotter/i)).toBeDefined();
  });

  it('shows LIVE indicator', () => {
    render(<TradingBlotter />);
    expect(screen.getByText('LIVE')).toBeDefined();
  });
});
