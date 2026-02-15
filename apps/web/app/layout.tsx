import type { Metadata } from 'next'
import { GlobalNav } from '@/components/GlobalNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Tickasting - Fair Ticketing on Kasplex',
  description: 'On-chain EVM ordering ticketing on Kasplex testnet. Deterministic and verifiable.',
  icons: {
    icon: [{ url: '/favicon.ico' }, { url: '/icon.png', type: 'image/png' }],
    apple: '/icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <GlobalNav />
        {children}
      </body>
    </html>
  )
}
