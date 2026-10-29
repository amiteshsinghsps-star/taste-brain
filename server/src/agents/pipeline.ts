// The run pipeline: profiler -> explorer (bounded) -> rule checker -> auditor ->
// strategist (explanations only). Deterministic spine; the LLM never ranks,
// filters, approves or writes a number.

import { createSession, hasReplayFixture, type Session } from '../qloo/adapter';
import { loadPack, getLocation, getCatalog, findOffer, sopSnippet } from '../packs/loader';
import { evaluateAll, itemVerdict, type RuleSubject } from './rule-checker';
import { narrate, structuredExplanation } from './llm';
import { buildTrace } from '../trace/builder';
import { graph } from '../graph/store';
import { computeFlipPoints } from './flip';
import { lintAudienceLanguage, checkNarrativeGrounding } from './auditor';
import type {
  Proposal, ProposalItem, TraceStep, AuditRejection, TasteMode, QlooEntityResult,
  Rule, RuleResult, EvidenceCard, RunSnapshot, NeedsTerm,
} from '../types';

let _pid = 0;
function newId() { return `p_${Date.now().toString(36)}_${(++_pid).toString().padStart(3, '0')}`; }
const nowIso = () => new Date().toISOString();

export interface RunInput {
  pack: string;
  location: string;
  goal: string;
  mode?: TasteMode;
  ip?: string;
  /** Seeds the user picked after an ambiguous resolution: input -> entity id. */
  chosen_seeds?: Record<string, string>;
  /** Operator-entered terms at run time: entity id -> field -> value. */
  offer_terms?: Record<string, Record<string, number>>;
  /** Names that played recently (no-repeat window), entered by the operator. */
  recent_plays?: string[];
  /** What-if rule thresholds: rule id -> value (band max/min or numeric value). */
  rule_overrides?: Record<string, number>;
  /** Finals Mode serves the stored snapshot instead of calling Qloo. */
  snapshot_id?: string;
}

// ── Grounding Auditor (PRD §7.5). Checks run before anything is displayed. ────

export function auditItem(item: ProposalItem, storedIds: Set<string>): { ok: boolean; reason: string; check: number } {
  // Check 1 — the item maps to a Qloo entity id present in THIS run's results.
  if (!item.entity_id || !storedIds.has(item.entity_id)) {
    return { ok: false, reason: "no Qloo entity id from this run's stored results", check: 1 };
  }
  // Check 3 — every applicable rule passes (or is explicitly awaiting a term).
  const failed = item.rule_results.find((r) => r.status === 'fail');
  if (failed) return { ok: false, reason: `rule ${failed.rule_id} failed: ${failed.reason}`, check: 3 };
  const blocking = item.rule_results.find((r) => r.status === 'needs_data' && (r.on_missing ?? 'block') === 'block');
  if (blocking) return { ok: false, reason: `rule ${blocking.rule_id} cannot be proven: ${blocking.reason}`, check: 3 };
  // Check 4 — mode is recorded on the item and its evidence.
  if (!item.mode || !item.evidence?.mode) return { ok: false, reason: 'mode missing on the item or its evidence', check: 4 };
  // Check 5 — audience-level language only, no claims about individuals.
  const lint = lintAudienceLanguage(item.explanation);
  if (!lint.ok) return { ok: false, reason: `language lint: ${lint.reason}`, check: 5 };
  return { ok: true, reason: '', check: 0 };
}

// ── Rule resolution with what-if overrides ───────────────────────────────────

function rulesForRun(
  packRules: Rule[],
  locationOverrides: Record<string, number> | undefined,
  reqOverrides: Record<string, number> | undefined,
  opts: { rule_ids?: string[]; recentPlays?: string[] } = {},
): { rules: Rule[]; changed: string[] } {
  // A room enforces the pack rules it is configured for, plus nothing invented.
  const scoped = opts.rule_ids?.length ? packRules.filter((r) => opts.rule_ids!.includes(r.id)) : packRules;
  const merged = { ...(locationOverrides ?? {}), ...(reqOverrides ?? {}) };
  const changed: string[] = [];
  const rules = scoped.map((r) => {
    // The no-repeat window is the operator's own history, never a guess.
    if (r.kind === 'exclude_recent') {
      const list = [...new Set([...(r.list ?? []), ...(opts.recentPlays ?? [])])];
      if (list.length !== (r.list ?? []).length) changed.push(`${r.id}: no-repeat window carries ${list.length} recent play(s) entered by the operator`);
      return { ...r, list, snippet: r.snippet ?? `must not appear in the last ${list.length} plays` };
    }
    const v = merged[r.id];
    if (v === undefined) return r;
    changed.push(`${r.id}: threshold set to ${v} for this run (what-if)`);
    if (r.kind === 'band') {
      const band = { ...r.band! };
      // A single override number on a band rule moves the ceiling (room size).
      band.max = v;
      return { ...r, band, snippet: `${r.band!.field} must be within [${band.min}, ${band.max}]` };
    }
    return { ...r, value: v, snippet: `${r.field} must be <= ${v}` };
  });
  return { rules, changed };
}

