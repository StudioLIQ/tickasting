import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GhostPass - Fair Ticketing on Kaspa',
  description: 'Zero-lag ticketing powered by Kaspa blockchain. Deterministic ordering, verifiable results.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  )
}
