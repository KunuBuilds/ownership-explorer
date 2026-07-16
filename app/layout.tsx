import type { Metadata } from 'next'
import { Archivo, Instrument_Serif, Newsreader } from 'next/font/google'
import './globals.css'
import Nav from '@/components/Nav'

// Self-hosted at build time — replaces the render-blocking @import that used to
// sit at the top of globals.css.
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})

// Instrument Serif ships a single weight; italic is a separate face.
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title:       'Ownership Explorer',
  description: 'Explore corporate ownership structures, brand hierarchies, and acquisition histories.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${instrumentSerif.variable} ${newsreader.variable}`}
    >
      <body>
        <Nav />
        <div id="app">
          {children}
        </div>
      </body>
    </html>
  )
}
