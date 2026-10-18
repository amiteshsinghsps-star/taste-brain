import React, { useState } from 'react';
import { Plus, Sliders, Bot, Shield, Zap, X, Play, FileText, CheckCircle2, Search, Filter } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';

interface AgentsPageProps {
  agents: any[];
  handleToggleAgentMode: (agentId: string, currentMode: string) => void;
  loadAllData: () => void;
}

export const AgentsPage: React.FC<AgentsPageProps> = ({
  agents,
  handleToggleAgentMode,
  loadAllData,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentType, setAgentType] = useState('FREIGHT_AGENT');
  const [customAgentType, setCustomAgentType] = useState('');
  const [agentMode, setAgentMode] = useState<'COPILOT' | 'AUTOPILOT'>('COPILOT');
  const [loading, setLoading] = useState(false);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [taskResult, setTaskResult] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('ALL');
  const [deletingAgent, setDeletingAgent] = useState<any>(null);

  const setAllAgentsMode = async (targetMode: 'COPILOT' | 'AUTOPILOT') => {
    for (const ag of agents) {
      if (ag.mode !== targetMode) {
        await api.updateAgentMode(ag.id, targetMode);
      }
    }
    loadAllData();
  };

  const handleRunAgentWorkflow = async (agent: any) => {
    setRunningAgentId(agent.id);
    setTaskResult(null);
    try {
      const payload = {
        bookingNumber: `BKG-${agent.type}-${Date.now().toString().slice(-4)}`,
        shipper: 'Global Logistics Corp',
        consignee: 'Acme Imports Ltd',
        origin: 'Shanghai Port (CNSHA)',
        destination: 'Hamburg Port (DEHAM)',
        hsCode: '8471.30',
      };

      const res: any = await api.runFreight(agent.id, payload);
      setTaskResult({ agentName: agent.name, result: res });
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Workflow test failed');
    } finally {
      setRunningAgentId(null);
    }
  };

  const handleCreateAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName) return;

    const finalType = agentType === 'CUSTOM' ? (customAgentType.trim().toUpperCase().replace(/\s+/g, '_') || 'CUSTOM_AGENT') : agentType;

    setLoading(true);
    try {
      await api.createAgent({ name: agentName, type: finalType, mode: agentMode });
      setIsModalOpen(false);
      setAgentName('');
      setAgentType('FREIGHT_AGENT');
      setCustomAgentType('');
      setAgentMode('COPILOT');
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to create agent');
    } finally {
      setLoading(false);
    }
  };

  const filteredAgents = agents.filter((ag) => {
    const matchesSearch =
      !searchQuery ||
      ag.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ag.type?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = selectedTypeFilter === 'ALL' || ag.type === selectedTypeFilter;

    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Global Control Plane */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-600" /> AI Agent Instances & Steering Plane
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Spin up domain AI agents, toggle Copilot vs Autopilot modes, and trigger live workflow tests</p>
        </div>

        <Button
          size="sm"
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-2 rounded-xl shadow-xs self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 mr-1.5" /> Spin Up AI Agent
        </Button>
      </div>

      {/* Global Steering Mode Banner */}
      <Card className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/90 via-white to-purple-50/50 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-md uppercase tracking-wider">Workspace Control Plane</span>
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Sliders className="h-4 w-4 text-indigo-600" /> Global Agent Autonomy Steering
            </h4>
            <p className="text-xs text-slate-600">Switch all active agents between Copilot (Human-in-the-loop) and Autopilot (Full Autonomy) with 1 click.</p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAllAgentsMode('COPILOT')} className="text-xs bg-white border-slate-200 text-slate-700">
              <Shield className="h-3.5 w-3.5 mr-1.5 text-indigo-600" /> Set All COPILOT
            </Button>
            <Button size="sm" onClick={() => setAllAgentsMode('AUTOPILOT')} className="bg-amber-500 hover:bg-amber-600 text-white text-xs px-4 rounded-xl font-medium">
              <Zap className="h-3.5 w-3.5 mr-1.5" /> Set All AUTOPILOT
            </Button>
          </div>
        </div>
      </Card>

      {/* Live Workflow Test Result Card */}
      {taskResult && (
        <Card className="rounded-2xl border border-emerald-200 bg-emerald-50/30 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" /> Live Workflow Test Output — {taskResult.agentName}
            </h4>
            <div className="flex items-center gap-2">
              <Badge variant={taskResult.result?.task?.status === 'COMPLETED' ? 'success' : 'warning'} className="text-[11px]">
                {taskResult.result?.task?.status || 'EXECUTED'}
              </Badge>
              <button onClick={() => setTaskResult(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold px-2 py-1">
                Dismiss
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-1.5">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-indigo-600" /> Generated Cited Response Reply:
              </span>
              <p className="whitespace-pre-line text-slate-700 leading-relaxed">{taskResult.result?.draftReply}</p>
            </div>

            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-1.5">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Customs Declaration Draft JSON Payload:
              </span>
              <pre className="bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-800 overflow-x-auto max-h-48">
                {JSON.stringify(taskResult.result?.declarationDraft, null, 2)}
              </pre>
            </div>
          </div>
        </Card>
      )}

      {/* Agents Search & Type Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="relative flex-1 w-full">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
          <Input
            placeholder="Search agents by name or type..."
            className="pl-9 h-10 rounded-xl text-xs bg-slate-50 border-slate-200"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0 shrink-0">
          <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-1" />
          {['ALL', 'FREIGHT_AGENT', 'FINANCE_AGENT', 'EMAIL_AGENT', 'COMPLIANCE_AGENT'].map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTypeFilter(t)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors shrink-0 ${
                selectedTypeFilter === t
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {t.replace('_AGENT', '')}
            </button>
          ))}
        </div>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredAgents.map((ag) => (
          <Card key={ag.id} className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4 hover:border-indigo-300 transition-colors">
            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shrink-0">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{ag.name}</h4>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{ag.type}</p>
                </div>
              </div>
              <Badge variant={ag.status === 'RUNNING' ? 'success' : 'secondary'} className="text-[11px]">
                {ag.status}
              </Badge>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between">
              <div>
                <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                  {ag.mode === 'COPILOT' ? <Shield className="h-3.5 w-3.5 text-indigo-600" /> : <Zap className="h-3.5 w-3.5 text-amber-500" />}
                  Steering Mode: {ag.mode}
                </span>
                <p className="text-slate-500 text-[11px] mt-0.5">{ag.mode === 'COPILOT' ? 'Stages actions for human approval' : 'Executes directly & logs to audit'}</p>
              </div>
              <Button size="sm" variant={ag.mode === 'AUTOPILOT' ? 'default' : 'outline'} onClick={() => handleToggleAgentMode(ag.id, ag.mode)} className="text-xs h-8 rounded-xl px-3">
                <Sliders className="h-3.5 w-3.5 mr-1" /> Toggle to {ag.mode === 'COPILOT' ? 'AUTOPILOT' : 'COPILOT'}
              </Button>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const nextStatus = ag.status === 'RUNNING' ? 'PAUSED' : 'RUNNING';
                    api.updateAgentStatus(ag.id, nextStatus).then(loadAllData);
                  }}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                    ag.status === 'RUNNING'
                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                  }`}
                >
                  {ag.status === 'RUNNING' ? '⏸️ Pause Agent' : '▶️ Resume Agent'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingAgent(ag)}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg border border-red-200/60 transition-colors"
                >
                  🗑️ Delete
                </button>
              </div>

              <Button
                size="sm"
                onClick={() => handleRunAgentWorkflow(ag)}
                disabled={runningAgentId === ag.id || ag.status !== 'RUNNING'}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-4 py-2 font-medium"
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {runningAgentId === ag.id ? 'Executing Task...' : 'Run Agent Workflow Test'}
              </Button>
            </div>
          </Card>
        ))}

        {filteredAgents.length === 0 && (
          <div className="col-span-2 text-center text-xs text-slate-400 font-medium py-14 bg-white border border-slate-200 rounded-2xl">
            No agents matching filter. Click 'Spin Up AI Agent' above to create an agent instance manually.
          </div>
        )}
      </div>

      {/* Confirm Delete Agent Modal */}
      <ConfirmDialog
        isOpen={!!deletingAgent}
        title="Delete AI Agent Instance?"
        description={
          deletingAgent
            ? `Are you sure you want to delete agent "${deletingAgent.name}" (${deletingAgent.type})? This will permanently remove the agent instance and all associated task logs.`
            : ''
        }
        onConfirm={() => {
          if (deletingAgent) {
            api.deleteAgent(deletingAgent.id).then(loadAllData);
          }
        }}
        onClose={() => setDeletingAgent(null)}
      />

      {/* Spin Up AI Agent Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Spin Up Custom AI Agent Instance</h3>
                <p className="text-xs text-slate-500 mt-0.5">Deploy an autonomous domain agent with custom steering rules</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAgentSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Agent Name</label>
                <Input
                  placeholder="e.g. Asia Customs Clearance Agent"
                  className="h-10 rounded-xl text-xs"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Domain Agent Type</label>
                <select
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
                >
                  <option value="FREIGHT_AGENT">FREIGHT_AGENT (Logistics & Customs Clearance)</option>
                  <option value="FINANCE_AGENT">FINANCE_AGENT (Accounts Payable & Credit Limits)</option>
                  <option value="EMAIL_AGENT">EMAIL_AGENT (Customer Triage Desk)</option>
                  <option value="COMPLIANCE_AGENT">COMPLIANCE_AGENT (SOP & Denied Party Screening)</option>
                  <option value="CUSTOM">✨ CUSTOM DOMAIN (Specify Custom Agent Type...)</option>
                </select>

                {agentType === 'CUSTOM' && (
                  <div className="mt-2 space-y-1">
                    <label className="text-[11px] font-bold text-indigo-700 block">Custom Agent Domain Code</label>
                    <Input
                      placeholder="e.g. HR_ONBOARDING_AGENT, PROCUREMENT_AGENT, LEGAL_CONTRACT_AGENT..."
                      className="h-10 rounded-xl text-xs font-mono"
                      value={customAgentType}
                      onChange={(e) => setCustomAgentType(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Initial Steering Autonomy Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAgentMode('COPILOT')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      agentMode === 'COPILOT'
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 font-bold'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Shield className="h-3.5 w-3.5 text-indigo-600" /> COPILOT
                    </div>
                    <p className="text-[10px] text-slate-500 font-normal mt-1 leading-normal">Stages actions for human review</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAgentMode('AUTOPILOT')}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      agentMode === 'AUTOPILOT'
                        ? 'border-amber-500 bg-amber-50/70 text-amber-900 font-bold'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Zap className="h-3.5 w-3.5 text-amber-500" /> AUTOPILOT
                    </div>
                    <p className="text-[10px] text-slate-500 font-normal mt-1 leading-normal">Executes directly & logs to audit</p>
                  </button>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-5 py-2 rounded-xl font-medium">
                  {loading ? 'Spinning Up...' : 'Deploy Agent Instance'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
