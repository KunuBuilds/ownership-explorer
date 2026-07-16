'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LookupSearch from './LookupSearch'
import styles from './Nav.module.css'

export default function Nav() {
  const path = usePathname()

  const links = [
    { href: '/',           label: 'Look up' },
    { href: '/browse',     label: 'Browse companies' },
    { href: '/categories', label: 'Categories' },
    { href: '/feedback',   label: 'Suggest a fix' },
  ]

  // The landing page's hero is itself the search field — a second one in the
  // nav would be redundant.
  const showSearch = path !== '/'

  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.brand}>Ownership Explorer</Link>
      <div className={styles.links}>
        {links.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className={`${styles.link} ${path === l.href || (l.href !== '/' && path.startsWith(l.href)) ? styles.active : ''}`}
          >
            {l.label}
          </Link>
        ))}
      </div>
      {showSearch && <LookupSearch />}
    </nav>
  )
}
