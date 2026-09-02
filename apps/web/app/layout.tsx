import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: 'Gilded Market Intelligence',
    template: '%s · Gilded',
  },
  description:
    'Private, source-aware market intelligence for a DonutSMP-compatible server.',
  applicationName: 'Gilded',
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    title: 'Gilded Market Intelligence',
    description: 'Private, source-aware market intelligence for a DonutSMP-compatible server.',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'Gilded — Source-aware market intelligence' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gilded Market Intelligence',
    description: 'Private, source-aware market intelligence for a DonutSMP-compatible server.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#090d0c',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
