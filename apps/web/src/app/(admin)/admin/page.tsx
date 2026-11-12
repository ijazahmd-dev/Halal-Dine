import React from 'react';
import { ShieldCheck, Building2, FileCheck2, AlertTriangle, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

export default function AdminDashboardPage(): React.ReactNode {
  const stats = [
    {
      name: 'Pending Halal Verifications',
      value: '3',
      change: 'Requires review',
      href: '/admin/verifications',
      icon: ShieldCheck,
      color: 'text-amber-600 bg-amber-50',
    },
    {
      name: 'Pending Ownership Claims',
      value: '5',
      change: '2 from Kozhikode',
      href: '/admin/claims',
      icon: FileCheck2,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      name: 'Active Restaurants',
      value: '142',
      change: 'Kerala District Seed',
      href: '/admin/restaurants',
      icon: Building2,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      name: 'Open Consumer Reports',
      value: '1',
      change: 'Needs investigation',
      href: '/admin/reports',
      icon: AlertTriangle,
      color: 'text-rose-600 bg-rose-50',
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Operational Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review verification queues, incoming ownership claims, and system metrics.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow transition"
            >
              <div className="flex items-center justify-between">
                <span className={`inline-flex rounded-lg p-2.5 ${item.color}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-4">
                <h3 className="text-2xl font-bold text-slate-900">{item.value}</h3>
                <p className="text-xs font-semibold text-slate-600 mt-1">{item.name}</p>
                <p className="text-xs text-slate-400 mt-1">{item.change}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Verification Queue Summary */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900">
            Halal Verification Submissions Requiring Attention
          </h2>
          <span className="text-xs font-medium text-slate-500">
            Human verification required — No automated approvals
          </span>
        </div>

        <div className="border border-slate-100 rounded-lg divide-y divide-slate-100 text-sm">
          {[
            {
              restaurant: 'Paragon Restaurant',
              district: 'Kozhikode',
              evidence: 'Halal Certificate + Supplier Invoices',
              submitted: '2 hours ago',
            },
            {
              restaurant: 'Rahmath Hotel',
              district: 'Kozhikode',
              evidence: 'FSSAI + Halal Compliance Affidavit',
              submitted: '5 hours ago',
            },
            {
              restaurant: 'Dhe Puttu',
              district: 'Ernakulam',
              evidence: 'Meat Supplier Halal Certifications',
              submitted: '1 day ago',
            },
          ].map((item, index) => (
            <div key={index} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900">{item.restaurant}</p>
                <p className="text-xs text-slate-500">
                  {item.district} &bull; {item.evidence}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{item.submitted}</span>
                <button
                  type="button"
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 transition"
                >
                  Review Case
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
