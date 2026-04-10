/**
 * @module web/lib/branding
 *
 * NexusTreasury Branding Configuration System
 *
 * All visual identity elements are fully configurable per tenant via:
 *   1. BrandConfig object (TypeScript)
 *   2. CSS custom properties injected into :root
 *   3. Tailwind design-token overrides via tailwind.config.ts
 *
 * White-labelling use cases:
 *   - Tier-2 banks that deploy NexusTreasury under their own brand
 *   - Implementation partners presenting demos to prospects
 *   - Regional regulatory environments requiring local language + iconography
 *
 * Configuration sources (highest priority first):
 *   1. Database: tenant_config table → branding JSONB column
 *   2. Environment variables: NEXT_PUBLIC_BRAND_* prefix
 *   3. Built-in preset: 'nexustreasury' (default)
 *   4. Built-in preset: 'calypso-challenger' (competitive demo mode)
 *   5. Built-in preset: 'minimal' (bare bones for system integrators)
 *
 * @see PRD §9 — UX & Design Requirements
 * @see NFR-024 — Multi-language support
 */

// ── Brand Config Interface ────────────────────────────────────────────────────

export interface BrandColors {
  /** Deep dark background — primary page background */
  bgDeep: string;
  /** Surface background — cards, panels */
  bgSurface: string;
  /** Elevated surface — hover states, selected rows */
  bgElevated: string;
  /** Primary accent — logo, CTAs, gold highlights */
  accent: string;
  /** Accent light — hover states, shimmer */
  accentLight: string;
  /** Success / BUY direction */
  buy: string;
  /** Danger / SELL direction / alerts */
  sell: string;
  /** Warning — soft alerts, approaching limits */
  warning: string;
  /** Body text — primary */
  textPrimary: string;
  /** Muted text — labels, secondary info */
  textMuted: string;
  /** Border / divider */
  border: string;
}

export interface BrandTypography {
  /** Display font — hero text, logo mark, chart titles */
  fontDisplay: string;
  /** Body font — UI text, tables, forms */
  fontBody: string;
  /** Monospace — prices, numbers, code, reference numbers */
  fontMono: string;
}

export interface BrandLogo {
  /** SVG string or URL to logo mark (shown in collapsed sidebar) */
  mark: string;
  /** SVG string or URL to full wordmark (shown in expanded sidebar) */
  wordmark?: string;
  /** Alt text for accessibility */
  alt: string;
  /** Width of the mark in pixels */
  markWidth: number;
  /** Width of the wordmark in pixels */
  wordmarkWidth?: number;
}

export interface BrandLocale {
  /** BCP 47 language tag, e.g. 'en', 'fr', 'ar', 'es' */
  language: string;
  /** Number format locale, e.g. 'en-US', 'fr-FR', 'ar-AE' */
  numberLocale: string;
  /** Date format pattern */
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  /** Currency symbol position */
  currencySymbolPosition: 'before' | 'after';
  /** RTL layout */
  rtl: boolean;
}

export interface BrandConfig {
  /** Unique identifier — used as CSS class and localStorage key */
  id: string;
  /** Display name shown in the platform header */
  displayName: string;
  /** Tagline shown in the login page and splash screen */
  tagline?: string;
  /** Favicon URL or base64 data URI */
  favicon?: string;
  /** Color tokens */
  colors: BrandColors;
  /** Typography */
  typography: BrandTypography;
  /** Logo assets */
  logo: BrandLogo;
  /** Localisation */
  locale: BrandLocale;
  /** Custom CSS injected after design tokens (escape hatch for complex overrides) */
  customCSS?: string;
  /**
   * Feature flags per brand — some deployments hide certain modules
   * e.g. a small bank may not use FX Options or Collateral Management
   */
  features: {
    fxEDealing: boolean;
    irrbbReporting: boolean;
    collateralMgmt: boolean;
    islamicFinance: boolean;
    aiInsights: boolean; // shows AI/ML panel in dashboard
    marketData: boolean;
  };
}

// ── Built-in Brand Presets ────────────────────────────────────────────────────

/** Default NexusTreasury brand — dark navy + gold */
export const NEXUSTREASURY_BRAND: BrandConfig = {
  id: 'nexustreasury',
  displayName: 'NexusTreasury',
  tagline: 'Cloud-native treasury for modern banks',
  colors: {
    bgDeep: '#030C1B',
    bgSurface: '#071827',
    bgElevated: '#0C2038',
    accent: '#D4A843',
    accentLight: '#F0CA6A',
    buy: '#10b981',
    sell: '#EF4060',
    warning: '#F59E0B',
    textPrimary: '#EAF0FF',
    textMuted: '#6882A8',
    border: '#243558',
  },
  typography: {
    fontDisplay: "'Cormorant Garamond', Georgia, serif",
    fontBody: "'DM Sans', system-ui, sans-serif",
    fontMono: "'JetBrains Mono', 'Fira Code', monospace",
  },
  logo: {
    mark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="#D4A843"/>
      <path d="M8 22L16 8L24 22" stroke="#030C1B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10.5 18H21.5" stroke="#030C1B" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    alt: 'NexusTreasury',
    markWidth: 32,
    wordmarkWidth: 160,
  },
  locale: {
    language: 'en',
    numberLocale: 'en-US',
    dateFormat: 'DD/MM/YYYY',
    currencySymbolPosition: 'before',
    rtl: false,
  },
  features: {
    fxEDealing: true,
    irrbbReporting: true,
    collateralMgmt: true,
    islamicFinance: true,
    aiInsights: true,
    marketData: true,
  },
};