function withDerivedChips(items: ProposalItem[], candidates: QlooEntityResult[], noLoc: QlooEntityResult[], trend: QlooEntityResult[]) {
  const rankOf = (arr: QlooEntityResult[], id: string) => arr.find((e) => e.entity_id === id)?.qloo_rank ?? null;
  for (const it of items) {
    if (noLoc.length) {
      const base = rankOf(candidates, it.entity_id);
      const without = rankOf(noLoc, it.entity_id);
      it.local_lift = base !== null && without !== null ? without - base : null;
    } else it.local_lift = null;
    if (trend.length) {
      const base = rankOf(candidates, it.entity_id);
      const biased = rankOf(trend, it.entity_id);
      it.rising = base === null || biased === null ? null : biased < base ? 'up' : biased > base ? 'down' : 'steady';
    } else it.rising = null;
  }
}

function evidenceFor(r: QlooEntityResult, sessionMode: TasteMode): EvidenceCard {
  return {
    entity_id: r.entity_id,
    endpoint: r.source.endpoint,
    workflow: r.source.workflow,
    mode: r.source.mode ?? sessionMode,
    fetched_at: r.source.fetched_at,
    qloo_rank: r.qloo_rank,
    popularity: r.popularity,
    obscurity: r.obscurity,
    followers: r.followers,
    primary_genres: r.primary_genres ?? [],
    qloo_tags: r.qloo_tags,
    explainability: r.explainability,
    fit_note: `fit ${Math.round(r.fit * 100)} is derived by Taste Brain from Qloo's result order (rank ${r.qloo_rank}); Qloo returns no affinity score on this endpoint`,
  };
}

interface EvalContext {
  packId: string;
  locationId: string;
  catalogKey: string;
  acceptUnknownOffers: boolean;
  rules: Rule[];
  recentExcludes: string[];
  sessionMode: TasteMode;
  changedRules: string[];
  offer_terms?: Record<string, Record<string, number>>;
  /** Set when no candidate query was made at all, so the step must not name Qloo. */
  noQueryReason?: string;
}

/**
 * Rule Checker + Auditor over Qloo's own order. Shared by a live run and by a
 * run served from a stored snapshot, so Finals Mode and the stage demo apply
 * exactly the same governance as a live call.
 */
