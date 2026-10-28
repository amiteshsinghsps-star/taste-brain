// HTTP surface. Every route is thin: it validates, calls the engine, and returns
// what the engine proved. Nothing here invents a fallback answer, and nothing
// here can leak the Qloo key — the key is read only inside rest-client.ts and
// surfaced as "set"/"missing".

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { env, qlooKeyStatus, qlooRestEnabled } from './config/env';
import { listPackIds, loadPack, getLocations, getLocation, getPublicLocations, getPublicLocation, getCatalog, findOffer, hasReplayFixture } from './packs/loader';
import { runPipeline, runFromSnapshot, decide, type RunInput } from './agents/pipeline';
import { createSession, callLog, servedMode } from './qloo/adapter';
import { quotaStatus, getRestLog } from './qloo/rest-client';
import { graph, verifyLedger, ledgerIsKeyed } from './graph/store';
import { runTasteLift } from './eval/taste-lift';
import { llmModel } from './agents/llm';
import { computeAblation, ablationHeadline } from './agents/ablation';
import { whatIf } from './agents/whatif';
import { whyNot } from './agents/whynot';
import { coPromotionPartners } from './agents/partners';
import { approvalBrief } from './agents/brief';
import { trustReport } from './agents/trust';
import { coverageBoard } from './agents/coverage';
import { quotaState, healthBuckets, qlooKeyAvailable, isTasteMode } from './agents/quota';
import { ALLOWED_PARAMS } from './qloo/allowlist';
import { sanitizeName } from './agents/auditor';
import { withModeMix, stampProposal } from './trace/builder';
import { exportFromStore, ExportSourceError } from './verify/buildFromStore';
import { ExportRefused } from './verify/export';
import { verifyExport } from './verify/verifier';
import { runAllAttacks, runAttack, ATTACK_IDS } from './breakit/attacks';
import type { Proposal, TasteMode, RunSnapshot } from './types';

// ── per-IP token bucket (PRD §14 controls) ───────────────────────────────────
const buckets = new Map<string, { tokens: number; ts: number }>();
function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: env.RATE_LIMIT_PER_MIN, ts: now };
  b.tokens = Math.min(env.RATE_LIMIT_PER_MIN, b.tokens + ((now - b.ts) / 60000) * env.RATE_LIMIT_PER_MIN);
  b.ts = now;
  if (b.tokens < 1) { buckets.set(ip, b); return res.status(429).json({ success: false, message: 'Rate limit reached. Try again shortly.' }); }
  b.tokens -= 1; buckets.set(ip, b); next();
}

const ID_RE = /^[A-Za-z0-9_-]+$/;
const isId = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && ID_RE.test(v);

/** Reject anything that is not a plain, bounded value before it reaches the engine. */
function safeString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length && s.length <= max ? s : null;
}

function numericMap(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) continue;   // refused, never coerced
    out[k.slice(0, 40)] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function entityMap(v: unknown): Record<string, Record<string, number>> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [entityId, fields] of Object.entries(v as Record<string, unknown>)) {
    const m = numericMap(fields);
    if (m && isId(entityId, 64)) out[entityId] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

function nameList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 40).map((x) => sanitizeName(String(x ?? ''))).filter(Boolean);
}

/**
 * The stored run an ask-about-room screen recomputes from. A snapshot carries the
 * room it was taken in, so a caller naming another room's run must be refused
 * rather than answered with rules and rows that describe somewhere else.
 */
function roomSnapshot(proposal_id: unknown, pack: string, location: string): { snap: RunSnapshot | null; error: string | null } {
  const named = proposal_id && isId(String(proposal_id), 40) ? String(proposal_id) : '';
  const snap = named ? graph.getSnapshot(named) : graph.latestSnapshotFor(pack, location);
  if (!snap) return { snap: null, error: 'no stored run for this room yet — run a proposal first' };
  if (named && (snap.pack !== pack || snap.location !== location)) {
    return { snap: null, error: `run ${named} was made for ${snap.pack}/${snap.location}, not ${pack}/${location}: its rules and rows do not describe this room` };
  }
  return { snap, error: null };
}

