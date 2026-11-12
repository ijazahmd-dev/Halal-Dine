import React from 'react';
import { ShieldCheck, MapPin, Search, Store } from 'lucide-react';
import Link from 'next/link';

export default function HomePage(): React.ReactNode {
  return (
    <div className="space-y-24 py-12 md:py-20">
      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-800">
            <ShieldCheck className="h-4 w-4 text-primary-600" />
            <span>Independent Halal Verification Platform</span>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
            Dine with Complete <span className="text-primary-600">Trust & Transparency</span>
          </h1>

          <p className="text-lg text-slate-600 sm:text-xl">
            Discover restaurants serving halal food with verified credentials, transparent evidence,
            and real-time location discovery across Kerala.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <Link
              href="#download"
              className="rounded-xl bg-primary-600 px-6 py-3.5 text-base font-semibold text-white shadow-md hover:bg-primary-700 transition"
            >
              Download Mobile App
            </Link>
            <Link
              href="/admin"
              className="rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-base font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
            >
              Admin Dashboard Demo
            </Link>
          </div>
        </div>
      </section>

      {/* Differentiator Highlights */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" id="verification">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Why Halal Dine is Different
          </h2>
          <p className="mt-2 text-slate-600">
            We don't simply list restaurants. We independently verify claims.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Verified Credentials</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Clear distinction between independent verification, owner claims, and unverified data.
              Every verified restaurant has inspectable certification and audit history.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
              <MapPin className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">PostGIS Geolocation</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Sub-millisecond proximity queries powered by PostgreSQL PostGIS. Accurate district and
              radius searches with turn-by-turn navigation.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <Store className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Owner Empowerment</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Restaurant owners can claim their business listing inside the mobile app, manage
              menus, and apply for official halal verification.
            </p>
          </div>
        </div>
      </section>

      {/* Kerala Districts */}
      <section className="bg-slate-50 py-16 border-y border-slate-200" id="kerala">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Kerala District Rollout
          </h2>
          <p className="mt-2 text-slate-600">
            Starting hyper-locally and expanding progressively across all 14 districts.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {[
              'Kozhikode',
              'Ernakulam',
              'Malappuram',
              'Thiruvananthapuram',
              'Thrissur',
              'Kannur',
              'Palakkad',
              'Kollam',
              'Alappuzha',
              'Kottayam',
              'Kasaragod',
              'Wayanad',
              'Pathanamthitta',
              'Idukki',
            ].map((district) => (
              <span
                key={district}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm border border-slate-200"
              >
                {district}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
