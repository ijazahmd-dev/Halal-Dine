import Link from 'next/link';
import {
  ShieldCheck,
  Building2,
  FileCheck2,
  AlertTriangle,
  Users,
  ScrollText,
  LayoutDashboard,
  ArrowLeft,
} from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navItems = [
    { label: 'Overview', href: '/admin', icon: LayoutDashboard },
    { label: 'Verification Queue', href: '/admin/verifications', icon: ShieldCheck, badge: '3' },
    { label: 'Ownership Claims', href: '/admin/claims', icon: FileCheck2, badge: '5' },
    { label: 'Restaurants', href: '/admin/restaurants', icon: Building2 },
    { label: 'Reports & Flags', href: '/admin/reports', icon: AlertTriangle, badge: '1' },
    { label: 'Users & Roles', href: '/admin/users', icon: Users },
    { label: 'Audit Logs', href: '/admin/audit', icon: ScrollText },
  ];

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700 font-bold text-white text-sm">
              HD
            </span>
            <span className="font-bold text-slate-800 tracking-tight">Admin Console</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-emerald-700 transition"
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-slate-500" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Return to Public Website</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        <header className="h-16 border-b border-slate-200 bg-white px-8 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-500">Halal Dine Administrator Portal</h2>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              Admin Session Active
            </span>
          </div>
        </header>

        <main className="flex-1 p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