function evaluateCandidates(candidates: QlooEntityResult[], ctx: EvalContext): {
  items: ProposalItem[]; rejections: AuditRejection[]; unsupported: Proposal['unsupported'];
  fieldsById: Map<string, Record<string, number>>; steps: TraceStep[];
} {
  const steps: TraceStep[] = [];
  const storedIds = new Set(candidates.map((c) => c.entity_id));
  steps.push(ctx.noQueryReason
    ? { type: 'QlooEntity', label: 'No candidate list was produced for this room', result: 'fail', mode: ctx.sessionMode, detail: ctx.noQueryReason, at: nowIso() }
    : { type: 'QlooEntity', label: `Qloo returned ${candidates.length} candidates for this room`, result: 'info', mode: ctx.sessionMode, detail: `ordered by Qloo's own relevance; order preserved, no re-ranking by this app`, at: nowIso() });
  for (const c of ctx.changedRules) steps.push({ type: 'Rule', label: c, result: 'info', mode: ctx.sessionMode, at: nowIso() });

  const items: ProposalItem[] = [];
  const rejections: AuditRejection[] = [];
  const unsupported: Proposal['unsupported'] = [];
  const fieldsById = new Map<string, Record<string, number>>();

  for (const r of candidates) {
    const offer = findOffer(ctx.packId, ctx.catalogKey, r.entity_id, r.name);
    // Operator-entered terms beat nothing: they are only used where the pack has
    // no terms on file, and they are always attributed as user-entered.
    const entered = graph.getOfferTerms(ctx.packId, ctx.locationId, r.entity_id);
    const runEntered = ctx.offer_terms?.[r.entity_id] ?? {};
    const fields: Record<string, number> = { ...(offer?.fields ?? {}), ...entered, ...runEntered };
    fieldsById.set(r.entity_id, fields);

    if (!offer && !ctx.acceptUnknownOffers) {
      // A strong Qloo match the organisation has no approved terms for is
      // surfaced, never quietly dropped.
      unsupported.push({ offer_id: `qloo_only:${r.entity_id}`, name: r.name, reason: 'Qloo ranks it for this audience, but there is no approved offer or entered term to rule-check' });
      steps.push({ type: 'Filter', label: `${r.name}: no approved offer on file`, id: r.entity_id, result: 'fail', mode: r.source.mode, detail: 'shown as unsupported; never ranked into the proposal', at: nowIso() });
      continue;
    }

    const name = offer?.name ?? r.name;
    if (ctx.recentExcludes.includes(name.toLowerCase())) {
      steps.push({ type: 'Filter', label: `${name}: inside the no-repeat window`, id: r.entity_id, result: 'fail', mode: r.source.mode, detail: 'excluded before ranking because the operator listed it as recently played', at: nowIso() });
      rejections.push({ entity_id: r.entity_id, offer_id: offer?.offer_id ?? `qloo_only:${r.entity_id}`, name, reason: 'listed by the operator as played inside the no-repeat window', check: 3, rule_id: 'no_repeat', at: nowIso() });
      continue;
    }

    const subject: RuleSubject = {
      name,
      fields,
      tags: [...(offer?.tags ?? []).map((t) => t.toLowerCase()), ...r.tag_names],
      tag_ids: r.qloo_tags.map((t) => t.id),
      qloo: r,
    };
    const rule_results = evaluateAll(ctx.rules, subject);
    const verdict = itemVerdict(rule_results);

    for (const rr of rule_results) {
      steps.push({
        type: 'Rule',
        label: `${rr.rule_id}: ${rr.status === 'pass' ? 'pass' : rr.status === 'fail' ? 'fail' : 'needs data'} — ${rr.reason}`,
        source: `${rr.source} — ${sopSnippet(ctx.packId, rr.source) ?? ''}`,
        result: rr.status, mode: r.source.mode, at: nowIso(),
      });
    }
    steps.push({ type: 'QlooEntity', label: name, id: r.entity_id, score: r.fit, result: verdict.rejected ? 'fail' : 'info', mode: r.source.mode, detail: `Qloo rank ${r.qloo_rank}${r.popularity ? `, popularity ${r.popularity.toFixed(3)}` : ''}${r.explainability ? ` — ${r.explainability.slice(0, 110)}` : ''}`, at: nowIso() });

    const item: ProposalItem = {
      entity_id: r.entity_id,
      offer_id: offer?.offer_id ?? `qloo_only:${r.entity_id}`,
      rank: 0,
      name,
      type: r.type,
      fit: r.fit,
      qloo_rank: r.qloo_rank,
      popularity: r.popularity,
      obscurity: r.obscurity,
      followers: r.followers,
      tags: [...new Set([...(offer?.tags ?? []), ...r.qloo_tags.map((t) => t.name)])],
      explanation: structuredExplanation(name, r),
      rule_results,
      rule_inputs: { fields, offer_tags: offer?.tags ?? [] },
      evidence: evidenceFor(r, ctx.sessionMode),
      mode: r.source.mode,
      approval_blocked: verdict.approval_blocked,
      needs_terms: verdict.needs_terms,
    };

    const audit = auditItem(item, storedIds);
    if (!audit.ok) {
      rejections.push({ entity_id: r.entity_id, offer_id: item.offer_id, name, reason: audit.reason, check: audit.check, rule_id: verdict.first_failure?.rule_id, at: nowIso() });
      steps.push({ type: 'Filter', label: `${name} rejected by the Auditor (check ${audit.check})`, id: r.entity_id, result: 'fail', mode: r.source.mode, detail: audit.reason, at: nowIso() });
      continue;
    }
    items.push(item);
  }

  // Ranking is Qloo's own order. No re-sorting by popularity, no LLM input.
  items.sort((a, b) => a.qloo_rank - b.qloo_rank);
  items.forEach((it, i) => {
    it.rank = i + 1;
    steps.push({ type: 'Proposal', label: `#${i + 1} ${it.name}`, id: it.entity_id, score: it.fit, result: 'pass', mode: it.mode, detail: `Qloo rank ${it.qloo_rank}`, at: nowIso() });
  });

  return { items, rejections, unsupported, fieldsById, steps };
}

