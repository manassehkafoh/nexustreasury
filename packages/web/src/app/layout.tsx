import type { Metadata } from 'next';
import './globals.css';
import { resolveBrand, generateCSSVariables } from '@/lib/branding';

export const metadata: Metadata = {
  title: 'NexusTreasury — Treasury Management Platform',
  description: 'Real-time, cloud-native treasury management for modern banks',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  // Resolve brand from environment / request headers (server component)
  const brand = resolveBrand({
    envBrandId: process.env['NEXT_PUBLIC_BRAND_ID'],
  });

  // Inject CSS variables as an inline <style> for zero-FOUC SSR theming
  const brandCSS = generateCSSVariables(brand);

  return (
    <html lang={brand.locale.language} dir={brand.locale.rtl ? 'rtl' : 'ltr'} className="dark" data-brand={brand.id}>
      <head>
        <style id={`nexus-brand-${brand.id}`} dangerouslySetInnerHTML={{ __html: brandCSS }} />
        {brand.favicon && <link rel="icon" href={brand.favicon} />}
      </head>
      <body style={{ fontFamily: brand.typography.fontBody }}>
        {children}
      </body>
    </html>
  );
}
