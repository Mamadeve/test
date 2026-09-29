import { Engine, ALLOWED_TRANSITIONS, SHIPMENT_RANK, ORDER_RANK } from '../src/sim/engine';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
};
const sumStates = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);
const locSum = (e: Engine, sku: string, wh: string) =>
  Object.values(e.state.locations)
    .filter((l: any) => l.warehouseId === wh && l.kind === 'STORAGE')
    .reduce((s: number, l: any) => s + (((l.contents as any)[sku]) ?? 0), 0);

function snapshotTotals(e: Engine): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sku, whs] of Object.entries(e.state.inv))
    for (const [wh, counts] of Object.entries(whs as any))
      out[`${sku}|${wh}`] = sumStates(counts);
  return out;
}

function checkLedgerReplay(e: Engine): boolean {
  const run: Record<string, Record<string, number>> = {};
  for (const l of e.state.ledger as any[]) {
    const key = `${l.sku}|${l.warehouseId}`;
    const cur = run[key] ?? (run[key] = {});
    for (const [k, v] of Object.entries(l.before)) {
      if ((cur[k] ?? 0) !== v) return false;
      cur[k] = (l.after as any)[k] ?? 0;
    }
  }
  for (const [sku, whs] of Object.entries(e.state.inv))
    for (const [wh, counts] of Object.entries(whs as any)) {
      const cur = run[`${sku}|${wh}`] ?? {};
      const keys = new Set([...Object.keys(cur), ...Object.keys(counts)]);
      for (const k of keys) if ((cur[k] ?? 0) !== ((counts as any)[k] ?? 0)) return false;
    }
  return true;
}

function checkSerialsEqualInv(e: Engine): string {
  const ser: Record<string, number> = {};
  for (const s of e.state.serials) {
    const k = `${s.sku}|${s.warehouseId}|${s.state}`;
    ser[k] = (ser[k] ?? 0) + 1;
  }
  for (const [sku, whs] of Object.entries(e.state.inv)) {
    const v = e.variantBySku(sku); if (!v) continue;
    if (!e.product(v.productId)?.serialized) continue;
    for (const [wh, counts] of Object.entries(whs as any))
      for (const [state, n] of Object.entries(counts as any)) {
        const sN = ser[`${sku}|${wh}|${state}`] ?? 0;
        if (sN !== n) return `${sku}|${wh}|${state}: inv=${n} serials=${sN}`;
      }
    // and no serials in states not present
    for (const k of Object.keys(ser)) {
      const [s2, w2, st2] = k.split('|');
      if (s2 === sku && ((e.state.inv[sku]?.[w2] as any)?.[st2] ?? 0) === 0)
        return `orphan serials ${k}=${ser[k]}`;
    }
  }
  return '';
}

function uniqueIds(e: Engine): string {
  const seen = new Set<string>(); const dup: string[] = [];
  const add = (id: string, tag: string) => { if (seen.has(id)) dup.push(`${tag}:${id}`); seen.add(id); };
  e.state.orders.forEach(o => add(o.id, 'ORD'));
  e.state.payments.forEach(p => add(p.id, 'PAY'));
  e.state.tasks.forEach(t => add(t.id, 'TASK'));
  e.state.packages.forEach(p => add(p.id, 'PKG'));
  e.state.events.forEach(ev => add(ev.id, 'EV'));
  e.state.ledger.forEach(l => add(l.id, 'INV-TX'));
  e.state.exceptions.forEach(x => add(x.id, 'EX'));
  e.state.returns.forEach(r => add(r.id + r.rma, 'RET'));
  e.state.refunds.forEach(r => add(r.id, 'RFD'));
  e.state.manifests.forEach(m => add(m.id, 'MAN'));
  e.state.totes.forEach(t => add(t.id, 'TOT'));
  e.state.serials.forEach(s => add(s.serial, 'SN'));
  e.state.coupons.forEach(c => add(c.id, 'CPN'));
  e.state.reservations.forEach(r => add(r.id, 'RSV'));
  e.state.orders.forEach(o => o.shipments.forEach(s => add(s.id, 'SHP')));
  return dup.join(',');
}

