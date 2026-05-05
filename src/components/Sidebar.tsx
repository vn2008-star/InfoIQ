'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, Bolt, Database, Settings, Upload } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Search', icon: Search },
  { href: '/bulk', label: 'Bulk Scrape', icon: Bolt },
  { href: '/import', label: 'Import CSV', icon: Upload },
  { href: '/saved', label: 'Saved Leads', icon: Database },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-white text-sm" style={{ background: 'var(--accent)' }}>
            IQ
          </div>
          <span className="logo-text font-bold text-[17px] tracking-tight" style={{ color: 'var(--text-primary)' }}>
            InfoIQ
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive ? 'active' : ''}`}
            >
              <item.icon className="icon" />
              <span className="link-text">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <Link href="/settings" className="sidebar-link">
          <Settings className="icon" />
          <span className="link-text">Settings</span>
        </Link>
        <div className="footer-text" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', paddingLeft: '14px' }}>
          InfoIQ v1.0
        </div>
      </div>
    </aside>
  );
}
