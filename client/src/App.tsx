import React, { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { OverviewPage } from '@/pages/OverviewPage';
import { AskBrainPage } from '@/pages/AskBrainPage';
import { ConnectorsPage } from '@/pages/ConnectorsPage';
import { KnowledgeGraphPage } from '@/pages/KnowledgeGraphPage';
import { NeedsReviewPage } from '@/pages/NeedsReviewPage';
import { ExecutableSkillsPage } from '@/pages/ExecutableSkillsPage';
import { FreightDeskPage } from '@/pages/FreightDeskPage';
import { EmailDeskPage } from '@/pages/EmailDeskPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { MemoryPage } from '@/pages/MemoryPage';
import { ControlPlanePage } from '@/pages/ControlPlanePage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';
import { TaskApprovalsPage } from '@/pages/TaskApprovalsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { LoginPage } from '@/pages/LoginPage';
import { api } from '@/lib/api';

export function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True until the first /api/auth/me round-trip settles, so a reload with a
  // valid session does not flash the login screen.
  const [booting, setBooting] = useState(true);

  // User Auth State — null until /api/auth/me resolves or somebody logs in.
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Core Data States
  const [sources, setSources] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [graphData, setGraphData] = useState<any>({ nodes: [], links: [] });

  // Brain Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [brainResult, setBrainResult] = useState<any>(null);

  // Modals & Active Selections
  const [editingSkill, setEditingSkill] = useState<any>(null);
  const [freightForm, setFreightForm] = useState({
    bookingNumber: '',
    shipper: '',
    consignee: '',
    origin: '',
    destination: '',
    hsCode: '',
  });
  const [freightResult, setFreightResult] = useState<any>(null);

  useEffect(() => {
    api.setOnUnauthenticated(() => {
      setCurrentUser(null);
      setActiveTab('login');
    });

    const urlParams = new URLSearchParams(window.location.search);
    const isOAuthSuccess =
      urlParams.get('status') === 'success' ||
      urlParams.has('connected_account_id') ||
      urlParams.get('tab') === 'sources' ||
      window.location.pathname.includes('/connectors');

    if (isOAuthSuccess) {
      setActiveTab('sources');
    }

    // Check existing auth session via HTTP-only refresh cookie / access token
    api
      .me()
      .then((res: any) => {
        if (res.user) {
          setCurrentUser(res.user);
          loadAllData();
          if (isOAuthSuccess) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } else {
          setActiveTab('login');
        }
      })
      .catch(() => {
        // No session: show the login screen. There is deliberately no
        // auto-login with a hard-coded account — a credential baked into the
        // bundle is readable by anyone who views source.
        setCurrentUser(null);
        setActiveTab('login');
      })
      .finally(() => setBooting(false));
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sourcesRes, skillsRes, agentsRes, teamRes, emailsRes, auditRes, graphRes] = await Promise.allSettled([
        api.listSources(),
        api.listSkills(),
        api.listAgents(),
        api.listTeam(),
        api.listEmails(),
        api.getAuditLogs(),
        api.getGraph(),
      ]);

      if (sourcesRes.status === 'fulfilled' && (sourcesRes.value as any)?.sources) setSources((sourcesRes.value as any).sources);
      if (skillsRes.status === 'fulfilled' && (skillsRes.value as any)?.skills) setSkills((skillsRes.value as any).skills);
      if (agentsRes.status === 'fulfilled' && (agentsRes.value as any)?.agents) setAgents((agentsRes.value as any).agents);
      if (teamRes.status === 'fulfilled' && (teamRes.value as any)?.members) setTeam((teamRes.value as any).members);
      if (emailsRes.status === 'fulfilled' && (emailsRes.value as any)?.emails) setEmails((emailsRes.value as any).emails);
      if (auditRes.status === 'fulfilled' && (auditRes.value as any)?.logs) setAuditLogs((auditRes.value as any).logs);
      if (graphRes.status === 'fulfilled' && (graphRes.value as any)?.graph) setGraphData((graphRes.value as any).graph);
    } catch (err: any) {
      console.error(err);
      setError('Failed to sync backend state. Make sure server is running on port 5000.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (e) {
      console.warn('Logout notice:', e);
    }
    setCurrentUser(null);
    setActiveTab('login');
  };

  const handleLoginSuccess = (user: any) => {
    setCurrentUser(user);
    setActiveTab('overview');
    loadAllData();
  };

  const handleAskBrain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setActiveTab('ask');
    setLoading(true);
    try {
      const res: any = await api.queryBrain(searchQuery);
      setBrainResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectSource = async (type: string, name: string, config: Record<string, any> = {}) => {
    try {
      const res: any = await api.createSource({ type, name, config });
      if (res.redirectUrl) {
        window.open(res.redirectUrl, '_blank');
      }
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSyncSource = async (id: string) => {
    try {
      await api.syncSource(id);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSkill) return;
    try {
      await api.updateSkill({
        skillId: editingSkill.id,
        ruleName: editingSkill.ruleName,
        description: editingSkill.description,
        triggerCondition: editingSkill.triggerCondition,
        parameters: editingSkill.parameters,
      });
      setEditingSkill(null);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRunFreight = async (agentId: string) => {
    setLoading(true);
    try {
      const res: any = await api.runFreight(agentId, freightForm);
      setFreightResult(res);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const [seeding, setSeeding] = useState(false);
  const handleSeedDemo = async () => {
    setSeeding(true);
    setError(null);
    try {
      await api.seedDemo();
      await loadAllData();
    } catch (err: any) {
      setError(err?.message || 'Demo seeding failed');
    } finally {
      setSeeding(false);
    }
  };

  const handleToggleAgentMode = async (agentId: string, currentMode: string) => {
    const nextMode = currentMode === 'COPILOT' ? 'AUTOPILOT' : 'COPILOT';
    try {
      await api.updateAgentMode(agentId, nextMode);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleScope = async (memberId: string, scope: string, currentlyGranted: boolean) => {
    try {
      if (currentlyGranted) {
        await api.revokeScope({ memberId, scope });
      } else {
        await api.grantScope({ memberId, scope });
      }
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApproveEmail = async (id: string) => {
    try {
      await api.approveEmail(id);
      loadAllData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (booting) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 font-sans text-xs text-slate-400">
        Restoring your session…
      </div>
    );
  }

  if (!currentUser || activeTab === 'login') {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onRefresh={loadAllData} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          activeTab={activeTab}
          user={currentUser}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearchSubmit={(e) => (setActiveTab('ask'), handleAskBrain(e))}
          onProfileClick={() => setActiveTab('profile')}
          onLogout={handleLogout}
        />

        {error && (
          <div className="bg-red-50 border-b border-red-200 text-red-700 px-6 py-2.5 text-xs flex justify-between items-center shrink-0">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="font-bold underline text-red-800">Dismiss</button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-8 space-y-6">
          {activeTab === 'overview' && (
            <OverviewPage
              user={currentUser}
              sources={sources}
              skills={skills}
              agents={agents}
              auditLogs={auditLogs}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              handleAskBrain={handleAskBrain}
              loading={loading}
              brainResult={brainResult}
              onNavigateTab={setActiveTab}
              handleSeedDemo={handleSeedDemo}
              seeding={seeding}
            />
          )}

          {activeTab === 'ask' && (
            <AskBrainPage
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              handleAskBrain={handleAskBrain}
              loading={loading}
              brainResult={brainResult}
            />
          )}

          {activeTab === 'sources' && (
            <ConnectorsPage
              sources={sources}
              handleConnectSource={handleConnectSource}
              handleSyncSource={handleSyncSource}
              loadAllData={loadAllData}
            />
          )}

          {activeTab === 'graph' && (
            <KnowledgeGraphPage graphData={graphData} loadAllData={loadAllData} />
          )}

          {activeTab === 'review' && <NeedsReviewPage />}

          {activeTab === 'skills' && (
            <ExecutableSkillsPage
              skills={skills}
              editingSkill={editingSkill}
              setEditingSkill={setEditingSkill}
              handleUpdateSkill={handleUpdateSkill}
              loadAllData={loadAllData}
            />
          )}

          {activeTab === 'freight' && (
            <FreightDeskPage
              freightForm={freightForm}
              setFreightForm={setFreightForm}
              handleRunFreight={handleRunFreight}
              agents={agents}
              loading={loading}
              freightResult={freightResult}
            />
          )}

          {activeTab === 'email' && (
            <EmailDeskPage emails={emails} handleApproveEmail={handleApproveEmail} loadAllData={loadAllData} />
          )}

          {activeTab === 'approvals' && <TaskApprovalsPage loadAllData={loadAllData} />}

          {activeTab === 'agents' && (
            <AgentsPage agents={agents} handleToggleAgentMode={handleToggleAgentMode} loadAllData={loadAllData} />
          )}

          {activeTab === 'memory' && <MemoryPage />}

          {activeTab === 'control' && (
            <ControlPlanePage team={team} handleToggleScope={handleToggleScope} loadAllData={loadAllData} />
          )}

          {activeTab === 'audit' && <AuditLogsPage auditLogs={auditLogs} />}

          {activeTab === 'profile' && (
            <ProfilePage user={currentUser} setUser={setCurrentUser} onLogout={handleLogout} />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
