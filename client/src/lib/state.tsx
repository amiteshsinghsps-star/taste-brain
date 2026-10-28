// Shared app state. One run at a time, kept in memory, so every screen describes
// the same proposal and no screen can quietly disagree with another. The types,
// the context object and the reader hook are in ./app-context.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { AppCtx, type AppState, type RunOptions } from './app-context';
import type { ModeInfo, PackLocation, PackSummary, Proposal, TasteMode } from './types';

export function AppProvider({ children }: { children: ReactNode }) {
  const [modeInfo, setModeInfo] = useState<ModeInfo | null>(null);
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [pack, setPack] = useState('venues');
  const [locations, setLocations] = useState<PackLocation[]>([]);
  const [location, setLocation] = useState('');
  const [typedGoal, setGoal] = useState('');
  const [mode, setMode] = useState<TasteMode>('live');
  const [approver, setApprover] = useState('');
  const [recentPlays, setRecentPlays] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [servedFrom, setServedFrom] = useState<'snapshot' | 'restored' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pack's own first goal template, filled for three acts this autumn. It is
  // derived, so it lands whenever the pack summaries do — no effect re-filling it.
  const goal = typedGoal || (packs.find((x) => x.pack === pack)?.goal_templates?.[0] ?? '').replace('{n}', '3').replace('{season}', 'autumn');

  useEffect(() => {
    api.mode().then((m) => { setModeInfo(m); setMode(m.default_mode); }).catch(() => {});
    api.packs().then((r) => setPacks(r.packs)).catch((e) => setError(String(e)));
  }, []);

  // A room change resets the operator's inputs: a no-repeat window or a goal
  // written for one room must not silently follow the next one. An adopted run
  // (a stored snapshot being re-served) is the one exception — it arrives with
  // its own room, and the selectors follow it instead of fighting it.
  const adopt = useRef<{ pack: string; location: string } | null>(null);

  // restoreRoom runs from a callback whose closure predates the fetch it is
  // reacting to, so it reads the freshly loaded rooms through a ref rather than
  // taking locations as a dependency — that would re-create the callback on every
  // pack load and re-trigger the effect that calls it.
  const locationsRef = useRef<PackLocation[]>([]);

  // Synchronous guard for run(): the busy state lands a render later, so two
  // triggers in the same tick would both pass an `if (busy)` check.
  const runningRef = useRef(false);

  // A browser reload wipes the in-memory run, but the server still holds it. The
  // room selector moves to the newest stored run's room and the effect below
  // re-serves that room's run — one path, so the two cannot race.
  const restoreRoom = useCallback((packId: string) => {
    api.latestProposal({ pack: packId })
      .then((r) => {
        const stored = r.proposal;
        if (stored && stored.pack === packId) {
          setLocation(stored.location);
          setRecentPlays(locationsRef.current.find((l) => l.id === stored.location)?.recent_plays ?? []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pack) return;
    // Guarded like the room-follow effect below: switching pack fast used to let
    // the slower reply land last and write the previous pack's rooms, then clear
    // a proposal that had just been restored. packs is read through a ref so this
    // effect runs once per pack instead of twice (once per packs load).
    let cancelled = false;
    const keep = adopt.current && adopt.current.pack === pack ? adopt.current : null;
    api.locations(pack).then((r) => {
      if (cancelled) return;
      locationsRef.current = r.locations;
      setLocations(r.locations);
      const wanted = keep && r.locations.some((l) => l.id === keep.location) ? keep.location : (r.locations[0]?.id ?? '');
      setLocation(wanted);
      const loc = r.locations.find((l) => l.id === wanted);
      setRecentPlays(loc?.recent_plays ?? []);
      if (!keep) {
        setGoal('');
        setProposal(null);
        setServedFrom(null);
        restoreRoom(pack);
      }
      adopt.current = null;
    }).catch((e) => {
      if (cancelled) return;
      // A failed room list ends the adoption attempt: leaving adopt.current set
      // would keep the run-follow effect below returning early forever.
      adopt.current = null;
      setError(String(e));
    });
    return () => { cancelled = true; };
  }, [pack, restoreRoom]);

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

  // A room and its recent plays move together. Doing it here, in the setter, is
  // what replaces the effect that used to re-sync one after the other changed.
  const selectLocation = useCallback((id: string) => {
    setLocation(id);
    setRecentPlays(locations.find((l) => l.id === id)?.recent_plays ?? []);
  }, [locations]);

  const run = useCallback(async (opts: RunOptions = {}) => {
    if (!pack || !location || !goal) { setError('pick a pack, a room and a goal first'); return null; }
    // One run at a time: the keyboard shortcut and the Re-run button both reach
    // this, and two overlapping runs would spend the Qloo budget twice and leave
    // the screens describing whichever response happened to land second.
    if (runningRef.current) return null;
    runningRef.current = true;
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
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : String(e));
      return null;
    } finally { runningRef.current = false; setBusy(false); }
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
    } catch (e) {
      return e instanceof Error && e.message ? e.message : String(e);
    }
  }, [proposal, approver]);

  const adoptRun = useCallback((p: Proposal) => {
    setGoal(p.goal);
    setProposal(p);
    setServedFrom('snapshot');
    if (p.pack === pack) {
      selectLocation(p.location);
    } else {
      adopt.current = { pack: p.pack, location: p.location };
      setLocation('');
      setPack(p.pack);
    }
  }, [pack, selectLocation]);

  const value = useMemo<AppState>(() => ({
    modeInfo, packs, pack, setPack, locations, location, setLocation: selectLocation,
    currentPack: packs.find((p) => p.pack === pack),
    currentLocation: locations.find((l) => l.id === location),
    goal, setGoal, mode, setMode, approver, setApprover,
    recentPlays, setRecentPlays,
    proposal, setProposal, adoptRun, servedFrom, busy, error, setError, run, decide,
  }), [modeInfo, packs, pack, locations, location, selectLocation, goal, mode, approver, recentPlays, proposal, servedFrom, busy, error, run, decide, adoptRun]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
