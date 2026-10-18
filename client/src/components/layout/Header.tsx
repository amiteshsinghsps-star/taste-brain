import React, { useState } from 'react';
import { Search, User, LogOut, Settings } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface HeaderProps {
  activeTab: string;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onProfileClick: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  searchQuery,
  setSearchQuery,
  onSearchSubmit,
  onProfileClick,
  onLogout,
}) => {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <header className="h-16 border-b border-slate-200 bg-white px-8 flex items-center justify-between shrink-0">
      <div className="flex items-center space-x-3">
        <h2 className="text-xl font-bold text-slate-900 capitalize">{activeTab.replace('-', ' ')}</h2>
      </div>

      <div className="flex items-center space-x-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
          <Input
            placeholder="Search brain knowledge..."
            className="pl-9 w-64 h-9 bg-slate-50 border-slate-200 focus:bg-white text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit(e)}
          />
        </div>

        {/* User Profile Menu Dropdown */}
        <div className="relative pl-4 border-l border-slate-200">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center space-x-2 text-left focus:outline-none group cursor-pointer"
          >
            <div className="h-8 w-8 rounded-full bg-indigo-100 group-hover:bg-indigo-600 group-hover:text-white text-indigo-700 font-bold flex items-center justify-center text-xs transition-colors shadow-2xs">
              OP
            </div>
            <div className="leading-none hidden md:block">
              <p className="text-xs font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">Ops Manager</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Admin Role</p>
            </div>
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200/90 rounded-2xl shadow-xl py-2 z-50 text-xs">
              <button
                onClick={() => {
                  setShowMenu(false);
                  onProfileClick();
                }}
                className="w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50 font-medium flex items-center gap-2"
              >
                <User className="h-3.5 w-3.5 text-indigo-600" /> Business Profile & Settings
              </button>
              <div className="border-t border-slate-100 my-1" />
              <button
                onClick={() => {
                  setShowMenu(false);
                  onLogout();
                }}
                className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 font-semibold flex items-center gap-2"
              >
                <LogOut className="h-3.5 w-3.5 text-red-500" /> Logout Session
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