/** One run of the engine for a room or store. */
export async function runPipeline(input: RunInput): Promise<Proposal> {
  const pack = loadPack(input.pack);
  const loc = getLocation(input.pack, input.location);
  const catalog = getCatalog(input.pack, loc.catalog);
  const session: Session = createSession({ pack: input.pack, location: input.location, requestedMode: input.mode, ip: input.ip });
  const steps: TraceStep[] = [];
  const filterType = pack.qloo.target_types[0] ? `urn:entity:${pack.qloo.target_types[0]}` : 'urn:entity:brand';
  const seedType = pack.qloo.seed_types[0] ? `urn:entity:${pack.qloo.seed_types[0]}` : undefined;
  const locationQuery = loc.city || loc.name;

  // ── Profiler: resolve the room's own seed list. Never guessed. ─────────────
  const seedLabels = loc.seeds.map((s) => (input.chosen_seeds?.[s] ? input.chosen_seeds[s]! : s.replace(/^qloo:[^:]+:/, '').replace(/_/g, ' ')));
  const seedInputs = loc.seeds.map((s) => s.replace(/^qloo:[^:]+:/, '').replace(/_/g, ' '));
  const resolved = await session.resolveSeeds(seedLabels, seedType ?? `urn:entity:${pack.qloo.target_types[0] ?? 'brand'}`);
  for (const id of resolved.ids) steps.push({ type: 'Audience', label: `seed resolved to a Qloo entity`, id, result: 'pass', mode: resolved.mode, at: nowIso() });
  if (session.mode === 'replay' && resolved.unresolved.length) {
    // Replay never re-resolves a name against /search: the stored rows were
    // captured against this room's seeds, and saying so is the honest label.
    steps.push({ type: 'Audience', label: `Replay mode: ${resolved.unresolved.length} configured seed(s) not re-resolved against /search`, result: 'info', mode: 'replay', detail: `seeds for this room: ${seedInputs.join(', ')} — the stored result is served as-is, and this run must not be read as a live resolution`, at: nowIso() });
  } else {
    for (const u of resolved.unresolved) {
      steps.push({ type: 'Audience', label: u.candidates.length ? `seed "${u.input}" is ambiguous` : `seed "${u.input}" did not resolve`, result: u.candidates.length ? 'info' : 'fail', mode: resolved.mode, detail: u.candidates.length ? `candidates: ${u.candidates.slice(0, 4).join(', ')} — pick one, nothing is guessed` : 'kept out of the signal; listed, not invented', at: nowIso() });
    }
  }

  // ── Audience portrait ──────────────────────────────────────────────────────
  let audienceTags: { name: string; id: string }[] = [];
  try {
    const aud = await session.audienceTags(resolved.ids, locationQuery);
    audienceTags = aud.tags.slice(0, 12).map((t) => ({ name: t.name, id: t.id }));
    steps.push({
      type: 'Audience', label: `${loc.name} audience portrait`, source: 'GET /v2/insights filter.type=urn:tag',
      mode: aud.mode, result: 'info', detail: audienceTags.map((t) => t.name).join(', ') || 'no tags returned for this room', at: nowIso(),
    });
    graph.upsertNode('Audience', `aud:${loc.id}`, { location_id: loc.id, taste_tags: audienceTags.map((t) => t.name), mode: aud.mode, fetched_at: nowIso() });
    graph.addEdge(`loc:${loc.id}`, 'HAS_AUDIENCE', `aud:${loc.id}`);
  } catch (err: any) {
    steps.push({ type: 'Audience', label: 'audience portrait unavailable', result: 'fail', mode: resolved.mode, detail: String(err?.message ?? err).slice(0, 120), at: nowIso() });
  }

  // ── Explorer: candidates for this room, then the bounded relax ladder ──────
  const recentPlays = input.recent_plays ?? loc.recent_plays ?? [];
  const recentExcludes = recentPlays.map((n) => n.toLowerCase());
  let candidates: QlooEntityResult[] = [];
  let candidatesMode: TasteMode | null = null;
  const relaxations: string[] = [];

  // The room's own tag guard travels as a query parameter, and the ladder's
  // first step drops query parameters. No rule re-checks it, so a relaxed run
  // has to hold the line here or an entity this room excluded ships as
  // rule-approved and approvable. The whole list is used, unfiltered: these are
  // exactly the values the constrained query sent, in either scheme Qloo uses
  // (`urn:tag:genre:indie_rock` or `qlootag:shellfish`).
  const roomTagGuard = loc.exclude_tag_ids ?? [];
  const guarded = (e: QlooEntityResult, t: string) => {
    const last = t.split(':').pop()!.toLowerCase();
    return (e.qloo_tags ?? []).some((x) => x.id === t || String(x.name ?? '').toLowerCase() === last);
  };
  const carriesGuardedTag = (e: QlooEntityResult) => roomTagGuard.some((t) => guarded(e, t));

  const attempt = async (opts: Parameters<Session['insights']>[0], label: string) => {
    const r = await session.insights(opts);
    const relaxedGuard = roomTagGuard.some((t) => !(opts.excludeTags ?? []).includes(t));
    const kept = relaxedGuard ? r.entities.filter((e) => !carriesGuardedTag(e)) : r.entities;
    if (r.entities.length !== kept.length) {
      relaxations.push(`${r.entities.length - kept.length} row(s) carry a tag this room excludes; the loosened query returned them and they were held out here, not by a pack rule`);
      steps.push({ type: 'Filter', label: `room tag guard re-applied locally after loosening`, result: 'fail', mode: r.mode, detail: `${r.entities.length - kept.length} of ${r.entities.length} row(s) dropped: ${r.entities.filter((e) => carriesGuardedTag(e)).map((e) => e.name).slice(0, 3).join(', ')}`, at: nowIso() });
    }
    if (kept.length) { candidates = kept; candidatesMode = r.mode; return true; }
    relaxations.push(`${label} returned no rows`);
    return false;
  };

  const baseOpts = {
    variant: 'default',
    filterType,
    seeds: resolved.ids,
    locationQuery,
    useLocation: pack.qloo.location_signal !== 'none',
    excludeTags: (loc.exclude_tag_ids ?? []).concat(pack.rules.filter((x) => x.kind === 'exclude_tags').flatMap((x) => x.tags ?? []).filter((t) => t.startsWith('urn:tag:'))),
    excludeEntities: loc.exclude_entity_ids ?? [],
    popularityMin: loc.popularity_band?.min,
    popularityMax: loc.popularity_band?.max,
    take: 25,
  };

  // Replay answers from committed fixtures only. When a room has no fixture there
  // is nothing to relax, so the ladder is not run and no step may claim it was.
  const replayWithoutFixture = session.mode === 'replay' && !hasReplayFixture(input.pack, loc.id);
  if (!replayWithoutFixture && !(await attempt(baseOpts, 'constrained query'))) {
    // Ladder step 1: drop tag exclusions.
    if (!(await attempt({ ...baseOpts, excludeTags: [] }, 'after dropping excluded tags'))) {
      // Ladder step 2: drop the popularity band.
      if (!(await attempt({ ...baseOpts, excludeTags: [], popularityMin: undefined, popularityMax: undefined }, 'after dropping the popularity band'))) {
        // Ladder step 3: keep seeds, drop the location filter.
        if (!(await attempt({ ...baseOpts, excludeTags: [], variant: 'no_location', useLocation: false, popularityMin: undefined, popularityMax: undefined }, 'after dropping the location filter'))) {
          // Ladder step 4: one seed only.
          await attempt({ ...baseOpts, excludeTags: [], useLocation: false, popularityMin: undefined, popularityMax: undefined, seeds: resolved.ids.slice(0, 1) }, 'after reducing to one seed');
        }
      }
    }
    for (const r of relaxations) steps.push({ type: 'Relax', label: r, result: 'info', mode: candidatesMode ?? session.mode, at: nowIso() });
    if (candidates.length) steps.push({ type: 'Relax', label: `query succeeded after loosening: ${relaxations.length} constraint(s) relaxed, listed above`, result: 'pass', mode: candidatesMode ?? session.mode, at: nowIso() });
  }

  // Comparison variants power the derived chips and the Ablation Lab. They are
  // skipped when the per-run budget is gone or the mode is Replay.
  let noLocation: QlooEntityResult[] = [];
  let trendBias: QlooEntityResult[] = [];
  let locationOnly: QlooEntityResult[] = [];
  if (session.mode !== 'replay' && resolved.ids.length) {
    try { noLocation = (await session.insights({ variant: 'no_location', filterType, seeds: resolved.ids, useLocation: false, take: 25 })).entities; } catch { /* chip shows unavailable */ }
    try { trendBias = (await session.insights({ variant: 'trend_bias', filterType, seeds: resolved.ids, locationQuery, trendBias: true, take: 25 })).entities; } catch { /* ditto */ }
    try { locationOnly = (await session.insights({ variant: 'location_only', filterType, locationQuery, locationOnly: true, take: 25 })).entities; } catch { /* ditto */ }
  } else if (!replayWithoutFixture) {
    noLocation = (await safeInsights(session, { variant: 'no_location', filterType, seeds: [], useLocation: false })).entities;
    trendBias = (await safeInsights(session, { variant: 'trend_bias', filterType, seeds: [], locationQuery, trendBias: true })).entities;
    locationOnly = (await safeInsights(session, { variant: 'location_only', filterType, locationQuery, locationOnly: true })).entities;
  }

  // ── Rule Checker + Auditor, over Qloo's own order ──────────────────────────
  // A run that asked for live but found every answer already in the private cache
  // made no live read, so a LIVE badge would overstate it — the label follows the
  // bytes that actually crossed the wire, and every rule step is stamped with it.
  // And when nothing Qloo-shaped was used at all — every row came from a committed
  // synthetic fixture — 'cached' would overstate too: that badge claims a stored
  // Qloo answer. The label follows the source the run really read, whichever mode
  // it was granted, because a Cached run whose cache missed used fixtures.
  const read = session.calls.filter((c) => !c.failed);
  const fetched_now = read.filter((c) => c.mode === 'live' && !c.cache_hit).length;
  const real_stored = read.filter((c) => c.mode === 'cached').length;
  const from_fixtures = read.filter((c) => c.mode === 'replay').length;
  const mode: TasteMode = fetched_now > 0 ? 'live'
    : real_stored > 0 ? 'cached'
      : from_fixtures > 0 ? 'replay'
        : session.mode === 'replay' ? 'replay' : 'cached';
  const { rules, changed } = rulesForRun(pack.rules, loc.rule_overrides, input.rule_overrides, {
    rule_ids: loc.rule_ids,
    recentPlays: input.recent_plays ?? loc.recent_plays ?? [],
  });
  const evaluated = evaluateCandidates(candidates, {
    packId: input.pack,
    locationId: input.location,
    catalogKey: loc.catalog,
    acceptUnknownOffers: !!loc.accept_unknown_offers,
    rules,
    recentExcludes: recentExcludes,
    sessionMode: mode,
    changedRules: changed,
    offer_terms: input.offer_terms,
    noQueryReason: replayWithoutFixture
      ? `Replay holds no committed fixture for ${input.pack}/${loc.id}, so no candidate query was made and no filter was relaxed — missing sample data on our side, not Qloo having nothing. This room needs Cached or Live.`
      : undefined,
  });
  steps.push(...evaluated.steps);
  const items = evaluated.items;
  const rejections = evaluated.rejections;
  const unsupported = evaluated.unsupported;
  const fieldsById = evaluated.fieldsById;
  const storedIds = new Set(candidates.map((c) => c.entity_id));

  withDerivedChips(items, candidates, noLocation, trendBias);

  // ── Strategist: explanations only, and only over grounded facts ────────────
  const top = items[0];
  if (top) {
    const llmOut = await narrate(`In one sentence, explain why "${top.name}" fits the ${pack.copy.audience_label} of ${loc.name}. Use only these grounded facts: Qloo rank ${top.qloo_rank}, ${top.evidence.primary_genres.join(', ')}. Do not add any other name, number or statistic.`);
    if (llmOut) {
      const grounded = checkNarrativeGrounding(llmOut, [top.name, ...items.slice(1, 5).map((i) => i.name), ...top.tags, ...top.evidence.primary_genres]);
      // The Auditor already ran on the template explanation, so model text
      // replacing it has to clear the same language lint before it ships.
      const linted = grounded.ok ? lintAudienceLanguage(llmOut) : grounded;
      if (grounded.ok && linted.ok) {
        top.explanation = llmOut;
        steps.push({ type: 'Proposal', label: 'narrative written by the LLM over grounded facts', result: 'info', mode: top.mode, detail: 'checked against stored results and the audience-language lint; ranking untouched', at: nowIso() });
      } else {
        steps.push({ type: 'Filter', label: 'LLM narrative discarded', result: 'fail', mode: top.mode, detail: grounded.ok ? linted.reason : grounded.reason, at: nowIso() });
      }
    }
  }

  const flip_points = computeFlipPoints(rejections, candidates, rules, input.pack, input.location, (id) => fieldsById.get(id) ?? {});
  const proposal_id = newId();
  const trace = buildTrace({ proposal_id, pack: input.pack, location: loc.id, goal: input.goal, mode, steps });

  const proposal: Proposal = {
    proposal_id, pack: input.pack, location: loc.id, goal: input.goal, mode,
    degrade_reason: (session.degrade_reason && mode !== session.mode
      ? `${session.degrade_reason} In the end this run found no stored Qloo answer for it either: every row came from the committed offline sample fixtures, so the badge says Replay.`
      : session.degrade_reason)
      || (session.mode === 'live' && mode === 'cached'
        ? "Live was allowed and asked for, but every answer was already in this server's stored copy — the run made no live read, so it is labelled Cached."
        : session.mode === 'live' && mode === 'replay'
          ? 'Live was allowed and asked for, but no Qloo answer was usable for this run: every row came from the committed offline sample fixtures. It is labelled Replay, not Cached, because nothing here is a stored Qloo answer.'
          : null),
    created_at: nowIso(), status: 'pending', items, unsupported, rejections,
    unresolved_seeds: resolved.unresolved,
    relaxations,
    allowlist_violations: session.violations,
    audience_tags: audienceTags,
    local_lift_note: noLocation.length
      ? `local lift and rising chips are derived by Taste Brain from Qloo outputs — they compare Qloo's ranking with the location signal against the same seeds without it; a positive number means the room's location moved this item up. Qloo returns no lift figure of its own.`
      : 'local lift unavailable: the no-location comparison returned nothing on this run',
    flip_points,
    trace,
  };

  // Persist: graph, proposals, snapshot, ledger.
  for (const r of candidates) graph.upsertNode('QlooEntity', r.entity_id, { qloo_id: r.entity_id, type: r.type, name: r.name, source_workflow: r.source.workflow, mode: r.source.mode, fetched_at: r.source.fetched_at });
  for (const it of items) graph.addEdge(`aud:${loc.id}`, 'AFFINITY', it.entity_id, { qloo_rank: it.qloo_rank, fit: it.fit, mode: it.mode });
  for (const rule of rules) {
    graph.upsertNode('Rule', `${input.pack}:${rule.id}`, { kind: rule.kind, source: rule.source, snippet: rule.snippet });
    graph.addEdge(`${input.pack}:${rule.id}`, 'DEFINED_IN', rule.source.split('#')[0]);
  }
  graph.upsertNode('Proposal', proposal_id, { pack: input.pack, location: loc.id, goal: input.goal, status: 'pending', created_at: proposal.created_at, mode });
  for (const it of items) graph.addEdge(proposal_id, 'SUPPORTED_BY', it.entity_id);
  for (const rule of rules) graph.addEdge(proposal_id, 'CHECKED_AGAINST', `${input.pack}:${rule.id}`);
  graph.saveProposal({ id: proposal_id, pack: input.pack, location: loc.id, goal: input.goal, mode, created_at: proposal.created_at, status: 'pending', payload: proposal });

  const snapshot: RunSnapshot = {
    proposal_id, pack: input.pack, location: loc.id, goal: input.goal, mode, created_at: proposal.created_at,
    resolved_seeds: resolved.ids, seed_inputs: seedInputs, location_query: locationQuery,
    rules, candidates,
    variants: { no_location: noLocation, trend_bias: trendBias, location_only: locationOnly },
    recent_plays: input.recent_plays ?? loc.recent_plays ?? [],
    audience_tags: audienceTags,
    item_ids: items.map((i) => i.entity_id),
    rerun_hash: trace.rerun_hash,
  };
  graph.saveSnapshot(snapshot);
  graph.appendLedger({
    at: proposal.created_at, action: 'proposed', proposal_id, pack: input.pack, location: loc.id,
    actor: 'taste-brain', detail: { goal: input.goal, mode, items: items.length, rejected: rejections.length, rerun_hash: trace.rerun_hash, rerun_hash_version: trace.rerun_hash_version ?? 1, session: { calls: session.calls.length, live_reads: fetched_now, relaxations, violations: session.violations } },
  });

  return proposal;
}

