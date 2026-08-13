import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://dealertech.io'),
  title: {
    default: 'DealerTech.io — Service drive intelligence for franchise dealerships',
    template: '%s · DealerTech.io',
  },
  description:
    'Know who pays before you write the RO. DealerTech reads the coverage a customer already owns, predicts what wears out next, and never lets a declined job go quiet.',
  openGraph: {
    type: 'website',
    siteName: 'DealerTech.io',
    title: 'Know who pays before you write the RO.',
    description:
      'Service drive intelligence for franchise dealerships. Coverage arbitration, prep sheets, and follow-up that actually happens.',
  },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
