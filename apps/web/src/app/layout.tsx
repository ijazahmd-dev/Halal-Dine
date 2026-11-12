import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Halal Dine — Verified Halal Restaurant Discovery',
  description:
    'Discover restaurants serving verified halal food with complete transparency across Kerala and beyond.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