function checkHistoryLegal(e: Engine): string {
  for (const o of e.state.orders) {
    for (let i = 1; i < o.history.length; i++) {
      const from = o.history[i - 1].state, to = o.history[i].state;
      const allowed = (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
      if (allowed) continue;
      // legal ONLY via the monotonic sync-from-shipments (documented in detailFa)
      // and only forward — backward jumps are always impossible
      const isSync = o.history[i].detailFa.includes('همگام‌سازی');
      const rf = ORDER_RANK[from], rt = ORDER_RANK[to];
      if (!(isSync && rf !== undefined && rt !== undefined && rt > rf))
        return `${o.id}: ${from} → ${to}${isSync ? ' (sync but not forward)' : ''}`;
    }
  }
  // no blocked-transition attempts either (transition() must never be asked to do the impossible)
  const blocked = e.state.exceptions.filter(x => x.messageFa.includes('گذار غیرمجاز'));
  if (blocked.length) return `blocked attempts: ${blocked.length}`;
  return '';
}

// ======================================================== FRESH =============
console.log('\n== A. موتور تازه (seed) ==');
{
  const e = new Engine();
  // 1. bins hold every sellable unit
  let binBad = '';
  for (const [sku, whs] of Object.entries(e.state.inv))
    for (const [wh, c] of Object.entries(whs as any)) {
      if (locSum(e, sku, wh) !== (c.AVAILABLE ?? 0)) binBad = `${sku}|${wh}: loc=${locSum(e, sku, wh)} A=${c.AVAILABLE}`;
    }
  ok('قفسه‌ها == موجودی قابل فروش (همه SKU/انبار)', !binBad, binBad);

  // 2. each product totals its initialQty (100)
  let qtyBad = '';
  for (const p of e.state.products) {
    const total = p.variants.reduce((s, v) =>
      s + Object.values(e.state.inv[v.sku] ?? {}).reduce((a: number, c: any) => a + sumStates(c), 0), 0);
    if (total !== p.initialQty) qtyBad = `${p.id}: ${total} != ${p.initialQty}`;
  }
  ok('هر محصول دقیقاً ۱۰۰ واحد', !qtyBad, qtyBad);

  // 3. serials == inv (serialized)
  const serErr = checkSerialsEqualInv(e);
  ok('سریال‌ها == اعداد موجودی (کالاهای سریال‌دار)', !serErr, serErr);

  // 4. ledger replay
  ok('بازپخش دفتر موجودی == وضعیت فعلی', checkLedgerReplay(e));

  // 5. kpi sanity on fresh
  const k = e.kpi();
  const pcts = [k.onTimeDispatch, k.onTimeDelivery, k.cancellationRate, k.returnRate, k.inventoryAccuracy, k.sellerConfirmRate];
  ok('KPI درصدی: متناهی و در [0,100]', pcts.every(v => Number.isFinite(v) && v >= 0 && v <= 100), JSON.stringify(pcts));
  ok('KPI شمارشی: صفر/منطقی', k.totalOrders === e.state.orders.length && Number.isFinite(k.pickRate));
}

// ================================================= AFTER DELIVERIES =========
console.log('\n== B. پس از ۵ سفارش تحویل‌شده ==');
const e1 = new Engine();
const before = snapshotTotals(e1);
for (let i = 0; i < 5; i++) e1.scenarioOrder({ productIdx: i, variantIdx: 0, qty: 2 });
e1.runAll(3500);
{
  const after = snapshotTotals(e1);
  let consBad = '';
  for (const key of Object.keys(before)) if (before[key] !== after[key]) consBad += `${key}: ${before[key]}→${after[key]} `;
  ok('حفظ کل موجودی در هر (SKU, انبار) — بدون اتوماسیون/شمارش', !consBad, consBad);

  ok('دفتر بازپخش می‌شود', checkLedgerReplay(e1));
  const serErr = checkSerialsEqualInv(e1);
  ok('سریال‌ها == موجودی بعد از چرخه کامل', !serErr, serErr);

  // bins == A + R + AL + PICKING (units still in bin)
  let binBad = '';
  for (const [sku, whs] of Object.entries(e1.state.inv))
    for (const [wh, c] of Object.entries(whs as any)) {
      const inBin = (c.AVAILABLE ?? 0) + (c.RESERVED ?? 0) + (c.ALLOCATED ?? 0) + (c.PICKING ?? 0);
      if (locSum(e1, sku, wh) !== inBin) binBad = `${sku}|${wh}: loc=${locSum(e1, sku, wh)} A+R+AL+P=${inBin}`;
    }
  ok('قفسه‌ها == واحدهای در انبار (A+R+AL+PICKING)', !binBad, binBad);

  // no false exceptions on clean flow
  const badExc = e1.state.exceptions.filter(x => x.type === 'INVENTORY_MISMATCH');
  ok('بدون استثنای دروغین مغایرت موجودی', badExc.length === 0, badExc.map(x => x.messageFa).join('; '));

  // money
  let moneyBad = '';
  for (const o of e1.state.orders) {
    const sum = o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const pay = e1.state.payments.find(p => p.id === o.paymentId);
    if (sum !== o.totalAmount) moneyBad += `${o.id} items≠total `;
    if (pay && pay.amount !== o.totalAmount) moneyBad += `${o.id} pay≠total `;
  }
  ok('مبلغ سفارش == جمع اقلام == مبلغ پرداخت', !moneyBad, moneyBad);

  // refunds ≤ payments
  const refundSum = e1.state.refunds.reduce((s, r) => s + r.amount, 0);
  const paySum = e1.state.payments.filter(p => p.status === 'SUCCESS').reduce((s, p) => s + p.amount, 0);
  ok('بازپرداخت‌ها ≤ پرداخت‌های موفق', refundSum <= paySum, `${refundSum} > ${paySum}`);

  // history legality
  const hl = checkHistoryLegal(e1);
  ok('هر گذار تاریخچه سفارش مجاز است', !hl, hl);

  // capacity
  const capBad = e1.state.warehouses.filter(w =>
    w.used.picking > w.capacity.picking || w.used.packing > w.capacity.packing ||
    w.used.receiving > w.capacity.receiving || w.used.dispatch > w.capacity.dispatch)
    .map(w => w.id).join(',');
  ok('استفاده ≤ ظرفیت برای همه انبارها', !capBad, capBad);

  // kpi cross-checks
  const k = e1.kpi();
  ok('deliveredCount == تعداد DELIVERED', k.deliveredCount === e1.state.orders.filter(o => o.state === 'DELIVERED').length, `${k.deliveredCount}`);
  ok('pickErrors == pickStats.errors', k.pickErrors === e1.state.pickStats.errors);
  ok('درصدها همچنان متناهی', [k.onTimeDelivery, k.cancellationRate, k.inventoryAccuracy].every(v => Number.isFinite(v) && v >= 0 && v <= 100));

  // ids
  const dups = uniqueIds(e1);
  ok('همه شناسه‌ها یکتا', !dups, dups);

  // shipments/packages legal states
  const shBad = e1.state.orders.flatMap(o => o.shipments).filter(s => !(s.state in SHIPMENT_RANK)).map(s => s.state).join(',');
  ok('وضعیت همه مرسولات معتبر', !shBad, shBad);

  // serial tagging: item serials belong to the order
  let tagBad = '';
  for (const o of e1.state.orders)
    for (const it of o.items)
      for (const sn of it.serials) {
        const u = e1.state.serials.find(s => s.serial === sn);
        if (!u) tagBad += `${sn} missing `;
        else if (u.orderId !== o.id) tagBad += `${sn} tagged ${u.orderId} != ${o.id} `;
      }
  ok('سریال‌های هر سفارش به همان سفارش تعلق دارند', !tagBad, tagBad);

  // events monotonic time
  let timeBad = '';
  for (let i = 1; i < e1.state.events.length; i++)
    if (e1.state.events[i].at < e1.state.events[i - 1].at) { timeBad = `${e1.state.events[i].id} < prev`; break; }
  ok('زمان رویدادها نزولی نمی‌شود', !timeBad, timeBad);
}

// ================================================ CONCURRENT SAME-SKU ======
console.log('\n== C. ۴ سفارش همزمان روی یک SKU (فشار روی سریال‌ها) ==');
{
  const e = new Engine();
  const before = snapshotTotals(e);
  const v = e.state.products[0].variants[0];
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const o = e.placeOrder({ customerId: 'CUS-0001', items: [{ variantId: v.id, qty: 2 }], city: 'تهران', addressFa: 'آدرس', paymentMethod: 'CARD', paymentOutcome: 'SUCCESS' });
    ids.push(o.id);
  }
  e.runAll(4000);
  const after = snapshotTotals(e);
  let consBad = '';
  for (const key of Object.keys(before)) if (before[key] !== after[key]) consBad += `${key}: ${before[key]}→${after[key]} `;
  ok('حفظ موجودی با سفارش‌های همزمان', !consBad, consBad);
  const serErr = checkSerialsEqualInv(e);
  ok('سریال‌ها == موجودی (همزمان)', !serErr, serErr);
  let tagBad = '';
  for (const oid of ids) {
    const o = e.state.orders.find(x => x.id === oid)!;
    if (o.state !== 'DELIVERED') { tagBad += `${oid}=${o.state} `; continue; }
    for (const it of o.items)
      for (const sn of it.serials) {
        const u = e.state.serials.find(s => s.serial === sn)!;
        if (u.orderId !== oid) tagBad += `${sn}→${u.orderId ?? 'none'}(expect ${oid}) `;
      }
  }
  ok('هر سفارش سریال‌های خودش را دارد', !tagBad, tagBad);
  ok('بدون استثنای دروغین', e.state.exceptions.length === 0, e.state.exceptions.map(x => x.type).join(','));
}

