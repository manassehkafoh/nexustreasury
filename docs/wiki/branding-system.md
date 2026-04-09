# Branding System

NexusTreasury supports white-label deployment. Each bank tenant can configure
its own visual identity — colours, fonts, logo, locale, and feature flags.
All branding is applied at runtime with zero code changes.

---

## Brand Configuration

Brands are defined in `packages/web/src/lib/branding.ts`:

```typescript
export const BRANDS: Record<string, BrandConfig> = {
  'nexustreasury': {
    name:        'NexusTreasury',
    primaryColor: '#1a56db',
    accentColor:  '#7e3af2',
    logoUrl:      '/brands/nexustreasury/logo.svg',
    faviconUrl:   '/brands/nexustreasury/favicon.ico',
    fontFamily:   'Inter, system-ui, sans-serif',
    locale:       'en-GB',
    currency:     'USD',
  },
  'republic-bank': {
    name:         'Republic Bank',
    primaryColor: '#c8102e',   // Republic Bank red
    accentColor:  '#003087',
    logoUrl:      '/brands/republic-bank/logo.svg',
    faviconUrl:   '/brands/republic-bank/favicon.ico',
    fontFamily:   'Montserrat, system-ui, sans-serif',
    locale:       'en-TT',
    currency:     'TTD',
  },
};
```

---

## Applying a Brand

The brand is set via the `NEXT_PUBLIC_BRAND` environment variable:

```bash
# Development
NEXT_PUBLIC_BRAND=republic-bank pnpm --filter @nexustreasury/web dev

# Kubernetes (per-tenant Deployment patch in Kustomize overlay)
env:
  - name: NEXT_PUBLIC_BRAND
    valueFrom:
      configMapKeyRef:
        name: nexustreasury-tenant-config
        key: brandId
```

---

## Adding a New Brand

1. Create `public/brands/<brand-id>/logo.svg` and `favicon.ico`
2. Add the brand config to `BRANDS` in `packages/web/src/lib/branding.ts`
3. Pass `--brand <brand-id>` to `scripts/provision-tenant.ts`
4. Update the Kustomize overlay for the tenant's namespace

---

## Feature Flags

Each brand config can include feature flags to enable/disable modules:

```typescript
features: {
  fxEDealing:      true,   // FX eDealing blotter
  irrbbReporting:  true,   // BCBS 368 IRRBB reports
  collateralMgmt:  true,   // ISDA CSA margin calls
  islamicFinance:  false,  // Murabaha / Sukuk (MENA markets)
  aiInsights:      true,   // RAG-powered treasury assistant (Sprint 11)
  marketData:      true,   // Bloomberg / LSEG live rates
}
```

Feature-flagged components are excluded from the Next.js bundle at build time
via `NEXT_PUBLIC_FEATURES` environment variables — not just hidden in the UI.

---

## Tenant Provisioning

Brand assignment is part of the tenant provisioning flow:

```bash
pnpm tsx scripts/provision-tenant.ts \
  --tenantId   republic-bank \
  --displayName "Republic Bank Ltd" \
  --adminEmail admin@republicbank.tt \
  --currency   TTD \
  --brand      republic-bank

# Or via the Postman collection:
# 🏗️ Provision New Tenant (Platform Admin)
```
