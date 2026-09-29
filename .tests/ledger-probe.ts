import { Engine } from '../src/sim/engine';
const e = new Engine();
const sku = 'PHX-BLK-256';
const o = e.scenarioOrder({ productIdx: 0, variantIdx: 0, qty: 2 });
console.log('order:', o!.id);
e.runAll(3000);
console.log('order state:', e.state.orders.find(x => x.id === o!.id)!.state);
const txs = e.state.ledger.filter(l => l.sku === sku && l.warehouseId === 'WH-TEH-01');
for (const t of txs) console.log(t.id, t.action, JSON.stringify(t.before), '→', JSON.stringify(t.after), '|', t.reason.slice(0, 60));
console.log('FINAL INV:', JSON.stringify(e.state.inv[sku]['WH-TEH-01']));
const locSum = Object.values(e.state.locations).filter((l: any) => l.warehouseId === 'WH-TEH-01' && l.kind === 'STORAGE')
  .reduce((s: number, l: any) => s + ((l.contents as any)[sku] ?? 0), 0);
console.log('LOC SUM:', locSum);
console.log('SERIALS by state:', JSON.stringify(e.state.serials.filter(s => s.sku === sku && s.warehouseId === 'WH-TEH-01').reduce<Record<string, number>>((a, s) => { a[s.state] = (a[s.state] ?? 0) + 1; return a; }, {})));
