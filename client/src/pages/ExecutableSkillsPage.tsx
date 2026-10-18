import React, { useEffect, useState } from 'react';
import { BookOpen, Edit2, History, Play, Plus, Trash2, ShieldCheck, Zap } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';

interface ExecutableSkillsPageProps {
  skills: any[];
  editingSkill: any;
  setEditingSkill: (skill: any) => void;
  handleUpdateSkill: (e: React.FormEvent) => void;
  loadAllData: () => void;
}

export const ExecutableSkillsPage: React.FC<ExecutableSkillsPageProps> = ({
  skills,
  editingSkill,
  setEditingSkill,
  handleUpdateSkill,
  loadAllData,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTriggerCondition, setNewTriggerCondition] = useState('On booking created or modified');
  const [newActionType, setNewActionType] = useState('CUSTOM_COMPLIANCE');
  const [submitting, setSubmitting] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<any>(null);

  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName || !newDescription) return;

    setSubmitting(true);
    try {
      await api.createSkill({
        ruleName: newRuleName,
        description: newDescription,
        triggerCondition: newTriggerCondition,
        actionType: newActionType,
        parameters: { active: true },
      });
      setShowAddModal(false);
      setNewRuleName('');
      setNewDescription('');
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to create skill rule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-indigo-600" /> Executable SOP Skill Rules Engine
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Versioned rules extracted from SOPs or defined manually. Immediate live agent enforcement.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowAddModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2 rounded-xl font-medium shadow-xs">
            <Plus className="h-4 w-4 mr-1.5" /> Add Custom Skill
          </Button>
          <Button size="sm" variant="outline" onClick={() => api.extractSkills().then(loadAllData)} className="text-xs border-slate-200 text-slate-700 bg-white">
            <Zap className="h-4 w-4 mr-1.5 text-amber-500" /> Auto-Extract from SOPs
          </Button>
        </div>
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {skills.map((skill) => (
          <Card key={skill.id} className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs border-l-4 border-l-indigo-600 space-y-4 hover:border-indigo-300 transition-colors">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-bold text-base text-slate-900 leading-snug">{skill.ruleName}</h4>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{skill.description}</p>
              </div>
              <Badge variant="outline" className="text-[11px] font-mono bg-indigo-50 text-indigo-700 border-indigo-200">
                v{skill.version}
              </Badge>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-xl space-y-1 text-xs">
              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" /> Trigger Condition:
              </span>
              <p className="text-slate-900 font-medium">{skill.triggerCondition}</p>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <Badge variant="secondary" className="text-[11px] font-mono">
                {skill.actionType}
              </Badge>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditingSkill(skill)} className="h-8 text-xs border-slate-200 text-slate-700">
                  <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit Parameters
                </Button>
                <button
                  type="button"
                  onClick={() => setDeletingSkill(skill)}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg border border-red-200/60 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </Card>
        ))}

        {skills.length === 0 && (
          <div className="col-span-2 text-center text-xs text-slate-400 font-medium py-14 bg-white border border-slate-200/90 rounded-2xl">
            No executable skills found. Click 'Auto-Extract from SOPs' or 'Add Custom Skill' above to create rules.
          </div>
        )}
      </div>

      {/* Policy Time Machine (W1): counterfactual rule replay over stored bookings */}
      <TimeMachineCard onApplied={loadAllData} />

      {/* Confirm Delete Skill Modal */}
      <ConfirmDialog
        isOpen={!!deletingSkill}
        title="Delete Executable Skill Rule?"
        description={
          deletingSkill
            ? `Are you sure you want to delete skill rule "${deletingSkill.ruleName}" (v${deletingSkill.version})? Active agents will no longer enforce this SOP condition.`
            : ''
        }
        onConfirm={() => {
          if (deletingSkill) {
            api.deleteSkill(deletingSkill.id).then(loadAllData);
          }
        }}
        onClose={() => setDeletingSkill(null)}
      />

      {/* Add Custom Skill Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-900">Define Custom Executable Skill Rule</h3>
              <p className="text-xs text-slate-500 mt-0.5">Rule will be assigned v1 and immediately enforced by all active agents</p>
            </div>

            <form onSubmit={handleCreateSkill} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Rule Name</label>
                <Input
                  placeholder="e.g. Dangerous Goods Cargo Declaration Check"
                  className="h-10 rounded-xl text-xs"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Description & Scope</label>
                <Input
                  placeholder="Ensure mandatory Class 9 dangerous goods certificate for battery shipments."
                  className="h-10 rounded-xl text-xs"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Action Type</label>
                <select
                  value={newActionType}
                  onChange={(e) => setNewActionType(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="DENIED_PARTY_SCREENING">DENIED_PARTY_SCREENING</option>
                  <option value="HS_CODE_VALIDATION">HS_CODE_VALIDATION</option>
                  <option value="CREDIT_LIMIT_APPROVAL">CREDIT_LIMIT_APPROVAL</option>
                  <option value="CUSTOM_COMPLIANCE">CUSTOM_COMPLIANCE</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Trigger Condition</label>
                <Input
                  placeholder="On booking created or modified"
                  className="h-10 rounded-xl text-xs font-mono"
                  value={newTriggerCondition}
                  onChange={(e) => setNewTriggerCondition(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-5 py-2 rounded-xl font-medium">
                  {submitting ? 'Creating...' : 'Create Skill Rule (v1)'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Skill Parameter Edit Modal */}
      {editingSkill && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-900">Edit Skill Parameters (Bumps to v{editingSkill.version + 1})</h3>
              <p className="text-xs text-slate-500 mt-0.5">Saving creates a new versioned rule entry in PostgreSQL</p>
            </div>

            <form onSubmit={handleUpdateSkill} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Rule Name</label>
                <Input value={editingSkill.ruleName} onChange={(e) => setEditingSkill({ ...editingSkill, ruleName: e.target.value })} className="h-10 rounded-xl text-xs" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Description</label>
                <Input value={editingSkill.description} onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })} className="h-10 rounded-xl text-xs" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Trigger Condition</label>
                <Input value={editingSkill.triggerCondition} onChange={(e) => setEditingSkill({ ...editingSkill, triggerCondition: e.target.value })} className="h-10 rounded-xl text-xs font-mono" />
              </div>
              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <Button type="button" variant="ghost" onClick={() => setEditingSkill(null)} className="text-xs">Cancel</Button>
                <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-5 py-2 rounded-xl font-medium">Save & Bump Version</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

