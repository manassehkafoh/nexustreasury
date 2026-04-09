# Branding System

NexusTreasury supports white-label deployment. Each bank tenant can apply its own brand — colours, fonts, logo, and locale — without rebuilding the application.

---

## Architecture

The branding system uses a configuration-driven approach. The `web` package reads brand configuration at build-time (static generation) and runtime (CSS custom properties), keeping bundle sizes minimal.

```
packages/web/src/lib/branding.ts    ← Brand configuration types + resolver
public/brands/                      ← Per-tenant brand assets (logo SVG, favicon)
  nexustreasury/
    logo.svg
    favicon.ico
  republic-bank/
    logo.svg
    favicon.ico
```

---

## Brand Configuration Schema

Each tenant's brand config is stored in the `brand_config` table (PostgreSQL, RLS-isolated per tenant) and injected into the Next.js layout at request time:

```typescript
interface BrandConfig {
  tenantId:    string;
  displayName: string;

  // Colours (CSS custom property values)
  colors: {
    primary:     string;  // Main brand colour   — e.g. '#0A5F9E'
    secondary:   string;  // Accent colour       — e.g. '#F5A623'
    background:  string;  // App background      — e.g. '#F8FAFC'
    surface:     string;  // Card/panel bg       — e.g. '#FFFFFF'
    text:        string;  // Primary text        — e.g. '#1A1A2E'
  };

  // Typography
  fonts: {
    heading: string;   // Google Fonts family name — e.g. 'Inter'
    body:    string;   // Body font               — e.g. 'Inter'
  };

  // Assets
  logoUrl:    string;  // Path to SVG logo
  faviconUrl: string;  // Path to favicon

  // Locale
  locale:   string;   // BCP 47 locale          — e.g. 'en-US', 'ar-AE'
  currency: string;   // Default ISO 4217 code  — e.g. 'USD', 'TTD', 'AED'
  timezone: string;   // IANA timezone          — e.g. 'America/Port_of_Spain'

  // Feature flags
  features: {
    fxEDealing:       boolean;
    irrbbReporting:   boolean;
    collateralMgmt:   boolean;
    islamicFinance:   boolean;
    aiInsights:       boolean;
    marketData:       boolean;
  };
}
```

---

## Built-in Themes

NexusTreasury ships with two brand profiles out of the box:

### `nexustreasury` (default)

```typescript
{
  colors: {
    primary:    '#0A5F9E',   // NexusTreasury Blue
    secondary:  '#F5A623',   // Amber accent
    background: '#F0F4F8',
    surface:    '#FFFFFF',
    text:       '#1A1A2E',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
}
```

### `republic-bank`

```typescript
{
  displayName: 'Republic Bank Ltd',
  colors: {
    primary:    '#C8102E',   // Republic Red
    secondary:  '#FFD700',   // Gold accent
    background: '#F8F8F8',
    surface:    '#FFFFFF',
    text:       '#1A1A1A',
  },
  currency: 'TTD',
  timezone: 'America/Port_of_Spain',
  locale:   'en-TT',
}
```

---

## Applying a Brand

### During tenant provisioning

```bash
pnpm tsx scripts/provision-tenant.ts \
  --tenantId   republic-bank \
  --displayName "Republic Bank Ltd" \
  --brand      republic-bank
```

The provisioning script reads `public/brands/republic-bank/` for assets and stores the config in the `brand_config` table.

### Updating an existing tenant's brand

```sql
UPDATE brand_config
SET colors = '{"primary": "#C8102E", "secondary": "#FFD700", ...}'::jsonb,
    updated_at = NOW()
WHERE tenant_id = 'republic-bank';
```

Or via the Platform Admin API:

```bash
curl -X PATCH https://admin.nexustreasury.io/api/v1/tenants/republic-bank/brand \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"colors": {"primary": "#C8102E"}}'
```

---

## Adding a New Brand

1. Create the brand directory:
   ```bash
   mkdir -p packages/web/public/brands/my-bank
   cp my-bank-logo.svg packages/web/public/brands/my-bank/logo.svg
   cp my-bank-favicon.ico packages/web/public/brands/my-bank/favicon.ico
   ```

2. Add the brand config to `packages/web/src/lib/branding.ts`:
   ```typescript
   export const BRAND_CONFIGS: Record<string, BrandConfig> = {
     'my-bank': {
       displayName: 'My Bank Ltd',
       colors: { primary: '#005B99', ... },
       currency: 'USD',
       timezone: 'America/New_York',
       features: { fxEDealing: true, islamicFinance: false, ... },
     },
   };
   ```

3. Provision the tenant (see above).

---

## Runtime Behaviour

CSS custom properties are injected into the `<html>` element by the Next.js layout server component:

```html
<html style="
  --color-primary: #C8102E;
  --color-secondary: #FFD700;
  --font-heading: 'Inter', sans-serif;
">
```

All Tailwind utility classes reference these CSS variables, so the entire UI theme updates without any JavaScript.

The logo is served from `/brands/{tenantId}/logo.svg` — cached at the CDN edge with a 30-day `Cache-Control: max-age=2592000, immutable` header.
