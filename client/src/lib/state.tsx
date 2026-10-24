// Shared app state. One run at a time, kept in memory, so every screen describes
// the same proposal and no screen can quietly disagree with another.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
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

interface AppState {
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

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [modeInfo, setModeInfo] = useState<ModeInfo | null>(null);
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [pack, setPack] = useState('venues');
  const [locations, setLocations] = useState<PackLocation[]>([]);
  const [location, setLocation] = useState('');
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<TasteMode>('replay');
  const [approver, setApprover] = useState('');
  const [recentPlays, setRecentPlays] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [servedFrom, setServedFrom] = useState<'snapshot' | 'restored' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.mode().then((m) => { setModeInfo(m); setMode(m.default_mode); }).catch(() => {});
    api.packs().then((r) => setPacks(r.packs)).catch((e) => setError(String(e)));
  }, []);

  // A room change resets the operator's inputs: a no-repeat window or a goal
  // written for one room must not silently follow the next one. An adopted run
  // (a stored snapshot being re-served) is the one exception — it arrives with
  // its own room, and the selectors follow it instead of fighting it.
  const adopt = useRef<{ pack: string; location: string } | null>(null);

  // A browser reload wipes the in-memory run, but the server still holds it. The
  // room selector moves to the newest stored run's room and the effect below
  // re-serves that room's run — one path, so the two cannot race.
  const restoreRoom = useCallback((packId: string) => {
    api.latestProposal({ pack: packId })
      .then((r) => {
        const stored = r.proposal;
        if (stored && stored.pack === packId) setLocation(stored.location);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pack) return;
    const keep = adopt.current && adopt.current.pack === pack ? adopt.current : null;
    api.locations(pack).then((r) => {
      setLocations(r.locations);
      const wanted = keep && r.locations.some((l) => l.id === keep.location) ? keep.location : (r.locations[0]?.id ?? '');
      setLocation(wanted);
      const loc = r.locations.find((l) => l.id === wanted);
      setRecentPlays(loc?.recent_plays ?? []);
      if (!keep) {
        const p = packs.find((x) => x.pack === pack);
        if (p?.goal_templates?.length) setGoal(p.goal_templates[0].replace('{n}', '3').replace('{season}', 'autumn'));
        setProposal(null);
        setServedFrom(null);
        restoreRoom(pack);
      }
      adopt.current = null;
    }).catch((e) => setError(String(e)));
  }, [pack, packs, restoreRoom]);

  // The active run follows the room. Switching rooms must not leave the previous
  // room's proposal on screen under the new room's name.
  useEffect(() => {
    if (!pack || !location || busy || adopt.current) return;
    if (proposal && proposal.pack === pack && proposal.location === location) return;
    let cancelled = false;
    api.latestProposal({ pack, location })
      .then((r) => {
        if (cancelled) return;
        if (r.proposal) { setProposal(r.proposal); setGoal(r.proposal.goal); setServedFrom('restored'); }
        else { setProposal(null); setServedFrom(null); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pack, location, busy, proposal]);

  useEffect(() => {
    const loc = locations.find((l) => l.id === location);
    if (loc) setRecentPlays(loc.recent_plays ?? []);
  }, [location, locations]);

  const run = useCallback(async (opts: RunOptions = {}) => {
    if (!pack || !location || !goal) { setError('pick a pack, a room and a goal first'); return null; }
    setBusy(true); setError(null);
    try {
      const r = await api.createProposal({
        pack, location, goal, mode: opts.mode ?? mode,
        recent_plays: opts.recent_plays ?? (recentPlays.length ? recentPlays : undefined),
        rule_overrides: opts.rule_overrides,
        offer_terms: opts.offer_terms,
        chosen_seeds: opts.chosen_seeds,
        snapshot_id: opts.snapshot_id,
      });
      setProposal(r.proposal);
      setServedFrom(r.served_from ?? null);
      return r.proposal;
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
      return null;
    } finally { setBusy(false); }
  }, [pack, location, goal, mode, recentPlays]);

  const decide = useCallback(async (
    outcome: 'approved' | 'rejected',
    entity_ids?: string[],
    terms?: Record<string, Record<string, number>>,
  ) => {
    if (!proposal) return 'there is no proposal to decide on';
    if (!approver.trim()) return 'a named approver is required — the engine never signs on your behalf';
    try {
      const r = await api.decide(proposal.proposal_id, { outcome, approver: approver.trim(), entity_ids, terms });
      setProposal(r.proposal);
      return null;
    } catch (e: any) {
      return e?.message ? String(e.message) : String(e);
    }
  }, [proposal, approver]);

  const adoptRun = useCallback((p: Proposal) => {
    setGoal(p.goal);
    setProposal(p);
    setServedFrom('snapshot');
    if (p.pack === pack) {
      setLocation(p.location);
      setRecentPlays(locations.find((l) => l.id === p.location)?.recent_plays ?? []);
    } else {
      adopt.current = { pack: p.pack, location: p.location };
      setLocation('');
      setPack(p.pack);
    }
  }, [pack, locations]);

  const value = useMemo<AppState>(() => ({
    modeInfo, packs, pack, setPack, locations, location, setLocation,
    currentPack: packs.find((p) => p.pack === pack),
    currentLocation: locations.find((l) => l.id === location),
    goal, setGoal, mode, setMode, approver, setApprover,
    recentPlays, setRecentPlays,
    proposal, setProposal, adoptRun, servedFrom, busy, error, setError, run, decide,
  }), [modeInfo, packs, pack, locations, location, goal, mode, approver, recentPlays, proposal, servedFrom, busy, error, run, decide, adoptRun]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

/** Screens that only make sense once a run exists say so instead of showing zeros. */
export const NEEDS_RUN = 'No run yet. Plan a proposal first — every figure on this screen is computed from a stored run, and none of it is invented here.';