/** W1 Policy Time Machine — replay stored bookings under candidate rule params before applying. */
const TimeMachineCard: React.FC<{ onApplied: () => void }> = ({ onApplied }) => {
  const [rules, setRules] = useState<GraphRuleItem[]>([]);
  const [ruleId, setRuleId] = useState('');
  const [candidateParams, setCandidateParams] = useState<Record<string, any>>({});
  const [sim, setSim] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState<any>(null);
  const [confirmApply, setConfirmApply] = useState(false);

  const loadRules = async () => {
    try {
      const res: any = await api.listGraphRules();
      const list: GraphRuleItem[] = (res.rules || []).filter((r: GraphRuleItem) => r.isExecutable && r.params && Object.keys(r.params).length > 0);
      setRules(list);
      if (list.length && !ruleId) {
        setRuleId(list[0].id);
        setCandidateParams({ ...list[0].params });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load graph rules');
    }
  };

  useEffect(() => { loadRules(); }, []);

  const selected = rules.find((r) => r.id === ruleId);

  const runSimulation = async () => {
    setBusy(true); setError(''); setSim(null); setApplied(null);
    try {
      const res: any = await api.simulateRule({ ruleId, candidateParams });
      setSim(res.simulation);
    } catch (err: any) {
      setError(err.message || 'Simulation failed');
    } finally {
      setBusy(false);
    }
  };

  const applySimulation = async () => {
    if (!sim) return;
    setBusy(true);
    try {
      const res: any = await api.applySimulation(sim.simulationId, { approverNote: `Applied from Time Machine UI (${sim.changed}/${sim.total} bookings change)` });
      setApplied(res);
      setSim(null);
      await loadRules();
      onApplied();
    } catch (err: any) {
      setError(err.message || 'Apply failed');
    } finally {
      setBusy(false); setConfirmApply(false);
    }
  };

  const discardSimulation = async () => {
    if (!sim) return;
    setBusy(true);
    try {
      await api.discardSimulation(sim.simulationId);
      setSim(null);
    } catch (err: any) {
      setError(err.message || 'Discard failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" /> Policy Time Machine
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Change a rule parameter and replay every stored booking under the candidate rule before touching production. Recorded verdicts come from the same pure engine, so replay fidelity is measured, not assumed.
          </p>
        </div>
        {rules.length > 0 && (
          <select
            value={ruleId}
            onChange={(e) => {
              setRuleId(e.target.value);
              const r = rules.find((x) => x.id === e.target.value);
              setCandidateParams(r ? { ...r.params } : {});
              setSim(null); setApplied(null);
            }}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-600"
          >
            {rules.map((r) => (
              <option key={r.id} value={r.id}>{r.ruleName} (v{r.version} · {r.actionType})</option>
            ))}
          </select>
        )}
      </div>

      {rules.length === 0 && !error && (
        <p className="text-xs text-slate-400 font-medium mt-4">No parameterized rules in the graph yet. Load the demo company or extract skills first.</p>
      )}

      {selected && (
        <div className="mt-4 flex flex-wrap items-end gap-3 p-3 bg-slate-50 border border-slate-200/70 rounded-xl">
          {Object.entries(selected.params).map(([key, value]) => (
            <div key={key}>
              <label className="text-[11px] font-bold text-slate-600 block mb-1 font-mono">{key}</label>
              <Input
                type={typeof value === 'number' ? 'number' : 'text'}
                className="h-9 rounded-xl text-xs w-32 font-mono"
                value={candidateParams[key] ?? ''}
                onChange={(e) => setCandidateParams({ ...candidateParams, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}
              />
            </div>
          ))}
          <Button size="sm" disabled={busy} onClick={runSimulation} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2 rounded-xl font-medium">
            <Play className="h-3.5 w-3.5 mr-1.5" /> {busy ? 'Replaying...' : 'Run What-If Simulation'}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-red-600 font-medium mt-3">{error}</p>}

      {applied && (
        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          <span className="font-bold">Applied.</span> New rule version <span className="font-mono">{applied.newRuleId}</span>, decision <span className="font-mono">{applied.decisionId}</span> recorded, ledger entry #{applied.ledgerSeq} appended. Old version superseded (never deleted).
        </div>
      )}

      {sim && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={sim.changed > 0 ? 'warning' : 'success'} className="text-[11px]">
              {sim.changed}/{sim.total} bookings change verdict
            </Badge>
            <Badge variant={sim.replayFidelity >= 0.99 ? 'success' : 'destructive'} className="text-[11px]">
              replay fidelity {(sim.replayFidelity * 100).toFixed(0)}% ({sim.replayMatches}/{sim.total})
            </Badge>
            {(sim.affectedCustomers || []).map((c: any) => (
              <Badge key={c.customer} variant="outline" className="text-[11px]">{c.customer}: {c.count}</Badge>
            ))}
          </div>

          {sim.diffs?.length > 0 && (
            <div className="border border-slate-200/80 rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Booking</TableHead>
                    <TableHead className="text-[11px]">Customer</TableHead>
                    <TableHead className="text-[11px]">Baseline</TableHead>
                    <TableHead className="text-[11px]">Candidate</TableHead>
                    <TableHead className="text-[11px]">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sim.diffs.map((d: any) => (
                    <TableRow key={d.bookingNumber}>
                      <TableCell className="text-xs font-mono font-medium">{d.bookingNumber}</TableCell>
                      <TableCell className="text-xs">{d.customer}</TableCell>
                      <TableCell className="text-xs"><Badge variant={verdictTone(d.baseline)} className="text-[10px]">{d.baseline}</Badge></TableCell>
                      <TableCell className="text-xs"><Badge variant={verdictTone(d.candidate)} className="text-[10px]">{d.candidate}</Badge></TableCell>
                      <TableCell className="text-xs font-mono">{d.margin}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => setConfirmApply(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-4 py-2 rounded-xl font-medium">
              Apply as new rule version
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={discardSimulation} className="text-xs border-slate-200 text-slate-700 bg-white">
              Discard simulation
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmApply}
        title="Apply rule change?"
        description={sim ? `This supersedes ${sim.ruleName} with the candidate parameters, records a Decision node, and appends a hash-chained ledger entry. ${sim.changed} stored bookings would have changed verdict.` : ''}
        onConfirm={applySimulation}
        onClose={() => setConfirmApply(false)}
      />
    </Card>
  );
};

interface GraphRuleItem {
  id: string;
  ruleName: string;
  actionType: string;
  version: number;
  params: Record<string, any>;
  isExecutable: boolean;
}

const verdictTone = (v: string): 'success' | 'destructive' | 'warning' | 'secondary' =>
  v === 'PASSED' ? 'success' : v === 'FLAGGED' ? 'destructive' : v === 'REQUIRES_APPROVAL' ? 'warning' : 'secondary';
