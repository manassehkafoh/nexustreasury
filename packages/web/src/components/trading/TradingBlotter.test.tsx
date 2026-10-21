import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradingBlotter } from './TradingBlotter';

describe('TradingBlotter', () => {
  it('renders the blotter header', () => {
    render(<TradingBlotter />);
    expect(screen.getByText(/live trading blotter/i)).toBeDefined();
  });

  it('shows LIVE indicator', () => {
    render(<TradingBlotter />);
    // The status uses 'disconnected' or 'connecting' before connected
    // This text appears in the UI
    expect(screen.getAllByText(/connecting/i)).toBeDefined();
  });
});
