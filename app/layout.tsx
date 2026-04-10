import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'

export const metadata: Metadata = {
  title:       'Ownership Explorer',
  description: 'Explore corporate ownership structures, brand hierarchies, and acquisition histories.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <div id="app">
          {children}
        </div>
      </body>
    </html>
  )
}
