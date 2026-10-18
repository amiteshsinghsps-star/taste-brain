import React, { useState } from 'react';
import { User, Building2, Shield, Key, LogOut, CheckCircle, Lock, ShieldCheck, FileCheck, EyeOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ProfilePageProps {
  user: any;
  setUser: (user: any) => void;
  onLogout: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ user, setUser, onLogout }) => {
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState(user?.companyName || 'Neutronz Logistics Inc.');
  const [name, setName] = useState(user?.name || 'Ops Manager');
  const [email, setEmail] = useState(user?.email || 'ops@neutronz.com');
  const [industry, setIndustry] = useState('Freight Forwarding & Supply Chain');
  const [currency, setCurrency] = useState('USD ($)');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);

    setTimeout(() => {
      setSaving(false);
      setUser({ ...user, name, email, companyName });
      setSuccessMsg('Business profile and workspace settings updated successfully.');
    }, 500);
  };

  const securityFeatures = [
    { title: 'Argon2id Salted Password Hashing', status: 'ENFORCED', desc: 'Cryptographically salted password hashing preventing hash leaks.' },
    { title: 'HTTP-Only Cookie Refresh Token Rotation', status: 'ACTIVE', desc: 'Protected against XSS token theft via HTTP-Only SameSite cookies.' },
    { title: 'Granular 6-Scope Access Enforcer', status: 'ACTIVE', desc: 'Least-privilege permission grants across EMAIL, DRIVE, SLACK, ACCOUNTING, BRAIN, WORKFLOWS.' },
    { title: 'Tamper-Evident Decision Ledger', status: 'ACTIVE', desc: 'Audit rows are append-only by API contract, and each agent verdict hash-chains to the previous one — /ledger/verify reports the exact seq where a rewrite broke the chain. Evident, not immutable.' },
    { title: 'Enterprise HTTP Security Headers', status: 'ENFORCED', desc: 'nosniff, DENY framing, XSS protection, HSTS subdomains, and Referrer policy.' },
  ];

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Page Title */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Building2 className="h-5 w-5 text-indigo-600" /> Business Profile & Security Controls
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage your workspace identity, company parameters, and view enterprise security posture</p>
        </div>

        <Button onClick={onLogout} variant="destructive" size="sm" className="h-9 px-4 text-xs font-semibold rounded-xl">
          <LogOut className="h-4 w-4 mr-1.5" /> Logout Session
        </Button>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" /> {successMsg}
          </span>
          <button onClick={() => setSuccessMsg(null)} className="font-bold underline text-emerald-900">Dismiss</button>
        </div>
      )}

      {/* Grid of Profile Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card Banner */}
        <div className="md:col-span-1 rounded-2xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-indigo-900 text-white p-6 shadow-md flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-[11px] font-bold border border-white/30 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-emerald-300" /> ADMIN ROLE
              </span>
              <Badge variant="outline" className="border-white/30 text-white text-[10px]">VERIFIED</Badge>
            </div>

            <div className="h-16 w-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center font-extrabold text-xl text-white shadow-inner">
              {name.split(' ').map((n: string) => n[0]).join('') || 'OP'}
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">{companyName}</h2>
              <p className="text-xs text-white/80 font-medium mt-0.5">{name}</p>
              <p className="text-[11px] text-white/60 font-mono mt-0.5">{email}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-white/15 text-[11px] text-white/70 space-y-1">
            <p><strong>Workspace Domain:</strong> neutronz-os.internal</p>
            <p><strong>Auth Protocol:</strong> Argon2id + Refresh Token Cookies</p>
          </div>
        </div>

        {/* Business Settings Form Card */}
        <Card className="md:col-span-2 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
          <h3 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <User className="h-4 w-4 text-indigo-600" /> Edit Business Parameters
          </h3>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Company / Firm Name</label>
                <Input className="h-10 rounded-xl" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Operating Industry</label>
                <Input className="h-10 rounded-xl" value={industry} onChange={(e) => setIndustry(e.target.value)} />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Full Operator Name</label>
                <Input className="h-10 rounded-xl" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Work Email Address</label>
                <Input className="h-10 rounded-xl" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Operating Currency</label>
                <Input className="h-10 rounded-xl" value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Access Role</label>
                <Input className="h-10 rounded-xl bg-slate-50 text-slate-500 font-mono text-xs" value="ADMIN (FULL_ACCESS)" disabled />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end space-x-3">
              <Button type="submit" disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-6 py-2.5 font-medium shadow-xs">
                {saving ? 'Saving Changes...' : 'Save Profile Changes'}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Enterprise Security & Compliance Card */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Lock className="h-4.5 w-4.5 text-indigo-600" /> Active Security Measures
          </h3>
          <Badge variant="outline" className="text-xs px-3 py-1 border-slate-200 text-slate-600">
            Self-hosted &amp; tenant-isolated — no compliance certification claimed
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {securityFeatures.map((sec, idx) => (
            <div key={idx} className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" /> {sec.title}
                </span>
                <Badge variant="success" className="text-[10px] font-mono">{sec.status}</Badge>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">{sec.desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
