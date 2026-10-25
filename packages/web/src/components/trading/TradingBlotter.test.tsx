import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradingBlotter } from './TradingBlotter';

describe('TradingBlotter', () => {
  it('renders the blotter header', () => {
    render(<TradingBlotter />);
    expect(screen.getByText(/live trading blotter/i)).toBeDefined();
  });

  it('shows CONNECTING indicator', () => {
    render(<TradingBlotter />);
    expect(screen.getByText('CONNECTING')).toBeDefined();
  });
});
