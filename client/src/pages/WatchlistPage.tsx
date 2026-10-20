import React, { useEffect, useState } from 'react';
import { ListChecks, Plus, ShieldAlert, Trash2, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

/**
 * Screening list the tenant controls. Entries are WatchlistEntry nodes in the
 * tenant graph, and the denied-party rule reads them as facts — so adding one
 * changes the next freight verdict for real, and removing one un-screens it.
 */
export const WatchlistPage: React.FC = () => {
  const [entries, setEntries] = useState<any[]>([]);
  const [counts, setCounts] = useState<{ custom: number; seeded: number }>({ custom: 0, seeded: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [list, setList] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await api.listWatchlist();
      setEntries(res.entries || []);
      setCounts({ custom: res.custom ?? 0, seeded: res.seeded ?? 0 });
    } catch (err: any) {
      setError(err.message || 'Could not load the screening list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runPreview = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res: any = await api.previewWatchlist(name.trim());
      setPreview(res.preview);
    } catch (err: any) {
      setError(err.message || 'Preview failed');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.addWatchlistEntry({ name: name.trim(), list: list.trim() || undefined, note: note.trim() || undefined });
      setNotice(
        res.alreadyPresent
          ? `"${res.entry.name}" was already on the list — nothing was duplicated.`
          : `Added "${res.entry.name}". The next screening run reads it straight from the graph.`
      );
      setPreview(res.preview);
      setName('');
      setList('');
      setNote('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not add the entry');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res: any = await api.removeWatchlistEntry(id);
      setNotice(res.removed ? `Removed ${id} — bookings with that party now screen clean again.` : res.reason);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not remove the entry');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-indigo-600" /> Screening List
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Denied-party entries are graph facts. The freight rule reads every WatchlistEntry node at evaluation time,
          so an entry added here changes the next verdict without a redeploy.
        </p>
      </div>

      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Party name</label>
            <Input
              placeholder="e.g. Globex Shipping Ltd"
              className="h-9 rounded-xl text-xs bg-slate-50 mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">List (optional)</label>
            <Input
              placeholder="e.g. compliance-bulletin-oct"
              className="h-9 rounded-xl text-xs bg-slate-50 mt-1"
              value={list}
              onChange={(e) => setList(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Why (optional)</label>
          <Input
            placeholder="Source or reason, stored on the node"
            className="h-9 rounded-xl text-xs bg-slate-50 mt-1"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={runPreview} disabled={busy || name.trim().length < 2} className="text-xs bg-white">
            <Zap className="h-3.5 w-3.5 mr-1.5 text-indigo-600" /> Preview impact
          </Button>
          <Button size="sm" onClick={add} disabled={busy || name.trim().length < 2} className="bg-indigo-600 text-white text-xs">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add entry
          </Button>
        </div>

        {preview && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs space-y-2">
            <p className="font-mono text-slate-700">{preview.statement}</p>
            {(preview.wouldFlag || []).map((f: any, i: number) => (
              <div key={i} className="font-mono text-[11px] text-amber-800">
                {f.bookingNumber} · party “{f.party}” · matched “{f.matched}”
              </div>
            ))}
          </div>
        )}

        {notice && <p className="text-xs font-semibold text-emerald-700">{notice}</p>}
        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      </Card>

      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Entries ({entries.length})</h4>
          <div className="flex gap-2">
            <Badge variant="secondary" className="text-[10px]">yours: {counts.custom}</Badge>
            <Badge variant="outline" className="text-[10px]">demo seed: {counts.seeded}</Badge>
          </div>
        </div>

        {loading && <p className="text-xs text-slate-400">Loading…</p>}

        <div className="space-y-2">
          {entries.map((e: any) => {
            const seeded = e.demoSeed === 'true';
            return (
              <div key={e.id} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-900">{e.name}</span>
                <Badge variant={seeded ? 'outline' : 'success'} className="text-[10px]">{seeded ? 'demo seed' : 'your entry'}</Badge>
                {e.list && <span className="font-mono text-[10px] text-slate-500">{e.list}</span>}
                {e.note && <span className="text-slate-600">· {e.note}</span>}
                {e.addedBy && <span className="text-[10px] font-mono text-slate-400">by {e.addedBy}</span>}
                <span className="flex-1" />
                {seeded ? (
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3" /> part of the demo company, read-only
                  </span>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => remove(e.id)} disabled={busy} className="text-red-600 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                  </Button>
                )}
              </div>
            );
          })}
          {!loading && entries.length === 0 && (
            <p className="text-xs text-slate-500 py-4">No screening entries in this tenant graph.</p>
          )}
        </div>

        <p className="text-[10px] text-slate-400">
          Adding and removing writes a chained ledger entry (WATCHLIST_ENTRY_ADDED / WATCHLIST_ENTRY_REMOVED),
          so the change is attributable and the chain breaks if someone edits it afterwards.
        </p>
      </Card>
    </div>
  );
};
