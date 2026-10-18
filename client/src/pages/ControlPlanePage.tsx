import React, { useState } from 'react';
import { UserCheck, Lock, Unlock, Shield, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';

interface ControlPlanePageProps {
  team: any[];
  handleToggleScope: (memberId: string, scope: string, currentlyGranted: boolean) => void;
  loadAllData: () => void;
}

export const ControlPlanePage: React.FC<ControlPlanePageProps> = ({
  team,
  handleToggleScope,
  loadAllData,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('OPS');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['BRAIN', 'WORKFLOWS']);
  const [loading, setLoading] = useState(false);
  const [deletingMember, setDeletingMember] = useState<any>(null);

  const availableScopes = ['EMAIL', 'DRIVE', 'SLACK', 'ACCOUNTING', 'BRAIN', 'WORKFLOWS'];

  const toggleModalScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;

    setLoading(true);
    try {
      const res: any = await api.createTeamMember({ name, email, role });
      if (res.member?.id) {
        // Grant selected scopes for new member
        for (const scope of selectedScopes) {
          await api.grantScope({ memberId: res.member.id, scope });
        }
      }
      setIsModalOpen(false);
      setName('');
      setEmail('');
      setRole('OPS');
      setSelectedScopes(['BRAIN', 'WORKFLOWS']);
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to add team member');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-600" /> Team & Granular 6-Scope Access Control
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Manage team members and grant/revoke access across 6 granular system scopes</p>
        </div>
        <Button
          size="sm"
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2 rounded-xl shadow-xs"
        >
          <UserCheck className="h-4 w-4 mr-1.5" /> Add Team Member
        </Button>
      </div>

      {/* Main Team Table Card */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 bg-white">
          <h4 className="font-bold text-sm text-slate-900 tracking-tight">Active Team Members & Scope Grants ({team.length})</h4>
        </div>
        <Table>
          <TableHeader className="bg-slate-50/40 border-b border-slate-100">
            <TableRow className="border-b border-slate-100 hover:bg-transparent">
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Member Name</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Role</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Granular 6-Scope Access Grants</TableHead>
              <TableHead className="h-11 px-6 text-right align-middle font-bold text-xs text-slate-700">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.map((m) => (
              <TableRow key={m.id} className="border-b border-slate-100/80 hover:bg-slate-50/50 transition-colors">
                <TableCell className="px-6 py-4">
                  <p className="font-bold text-xs text-slate-900">{m.name}</p>
                  <p className="text-[11px] text-slate-500">{m.email}</p>
                </TableCell>
                <TableCell className="px-6 py-4">
                  <Badge variant="outline" className="text-[11px] bg-slate-50 border-slate-200 text-slate-700">
                    {m.role}
                  </Badge>
                </TableCell>
                <TableCell className="px-6 py-4">
                  <div className="flex flex-wrap gap-2">
                    {availableScopes.map((scope) => {
                      const grant = m.accessGrants?.find((g: any) => g.scope === scope);
                      const isGranted = grant?.isGranted ?? false;
                      return (
                        <button
                          key={scope}
                          onClick={() => handleToggleScope(m.id, scope, isGranted)}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center space-x-1.5 border transition-colors cursor-pointer ${
                            isGranted ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-2xs' : 'bg-slate-100 border-slate-200 text-slate-400 opacity-60'
                          }`}
                        >
                          {isGranted ? <Unlock className="h-3 w-3 text-indigo-600" /> : <Lock className="h-3 w-3 text-slate-400" />}
                          <span>{scope}</span>
                        </button>
                      );
                    })}
                  </div>
                </TableCell>
                <TableCell className="px-6 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => setDeletingMember(m)}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-xl border border-red-200/60 transition-colors"
                  >
                    🗑️ Remove Member
                  </button>
                </TableCell>
              </TableRow>
            ))}
            {team.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-center text-xs text-slate-400 font-medium py-14">
                  No team members added. Click 'Add Team Member' above to create a team member manually.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Confirm Delete Team Member Modal */}
      <ConfirmDialog
        isOpen={!!deletingMember}
        title="Remove Team Member Access?"
        description={
          deletingMember
            ? `Are you sure you want to remove team member "${deletingMember.name}" (${deletingMember.email})? Their system scope access grants will be revoked.`
            : ''
        }
        onConfirm={() => {
          if (deletingMember) {
            api.deleteTeamMember(deletingMember.id).then(loadAllData);
          }
        }}
        onClose={() => setDeletingMember(null)}
      />

      {/* Add Team Member Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-white rounded-2xl p-6 border border-slate-200 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-indigo-600" /> Add Team Member Manually
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddMemberSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Full Name</label>
                <Input
                  required
                  placeholder="e.g. Sarah Jenkins"
                  className="h-10 rounded-xl"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Email Address</label>
                <Input
                  required
                  type="email"
                  placeholder="e.g. sarah.j@firm.com"
                  className="h-10 rounded-xl"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Role</label>
                <select
                  className="w-full h-10 px-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="OPS">OPS — Operational Staff</option>
                  <option value="ACCOUNTS">ACCOUNTS — Finance & Billing</option>
                  <option value="ADMIN">ADMIN — Full Workspace Administrator</option>
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <label className="text-xs font-bold text-slate-700 block">Initial 6-Scope Access Grants</label>
                <div className="grid grid-cols-2 gap-2">
                  {availableScopes.map((scope) => (
                    <label
                      key={scope}
                      className={`flex items-center space-x-2 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                        selectedScopes.includes(scope) ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope)}
                        onChange={() => toggleModalScope(scope)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{scope}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} className="rounded-xl text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-5">
                  {loading ? 'Creating...' : 'Create Team Member'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};
