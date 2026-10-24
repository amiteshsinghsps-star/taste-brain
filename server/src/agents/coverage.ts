// Qloo Coverage Board (F49). Reads the committed verification record and the
// latest live probe report, and reports what Qloo can and cannot do on this key.
//
// The board exists so the demo cannot overclaim: a capability that returns 200
// with zero rows is shown as "accepted but empty", not as a feature.

import * as fs from 'fs';
import * as path from 'path';

// The verification record lives at the server root (server/verification), one
// level above src/ and above dist/, so two levels up is correct in both layouts.
const VERIFICATION_DIR = path.join(__dirname, '..', '..', 'verification');

export interface CapabilityRow {
  id: string;
  name: string;
  endpoint: string;
  status: 'verified' | 'accepted_but_empty' | 'not_usable';
  params: string[];
  evidence: string;
  used_by: string;
  // From the live probe report, when a matching row exists.
  http_status?: number;
  row_count?: number;
  probe_at?: string;
}

export interface CoverageBoard {
  verified_at: string;
  base_url: string;
  gate: { requirement: string; result: string; note: string };
  counts: { verified: number; accepted_but_empty: number; not_usable: number };
  rows: CapabilityRow[];
  field_notes: string[];
  method: string;
}

function readJson<T>(file: string): T | null {
  const p = path.join(VERIFICATION_DIR, file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; }
}

interface CapFile {
  verified_at: string;
  base_url: string;
  method: string;
  decision_gate: { requirement: string; result: string; note: string };
  capabilities: Omit<CapabilityRow, 'http_status' | 'row_count' | 'probe_at'>[];
  field_notes: string[];
}

interface GateFile {
  verified_at: string;
  rows: { id: string; status: number; count: number }[];
}

/**
 * A capability can be probed by more than one request (Q10 compares two ways,
 * Q8 has a good and a bad shape). The row shown is the one that matches the
 * status the board claims, so a 400 from a deliberately wrong shape never
 * overwrites a verified result.
 */
function pickProbe(probe: GateFile | null, id: string, claimed: CapabilityRow['status']): { http_status?: number; row_count?: number; probe_at?: string } {
  if (!probe) return {};
  const matches = probe.rows.filter((r) => r.id === id || r.id.replace(/[ab]$/, '') === id);
  if (!matches.length) return {};
  const best = claimed === 'verified'
    ? matches.find((r) => r.status === 200 && r.count > 0)
    : claimed === 'accepted_but_empty'
      ? matches.find((r) => r.status === 200 && r.count === 0)
      : matches.find((r) => r.status >= 400);
  const row = best ?? matches[0];
  return { http_status: row.status, row_count: row.count, probe_at: probe.verified_at };
}

export function coverageBoard(): CoverageBoard {
  const caps = readJson<CapFile>('qloo-capabilities.json');
  const probe = readJson<GateFile>('gate-report.json');
  if (!caps) {
    return {
      verified_at: '',
      base_url: '',
      gate: { requirement: 'no verification record found in server/verification', result: 'unknown', note: 'Run `npm run gate` on a host with the Qloo key to produce it.' },
      counts: { verified: 0, accepted_but_empty: 0, not_usable: 0 },
      rows: [],
      field_notes: [],
      method: '',
    };
  }
  const rows: CapabilityRow[] = caps.capabilities.map((c) => ({ ...c, ...pickProbe(probe, c.id, c.status) }));
  return {
    verified_at: caps.verified_at,
    base_url: caps.base_url,
    gate: caps.decision_gate,
    counts: {
      verified: rows.filter((r) => r.status === 'verified').length,
      accepted_but_empty: rows.filter((r) => r.status === 'accepted_but_empty').length,
      not_usable: rows.filter((r) => r.status === 'not_usable').length,
    },
    rows,
    field_notes: caps.field_notes,
    method: caps.method,
  };
}
