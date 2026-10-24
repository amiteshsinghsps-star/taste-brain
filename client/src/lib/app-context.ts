// The shape of the shared app state, and the reader side of it. The provider
// component lives in state.tsx; keeping this file component-free is what lets
// both modules hot-reload instead of tearing the tree down on every edit.

import { createContext, useContext } from 'react';
import type { ModeInfo, PackLocation, PackSummary, Proposal, TasteMode } from './types';

export interface RunOptions {
  mode?: TasteMode;
  goal?: string;
  recent_plays?: string[];
  rule_overrides?: Record<string, number>;
  offer_terms?: Record<string, Record<string, number>>;
  chosen_seeds?: Record<string, string>;
  snapshot_id?: string;
}

export interface AppState {
  modeInfo: ModeInfo | null;
  packs: PackSummary[];
  pack: string;
  setPack: (p: string) => void;
  locations: PackLocation[];
  location: string;
  setLocation: (l: string) => void;
  currentPack: PackSummary | undefined;
  currentLocation: PackLocation | undefined;
  goal: string;
  setGoal: (g: string) => void;
  mode: TasteMode;
  setMode: (m: TasteMode) => void;
  approver: string;
  setApprover: (a: string) => void;
  recentPlays: string[];
  setRecentPlays: (r: string[]) => void;
  proposal: Proposal | null;
  setProposal: (p: Proposal | null) => void;
  /** Make an existing run the active one, moving the pack and room selectors with it. */
  adoptRun: (p: Proposal) => void;
  /** How the active run got here: re-served from a snapshot, or restored after a reload. */
  servedFrom: 'snapshot' | 'restored' | null;
  busy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  run: (opts?: RunOptions) => Promise<Proposal | null>;
  decide: (outcome: 'approved' | 'rejected', entity_ids?: string[], terms?: Record<string, Record<string, number>>) => Promise<string | null>;
}

export const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

/** Screens that only make sense once a run exists say so instead of showing zeros. */
export const NEEDS_RUN = 'No run yet. Plan a proposal first — every figure on this screen is computed from a stored run, and none of it is invented here.';
