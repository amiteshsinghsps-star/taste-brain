process.env.GRAPH_DB=':memory:';
process.env.DEFAULT_MODE='replay';
process.env.QLOO_ENABLED='false';
async function main() {
  const { runPipeline } = await import('../src/agents/pipeline');
  for (const [pack, loc] of [['venues','venue_redroom'],['retail','store_3'],['restaurants','loc_westside']] as const) {
    const p = await runPipeline({ pack, location: loc, goal: 'demo', mode: 'replay' });
    console.log('\n=====', pack, loc, 'mode=', p.mode);
    console.log('items:', p.items.map(i=>`#${i.rank} ${i.name} (rank ${i.qloo_rank}, fit ${i.fit.toFixed(2)}, lift ${i.local_lift}, rising ${i.rising}, blocked ${i.approval_blocked})`));
    console.log('rejections:', p.rejections.map(r=>`${r.name}: ${r.reason} [check ${r.check}]`));
    console.log('unsupported:', p.unsupported.map(u=>u.name));
    console.log('flip_points:', JSON.stringify(p.flip_points));
    console.log('audience:', p.audience_tags.map(t=>t.name).join(','));
    console.log('lift_note:', p.local_lift_note);
    console.log('trace steps:', p.trace.steps.length);
  }
}
main().catch(e=>{console.error(e); process.exit(1);});
