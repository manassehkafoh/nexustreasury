import type { Metadata } from 'next';
import './globals.css';

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
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
