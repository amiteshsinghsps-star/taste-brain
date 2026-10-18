import React, { useState } from 'react';
import { Ship, Play, ShieldAlert, FileText, CheckCircle, HelpCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';

interface FreightDeskPageProps {
  freightForm: any;
  setFreightForm: (form: any) => void;
  handleRunFreight: (agentId: string) => void;
  agents: any[];
  loading: boolean;
  freightResult: any;
}

export const FreightDeskPage: React.FC<FreightDeskPageProps> = ({
  freightForm,
  setFreightForm,
  handleRunFreight,
  agents,
  loading,
  freightResult,
}) => {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Ship className="h-5 w-5 text-indigo-600" /> Freight / Customs Desk Workflow
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">Parse booking → field validation → denied-party screening → cited reply → customs declaration draft</p>
      </div>

      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 className="font-bold text-sm text-slate-900">Booking & Shipment Input Parameters</h4>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sample Route Presets:</span>
              <button
                type="button"
                onClick={() =>
                  setFreightForm({
                    bookingNumber: 'BKG-SH-HAM-2026',
                    shipper: 'Global Logistics Corp',
                    consignee: 'Acme Imports Ltd',
                    origin: 'Shanghai Port (CNSHA)',
                    destination: 'Hamburg Port (DEHAM)',
                    hsCode: '8471.30',
                  })
                }
                className="text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold px-2.5 py-1 rounded-lg border border-indigo-200/60 transition-colors"
              >
                Shanghai → Hamburg
              </button>
              <button
                type="button"
                onClick={() =>
                  setFreightForm({
                    bookingNumber: 'BKG-SZ-LAX-9901',
                    shipper: 'Acme Banned Corp',
                    consignee: 'Pacific Freight Services',
                    origin: 'Shenzhen Yantian Port (CNNGB)',
                    destination: 'Port of Los Angeles (USLAX)',
                    hsCode: '8517.62',
                  })
                }
                className="text-[11px] bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold px-2.5 py-1 rounded-lg border border-amber-200/60 transition-colors"
              >
                Shenzhen → LA (Sanction Flagged)
              </button>
              <button
                type="button"
                onClick={() =>
                  setFreightForm({
                    bookingNumber: 'BKG-RTM-SIN-4042',
                    shipper: 'Rotterdam Port Logistics',
                    consignee: 'Singapore Marine Hub',
                    origin: 'Rotterdam Port (NLRTM)',
                    destination: 'Singapore Port (SGSIN)',
                    hsCode: '8409.91',
                  })
                }
                className="text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-1 rounded-lg border border-emerald-200/60 transition-colors"
              >
                Rotterdam → Singapore
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Booking Number</label>
              <Input className="h-10 rounded-xl" value={freightForm.bookingNumber} onChange={(e) => setFreightForm({ ...freightForm, bookingNumber: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Shipper Name</label>
              <Input className="h-10 rounded-xl" value={freightForm.shipper} onChange={(e) => setFreightForm({ ...freightForm, shipper: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Consignee Name</label>
              <Input className="h-10 rounded-xl" value={freightForm.consignee} onChange={(e) => setFreightForm({ ...freightForm, consignee: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Origin Port</label>
              <Input className="h-10 rounded-xl" value={freightForm.origin} onChange={(e) => setFreightForm({ ...freightForm, origin: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Destination Port</label>
              <Input className="h-10 rounded-xl" value={freightForm.destination} onChange={(e) => setFreightForm({ ...freightForm, destination: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">HS Code</label>
              <Input className="h-10 rounded-xl font-mono text-xs" value={freightForm.hsCode} onChange={(e) => setFreightForm({ ...freightForm, hsCode: e.target.value })} />
            </div>
          </div>

          <div className="pt-2">
            <Button onClick={() => handleRunFreight(agents[0]?.id || 'freight_agent_001')} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-6 py-2.5 font-medium shadow-xs">
              <Play className="h-4 w-4 mr-2" /> Run Freight & Customs Screen
            </Button>
          </div>
        </div>

        {freightResult && (
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-slate-900 text-sm">Execution Summary & Screening Results</h4>
              <Badge variant={freightResult.result?.violations?.length === 0 ? 'success' : 'destructive'} className="text-[11px]">
                Status: {freightResult.task?.status}
              </Badge>
            </div>

            <WhyNotPanel defaultBooking={freightResult.result?.bookingNumber || freightForm.bookingNumber} />

            <div className="p-5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-indigo-600" /> Generated Cited Response Reply:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (freightResult?.result?.draftReply) {
                      navigator.clipboard.writeText(freightResult.result.draftReply);
                      alert('Cited response reply copied to clipboard!');
                    }
                  }}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs transition-colors"
                >
                  📋 Copy Reply Text
                </button>
              </div>
              <p className="whitespace-pre-line text-slate-800 leading-relaxed pl-5">{freightResult.result?.draftReply}</p>
            </div>

            <div className="p-5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle className="h-4 w-4 text-emerald-600" /> Customs Declaration Draft JSON Payload:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (freightResult?.result?.declarationDraft) {
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(freightResult.result.declarationDraft, null, 2));
                      const downloadAnchor = document.createElement('a');
                      downloadAnchor.setAttribute("href", dataStr);
                      downloadAnchor.setAttribute("download", `customs_manifest_${freightResult.result.declarationDraft.manifestNumber || Date.now()}.json`);
                      document.body.appendChild(downloadAnchor);
                      downloadAnchor.click();
                      downloadAnchor.remove();
                    }
                  }}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs transition-colors"
                >
                  💾 Download Manifest JSON
                </button>
              </div>
              <pre className="bg-white p-4 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-800 overflow-x-auto">{JSON.stringify(freightResult.result?.declarationDraft, null, 2)}</pre>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

/** W3 Why-Not — per-rule evaluation with decision margins for a stored booking. */
const WhyNotPanel: React.FC<{ defaultBooking: string }> = ({ defaultBooking }) => {
  const [booking, setBooking] = useState(defaultBooking);
  const [whyNot, setWhyNot] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!booking) return;
    setBusy(true); setError(''); setWhyNot(null);
    try {
      const res: any = await api.whyNot(booking);
      setWhyNot(res.whyNot);
    } catch (err: any) {
      setError(err.message || 'Why-Not lookup failed');
    } finally {
      setBusy(false);
    }
  };

  const verdictTone = (v: string): 'success' | 'destructive' | 'warning' | 'secondary' =>
    v === 'PASSED' ? 'success' : v === 'FLAGGED' ? 'destructive' : v === 'REQUIRES_APPROVAL' ? 'warning' : 'secondary';

  return (
    <div className="p-5 bg-indigo-50/30 border border-indigo-100 rounded-2xl text-xs space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="font-bold text-slate-900 flex items-center gap-1.5 shrink-0">
          <HelpCircle className="h-4 w-4 text-indigo-600" /> Why this verdict?
        </span>
        <div className="flex items-center gap-2 flex-1">
          <Input
            className="h-8 rounded-xl text-xs font-mono max-w-48"
            placeholder="e.g. BK-1043"
            value={booking}
            onChange={(e) => setBooking(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          />
          <Button size="sm" disabled={busy} onClick={run} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-xl font-medium">
            {busy ? 'Explaining...' : 'Explain verdict'}
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">Works for any booking stored in the graph (e.g. seeded BK-1007 … BK-3005). Shows each rule's verdict, decision margin, and the closest near-miss rule.</p>

      {error && <p className="text-red-600 font-medium">{error}</p>}

      {whyNot && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono bg-white">{whyNot.bookingNumber}</Badge>
            <Badge variant={verdictTone(whyNot.recordedVerdict)} className="text-[10px]">recorded: {whyNot.recordedVerdict}</Badge>
            <Badge variant={verdictTone(whyNot.currentVerdict)} className="text-[10px]">current rules: {whyNot.currentVerdict}</Badge>
          </div>
          <div className="border border-indigo-100 bg-white rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Rule</TableHead>
                  <TableHead className="text-[11px]">Verdict</TableHead>
                  <TableHead className="text-[11px]">Margin</TableHead>
                  <TableHead className="text-[11px]">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(whyNot.evaluations || []).map((e: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{e.ruleName}</TableCell>
                    <TableCell className="text-xs"><Badge variant={verdictTone(e.verdict)} className="text-[10px]">{e.verdict}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{e.margin ?? '—'}</TableCell>
                    <TableCell className="text-[11px] text-slate-600">{(e.reasons || [])[0]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {whyNot.nearestRule && (
            <p className="text-[11px] text-slate-600">
              <span className="font-bold">Closest near-miss:</span> {whyNot.nearestRule.ruleName} (margin {whyNot.nearestRule.margin}) — the first rule that would flip under a small threshold change.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
