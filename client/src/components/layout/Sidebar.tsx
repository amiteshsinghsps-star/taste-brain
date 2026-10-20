import React, { useState } from 'react';
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Home,
  Inbox,
  Ship,
  Sparkles,
  Workflow,
  Database,
  BookOpen,
  Share2,
  Bot,
  Shield,
  AlertTriangle,
  History,
  Building2,
  Route,
  ListChecks,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onRefresh: () => void;
}

type NavItem = { id: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { label: string; icon: React.ComponentType<{ className?: string }>; children: NavItem[] };

const mainNav: NavItem[] = [
  { id: 'overview', label: 'Overview Cockpit', icon: Home },
  { id: 'ask', label: 'Ask Company Brain', icon: Sparkles },
  { id: 'email', label: 'Email Desk Triage', icon: Inbox },
  { id: 'profile', label: 'Business Profile', icon: Building2 },
];

const shortcutsNav: NavItem[] = [
  { id: 'freight', label: 'Freight & Customs', icon: Ship },
  { id: 'approvals', label: 'Task Approvals', icon: ClipboardCheck },
];

const groupsNav: NavGroup[] = [
  {
    label: 'Brain',
    icon: Brain,
    children: [
      { id: 'sources', label: 'Data Sources', icon: Database },
      { id: 'skills', label: 'Executable Skills', icon: BookOpen },
      { id: 'graph', label: 'Knowledge Graph', icon: Share2 },
      { id: 'insights', label: 'Graph Insights', icon: Route },
      { id: 'watchlist', label: 'Screening List', icon: ListChecks },
      { id: 'review', label: 'Needs Review', icon: AlertTriangle },
    ],
  },
  {
    label: 'Work & Agents',
    icon: Workflow,
    children: [
      { id: 'freight', label: 'Freight Desk', icon: Ship },
      { id: 'agents', label: 'AI Agents & Steer', icon: Bot },
      { id: 'memory', label: 'Agent Memory', icon: Brain },
      { id: 'control', label: 'Control Plane & Team', icon: Shield },
    ],
  },
  {
    label: 'Signals & Audit',
    icon: Activity,
    children: [
      { id: 'audit', label: 'Audit Trail Logs', icon: History },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onRefresh }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>('Brain');

  const handleGroupToggle = (label: string) => {
    setOpenGroup(openGroup === label ? null : label);
  };

  return (
    <aside
      className={`relative border-r border-slate-200 bg-white transition-all duration-300 flex flex-col justify-between shrink-0 select-none z-30 ${
        collapsed ? 'w-[72px]' : 'w-[240px]'
      }`}
    >
      {/* Top Workspace Header */}
      <div>
        <div className={`p-4 border-b border-slate-200 flex items-center ${collapsed ? 'justify-center px-2' : 'justify-between'}`}>
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shrink-0 shadow-sm">
              <Brain className="h-5 w-5" />
            </div>
            {!collapsed && (
              <div className="truncate">
                <h1 className="font-bold text-slate-900 text-sm leading-tight truncate">Neutronz AI-OS</h1>
                <p className="text-[11px] text-indigo-600 font-medium truncate">Company Brain</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation Items */}
        <div className="p-3 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)]">
          {/* Main Direct Navigation */}
          <ul className="space-y-1">
            {mainNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setActiveTab(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      collapsed ? 'justify-center px-0 py-2.5' : ''
                    } ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-600'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Shortcuts Section */}
          <div>
            {!collapsed ? (
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Shortcuts</div>
            ) : (
              <div className="mx-2 my-2 border-t border-slate-200" />
            )}
            <ul className="space-y-1">
              {shortcutsNav.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => setActiveTab(item.id)}
                      title={collapsed ? item.label : undefined}
                      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        collapsed ? 'justify-center px-0 py-2.5' : ''
                      } ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-600'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Accordion Groups Section */}
          <div>
            {!collapsed ? (
              <div className="px-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Workspace</div>
            ) : (
              <div className="mx-2 my-2 border-t border-slate-200" />
            )}

            <ul className="space-y-1">
              {groupsNav.map((group) => {
                const GroupIcon = group.icon;
                const isOpen = openGroup === group.label;
                const isChildActive = group.children.some((c) => c.id === activeTab);

                return (
                  <li key={group.label}>
                    <button
                      onClick={() => (collapsed ? setCollapsed(false) : handleGroupToggle(group.label))}
                      title={collapsed ? group.label : undefined}
                      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        collapsed ? 'justify-center px-0 py-2.5' : ''
                      } ${
                        isChildActive ? 'text-indigo-700 font-bold bg-slate-50' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <GroupIcon className={`h-4 w-4 shrink-0 ${isChildActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left truncate">{group.label}</span>
                          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </>
                      )}
                    </button>

                    {!collapsed && isOpen && (
                      <ul className="ml-4 mt-1 pl-3 border-l border-slate-200 space-y-1">
                        {group.children.map((child) => {
                          const ChildIcon = child.icon;
                          const isActive = activeTab === child.id;
                          return (
                            <li key={child.id}>
                              <button
                                onClick={() => setActiveTab(child.id)}
                                className={`w-full flex items-center space-x-2 px-2 py-1.5 rounded text-xs transition-colors ${
                                  isActive
                                    ? 'bg-indigo-50 text-indigo-700 font-bold'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                }`}
                              >
                                <ChildIcon className={`h-3.5 w-3.5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                                <span className="truncate">{child.label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* Collapse Toggle Button */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/50 flex flex-col">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            className="flex-1 flex items-center justify-center p-2 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 transition-colors text-xs font-medium"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4 mr-1" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};
