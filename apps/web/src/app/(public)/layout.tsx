import Link from 'next/link';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 font-bold text-white shadow-sm">
              HD
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Halal<span className="text-primary-600">Dine</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/#verification"
              className="text-sm font-medium text-slate-600 hover:text-primary-600 transition"
            >
              How It Works
            </Link>
            <Link
              href="/#kerala"
              className="text-sm font-medium text-slate-600 hover:text-primary-600 transition"
            >
              Kerala Rollout
            </Link>
            <Link
              href="/admin"
              className="text-sm font-medium text-slate-500 hover:text-slate-900 transition"
            >
              Admin Portal
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/#download"
              className="rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 transition"
            >
              Get the App
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-slate-900 text-slate-400">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm">
              &copy; {new Date().getFullYear()} Halal Dine. Built with trust and transparency for
              Kerala and beyond.
            </p>
            <div className="flex gap-6 text-sm">
              <Link href="/privacy" className="hover:text-white transition">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-white transition">
                Terms of Service
              </Link>
              <Link href="/admin" className="text-slate-500 hover:text-primary-400 transition">
                Admin
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
