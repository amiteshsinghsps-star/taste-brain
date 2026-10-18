import React, { useState } from 'react';
import { Brain, Lock, Mail, User, Shield, Building2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface LoginPageProps {
  onLoginSuccess: (userData: any) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('OPS');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === 'login') {
        const res: any = await api.login({ email, password });
        onLoginSuccess(res.user || { email, name: email.split('@')[0], role: 'ADMIN' });
      } else {
        const res: any = await api.register({ email, password, name, role, companyName });
        onLoginSuccess(res.user || { email, name, role, companyName });
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-4 antialiased">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Logo Header */}
        <div className="text-center space-y-2">
          <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold mx-auto shadow-md">
            <Brain className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Neutronz AI-OS</h1>
          <p className="text-xs text-slate-500 font-medium">Enterprise Company Brain & Autonomous Control Plane</p>
        </div>

        {/* Main Auth Form Card */}
        <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xl space-y-5">
          {/* Mode Switcher Tabs */}
          <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200/80">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${mode === 'login' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${mode === 'register' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              Register Identity
            </button>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Maya Kohli"
                    className="pl-9 h-10 rounded-xl text-xs"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Work Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  className="pl-9 h-10 rounded-xl text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="pl-9 h-10 rounded-xl text-xs font-mono"
                />
              </div>
            </div>

            {mode === 'register' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Role Scope</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="OPS">Ops</option>
                    <option value="ACCOUNTS">Accounts</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Company (Optional)</label>
                  <Input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Meridian Freight"
                    className="h-10 rounded-xl text-xs"
                  />
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs h-10 font-bold shadow-xs flex items-center justify-center gap-2 mt-2"
            >
              {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In to Workspace' : 'Create Identity'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          {mode === 'login' && (
            <div className="pt-3 border-t border-slate-100 text-center">
              <p className="text-[11px] text-slate-500">
                No account yet? <button type="button" onClick={() => setMode('register')} className="font-semibold text-indigo-600 hover:underline">Sign up</button>
                {' '}— every account gets its own isolated FalkorDB graph, so a fresh signup starts empty and you load the
                demo company from the Overview.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