/** Republic Bank brand — Caribbean blue + gold */
export const REPUBLIC_BANK_BRAND: BrandConfig = {
  ...NEXUSTREASURY_BRAND,
  id: 'republic-bank',
  displayName: 'Republic Treasury',
  tagline: 'Republic Bank — Treasury Management',
  colors: {
    ...NEXUSTREASURY_BRAND.colors,
    accent: '#C8A84B', // Republic Bank gold
    accentLight: '#E8C86A',
    bgDeep: '#021420', // darker navy
    bgSurface: '#061C2E',
  },
  logo: {
    mark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="4" fill="#C8A84B"/>
      <text x="5" y="23" font-size="18" font-weight="bold" fill="#021420" font-family="serif">R</text>
    </svg>`,
    alt: 'Republic Bank',
    markWidth: 32,
  },
  features: {
    ...NEXUSTREASURY_BRAND.features,
    islamicFinance: false, // Not in scope for Caribbean deployment
  },
};

/** Minimal / white-label preset — neutral grays for system integrators */
export const MINIMAL_BRAND: BrandConfig = {
  ...NEXUSTREASURY_BRAND,
  id: 'minimal',
  displayName: 'Treasury Platform',
  tagline: '',
  colors: {
    bgDeep: '#0F1117',
    bgSurface: '#161B22',
    bgElevated: '#1C2128',
    accent: '#3B82F6',
    accentLight: '#60A5FA',
    buy: '#22C55E',
    sell: '#EF4444',
    warning: '#EAB308',
    textPrimary: '#F0F6FC',
    textMuted: '#8B949E',
    border: '#30363D',
  },
  typography: {
    fontDisplay: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    fontMono: "'JetBrains Mono', monospace",
  },
  logo: {
    mark: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#3B82F6"/>
      <path d="M10 20L16 10L22 20" stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    alt: 'Treasury Platform',
    markWidth: 32,
  },
};

/** All built-in presets */
export const BRAND_PRESETS: Record<string, BrandConfig> = {
  nexustreasury: NEXUSTREASURY_BRAND,
  'republic-bank': REPUBLIC_BANK_BRAND,
  minimal: MINIMAL_BRAND,
};

// ── CSS Variable Generator ────────────────────────────────────────────────────

/**
 * Convert a BrandConfig into a CSS custom property block injected into :root.
 * This enables full runtime theming without Tailwind class regeneration.
 *
 * Usage in Next.js layout.tsx:
 *   <style dangerouslySetInnerHTML={{ __html: generateCSSVariables(brand) }} />
 */
export function generateCSSVariables(brand: BrandConfig): string {
  const c = brand.colors;
  const t = brand.typography;
  return `
:root {
  --nt-bg-deep:       ${c.bgDeep};
  --nt-bg-surface:    ${c.bgSurface};
  --nt-bg-elevated:   ${c.bgElevated};
  --nt-accent:        ${c.accent};
  --nt-accent-light:  ${c.accentLight};
  --nt-buy:           ${c.buy};
  --nt-sell:          ${c.sell};
  --nt-warning:       ${c.warning};
  --nt-text:          ${c.textPrimary};
  --nt-muted:         ${c.textMuted};
  --nt-border:        ${c.border};
  --nt-font-display:  ${t.fontDisplay};
  --nt-font-body:     ${t.fontBody};
  --nt-font-mono:     ${t.fontMono};
}
${brand.customCSS ?? ''}
`.trim();
}

// ── Runtime Brand Resolver ────────────────────────────────────────────────────

/**
 * Resolve the active brand config for the current request.
 *
 * Resolution order:
 *  1. `NEXT_PUBLIC_BRAND_ID` env var (build-time override)
 *  2. `x-tenant-brand` HTTP header (set by API gateway from tenant DB)
 *  3. URL subdomain convention: `republic-bank.app.nexustreasury.io`
 *  4. Default: 'nexustreasury'
 *
 * In production this is called from the Next.js middleware and the result
 * is forwarded as a request header `x-brand-config` (JSON).
 */
export function resolveBrand(params?: {
  envBrandId?: string;
  headerBrandId?: string;
  hostname?: string;
  customConfig?: Partial<BrandConfig>;
}): BrandConfig {
  const brandId =
    params?.envBrandId ??
    params?.headerBrandId ??
    extractSubdomainBrandId(params?.hostname) ??
    'nexustreasury';

  const base = BRAND_PRESETS[brandId] ?? NEXUSTREASURY_BRAND;

  // Apply any runtime partial overrides (from tenant DB JSONB column)
  if (params?.customConfig) {
    return deepMergeBrand(base, params.customConfig);
  }
  return base;
}

function extractSubdomainBrandId(hostname?: string): string | undefined {
  if (!hostname) return undefined;
  const parts = hostname.split('.');
  if (parts.length >= 3) return parts[0]; // e.g. 'republic-bank' from 'republic-bank.app.nexustreasury.io'
  return undefined;
}

function deepMergeBrand(base: BrandConfig, override: Partial<BrandConfig>): BrandConfig {
  return {
    ...base,
    ...override,
    colors: { ...base.colors, ...(override.colors ?? {}) },
    typography: { ...base.typography, ...(override.typography ?? {}) },
    logo: { ...base.logo, ...(override.logo ?? {}) },
    locale: { ...base.locale, ...(override.locale ?? {}) },
    features: { ...base.features, ...(override.features ?? {}) },
  };
}
