'use client';

/**
 * @module web/components/ui/BrandProvider
 *
 * React context for the active brand configuration.
 * Injects CSS custom properties into :root at runtime.
 * Allows any component to read brand tokens via useBrand().
 *
 * Usage:
 *   // layout.tsx — wrap the whole app once
 *   <BrandProvider brand={resolvedBrand}>
 *     {children}
 *   </BrandProvider>
 *
 *   // any component
 *   const { brand } = useBrand();
 *   <span style={{ color: 'var(--nt-accent)' }}>{brand.displayName}</span>
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  generateCSSVariables,
  NEXUSTREASURY_BRAND,
  BRAND_PRESETS,
  type BrandConfig,
} from '../../lib/branding';

// ── Context ───────────────────────────────────────────────────────────────────

interface BrandContextValue {
  brand:    BrandConfig;
  setBrand: (config: BrandConfig) => void;
  /** Switch to a named preset (e.g. 'republic-bank', 'minimal') */
  loadPreset: (id: string) => void;
}

const BrandContext = createContext<BrandContextValue>({
  brand:      NEXUSTREASURY_BRAND,
  setBrand:   () => {},
  loadPreset: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

interface BrandProviderProps {
  brand?:    BrandConfig;
  children:  React.ReactNode;
}

export function BrandProvider({ brand: initialBrand = NEXUSTREASURY_BRAND, children }: BrandProviderProps): JSX.Element {
  const [brand, setBrandState] = useState<BrandConfig>(initialBrand);

  // Inject CSS variables into :root whenever the brand changes
  useEffect(() => {
    const existingStyle = document.getElementById('nt-brand-vars');
    const style = existingStyle ?? ((): HTMLStyleElement => {
      const el = document.createElement('style');
      el.id = 'nt-brand-vars';
      document.head.appendChild(el);
      return el;
    })();
    style.textContent = generateCSSVariables(brand);

    // Sync lang + dir attributes for RTL locales
    document.documentElement.lang = brand.locale.language;
    document.documentElement.dir  = brand.locale.rtl ? 'rtl' : 'ltr';
  }, [brand]);

  const setBrand   = (config: BrandConfig): void => { setBrandState(config); };
  const loadPreset = (id: string): void => {
    const preset = BRAND_PRESETS[id];
    if (preset) setBrandState(preset);
  };

  const value = useMemo(() => ({ brand, setBrand, loadPreset }), [brand]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}

// ── LogoMark ──────────────────────────────────────────────────────────────────

/** Renders the brand logo mark from an inline SVG string */
export function BrandLogoMark({ className }: { className?: string }): JSX.Element {
  const { brand } = useBrand();
  return (
    <span
      className={className}
      aria-label={brand.logo.alt}
      style={{ display: 'inline-flex', width: brand.logo.markWidth }}
      dangerouslySetInnerHTML={{ __html: brand.logo.mark }}
    />
  );
}
