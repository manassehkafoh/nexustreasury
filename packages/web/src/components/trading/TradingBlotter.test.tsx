import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradingBlotter } from './TradingBlotter';

describe('TradingBlotter', () => {
  it('renders the blotter header', () => {
    render(<TradingBlotter />);
    expect(screen.getByText(/Live Trading Blotter/i)).toBeDefined();
  });

  it('shows CONNECTING indicator initially', () => {
    render(<TradingBlotter />);
    expect(screen.getByText('CONNECTING')).toBeDefined();
  });
});
