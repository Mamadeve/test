import { Engine } from '../src/sim/engine';

function dump(e: Engine, label: string) {
  const st = e.state;
  console.log(`\n===== ${label} =====`);
  // for each sku/wh: contents sum vs state sums
  const rows: any[] = [];
  for (const [sku, whs] of Object.entries(st.inv)) {
    for (const [wh, counts] of Object.entries(whs as Record<string, any>)) {
      const locSum = Object.values(st.locations)
        .filter((l: any) => l.warehouseId === wh && l.kind === 'STORAGE')
        .reduce((s: number, l: any) => s + (l.contents[sku] ?? 0), 0);
      const states: Record<string, number> = {};
      for (const [k, v] of Object.entries(counts)) if (v) states[k] = v;
      const total = Object.values(counts).reduce((a: number, b: number) => a + b, 0);
      rows.push({ sku, wh, locSum, states, total });
    }
  }
  for (const r of rows.slice(0, 8)) console.log(JSON.stringify(r));
  // hypothesize contents == A+R+AL+? ; find which subset matches locSum for all rows
  const keys = ['AVAILABLE', 'RESERVED', 'ALLOCATED', 'PICKING', 'RECEIVED', 'QUARANTINED', 'DAMAGED'];
  for (let mask = 0; mask < (1 << keys.length); mask++) {
    const subset = keys.filter((_, i) => mask & (1 << i));
    const allMatch = rows.every(r => subset.reduce((s, k) => s + (r.states[k] ?? 0), 0) === r.locSum);
    if (allMatch) console.log('MATCH contents ==', subset.join('+') || '∅');
  }
  // ledger replay
  let replayOk = true, firstErr = '';
  const run: Record<string, Record<string, number>> = {};
  for (const l of st.ledger as any[]) {
    const key = `${l.sku}|${l.warehouseId}`;
    const cur = run[key] ?? (run[key] = {});
    for (const [k, v] of Object.entries(l.before)) {
      if ((cur[k] ?? 0) !== v) { replayOk = false; firstErr = `${l.id} ${key} ${k}: running=${cur[k] ?? 0} before=${v}`; }
      cur[k] = (l.after as any)[k] ?? 0;
    }
  }
  if (!replayOk) console.log('LEDGER REPLAY FAIL:', firstErr);
  else {
    // final match vs inv
    let finalOk = true; let ferr = '';
    for (const [sku, whs] of Object.entries(st.inv))
      for (const [wh, counts] of Object.entries(whs as any)) {
        const key = `${sku}|${wh}`; const cur = run[key] ?? {};
        const allKeys = new Set([...Object.keys(cur), ...Object.keys(counts)]);
        for (const k of allKeys) {
          const a = cur[k] ?? 0, b = (counts as any)[k] ?? 0;
          if (a !== b) { finalOk = false; ferr = `${key} ${k}: replay=${a} inv=${b}`; }
        }
      }
    console.log(finalOk ? 'LEDGER FINAL == INV ✓' : 'LEDGER FINAL MISMATCH: ' + ferr);
  }
  // serials vs counts
  let serOk = true, serErr = '';
  const serMap: Record<string, number> = {};
  for (const s of st.serials) {
    const k = `${s.sku}|${s.warehouseId}|${s.state}`;
    serMap[k] = (serMap[k] ?? 0) + 1;
  }
  for (const [sku, whs] of Object.entries(st.inv))
    for (const [wh, counts] of Object.entries(whs as any)) {
      const variant = e.variantBySku(sku);
      if (!variant || !e.product(variant.productId)?.serialized) continue;
      for (const k of ['AVAILABLE', 'ALLOCATED', 'RESERVED', 'PICKING', 'DELIVERED']) {
        const invN = (counts as any)[k] ?? 0;
        const serN = serMap[`${sku}|${wh}|${k}`] ?? 0;
        if (invN !== serN && (invN > 0 || serN > 0)) {
          // DELIVERED state may not exist in inv; check
          serOk = false; serErr = `${sku}|${wh}|${k}: inv=${invN} serials=${serN}`;
        }
      }
    }
  console.log(serOk ? 'SERIALS == INV (serialized skus) ✓' : 'SERIALS MISMATCH: ' + serErr);
}

// fresh
const e0 = new Engine();
dump(e0, 'FRESH (seeded)');

// after activity
const e1 = new Engine();
for (let i = 0; i < 5; i++) e1.scenarioOrder({ productIdx: i, variantIdx: 0, qty: 2 });
e1.runAll(3000);
dump(e1, 'AFTER 5 ORDERS (delivered)');

// after returns/restock
const delivered = e1.state.orders.filter(o => o.state === 'DELIVERED');
for (const o of delivered) {
  const r = e1.requestReturn(o.id, [0], 'کیفیت پایین');
  if (r.ok) break;
}
e1.runAll(4000);
dump(e1, 'AFTER RETURN CYCLE');
