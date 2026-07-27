import { Fraunces, Inter, Caveat } from 'next/font/google';

import './globals.css';

// Tri-stack (see globals.css for how each is used):
//   Fraunces  — serif display, warm and editorial. Headings only.
//   Inter     — sans, the workhorse. All body copy, UI and long answers.
//   Caveat    — handwritten, accents only. Never for anything load-bearing.
// next/font self-hosts these at build time: no runtime request to Google, no
// layout shift, and `display: swap` so text is never invisible.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['600', '700', '900'],
  display: 'swap',
  variable: '--font-display',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-body',
});

const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-hand',
});

export const metadata = {
  title: 'Scholarship Assistant',
  description: 'Answers about Indian government scholarship schemes, from their official guideline documents.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is never disabled — pinch-to-zoom is an accessibility requirement.
  themeColor: '#2563EB',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