// ==================================================== INBOUND ==============
console.log('\n== D. ورودی کالا: قفسه و موجودی ==');
{
  const e = new Engine();
  const sku = e.state.products[0].variants[0].sku;
  const before = snapshotTotals(e)[`${sku}|WH-TEH-01`];
  e.createInbound({ supplierFa: 'تامین', warehouseId: 'WH-TEH-01', sku, qty: 10, exceptionKind: 'NONE' });
  e.runAll(2500);
  const after = snapshotTotals(e)[`${sku}|WH-TEH-01`];
  ok('موجودی +۱۰ پس از چیدمان', after === before + 10, `${before} → ${after}`);
  ok('قفسه‌ها هم +۱۰ شدند (Put-away فیزیکی)', locSum(e, sku, 'WH-TEH-01') === e.available(sku, 'WH-TEH-01'),
    `loc=${locSum(e, sku, 'WH-TEH-01')} A=${e.available(sku, 'WH-TEH-01')}`);
  ok('دpółبازپخش دفتر', checkLedgerReplay(e));
}

// ==================================================== CYCLE COUNT ==========
console.log('\n== E. شمارش چرخه‌ای: اصلاح دقیق ==');
{
  const e = new Engine();
  const sku = e.state.products[0].variants[0].sku;
  const before = snapshotTotals(e);
  const cc = e.startCycleCount(sku, 'WH-TEH-01', -3);
  e.runAll(800);
  e.approveAdjustment(cc.id);
  e.runAll(400);
  const after = snapshotTotals(e);
  const key = `${sku}|WH-TEH-01`;
  ok('کل فقط با همان اختلاف تغییر می‌کند (−۳)', after[key] === before[key] - 3, `${before[key]} → ${after[key]}`);
  ok('دفتر بازپخش پس از اصلاح', checkLedgerReplay(e));
}

// ==================================================== CANCEL RELEASE =======
console.log('\n== F. لغو/شکست پرداخت: آزادسازی کامل ==');
{
  const e = new Engine();
  const v = e.state.products[1].variants[0];
  const sku = v.sku;
  const before = snapshotTotals(e);
  const o = e.placeOrder({ customerId: 'CUS-0001', items: [{ variantId: v.id, qty: 3 }], city: 'تهران', addressFa: 'آدرس', paymentMethod: 'CARD', paymentOutcome: 'FAIL' });
  e.runAll(600);
  const after = snapshotTotals(e);
  let bad = '';
  for (const key of Object.keys(before)) if (before[key] !== after[key]) bad += `${key}: ${before[key]}→${after[key]} `;
  ok('شکست پرداخت → هیچ واحدی گم/قفل نمی‌شود', !bad, bad);
  ok('سفارش PAYMENT_FAILED', e.state.orders.find(x => x.id === o.id)!.state === 'PAYMENT_FAILED');
  ok('رزروی باقی نمانده', !e.state.reservations.some(r => r.orderId === o.id && !r.released));
}

console.log(`\n######## CONSISTENCY RESULT: ${pass} passed, ${fail} failed ########`);
process.exit(fail ? 1 : 0);
