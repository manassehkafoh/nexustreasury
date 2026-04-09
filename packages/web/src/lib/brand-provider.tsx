'use client';

/**
 * @module web/lib/brand-provider
 *
 * React context for runtime brand configuration.
 * Injects CSS custom properties into :root on mount and whenever brand changes.
 * Used by every component that needs brand-aware colours.
 *
 * Usage:
 *   // layout.tsx — wrap once at the root
 *   <BrandProvider config={resolvedBrand}>
 *     {children}
 *   </BrandProvider>
 *
 *   // any component
 *   const { brand } = useBrand();
 *   // brand.colors.accent, brand.features.fxEDealing, etc.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  generateCSSVariables,
  NEXUSTREASURY_BRAND,
  type BrandConfig,
} from './branding.js';

// ── Context ───────────────────────────────────────────────────────────────────

interface BrandContextValue {
  brand: BrandConfig;
}

const BrandContext = createContext<BrandContextValue>({
  brand: NEXUSTREASURY_BRAND,
});

// ── Provider ──────────────────────────────────────────────────────────────────

interface BrandProviderProps {
  config:   BrandConfig;
  children: ReactNode;
}

/**
 * Wrap the root layout with this provider.
 * It injects CSS variables into a <style> tag under document.head on mount,
 * keyed by brand.id so multiple brands in SSR tests don't conflict.
 */
export function BrandProvider({ config, children }: BrandProviderProps): JSX.Element {
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect((): (() => void) => {
    const css    = generateCSSVariables(config);
    const styleId = `nexus-brand-${config.id}`;

    // Reuse or create the <style> tag
    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = styleId;
      document.head.appendChild(el);
    }
    el.textContent = css;
    styleRef.current = el;

    // Apply brand id as data-brand on <html> for conditional CSS selectors
    document.documentElement.setAttribute('data-brand', config.id);
    // Apply RTL direction if needed
    document.documentElement.dir = config.locale.rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = config.locale.language;

    return (): void => {
      // Cleanup only if the element is still ours
      if (styleRef.current?.id === styleId) {
        styleRef.current.textContent = '';
      }
    };
  }, [config]);

  return (
    <BrandContext.Provider value={{ brand: config }}>
      {children}
    </BrandContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Access the active brand configuration from any client component.
 *
 * @example
 * function TradeButton() {
 *   const { brand } = useBrand();
 *   return (
 *     <button style={{ background: brand.colors.buy }}>
 *       BUY
 *     </button>
 *   );
 * }
 */
export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}

// ── Logo Component ────────────────────────────────────────────────────────────

interface LogoProps {
  variant?:  'mark' | 'wordmark';
  className?: string;
}

/**
 * Brand-aware logo component — renders the SVG mark or wordmark from config.
 * Use `variant="mark"` for collapsed sidebars and mobile headers.
 */
export function BrandLogo({ variant = 'mark', className }: LogoProps): JSX.Element {
  const { brand } = useBrand();
  const svg       = variant === 'wordmark' && brand.logo.wordmark
    ? brand.logo.wordmark
    : brand.logo.mark;
  const width = variant === 'wordmark'
    ? (brand.logo.wordmarkWidth ?? brand.logo.markWidth)
    : brand.logo.markWidth;

  return (
    <span
      className={className}
      aria-label={brand.logo.alt}
      role="img"
      style={{ display: 'inline-flex', width }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
