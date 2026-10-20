/**
 * Live end-to-end check of the demo-critical path (PRD v3 §8) against a running server.
 *
 *   npm run dev           # or: npx tsx src/index.ts
 *   npx tsx src/eval/e2e-v3.ts
 *
 * Everything it asserts is observable: it only talks to the HTTP API, never to the DB.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function signUp(): Promise<{ token: string; userId: string; email: string }> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@neutronz.dev`;
  const password = 'correct-horse-battery';
  const reg = await api('POST', '/api/auth/register', { email, password, name: 'E2E Operator' });
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`register failed ${reg.status} ${JSON.stringify(reg.json)}`);
  const login = await api('POST', '/api/auth/login', { email, password });
  const token = login.json?.accessToken ?? login.json?.token ?? login.json?.data?.accessToken;
  const userId = login.json?.user?.id ?? reg.json?.user?.id ?? token ? decodeSub(token) : '';
  if (!token) throw new Error(`login failed ${login.status} ${JSON.stringify(login.json)}`);
  return { token, userId: String(userId ?? ''), email };
}

function decodeSub(token?: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString('utf8'));
    return payload.sub ?? payload.userId ?? '';
  } catch {
    return '';
  }
}

async function main() {
  console.log(`Neutronz v3 end-to-end check against ${BASE}\n`);

  // 0. health
  const health = await api('GET', '/health');
  record('health', health.json?.falkordb === true && health.json?.postgres === true, JSON.stringify(health.json));
  if (!health.json?.falkordb) throw new Error('FalkorDB unreachable — run `docker compose up -d` at repo root');

  // 0b. graph proof endpoint (E04): live node/edge counts straight from FalkorDB
  const status = await api('GET', '/api/status');
  record(
    'status proves falkordb backend with live counts',
    status.status === 200 &&
      status.json?.backend === 'falkordb' &&
      (status.json?.graph?.nodes ?? 0) > 0 &&
      (status.json?.graph?.edges ?? 0) > 0,
    `graphs=${status.json?.stores?.falkordb?.graphs} nodes=${status.json?.graph?.nodes} edges=${status.json?.graph?.edges} llm=${status.json?.llm}`
  );

  // 0c. demo safety: live connectors must be off unless explicitly enabled
  const conn = await api('GET', '/api/status/connectors');
  record('live connectors off by default', conn.json?.liveConnectorsEnabled === false, conn.json?.banner);

  // 1. auth + demo company
  const { token, email } = await signUp();
  record('auth register+login', !!token, email);

  const seeded = await api('POST', '/api/brain/seed-demo', {}, token);
  record(
    'seed demo company',
    seeded.status === 200 && (seeded.json?.stats?.totalNodes ?? seeded.json?.counts ?? null) !== null,
    JSON.stringify(seeded.json?.counts ?? seeded.json?.stats ?? seeded.json).slice(0, 220)
  );

  // 2. graph rules
  const rulesRes = await api('GET', '/api/brain/rules', undefined, token);
  const rules = rulesRes.json?.rules ?? [];
  record('active graph rules', rules.length >= 2, `${rules.length} rules: ${rules.map((r: any) => `${r.actionType}@v${r.version}`).join(', ')}`);
  const credit = rules.find((r: any) => r.actionType === 'CREDIT_LIMIT_APPROVAL');
  // The engine reads maxCreditLimit first, then threshold — use whichever the live rule carries.
  const thresholdKey = credit?.params?.maxCreditLimit !== undefined ? 'maxCreditLimit' : 'threshold';
  const currentThreshold = credit?.params?.[thresholdKey];
  record('credit rule present', !!credit, `id=${credit?.id} ${thresholdKey}=${currentThreshold}`);

  // 3. Why-Not on a non-flagged booking (before any rule change)
  const why = await api('GET', '/api/brain/why-not?booking=BK-1043', undefined, token);
  const wn = why.json?.whyNot;
  record(
    'why-not BK-1043',
    !!wn && typeof wn.nearestRule === 'object' && typeof wn.summary === 'string' && wn.evaluations?.length > 0,
    String(wn?.summary ?? JSON.stringify(why.json)).slice(0, 200)
  );

  // 4. Ask Brain query returns answer + citations + trace
  const q = await api('POST', '/api/brain/query', { query: 'Who owns the denied-party screening policy?' }, token);
  const ans = q.json?.result ?? q.json;
  record(
    'brain query cites + traces',
    (ans?.citations?.length ?? 0) > 0 &&
      (ans?.trace?.edges?.length ?? 0) > 0 &&
      (ans?.trace?.nodes?.length ?? 0) > 0,
    `${ans?.citations?.length ?? 0} citations, ${ans?.trace?.edges?.length ?? 0} hops over ${ans?.trace?.nodes?.length ?? 0} nodes, latency ${ans?.latencyMs ?? '?'}ms`
  );

  // 5. Graph-vs-RAG compare
  const cmp = await api('POST', '/api/brain/compare', { question: 'What is the current credit auto-approval limit?' }, token);
  const c = cmp.json;
  record(
    'compare baseline vs graph',
    !!c?.baseline && !!c?.neutronz,
    `baseline source=${c?.baseline?.score?.sourceRecall ?? c?.baseline?.scores?.sourceRecall} graph source=${c?.neutronz?.score?.sourceRecall ?? c?.neutronz?.scores?.sourceRecall}`
  );

  // 6. Knowledge health report finds planted issues
  const hp = await api('GET', '/api/brain/health', undefined, token);
  const findings = hp.json?.findings ?? [];
  record(
    'health report',
    typeof hp.json?.score === 'number' && findings.length >= 3,
    `score=${hp.json?.score} findings=${findings.map((f: any) => f.kind).join(', ')}`
  );

  // 7. Freight agent: BK-1042 → FLAGGED → Copilot stage → approve → ledger tick
  const ledgerBefore = await api('GET', '/api/ledger/verify', undefined, token);
  const entriesBefore = ledgerBefore.json?.entries ?? 0;

  const agentRes = await api('POST', '/api/agents', { name: 'Freight Agent', type: 'FREIGHT', mode: 'COPILOT' }, token);
  const agentId = agentRes.json?.agent?.id;
  record('create freight agent (COPILOT)', !!agentId, `status ${agentRes.status} id=${agentId ?? JSON.stringify(agentRes.json).slice(0, 120)}`);

  if (agentId) {
    const run = await api(
      'POST',
      `/api/agents/${agentId}/freight`,
      {
        bookingNumber: 'BK-1042',
        shipper: 'Denied Trading LLC',
        consignee: 'Northwind Traders',
        origin: 'Shenzhen, CN',
        destination: 'Hamburg, DE',
        hsCode: '8471.30',
        containerType: '40HQ',
        value: 12000,
        currency: 'USD',
      },
      token
    );
    const task = run.json?.task;
    const verdict = run.json?.result?.verdict;
    record(
      'freight BK-1042 → FLAGGED by the pure engine',
      verdict === 'FLAGGED',
      `verdict=${verdict} taskStatus=${task?.status} evaluations=${(run.json?.result?.evaluations ?? []).length} citations=${(run.json?.result?.citations ?? []).length}`
    );

    const tasks = await api('GET', '/api/agents/tasks?status=STAGED_FOR_APPROVAL', undefined, token);
    const staged =
      (tasks.json?.tasks ?? []).find((t: any) => t.taskType === 'FREIGHT_CUSTOMS_WORKFLOW') ?? tasks.json?.tasks?.[0];
    record('copilot interrupt staged a task', !!staged, staged ? `task ${staged.id}` : JSON.stringify(tasks.json).slice(0, 140));

    // Precedent panel (E06): the approval card must show what was decided before.
    const pr = staged?.outputResult?.precedents ?? [];
    record(
      'approval card carries precedents from the graph',
      pr.length > 0 && pr.every((p: any) => p.summary && p.decidedBy),
      `${pr.length} prior decision(s): ${pr.map((p: any) => `${p.outcome} by ${p.decidedBy}`).join('; ') || 'none'}`
    );

    if (staged) {
      const appr = await api('POST', `/api/agents/tasks/${staged.id}/approve`, {}, token);
      record('approve staged task', appr.status === 200 && appr.json?.success === true, `status ${appr.status}`);
    }
  }

  // 8. Ledger chain intact and grew
  const ledgerAfter = await api('GET', '/api/ledger/verify', undefined, token);
  record(
    'ledger chain verified',
    ledgerAfter.json?.ok === true && (ledgerAfter.json?.entries ?? 0) > entriesBefore,
    `ok=${ledgerAfter.json?.ok} entries ${entriesBefore} -> ${ledgerAfter.json?.entries}`
  );

  const ledgerList = await api('GET', '/api/ledger?limit=10', undefined, token);
  record('ledger list', (ledgerList.json?.entries?.length ?? 0) > 0, `${ledgerList.json?.entries?.length ?? 0} recent entries, kinds: ${[...new Set((ledgerList.json?.entries ?? []).map((e: any) => e.kind))].join(', ')}`);

  // 9. Time Machine: simulate 10k -> 5k, discard must be pure, apply must version the rule
  const simBody = { ruleId: credit?.id, candidateParams: { [thresholdKey]: 5000 } };
  const sim1 = await api('POST', '/api/brain/simulate', simBody, token);
  const s1 = sim1.json?.simulation;
  record(
    'time machine simulate',
    !!s1 && s1.replayFidelity === 1 && s1.changed >= 4,
    `total=${s1?.total} changed=${s1?.changed} replayFidelity=${s1?.replayFidelity} impactRules=${(s1?.impact?.rules ?? []).length} impactOwners=${(s1?.impact?.owners ?? []).length} impactAgents=${(s1?.impact?.agents ?? []).length}`
  );

  if (s1?.simulationId) {
    const disc = await api('POST', `/api/brain/simulate/${s1.simulationId}/discard`, {}, token);
    const rulesAfterDiscard = await api('GET', '/api/brain/rules', undefined, token);
    const creditNow = (rulesAfterDiscard.json?.rules ?? []).find((r: any) => r.actionType === 'CREDIT_LIMIT_APPROVAL');
    record(
      'discard leaves rules unchanged (T17)',
      disc.json?.success === true && creditNow?.params?.[thresholdKey] === currentThreshold,
      `${thresholdKey} still ${creditNow?.params?.[thresholdKey]}`
    );
  }

  const sim2 = await api('POST', '/api/brain/simulate', simBody, token);
  const s2 = sim2.json?.simulation;
  if (s2?.simulationId) {
    const applied = await api('POST', `/api/brain/simulate/${s2.simulationId}/apply`, { approverNote: 'e2e rehearsal' }, token);
    const rulesNow = await api('GET', '/api/brain/rules', undefined, token);
    const activeCredit = (rulesNow.json?.rules ?? []).filter((r: any) => r.actionType === 'CREDIT_LIMIT_APPROVAL');
    record(
      'apply versions the rule (T17)',
      applied.json?.success === true && activeCredit.length === 1 && activeCredit[0].params?.[thresholdKey] === 5000,
      `${thresholdKey}=${activeCredit[0]?.params?.[thresholdKey]} apply=${JSON.stringify(applied.json).slice(0, 160)}`
    );
    const ledgerPost = await api('GET', '/api/ledger/verify', undefined, token);
    record('ledger grew after apply', ledgerPost.json?.ok === true && (ledgerPost.json?.entries ?? 0) > (ledgerAfter.json?.entries ?? 0), `entries ${ledgerAfter.json?.entries} -> ${ledgerPost.json?.entries}`);
  } else {
    record('apply versions the rule (T17)', false, 'no simulation id returned');
  }

  // 10. Freshness: stale queue reachable
  const stale = await api('GET', '/api/brain/stale', undefined, token);
  record('stale queue endpoint', stale.status === 200 && Array.isArray(stale.json?.items ?? stale.json?.stale), JSON.stringify(stale.json).slice(0, 140));

  // 11. Tenant isolation: a fresh user sees an empty brain (T1 over HTTP)
  const other = await signUp();
  const otherRules = await api('GET', '/api/brain/rules', undefined, other.token);
  const otherQuery = await api('POST', '/api/brain/query', { query: 'Who owns the denied-party screening policy?' }, other.token);
  record(
    'tenant isolation (fresh user sees nothing)',
    (otherRules.json?.rules ?? []).length === 0 && (otherQuery.json?.result?.citations ?? otherQuery.json?.citations ?? []).length === 0,
    `rules=${(otherRules.json?.rules ?? []).length} citations=${(otherQuery.json?.result?.citations ?? otherQuery.json?.citations ?? []).length}`
  );

  // 12. Agent memory: write an episode, recall it, and confirm another tenant cannot
  const marker = `zebra-${Date.now()}`;
  const episode = await api(
    'POST',
    '/api/memory/episodes',
    { summary: `Screened booking ${marker}: staged for a human, nothing shipped`, outcome: 'STAGED_FOR_APPROVAL', shared: true },
    token
  );
  const recalled = await api('GET', `/api/memory/recall?q=${marker}`, undefined, token);
  const recalledOther = await api('GET', `/api/memory/recall?q=${marker}`, undefined, other.token);
  const hit = (recalled.json?.memories ?? []).some((m: any) => String(m.text).includes(marker));
  record(
    'agent memory write + recall round-trip, isolated per tenant',
    episode.status === 201 && hit && (recalledOther.json?.memories ?? []).length === 0,
    `episode=${episode.status} recalled=${(recalled.json?.memories ?? []).length} otherTenant=${(recalledOther.json?.memories ?? []).length}`
  );

  const memStats = await api('GET', '/api/memory/stats', undefined, token);
  record(
    'memory stats reported from the graph',
    memStats.status === 200 && Number(memStats.json?.episodes ?? 0) >= 1,
    JSON.stringify(memStats.json)
  );

  // 13. Connection path ("how are these two things connected?") over shortestPath
  const gp = await api('GET', '/api/brain/graph', undefined, token);
  const gnodes: any[] = gp.json?.graph?.nodes ?? [];
  const glinks: any[] = gp.json?.graph?.links ?? [];
  const nameOf = (id: string) => gnodes.find((n) => n.id === id)?.name || '';
  const pickLink = glinks.find((l) => nameOf(l.source) && nameOf(l.target) && nameOf(l.source).length > 3 && nameOf(l.target).length > 3);
  const pathRes = pickLink
    ? await api('GET', `/api/brain/path?from=${encodeURIComponent(nameOf(pickLink.source))}&to=${encodeURIComponent(nameOf(pickLink.target))}`, undefined, token)
    : { status: 0, json: null };
  const p = pathRes.json?.path;
  record(
    'connection path returns a real hop chain',
    p?.connected === true && Array.isArray(p?.nodes) && p.nodes.length >= 2 && (p?.edges?.length ?? 0) === p.nodes.length - 1,
    `"${nameOf(pickLink?.source ?? '')}" → "${nameOf(pickLink?.target ?? '')}": hops=${p?.hops} chain=${(p?.nodes ?? []).map((n: any) => `${n.label}:${n.name}`).join(' → ')} · ${String(p?.statement ?? '').slice(0, 90)}`
  );

  // 14. Path absence: two entities with no link say so instead of returning []
  const farPath = await api('GET', `/api/brain/path?from=${encodeURIComponent(nameOf(pickLink?.source ?? '') || 'zz')}&to=no-such-entity-qq-${Date.now()}`, undefined, token);
  const fp = farPath.json?.path;
  record(
    'unmatched endpoint reported as absence, not an empty list',
    farPath.status === 200 && fp?.connected === false && typeof fp?.statement === 'string' && fp.statement.length > 20,
    String(fp?.statement ?? JSON.stringify(farPath.json)).slice(0, 150)
  );

  // 15. Rule version diff — the apply in step 9 created v2 with a changed param
  const vr = await api('GET', `/api/brain/rules/${encodeURIComponent(String(credit?.id ?? ''))}/versions`, undefined, token);
  const vdiff = (vr.json?.diffs ?? []).find((d: any) => d.changed.some((c: any) => c.key === thresholdKey));
  record(
    'rule version diff shows the parameter change',
    vr.status === 200 && (vr.json?.versions ?? []).length >= 2 && !!vdiff,
    `${(vr.json?.versions ?? []).length} version(s): ${(vr.json?.versions ?? []).map((v: any) => `v${v.version}(${v.status})`).join(', ')}; ${thresholdKey} ${vdiff?.changed?.[0]?.before} → ${vdiff?.changed?.[0]?.after}`
  );

  // 16. Decision timeline for one subject
  const tl = await api('GET', '/api/brain/timeline?subject=BK-1042', undefined, token);
  const kinds = [...new Set((tl.json?.events ?? []).map((e: any) => e.kind))];
  record(
    'decision timeline replays one subject from the graph',
    tl.status === 200 && (tl.json?.events ?? []).length > 0 && tl.json?.statement?.length > 10,
    `${(tl.json?.events ?? []).length} event(s) across ${kinds.join(', ')} · ${String(tl.json?.statement ?? '').slice(0, 90)}`
  );

  // 17. Cross-agent handoff board (existing HANDED_OFF_TO edges)
  const hb = await api('GET', '/api/brain/handoffs', undefined, token);
  record(
    'handoff board reads HANDED_OFF_TO edges',
    hb.status === 200 && (hb.json?.handoffs ?? []).length >= 1 && (hb.json?.agents ?? []).length >= 1,
    `${(hb.json?.handoffs ?? []).length} handoff(s) over ${(hb.json?.agents ?? []).length} agent(s): ${(hb.json?.handoffs ?? []).slice(0, 3).map((h: any) => `${h.fromName || 'task'}→${h.toName}`).join(', ')}`
  );

  // 18. Explain a node (one-click drill)
  const policyNode = gnodes.find((n) => n.label === 'Policy' || n.properties?.policyName) ?? gnodes[0];
  const ex = await api('GET', `/api/brain/explain/${encodeURIComponent(String(policyNode?.id ?? ''))}`, undefined, token);
  record(
    'node explanation assembles neighbourhood + SOP + provenance',
    ex.status === 200 && ex.json?.explanation?.node?.id === policyNode?.id && (ex.json?.explanation?.neighbours ?? []).length > 0,
    `${ex.json?.explanation?.node?.label} "${ex.json?.explanation?.node?.name}": ${(ex.json?.explanation?.neighbours ?? []).length} neighbour(s), ${(ex.json?.explanation?.provenance ?? []).length} source chunk(s), ${(ex.json?.explanation?.decisions ?? []).length} decision(s)`
  );

  // 19. Freshness digest
  const dg = await api('GET', '/api/brain/freshness-digest?days=60', undefined, token);
  record(
    'freshness digest aggregates version + staleness events',
    dg.status === 200 && typeof dg.json?.digest?.counts?.supersededRules === 'number' && dg.json.digest.counts.supersededRules >= 1,
    `supersededDocs=${dg.json?.digest?.counts?.supersededDocuments} supersededRules=${dg.json?.digest?.counts?.supersededRules} stale=${dg.json?.digest?.counts?.staleRules} pending=${dg.json?.digest?.counts?.pendingReviewPolicies}`
  );

  // 20. Graph export in three formats, straight from the tenant graph
  const expJson = await fetch(`${BASE}/api/brain/graph/export?format=json`, { headers: { Authorization: `Bearer ${token}` } });
  const expJsonText = await expJson.text();
  let expJsonObj: any = null;
  try {
    expJsonObj = JSON.parse(expJsonText);
  } catch {
    /* recorded as a failure below */
  }
  const expXml = await fetch(`${BASE}/api/brain/graph/export?format=graphml`, { headers: { Authorization: `Bearer ${token}` } });
  const expXmlText = await expXml.text();
  const expCsv = await fetch(`${BASE}/api/brain/graph/export?format=csv`, { headers: { Authorization: `Bearer ${token}` } });
  const expCsvText = await expCsv.text();
  record(
    'graph export emits JSON, GraphML and CSV from real counts',
    expJsonObj?.nodes?.length > 0 &&
      expXmlText.startsWith('<?xml') &&
      expXmlText.includes('<graphml') &&
      (expXmlText.match(/<node /g) || []).length === expJsonObj.nodes.length &&
      expCsvText.split('\r\n')[0].startsWith('source_id,'),
    `json nodes=${expJsonObj?.nodes?.length} edges=${expJsonObj?.edges?.length}; graphml ${expXmlText.length} chars with ${(expXmlText.match(/<edge /g) || []).length} <edge>; csv ${expCsvText.split('\r\n').length - 1} rows; disposition=${expJson.headers.get('content-disposition')}`
  );

  // 21. Answer feedback (👎) becomes a Knowledge Health finding on the cited chunk
  const cited = (ans?.citations ?? [])[0];
  const fb = await api('POST', '/api/brain/feedback', { question: 'Who owns the denied-party screening policy?', verdict: 'DOWN', chunkIds: [cited?.chunkId], comment: 'stale threshold quoted', traceId: ans?.traceId }, token);
  const healthAfterFb = await api('GET', '/api/brain/health', undefined, token);
  const fbFindings = (healthAfterFb.json?.findings ?? []).filter((f: any) => f.kind === 'SOURCE_THUMBS_DOWN');
  record(
    'thumbs-down feedback lands in Knowledge Health',
    fb.status === 201 && fbFindings.length >= 1 && fbFindings[0].subjectId === cited?.chunkId,
    `feedback=${fb.status} citedChunk=${cited?.chunkId} linked=${fb.json?.feedback?.linkedChunks?.length} findings=${fbFindings.length} healthScore=${healthAfterFb.json?.score}`
  );

  // 22. A rating with no cited chunk is still stored (and does not fake a link)
  const fbNoChunk = await api('POST', '/api/brain/feedback', { question: 'What is our holiday overtime policy?', verdict: 'UP', chunkIds: ['chunk_does_not_exist'] }, token);
  const fbList = await api('GET', '/api/brain/feedback', undefined, token);
  record(
    'feedback list reads the graph, bogus chunk ids are refused',
    fbNoChunk.status === 201 && (fbList.json?.items ?? []).length >= 2 && (fbNoChunk.json?.feedback?.linkedChunks ?? []).length === 0,
    `items=${(fbList.json?.items ?? []).length} counts=${JSON.stringify(fbList.json?.counts)} linkedOnBogusId=${(fbNoChunk.json?.feedback?.linkedChunks ?? []).length}`
  );

  // 23. Own watchlist entry changes the next screening verdict (graph fact → engine)
  const customParty = `Globex Restricted-${Date.now().toString().slice(-6)}`;
  const wlAdd = await api('POST', '/api/watchlist', { name: customParty, note: 'added from the UI during e2e' }, token);
  const previewAfter = wlAdd.json?.preview;
  record(
    'watchlist add writes a WatchlistEntry node and previews impact',
    wlAdd.status === 201 && wlAdd.json?.entry?.demoSeed === 'false' && typeof previewAfter?.screenedBookings === 'number',
    `id=${wlAdd.json?.entry?.id} list=${wlAdd.json?.entry?.list} previewStatement="${String(previewAfter?.statement ?? '').slice(0, 90)}"`
  );

  if (agentId) {
    const runWithNewEntry = await api(
      'POST',
      `/api/agents/${agentId}/freight`,
      { bookingNumber: `BK-WL-${Date.now().toString().slice(-5)}`, shipper: customParty, consignee: 'Northwind Traders', origin: 'Shenzhen, CN', destination: 'Hamburg, DE', hsCode: '8471.30', value: 100, currency: 'USD' },
      token
    );
    const flaggedByNew = runWithNewEntry.json?.result?.evaluations?.find((e: any) => e.actionType === 'DENIED_PARTY_SCREENING');
    record(
      'new watchlist entry actually flips the pure engine',
      runWithNewEntry.json?.result?.verdict === 'FLAGGED' && flaggedByNew?.fired === true,
      `verdict=${runWithNewEntry.json?.result?.verdict} reason=${String(flaggedByNew?.reasons?.[0] ?? '').slice(0, 110)}`
    );

    const wlId = wlAdd.json?.entry?.id;
    const wlDel = await api('DELETE', `/api/watchlist/${encodeURIComponent(String(wlId))}`, undefined, token);
    const runAfterDelete = await api(
      'POST',
      `/api/agents/${agentId}/freight`,
      { bookingNumber: `BK-WL2-${Date.now().toString().slice(-5)}`, shipper: customParty, consignee: 'Northwind Traders', origin: 'Shenzhen, CN', destination: 'Hamburg, DE', hsCode: '8471.30', value: 100, currency: 'USD' },
      token
    );
    record(
      'removing your own entry un-screens it again',
      wlDel.status === 200 && wlDel.json?.removed === true && runAfterDelete.json?.result?.verdict !== 'FLAGGED',
      `delete=${wlDel.status} verdict after removal=${runAfterDelete.json?.result?.verdict}`
    );

    const wlAll = await api('GET', '/api/watchlist', undefined, token);
    const seededId = (wlAll.json?.entries ?? []).find((e: any) => e.demoSeed === 'true')?.id;
    const wlDelSeeded = await api('DELETE', `/api/watchlist/${encodeURIComponent(String(seededId))}`, undefined, token);
    record(
      'seeded demo entries are refused, not deleted',
      wlDelSeeded.status === 409 && wlDelSeeded.json?.removed === false,
      `${wlDelSeeded.status}: ${String(wlDelSeeded.json?.reason ?? '').slice(0, 100)}`
    );
  }

  // 24. Pinned brain queries, per tenant
  const pinQuestion = `Which containers are demurrage exposed? (${Date.now()})`;
  const pin = await api('POST', '/api/brain/saved-queries', { question: pinQuestion, snippet: 'from e2e', traceId: ans?.traceId }, token);
  const pinList = await api('GET', '/api/brain/saved-queries', undefined, token);
  const pinListOther = await api('GET', '/api/brain/saved-queries', undefined, other.token);
  const pinId = pin.json?.saved?.id;
  const pinDel = await api('DELETE', `/api/brain/saved-queries/${encodeURIComponent(String(pinId))}`, undefined, token);
  const pinListAfter = await api('GET', '/api/brain/saved-queries', undefined, token);
  record(
    'pinned queries save, isolate and delete in the tenant graph',
    pin.status === 201 &&
      (pinList.json?.items ?? []).some((i: any) => i.question === pinQuestion) &&
      (pinListOther.json?.items ?? []).length === 0 &&
      pinDel.status === 200 &&
      !(pinListAfter.json?.items ?? []).some((i: any) => i.question === pinQuestion),
    `saved=${pin.status} mine=${(pinList.json?.items ?? []).length} otherTenant=${(pinListOther.json?.items ?? []).length} afterDelete=${(pinListAfter.json?.items ?? []).length}`
  );

  // 25. Ledger absorbed the watchlist writes without breaking the chain
  const ledgerEnd = await api('GET', '/api/ledger/verify', undefined, token);
  const ledgerKinds = [...new Set((await api('GET', '/api/ledger?limit=50', undefined, token)).json?.entries?.map((e: any) => e.kind) ?? [])];
  record(
    'ledger still verifies after the new write paths',
    ledgerEnd.json?.ok === true && ledgerKinds.includes('WATCHLIST_ENTRY_ADDED') && ledgerKinds.includes('WATCHLIST_ENTRY_REMOVED'),
    `entries=${ledgerEnd.json?.entries} kinds=${ledgerKinds.join(', ')}`
  );

  const failed = checks.filter((ch) => !ch.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('Failing:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nE2E aborted:', err.message);
  process.exitCode = 1;
});

export {};