/**
 * Finals Mode (F48). Rebuild a proposal from a stored run snapshot: the same
 * rules, the same Auditor, the same ranking — zero Qloo calls, so the stage
 * demo cannot fail on a network or a spent key. The mode badge says Cached
 * because that is exactly what it is, and the snapshot's own fetch mode stays
 * on every item's evidence.
 */
export function runFromSnapshot(input: RunInput): Proposal | null {
  const snapshot = input.snapshot_id ? graph.getSnapshot(input.snapshot_id) : graph.latestSnapshotFor(input.pack, input.location);
  if (!snapshot) return null;

  const pack = loadPack(input.pack);
  const loc = getLocation(input.pack, input.location);
  const steps: TraceStep[] = [];
  const servedMode: TasteMode = snapshot.mode === 'live' ? 'cached' : snapshot.mode;

  steps.push({
    type: 'Proposal',
    label: `Finals Mode: served from the stored run ${snapshot.proposal_id}`,
    result: 'info',
    mode: servedMode,
    detail: `Qloo's rows were fetched in ${snapshot.mode} mode at ${snapshot.created_at} and replayed from the server-side snapshot. No Qloo call was made for this run.`,
    at: nowIso(),
  });

  const { rules, changed } = rulesForRun(pack.rules, loc.rule_overrides, input.rule_overrides, {
    rule_ids: loc.rule_ids,
    recentPlays: input.recent_plays ?? loc.recent_plays ?? [],
  });
  const evaluated = evaluateCandidates(snapshot.candidates, {
    packId: input.pack,
    locationId: input.location,
    catalogKey: loc.catalog,
    acceptUnknownOffers: !!loc.accept_unknown_offers,
    rules,
    recentExcludes: (input.recent_plays ?? snapshot.recent_plays ?? []).map((n) => n.toLowerCase()),
    sessionMode: servedMode,
    changedRules: changed,
    offer_terms: input.offer_terms,
  });
  steps.push(...evaluated.steps);

  const noLocation = snapshot.variants.no_location ?? [];
  const trendBias = snapshot.variants.trend_bias ?? [];
  withDerivedChips(evaluated.items, snapshot.candidates, noLocation, trendBias);

  const flip_points = computeFlipPoints(evaluated.rejections, snapshot.candidates, rules, input.pack, input.location, (id) => evaluated.fieldsById.get(id) ?? {});
  const proposal_id = newId();
  const trace = buildTrace({ proposal_id, pack: input.pack, location: loc.id, goal: input.goal, mode: servedMode, steps });

  const audience = graph.getNode<{ taste_tags: string[] }>(`aud:${loc.id}`);
  const audienceTags = snapshot.audience_tags?.length
    ? snapshot.audience_tags
    : (audience?.taste_tags ?? []).map((name) => ({ name, id: `urn:tag:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` }));
  const proposal: Proposal = {
    proposal_id,
    pack: input.pack,
    location: loc.id,
    goal: input.goal,
    mode: servedMode,
    degrade_reason: snapshot.mode === 'live' && servedMode === 'cached'
      ? 'Finals Mode re-served the stored answer from that live run — bytes already on this server, no live read, so the badge is Cached.'
      : null,
    created_at: nowIso(),
    status: 'pending',
    items: evaluated.items,
    unsupported: evaluated.unsupported,
    rejections: evaluated.rejections,
    unresolved_seeds: [],
    relaxations: [],
    allowlist_violations: [],
    audience_tags: audienceTags,
    local_lift_note: noLocation.length
      ? 'local lift and rising chips are derived by Taste Brain from Qloo outputs; they were computed when the snapshot was taken and are replayed here unchanged, with no Qloo call made'
      : 'local lift unavailable: this snapshot stored no comparison rows',
    flip_points,
    trace,
  };

  graph.upsertNode('Proposal', proposal_id, { pack: input.pack, location: loc.id, goal: input.goal, status: 'pending', created_at: proposal.created_at, mode: servedMode, served_from: snapshot.proposal_id });
  for (const it of evaluated.items) graph.addEdge(proposal_id, 'SUPPORTED_BY', it.entity_id);
  graph.saveProposal({ id: proposal_id, pack: input.pack, location: loc.id, goal: input.goal, mode: servedMode, created_at: proposal.created_at, status: 'pending', payload: proposal });
  // The snapshot a Finals run was served from is stored again under the new
  // proposal id. Without it the Auditor cannot find the rows this run actually
  // displayed, so "grounded items" reports a failure on a run that is grounded,
  // and the Ablation Lab and the exporter both refuse a Finals proposal.
  graph.saveSnapshot({
    proposal_id, pack: input.pack, location: loc.id, goal: input.goal,
    // servedMode, not the source snapshot's fetch mode: this run made zero Qloo
    // calls, and the stored-runs list badges what it lists. Inheriting 'live'
    // would show a no-call replay as a live run.
    mode: servedMode,
    created_at: proposal.created_at,
    resolved_seeds: snapshot.resolved_seeds, seed_inputs: snapshot.seed_inputs, location_query: snapshot.location_query,
    rules, candidates: snapshot.candidates, variants: snapshot.variants,
    recent_plays: input.recent_plays ?? snapshot.recent_plays ?? loc.recent_plays ?? [],
    audience_tags: audienceTags,
    item_ids: evaluated.items.map((i) => i.entity_id),
    rerun_hash: trace.rerun_hash,
  });
  graph.appendLedger({
    at: proposal.created_at, action: 'proposed', proposal_id, pack: input.pack, location: loc.id,
    actor: 'taste-brain',
    detail: { goal: input.goal, mode: servedMode, served_from: snapshot.proposal_id, qloo_calls: 0, items: evaluated.items.length, rejected: evaluated.rejections.length, rerun_hash: trace.rerun_hash, rerun_hash_version: trace.rerun_hash_version ?? 1 },
  });
  return proposal;
}