let lastEval: unknown = null;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // 0 keeps Express on the socket address, so a direct client cannot pick its own
  // IP with X-Forwarded-For. A host behind a proxy sets the hop count.
  if (env.TRUST_PROXY_HOPS > 0) app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  // The API only ever returns JSON, so a fetched document must never render. The
  // static client is left out: 'default-src none' would refuse its own scripts.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/healthz')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(cors({ origin: env.CLIENT_ORIGIN }));

  const latestProposal = (): Proposal | null => {
    const list = graph.listProposals();
    return list.length ? graph.getProposal<Proposal>(list[0].id) : null;
  };

  /** Terms on file for an entity: the pack's catalogue plus operator entries. */
  const fieldsFor = (pack: string, location: string, entityId: string, entityName?: string) => {
    const snap = graph.latestSnapshotFor(pack, location);
    const loc = (() => { try { return getLocation(pack, location); } catch { return null; } })();
    const offer = loc ? findOffer(pack, loc.catalog, entityId, entityName) : undefined;
    void snap;
    return { ...(offer?.fields ?? {}), ...graph.getOfferTerms(pack, location, entityId) };
  };

  // ── health & mode ──────────────────────────────────────────────────────────
  app.get('/healthz', (_req, res) => res.json({
    status: 'ok',
    mode: env.DEFAULT_MODE,
    qloo_enabled: env.QLOO_ENABLED,
    qloo_key: qlooKeyStatus(),
    finals_mode: env.FINALS_OVERRIDE,
    timestamp: new Date().toISOString(),
  }));

  // F41 Quota Guardian: budget buckets, coarse only, no identities and no keys.
  app.get('/api/health', (req, res) => {
    const s = quotaState(req.ip);
    res.json({
      success: true,
      status: s.live_allowed || !qlooKeyAvailable() ? 'ok' : 'degraded',
      qloo_key: qlooKeyStatus(),
      qloo_rest_active: qlooRestEnabled(),
      finals_mode: env.FINALS_OVERRIDE,
      default_mode: env.DEFAULT_MODE,
      llm_model: llmModel(),
      buckets: healthBuckets(req.ip),
      per_run_call_budget: env.QLOO_MAX_CALLS_PER_RUN,
      harness_quota: quotaStatus(),
      quota: {
        visitor_hour: { used: s.visitor_hour_used, limit: s.visitor_hour_limit },
        visitor_day: { used: s.visitor_day_used, limit: s.visitor_day_limit },
        global_day: { used: s.global_day_used, limit: s.global_day_limit },
        monthly: { used: s.monthly_used, floor: s.monthly_floor },
      },
      live_allowed: s.live_allowed,
      // Budget permitting is not the same as the host permitting it: on a box with
      // QLOO_ENABLED=false a live request is refused even with the whole budget free.
      live_possible: s.live_allowed && qlooRestEnabled(),
      floor_reached: s.floor_reached,
      note: !qlooRestEnabled()
        ? env.QLOO_API_KEY
          ? 'A Qloo key is present but live is switched off on this host (QLOO_ENABLED). No request leaves this box; every result is Cached or Replay.'
          : 'No Qloo key on this host. Every result is Cached or Replay.'
        : s.floor_reached
          ? 'The monthly floor is reached. Live requests now serve labelled Replay data so the key lasts through judging.'
          : s.live_allowed
            ? 'Live Qloo is available within budget.'
            : 'This visitor is over their live budget; the same Qloo answer is served from the stored copy and labelled Cached.',
    });
  });

  app.get('/api/mode', (req, res) => {
    const quota = quotaStatus();
    const s = quotaState(req.ip);
    res.json({
      default_mode: env.DEFAULT_MODE,
      qloo_enabled: env.QLOO_ENABLED,
      qloo_key: qlooKeyStatus(),
      qloo_rest_active: qlooRestEnabled(),
      finals_mode: env.FINALS_OVERRIDE,
      llm_model: llmModel(),
      quota_note: env.FINALS_OVERRIDE
        ? 'Finals Mode is on: no live Qloo call is made, stored results are served and labelled Cached.'
        : qlooRestEnabled()
          ? `Live calls available. Global demo budget today: ${s.global_day_used}/${s.global_day_limit}; this visitor ${s.visitor_day_used}/${s.visitor_day_limit}. Real quota reported by the harness: ${quota.used}/${quota.soft_limit}.`
          : env.QLOO_API_KEY
            ? 'A Qloo key is present but live is switched off on this host (QLOO_ENABLED=false), so no request leaves this box. Cached/Replay run from the stored copy and synthetic fixtures.'
            : 'No Qloo key on this host — running Cached/Replay from the stored copy and synthetic fixtures.',
      per_run_call_budget: env.QLOO_MAX_CALLS_PER_RUN,
      quota,
    });
  });

  // ── packs (configuration, not code) ────────────────────────────────────────
  app.get('/api/packs', (_req, res) => {
    const packs = listPackIds().map((id) => {
      const p = loadPack(id);
      return {
        pack: p.pack, unit: p.unit, display_name: p.display_name, description: p.description,
        goal_templates: p.goal_templates, copy: p.copy, rules: p.rules,
        data_provenance: p.locations.map((l) => ({ id: l.id, name: l.name, provenance: l.data_provenance })),
      };
    });
    res.json({ success: true, packs });
  });

  app.get('/api/packs/:id/locations', (req, res) => {
    try {
      // Committed identities: an overlaid pack carries real-world names inside its
      // seed ids, and this list is served to any browser.
      const locations = getPublicLocations(req.params.id).map((l) => ({ ...l, replay_fixture: hasReplayFixture(req.params.id, l.id) }));
      res.json({ success: true, locations });
    }
    catch { res.status(404).json({ success: false, message: 'unknown pack' }); }
  });

  app.get('/api/packs/:id/locations/:loc', (req, res) => {
    try {
      const loc = getPublicLocation(req.params.id, req.params.loc);
      const audience = graph.getNode<{ taste_tags: string[]; mode: TasteMode; fetched_at: string }>(`aud:${loc.id}`);
      res.json({ success: true, location: { ...loc, replay_fixture: hasReplayFixture(req.params.id, loc.id) }, audience, catalog_size: getCatalog(req.params.id, loc.catalog).length });
    } catch { res.status(404).json({ success: false, message: 'unknown location' }); }
  });

  // ── the run ────────────────────────────────────────────────────────────────
  app.post('/api/proposals', rateLimit, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (!isId(body.pack) || !isId(body.location)) return res.status(400).json({ success: false, message: 'pack and location must be short alphanumeric ids' });
      const goal = safeString(body.goal, 256);
      if (!goal) return res.status(400).json({ success: false, message: 'goal must be a string of 1..256 characters' });
      if (body.mode && !['live', 'cached', 'replay'].includes(body.mode)) return res.status(400).json({ success: false, message: 'mode must be live, cached or replay' });
      const chosen: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.chosen_seeds ?? {})) if (typeof v === 'string' && v.length <= 64) chosen[String(k).slice(0, 64)] = v;

      const input: RunInput = {
        pack: body.pack, location: body.location, goal,
        mode: body.mode, ip: req.ip,
        chosen_seeds: Object.keys(chosen).length ? chosen : undefined,
        offer_terms: entityMap(body.offer_terms),
        recent_plays: nameList(body.recent_plays),
        rule_overrides: numericMap(body.rule_overrides),
      };

      // F48 Finals Mode: never touch the network if a stored run exists.
      if (env.FINALS_OVERRIDE || body.snapshot_id) {
        if (body.snapshot_id && !isId(body.snapshot_id, 40)) return res.status(400).json({ success: false, message: 'bad snapshot id' });
        const fromSnap = runFromSnapshot({ ...input, snapshot_id: body.snapshot_id });
        if (fromSnap) return res.json({ success: true, proposal: stampProposal(fromSnap), served_from: 'snapshot' });
        // An explicitly requested snapshot must never silently become a fresh
        // run — that would serve network data under a replay label.
        if (body.snapshot_id) return res.status(404).json({ success: false, message: `no stored run matches snapshot_id ${body.snapshot_id}` });
        if (env.FINALS_OVERRIDE) return res.status(503).json({ success: false, message: 'Finals Mode is on but this room has no stored run. Run it once with the key to capture a snapshot.' });
      }

      const proposal = await runPipeline(input);
      res.json({ success: true, proposal: stampProposal(proposal) });
    } catch (err) { next(err); }
  });

  app.get('/api/proposals', (_req, res) => res.json({ success: true, proposals: graph.listProposals() }));

  // The most recent stored run, so a page reload does not lose the operator's work.
  // Both filters are optional — with neither, the newest run on this server is the
  // one to go back to. Declared before /api/proposals/:id, otherwise "latest" is
  // read as an id and refused as a malformed one.
  app.get('/api/proposals/latest', (req, res) => {
    const wanted = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? req.query[k] : '');
    const pack = wanted('pack'), location = wanted('location');
    if ((pack && !isId(pack)) || (location && !isId(location))) {
      return res.status(400).json({ success: false, message: 'pack and location must be short alphanumeric ids' });
    }
    const found = graph.listProposals().find((p) => (!pack || p.pack === pack) && (!location || p.location === location));
    const proposal = found ? graph.getProposal<Proposal>(found.id) : null;
    res.json({ success: true, proposal: proposal ? stampProposal(proposal) : null });
  });

  app.get('/api/proposals/:id', (req, res) => {
    const p = isId(req.params.id, 40) ? graph.getProposal<Proposal>(req.params.id) : null;
    if (!p) return res.status(404).json({ success: false, message: 'not found' });
    res.json({ success: true, proposal: stampProposal(p) });
  });

  app.get('/api/proposals/:id/trace', (req, res) => {
    const p = isId(req.params.id, 40) ? graph.getProposal<Proposal>(req.params.id) : null;
    if (!p) return res.status(404).json({ success: false, message: 'not found' });
    res.json(withModeMix(p.trace));
  });

  // ── W1 Verifier ────────────────────────────────────────────────────────────
  // The export is the whole evidence set for one decision, in one file. It is
  // refused for live runs until Qloo confirms what may be shared.
  app.get('/api/proposals/:id/export', (req, res) => {
    const id = isId(req.params.id, 40) ? req.params.id : '';
    if (!id) return res.status(400).json({ success: false, message: 'bad proposal id' });
    try {
      const exp = exportFromStore(id, env.EXPORT_ALLOW_LIVE);
      res.setHeader('content-disposition', `attachment; filename="taste-brain-${id}.json"`);
      res.json(exp);
    } catch (e) {
      if (e instanceof ExportRefused) return res.status(409).json({ success: false, message: e.message, refused: true });
      if (e instanceof ExportSourceError) return res.status(404).json({ success: false, message: e.message });
      throw e;
    }
  });

  // A FAIL here is a valid verdict, not an error, so the HTTP status stays 200 and
  // the report carries the outcome. The same verifyExport() backs the CLI.
  app.post('/api/verify', rateLimit, (req, res) => {
    res.json({ success: true, report: verifyExport(req.body) });
  });

  // ── Break-it Challenge (W6) ────────────────────────────────────────────────
  // Both routes run the real defences over the committed synthetic sample, so a
  // visitor can try to break the engine without a chance of breaking the store.
  // A blocked attack and a successful one are both 200: the verdict is data.
  app.get('/api/breakit', rateLimit, (_req, res) => {
    res.json({ success: true, report: runAllAttacks() });
  });

  app.post('/api/breakit', rateLimit, (req, res) => {
    const id = safeString(req.body?.attack, 40);
    if (!id || !ATTACK_IDS.includes(id)) {
      return res.status(400).json({ success: false, message: `attack must be one of ${ATTACK_IDS.join(', ')}` });
    }
    const outcome = runAttack(id);
    if (!outcome) return res.status(404).json({ success: false, message: 'unknown attack' });
    res.json({ success: true, attack: outcome });
  });

  // ── human decision (F7 + F15) ──────────────────────────────────────────────
  app.post('/api/proposals/:id/decision', rateLimit, (req, res) => {
    const outcome = req.body?.outcome;
    if (outcome !== 'approved' && outcome !== 'rejected') return res.status(400).json({ success: false, message: 'outcome must be approved or rejected' });
    const approver = safeString(req.body?.approver, 80);
    if (!approver) {
      const given = typeof req.body?.approver === 'string' ? req.body.approver.trim() : '';
      return res.status(400).json({
        success: false,
        message: given.length > 80
          ? `an approver name is capped at 80 characters — the one supplied is ${given.length}`
          : 'a named approver is required — the engine never signs on your behalf',
      });
    }
    const id = isId(req.params.id, 40) ? req.params.id : '';
    const p = id ? graph.getProposal<Proposal>(id) : null;
    if (!p) return res.status(404).json({ success: false, message: 'not found' });

    const result = decide(p, outcome, approver, {
      entity_ids: Array.isArray(req.body?.entity_ids) ? req.body.entity_ids.filter((x: unknown) => typeof x === 'string' && x.length <= 64) : undefined,
      terms: entityMap(req.body?.terms),
    });
    if (result.error) return res.status(409).json({ success: false, message: result.error, blocked: true });
    res.json({ success: true, proposal: stampProposal(result.proposal) });
  });

  // ── F11 Ablation Lab ───────────────────────────────────────────────────────
  app.get('/api/proposals/:id/ablation', (req, res) => {
    const id = isId(req.params.id, 40) ? req.params.id : '';
    const snap = graph.getSnapshot(id);
    if (!snap) return res.status(404).json({ success: false, message: 'no stored run for that proposal' });
    const result = computeAblation(snap);
    res.json({ success: true, ablation: result, headline: ablationHeadline(result) });
  });

  app.get('/api/snapshots', (_req, res) => res.json({ success: true, snapshots: graph.listSnapshots() }));

  // ── F12 Why-not ────────────────────────────────────────────────────────────
  app.post('/api/whynot', rateLimit, async (req, res, next) => {
    try {
      const { pack, location, query, proposal_id } = req.body ?? {};
      if (!isId(pack) || !isId(location)) return res.status(400).json({ success: false, message: 'pack and location must be short alphanumeric ids' });
      const q = safeString(query, 80);
      if (!q) return res.status(400).json({ success: false, message: 'query must be a name to look for' });
      const { snap, error } = roomSnapshot(proposal_id, pack, location);
      if (!snap) return res.status(404).json({ success: false, message: error });
      const loc = getLocation(pack, location);
      const allowLive = req.body?.check_entity === true;
      const livePossible = allowLive && qlooKeyAvailable() && env.QLOO_ENABLED;
      // Whether a /search call actually left this box. The screen reports it as
      // fact, so it must not be the caller's request echoed back.
      let lookupsMade = 0;
      const answer = await whyNot({
        snapshot: snap,
        query: q,
        fieldsFor: (entityId, name) => fieldsFor(pack, location, entityId, name ?? q),
        excluded_ids: loc.exclude_entity_ids ?? [],
        recent_plays: nameList(req.body?.recent_plays) ?? loc.recent_plays ?? [],
        resolveLive: livePossible
          ? async (name) => {
              // One search call, only when the operator explicitly asked to check
              // whether Qloo knows the entity at all.
              const session = createSession({ pack, location, requestedMode: 'live', ip: req.ip });
              const r = await session.resolveSeeds([name], `urn:entity:${loadPack(pack).qloo.target_types[0] ?? 'artist'}`);
              lookupsMade += session.live_calls;
              return { exists: r.ids.length > 0, entity_id: r.ids[0] };
            }
          : undefined,
      });
      res.json({ success: true, answer, live_check_used: lookupsMade > 0, live_check_declined: allowLive && lookupsMade === 0 });
    } catch (err) { next(err); }
  });

  // ── F13 What-if ────────────────────────────────────────────────────────────
  app.post('/api/whatif', rateLimit, (req, res, next) => {
    try {
      const { pack, location, rule_overrides, offer_terms, recent_plays, band, proposal_id } = req.body ?? {};
      if (!isId(pack) || !isId(location)) return res.status(400).json({ success: false, message: 'pack and location must be short alphanumeric ids' });
      const { snap, error } = roomSnapshot(proposal_id, pack, location);
      if (!snap) return res.status(404).json({ success: false, message: error });
      if (!band && !rule_overrides && !offer_terms && !recent_plays) {
        return res.status(400).json({ success: false, message: 'nothing to recompute: pass a threshold, a term, a band or a recent-play list' });
      }
      const b = band && typeof band === 'object' ? { min: Number((band as any).min), max: Number((band as any).max) } : undefined;
      if (b && (Number.isFinite(b.min) && (b.min! < 0 || b.min! > 1) || Number.isFinite(b.max) && (b.max! < 0 || b.max! > 1))) {
        return res.status(400).json({ success: false, message: 'popularity band values must be floats between 0 and 1 — the same rule Qloo enforces' });
      }
      res.json({
        success: true,
        whatif: whatIf({
          snapshot: snap,
          rule_overrides: numericMap(rule_overrides),
          offer_terms: entityMap(offer_terms),
          recent_plays: nameList(recent_plays),
          band: b && (Number.isFinite(b.min) || Number.isFinite(b.max)) ? { min: Number.isFinite(b.min) ? b.min : undefined, max: Number.isFinite(b.max) ? b.max : undefined } : undefined,
          fieldsFor: (entityId) => fieldsFor(pack, location, entityId),
        }),
      });
    } catch (err) { next(err); }
  });

  // ── V5 Co-promotion partners ───────────────────────────────────────────────
  app.post('/api/partners', rateLimit, async (req, res, next) => {
    try {
      const { pack, location, proposal_id } = req.body ?? {};
      if (!isId(pack) || !isId(location)) return res.status(400).json({ success: false, message: 'pack and location must be short alphanumeric ids' });
      const { snap, error } = roomSnapshot(proposal_id, pack, location);
      if (!snap) return res.status(404).json({ success: false, message: error });
      if (req.body?.mode !== undefined && !isTasteMode(req.body.mode)) {
        return res.status(400).json({ success: false, message: 'mode must be live, cached or replay' });
      }
      const loc = getLocation(pack, location);
      const session = createSession({ pack, location, requestedMode: req.body?.mode, ip: req.ip });
      // Replay makes no /search lookup, so nothing resolves — but the room's
      // configured seeds are still what its stored partner rows were built
      // against. Falling back to them queries the stored rows instead of
      // claiming there was nothing to ask about.
      const seeds = snap.resolved_seeds.length ? snap.resolved_seeds : snap.seed_inputs;
      const result = await coPromotionPartners({
        session,
        seeds,
        locationQuery: snap.location_query,
        audienceTags: snap.audience_tags ?? [],
        types: ['brand', 'place'],
        seedsWereResolved: snap.resolved_seeds.length > 0,
      });
      for (const r of result.rows) graph.addEdge(`loc:${loc.id}`, 'PARTNER_OF', r.entity_id, { mode: r.mode, shared_tags: r.shared_tags });
      res.json({ success: true, partners: result, mode: servedMode(session), degrade_reason: session.degrade_reason });
    } catch (err) { next(err); }
  });

  // ── V6 Owner approval brief ────────────────────────────────────────────────
  app.get('/api/proposals/:id/brief', (req, res) => {
    const id = isId(req.params.id, 40) ? req.params.id : '';
    const p = id ? graph.getProposal<Proposal>(id) : null;
    if (!p) return res.status(404).json({ success: false, message: 'not found' });
    const approver = safeString(req.query.approver, 80) ?? 'the approver on file';
    res.json({ success: true, brief: approvalBrief(p, approver) });
  });

  // ── F15 Decision ledger ────────────────────────────────────────────────────
  app.get('/api/ledger', (req, res) => {
    // A display window: the newest N in chain order. Verification never uses this
    // route, because a bounded read can only prove the part it held.
    const raw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const wanted = Math.floor(Number(raw));
    const limit = Number.isFinite(wanted) && wanted > 0 ? Math.min(wanted, 300) : 300;
    const entries = graph.readLedger(limit);
    res.json({ success: true, entries, head_hash: graph.headHash(), length: entries.length, total: graph.countLedger(), limit });
  });

  app.get('/api/ledger/verify', (_req, res) => {
    // The whole chain: a bounded read could only ever prove the part it held, and
    // a note claiming every link was checked would then be false.
    const entries = graph.readLedger(Number.MAX_SAFE_INTEGER);
    const v = verifyLedger(entries);
    res.json({
      success: true,
      ...v,
      note: v.ok
        ? v.partial
          ? `${v.length} entr${v.length === 1 ? 'y' : 'ies'} re-hashed from entry ${entries[0].seq} onward; the links inside that range were checked, older entries were not in this read`
          : `${v.length} entr${v.length === 1 ? 'y' : 'ies'}, every hash recomputed and every link checked from the first entry`
        : 'the chain is broken: an entry was changed after it was written',
      // Whether the chain is bound to a secret this host holds. An unkeyed chain is
      // tamper-evident, not tamper-proof: whoever has the file can rewrite the lot.
      keyed: ledgerIsKeyed(),
      keyless_note: v.keyless_entries > 0
        ? `${v.keyless_entries} of ${v.length} entries are hashed with unkeyed sha256, so rewriting that whole range is arithmetic rather than forgery`
        : ledgerIsKeyed()
          ? 'every entry is HMAC-bound to this host\'s key'
          : 'the chain is unkeyed on this host: set LEDGER_HMAC_SECRET before the first entry to bind it',
    });
  });

  // ── F49 Coverage Board ─────────────────────────────────────────────────────
  app.get('/api/coverage', (_req, res) => res.json({ success: true, board: coverageBoard() }));

  // ── F47 Trust Center ───────────────────────────────────────────────────────
  app.get('/api/trust', rateLimit, (_req, res) => {
    const report = trustReport(latestProposal());
    res.json({ success: true, report, allowlist: ALLOWED_PARAMS });
  });

  // ── Taste Lift ablation study ──────────────────────────────────────────────
  app.post('/api/eval/run', rateLimit, async (_req, res, next) => {
    try { lastEval = await runTasteLift(env.DEFAULT_MODE); res.json({ success: true, results: lastEval }); }
    catch (err) { next(err); }
  });
  app.get('/api/eval/results', (_req, res) => res.json({ success: true, results: lastEval ?? null }));

  // ── Qloo call logs: modes, endpoints, counts. Never headers, keys or payloads ─
  app.get('/api/qloo/log', (_req, res) => res.json({ success: true, log: callLog() }));
  app.get('/api/qloo/rest-log', (_req, res) => res.json({ success: true, log: getRestLog() }));

  // In production, serve the built client from server/public when it is present.
  // This is registered here, not after createApp returns: the catch-all below is
  // what answers every unmatched request, so a static mount added later would sit
  // behind it and the client could never load.
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    // Single-page app: anything that is not an API route is the shell's own route.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/healthz')) return next();
      const index = path.join(publicDir, 'index.html');
      if (fs.existsSync(index)) res.sendFile(index); else next();
    });
  }

  app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // A violation of the allowlist is a real finding and is shown; nothing else
    // internal is echoed to the browser.
    if (err?.name === 'AllowlistViolation') {
      return res.status(400).json({ success: false, message: `refused: ${err.param} is not a verified Qloo parameter for ${err.endpoint}` });
    }
    console.error('Taste Brain error:', err?.message ?? err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  return app;
}