async function safeInsights(session: Session, opts: Parameters<Session['insights']>[0]): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {  try { return await session.insights(opts); } catch { return { entities: [], mode: session.mode }; }
}

// ── Approve / reject (F7 + F15) ──────────────────────────────────────────────

export function decide(
  proposal: Proposal,
  outcome: 'approved' | 'rejected',
  approver: string,
  opts: { entity_ids?: string[]; terms?: Record<string, Record<string, number>> } = {},
): { proposal: Proposal; error?: string } {
  const now = nowIso();
  const chosen = opts.entity_ids?.length ? proposal.items.filter((i) => opts.entity_ids!.includes(i.entity_id)) : proposal.items;
  if (outcome === 'approved') {
    if (!chosen.length) return { proposal, error: 'nothing to approve: the proposal has no items that passed every applicable rule' };
    const storedTerms = (entityId: string) => graph.getOfferTerms(proposal.pack, proposal.location, entityId);
    const missingTerm = (i: ProposalItem, t: NeedsTerm) =>
      opts.terms?.[i.entity_id]?.[t.field] === undefined && storedTerms(i.entity_id)[t.field] === undefined;
    const blocked = chosen.filter((i) => i.approval_blocked && i.needs_terms.some((t) => t.enterable && missingTerm(i, t)));
    if (blocked.length) {
      const awaiting = [...new Set(blocked.flatMap((b) => b.needs_terms.filter((t) => t.enterable && missingTerm(b, t)).map((t) => `${t.label} (${t.rule_id})`)))];
      return { proposal, error: `cannot approve ${blocked.map((b) => b.name).join(', ')}: still not on file — ${awaiting.join('; ')}. Enter the term; Taste Brain never guesses one.` };
    }
  }

  if (opts.terms) {
    for (const [entityId, fields] of Object.entries(opts.terms)) {
      for (const [field, value] of Object.entries(fields)) {
        graph.setOfferTerm(proposal.pack, proposal.location, entityId, field, value);
        graph.appendLedger({ at: nowIso(), action: 'term_entered', proposal_id: proposal.proposal_id, pack: proposal.pack, location: proposal.location, actor: approver, detail: { entity_id: entityId, field, value } });
      }
    }
  }

  proposal.status = outcome;
  const did = `d_${proposal.proposal_id}`;
  graph.upsertNode('Decision', did, { outcome, decided_at: now, approver });
  graph.upsertNode('Person', `person:${approver}`, { name: approver, role: 'Venue owner' });
  graph.addEdge(did, 'RESULTS_FROM', proposal.proposal_id);
  graph.addEdge(did, 'APPROVED_BY', `person:${approver}`);
  proposal.trace.steps.push({ type: 'Decision', mode: proposal.mode, label: outcome === 'approved' ? `Approved by ${approver}` : `Rejected by ${approver}`, source: approver, result: outcome === 'approved' ? 'pass' : 'fail', at: now });

  const entry = graph.appendLedger({
    at: now, action: outcome, proposal_id: proposal.proposal_id, pack: proposal.pack, location: proposal.location,
    actor: approver, detail: { approved: outcome === 'approved' ? chosen.map((c) => ({ name: c.name, qloo_rank: c.qloo_rank })) : [], item_count: chosen.length, rerun_hash: proposal.trace.rerun_hash, rerun_hash_version: proposal.trace.rerun_hash_version ?? 1 },
  });
  proposal.trace.steps.push({ type: 'Ledger', mode: proposal.mode, label: `decision written to the ledger as entry ${entry.seq}`, result: 'pass', detail: `hash ${entry.hash.slice(0, 16)}… linked to ${entry.prev_hash.slice(0, 16)}…`, at: now });
  graph.setProposalStatus(proposal.proposal_id, outcome);
  graph.saveProposal({ id: proposal.proposal_id, pack: proposal.pack, location: proposal.location, goal: proposal.goal, mode: proposal.mode, created_at: proposal.created_at, status: outcome, payload: proposal });
  return { proposal };
}
