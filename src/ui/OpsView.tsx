import React, { useMemo, useState } from 'react';
import { Engine, QC_RULES, PACKAGE_RULES, ALLOWED_TRANSITIONS, ORDER_RANK, SHIPMENT_RANK } from '../sim/engine';
import type { ExceptionRec, InboundExceptionKind, Order, ScenarioId } from '../sim/types';
import { SCENARIOS } from '../sim/scenarios';
import {
  faMoney, faDateTime, faTime, faPercent, faOrderState, faTaskType, faTaskStatus,
  faInvState, faRole, faExceptionType, faExceptionStatus, faSeverity, faFulfillment,
  faInboundState, faInboundException, faToteState, faPackageState, faManifestStatus,
  faReturnState, faDisposition, faRefundStatus, faCycleCountState, faPickStrategy, faNarration, faPackageType,
} from '../sim/labels';
import {
  OrderChip, ShipmentChip, SevChip, Stat, Drawer, Modal, PageH, Empty, KV, useToasts,
} from './common';

type SubTab = 'tower' | 'kpi' | 'orders' | 'wh' | 'inbound' | 'inv' | 'exceptions' | 'returns' | 'sellers' | 'support' | 'admin';

export default function OpsView({ e, focusOrderId, clearFocus }: {
  e: Engine; focusOrderId?: string | null; clearFocus?: () => void;
}) {
  const [sub, setSub] = useState<SubTab>('tower');
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [excOpen, setExcOpen] = useState<ExceptionRec | null>(null);
  const { push, node } = useToasts();

  React.useEffect(() => {
    if (focusOrderId) { setOpenOrder(focusOrderId); clearFocus?.(); }
  }, [focusOrderId]);

  const st = e.state;
  const openExcs = st.exceptions.filter(x => x.status !== 'RESOLVED');

  const goExc = (ex: ExceptionRec) => {
    setExcOpen(ex);
  };

  return (
    <div>
      <PageH title="مرکز عملیات (OMS / WMS)" desc="نمای عملیات: برج کنترل، کارایی، انبار، موجودی، استثناها، فروشندگان، مرجوعی و کنترل سناریو.">
        <span className={`chip ${openExcs.length ? 'red' : 'green'} plain`}>
          استثنای باز: {openExcs.length.toLocaleString('fa-IR')}
        </span>
        <span className={`chip ${st.warehouses.some(w => w.capacityState === 'CONGESTED') ? 'orange' : 'green'} plain`}>
          ظرفیت انبارها: {st.warehouses.map(w => w.capacityState === 'CONGESTED' ? 'بحرانی' : w.capacityState === 'BUSY' ? 'شلوغ' : 'عادی').join(' / ')}
        </span>
      </PageH>

      <div className="tabs">
        {([
          ['tower', 'برج کنترل'], ['kpi', 'داشبورد KPI'], ['orders', 'سفارش‌ها'],
          ['wh', 'انبارها'], ['inbound', 'ورود کالا'], ['inv', 'موجودی و دفتر'],
          ['exceptions', `استثناها (${openExcs.length.toLocaleString('fa-IR')})`], ['returns', 'مرجوعی و بازپرداخت'],
          ['sellers', 'فروشندگان'], ['support', 'پشتیبانی'], ['admin', 'کنترل سناریو'],
        ] as const).map(([k, t]) => (
          <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k as any)}>{t}</button>
        ))}
      </div>

      {sub === 'tower' && <ControlTower e={e} onOrder={setOpenOrder} onExc={goExc} />}
      {sub === 'kpi' && <KpiDash e={e} />}
      {sub === 'orders' && <OrdersTable e={e} onOrder={setOpenOrder} />}
      {sub === 'wh' && <WarehouseView e={e} />}
      {sub === 'inbound' && <InboundView e={e} toast={push} />}
      {sub === 'inv' && <InventoryView e={e} toast={push} />}
      {sub === 'exceptions' && <ExceptionCenter e={e} onOpen={setExcOpen} />}
      {sub === 'returns' && <ReturnsView e={e} />}
      {sub === 'sellers' && <SellersView e={e} />}
      {sub === 'support' && <SupportView e={e} onOrder={setOpenOrder} />}
      {sub === 'admin' && <AdminPanel e={e} toast={push} />}

      {openOrder && (() => {
        const o = st.orders.find(x => x.id === openOrder);
        if (!o) return null;
        return <OrderDrawer e={e} order={o} onClose={() => setOpenOrder(null)} />;
      })()}

      {excOpen && <ExcDrawer e={e} ex={excOpen} onClose={() => setExcOpen(null)} toast={push} />}
      {node}
    </div>
  );
}

// ======================================================== CONTROL TOWER =====
function ControlTower({ e, onOrder, onExc }: { e: Engine; onOrder: (id: string) => void; onExc: (x: ExceptionRec) => void }) {
  const st = e.state;
  const live = st.orders.filter(o => !['DELIVERED', 'CANCELLED', 'PAYMENT_FAILED'].includes(o.state));
  const queues = {
    pick: st.tasks.filter(t => t.type === 'PICK' && ['QUEUED', 'ACTIVE'].includes(t.status)).length,
    pack: st.tasks.filter(t => t.type === 'PACK' && ['QUEUED', 'ACTIVE'].includes(t.status)).length,
    dispatch: st.tasks.filter(t => t.type === 'HANDOVER' && ['QUEUED', 'ACTIVE'].includes(t.status)).length,
    seller: st.tasks.filter(t => t.type === 'SELLER_CONFIRM' && ['QUEUED', 'ACTIVE'].includes(t.status)).length,
    ret: st.tasks.filter(t => ['RETURN_PICKUP', 'RETURN_TRANSIT', 'RETURN_RECEIVE', 'RETURN_INSPECT'].includes(t.type) && ['QUEUED', 'ACTIVE'].includes(t.status)).length,
    refund: st.refunds.filter(r => ['REFUND_PENDING', 'REFUND_PROCESSING'].includes(r.status)).length,
  };
  const sellerDelays = st.tasks.filter(t => t.type === 'SELLER_CONFIRM' && t.status === 'QUEUED' && t.endAt - st.simTime > 30 * 60000);
  const alerts = [
    ...st.exceptions.filter(x => x.status !== 'RESOLVED').slice(0, 6).map(x => ({ kind: 'exc' as const, x })),
  ];

  return (
    <div>
      <div className="grid g4 mb">
        <Stat lbl="سفارش‌های زنده" val={live.length.toLocaleString('fa-IR')} sub="در صف یا در حال پردازش" tone="info" />
        <Stat lbl="استثنای باز" val={st.exceptions.filter(x => x.status !== 'RESOLVED').length.toLocaleString('fa-IR')} sub="نیازمند اقدام عملیات" tone="err" />
        <Stat lbl="در صف برداشت" val={queues.pick.toLocaleString('fa-IR')} sub="Pick tasks" tone="warn" />
        <Stat lbl="در صف بسته‌بندی" val={queues.pack.toLocaleString('fa-IR')} sub="Pack/QC tasks" tone="vio" />
      </div>

      <div className="grid g23">
        <div className="card">
          <h3>سفارش‌های زنده <span className="n">({live.length})</span></h3>
          {live.length === 0 ? <Empty icon="🌙" text="سفارش فعالی وجود ندارد." /> : (
            <table className="tbl">
              <thead><tr><th>سفارش</th><th>مشتری</th><th>وضعیت</th><th>مرسوله‌ها</th><th>مدل ارسال</th><th></th></tr></thead>
              <tbody>
                {live.slice(-14).reverse().map(o => (
                  <tr key={o.id} className="clickable" onClick={() => onOrder(o.id)}>
                    <td className="mono">{o.id}</td>
                    <td>{o.customerNameFa}</td>
                    <td><OrderChip state={o.state} /></td>
                    <td>{o.shipments.length.toLocaleString('fa-IR')}</td>
                    <td className="tiny">{o.fulfillmentSummary.map(f => faFulfillment[f]).join('، ') || '—'}</td>
                    <td><button className="btn sm">باز</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>صفوف و هشدارها</h3>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="k"> صف تأیید فروشنده</div><div className="v num">{queues.seller.toLocaleString('fa-IR')}</div>
            <div className="k">صف تحویل حامل (Handover)</div><div className="v num">{queues.dispatch.toLocaleString('fa-IR')}</div>
            <div className="k">صف مرجوعی</div><div className="v num">{queues.ret.toLocaleString('fa-IR')}</div>
            <div className="k">بازپرداخت در جریان</div><div className="v num">{queues.refund.toLocaleString('fa-IR')}</div>
            <div className="k">تأخیر فروشنده‌ها (&gt;۳۰ دقیقه)</div><div className="v num">{sellerDelays.length.toLocaleString('fa-IR')}</div>
            <div className="k">خطاهای برداشت</div><div className="v num err-c">{st.pickStats.errors.toLocaleString('fa-IR')}</div>
            <div className="k">دقت موجودی</div><div className="v num acc-c">{faPercent(e.kpi().inventoryAccuracy)}</div>
          </div>
          <div className="divider" />
          <h3>هشدارهای عملیاتی</h3>
          {alerts.length === 0 ? <div className="tiny">هشدار فعالی نیست.</div> : alerts.map(a => (
            <div className={`exc ${a.x.severity} ${a.x.status === 'RESOLVED' ? 'resolved' : ''}`} key={a.x.id}
              style={{ cursor: 'pointer' }} onClick={() => onExc(a.x)}>
              <div className="row tight">
                <SevChip sev={a.x.severity} />
                <b style={{ fontSize: 12.5 }}>{faExceptionType[a.x.type]}</b>
                <span className="tiny">{faExceptionStatus[a.x.status]}</span>
                <div className="spacer" />
                <span className="tiny mono">{a.x.id}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{a.x.messageFa}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid g3 mt">
        <div className="card">
          <h3>بار کاری انبارها</h3>
          {st.warehouses.filter(w => w.id !== 'WH-SEL-01').map(w => {
            const totalCap = w.capacity.picking + w.capacity.receiving + w.capacity.dispatch;
            const used = w.used.picking + w.used.receiving + w.used.dispatch;
            const pct = Math.min(100, Math.round((used / Math.max(1, totalCap)) * 100));
            return (
              <div key={w.id} className="mb">
                <div className="row tight"><b style={{ fontSize: 12.5 }}>{w.nameFa}</b>
                  <span className={`chip ${w.capacityState === 'CONGESTED' ? 'red' : w.capacityState === 'BUSY' ? 'yellow' : 'green'} plain`}>
                    {w.capacityState === 'CONGESTED' ? 'ازدحام' : w.capacityState === 'BUSY' ? 'شلوغ' : 'عادی'}
                  </span>
                </div>
                <div className="bar mt"><i style={{ width: `${pct}%` }} /></div>
                <div className="tiny">برداشت {w.used.picking.toLocaleString('fa-IR')} | دریافت {w.used.receiving.toLocaleString('fa-IR')} | ارسال {w.used.dispatch.toLocaleString('fa-IR')}</div>
              </div>
            );
          })}
        </div>
        <div className="card">
          <h3>صف تجمیع/بسته‌بندی/تفکیک</h3>
          {(['CONSOLIDATION', 'QC', 'PACK', 'SORTATION', 'HANDOVER'] as const).map(ty => {
            const n = st.tasks.filter(t => t.type === ty && ['QUEUED', 'ACTIVE'].includes(t.status)).length;
            const done = st.tasks.filter(t => t.type === ty && t.status === 'DONE').length;
            return (
              <div className="row tight mb" key={ty} style={{ marginBottom: 7 }}>
                <span style={{ fontSize: 12.5, minWidth: 140 }}>{faTaskType[ty]}</span>
                <span className={`chip ${n ? 'yellow' : 'green'} plain`}>فعال: {n.toLocaleString('fa-IR')}</span>
                <span className="tiny">انجام‌شده: {done.toLocaleString('fa-IR')}</span>
              </div>
            );
          })}
        </div>
        <div className="card">
          <h3>مرجوعی و بازپرداخت</h3>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="k">درخواست مرجوعی</div><div className="v num">{st.returnStats.requested.toLocaleString('fa-IR')}</div>
            <div className="k">تأییدشده</div><div className="v num ok-c">{st.returnStats.approved.toLocaleString('fa-IR')}</div>
            <div className="k">ردشده</div><div className="v num err-c">{st.returnStats.rejected.toLocaleString('fa-IR')}</div>
            <div className="k">بازپرداخت موفق</div><div className="v num ok-c">{st.refunds.filter(r => r.status === 'REFUNDED').length.toLocaleString('fa-IR')}</div>
            <div className="k">بازپرداخت ناموفق</div><div className="v num err-c">{st.refunds.filter(r => r.status === 'REFUND_FAILED').length.toLocaleString('fa-IR')}</div>
            <div className="k">کوپن جبرانی صادرشده</div><div className="v num">{st.coupons.length.toLocaleString('fa-IR')}</div>
          </div>
          <div className="divider" />
          <h3>مانیفست‌های ارسال</h3>
          {st.manifests.length === 0 ? <div className="tiny">مانیفستی ساخته نشده.</div> :
            st.manifests.slice(-4).reverse().map(m => (
              <div className="row tight" key={m.id} style={{ fontSize: 12 }}>
                <span className="mono">{m.id}</span>
                <span className="tag">{faManifestStatus[m.status]}</span>
                <span className="tiny">{m.packageIds.length.toLocaleString('fa-IR')} بسته ← {m.destinationFa}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================ KPI =======
function KpiDash({ e }: { e: Engine }) {
  const k = e.kpi();
  const st = e.state;
  return (
    <div>
      <div className="grid g4 mb">
        <Stat lbl="سفارش‌های تکمیل‌شده" val={k.ordersProcessed.toLocaleString('fa-IR')} sub={`کل: ${k.totalOrders.toLocaleString('fa-IR')} — در جریان: ${k.ordersPending.toLocaleString('fa-IR')}`} tone="ok" />
        <Stat lbl="نرخ برداشت (Pick Rate)" val={k.pickRate.toLocaleString('fa-IR')} sub="کار در ساعت شبیه‌سازی" tone="info" />
        <Stat lbl="نرخ بسته‌بندی (Pack Rate)" val={k.packRate.toLocaleString('fa-IR')} sub="کار در ساعت شبیه‌سازی" tone="vio" />
        <Stat lbl="ارسال به‌موقع" val={faPercent(k.onTimeDispatch)} sub="On-time dispatch" tone="ok" />
      </div>
      <div className="grid g4 mb">
        <Stat lbl="تحویل به‌موقع" val={faPercent(k.onTimeDelivery)} sub={`تحویل‌شده: ${k.deliveredCount.toLocaleString('fa-IR')}`} tone="ok" />
        <Stat lbl="نرخ تأیید فروشنده" val={faPercent(k.sellerConfirmRate)} sub={`پرسش: ${st.sellerStats.asked.toLocaleString('fa-IR')}`} tone="info" />
        <Stat lbl="نرخ لغو" val={faPercent(k.cancellationRate)} sub={`لغو: ${st.orders.filter(o => o.state === 'CANCELLED').length.toLocaleString('fa-IR')}`} tone="warn" />
        <Stat lbl="نرخ مرجوعی" val={faPercent(k.returnRate)} sub={`درخواست: ${st.returnStats.requested.toLocaleString('fa-IR')}`} tone="vio" />
      </div>
      <div className="grid g4 mb">
        <Stat lbl="دقت موجودی" val={faPercent(k.inventoryAccuracy)} sub={`اصلاحات: ${st.inventoryAdjustments.toLocaleString('fa-IR')} از ${st.inventoryCounts.toLocaleString('fa-IR')} شمارش`} tone={k.inventoryAccuracy > 95 ? 'ok' : 'err'} />
        <Stat lbl="خطاهای برداشت" val={k.pickErrors.toLocaleString('fa-IR')} sub="Pick errors" tone={k.pickErrors ? 'err' : 'ok'} />
        <Stat lbl="خطاهای بسته‌بندی" val={k.packErrors.toLocaleString('fa-IR')} sub="Pack errors" tone="ok" />
        <Stat lbl="میانگین زمان پردازش" val={`${k.avgProcessMinutes.toLocaleString('fa-IR')} دقیقه`} sub="از ثبت تا تحویل" tone="info" />
      </div>
      <div className="card mb">
        <h3>توزیع وضعیت سفارش‌ها (لحظه‌ای)</h3>
        {st.orders.length === 0
          ? <Empty icon="📭" text="هنوز سفارشی ثبت نشده است." />
          : (() => {
            const counts = new Map<string, number>();
            for (const o of st.orders) counts.set(o.state, (counts.get(o.state) ?? 0) + 1);
            const entries = [...counts.entries()].sort((a, b) => ((ORDER_RANK as any)[a[0]] ?? 0) - ((ORDER_RANK as any)[b[0]] ?? 0));
            const palette = ['#3b82f6', '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e', '#64748b', '#ec4899', '#14b8a6', '#eab308', '#84cc16', '#f97316', '#0ea5e9', '#a855f7', '#22c55e', '#ef4444', '#6366f1', '#e11d48', '#7c3aed', '#0891b2', '#65a30d', '#d97706', '#dc2626', '#2563eb', '#9333ea', '#16a34a'];
            const total = st.orders.length;
            return (
              <>
                <div className="dist-bar">
                  {entries.map(([s, n], i) => (
                    <i key={s} title={`${faOrderState[s as keyof typeof faOrderState] ?? s} — ${n.toLocaleString('fa-IR')} سفارش`}
                      style={{ width: `${(n / total) * 100}%`, background: palette[i % palette.length] }} />
                  ))}
                </div>
                <div className="dist-legend">
                  {entries.map(([s, n], i) => (
                    <span key={s} className="tiny"><span className="sw" style={{ background: palette[i % palette.length] }} />{faOrderState[s as keyof typeof faOrderState] ?? s} — {n.toLocaleString('fa-IR')}</span>
                  ))}
                </div>
              </>
            );
          })()}
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>بهره‌وری انبارها (Utilization)</h3>
          <Stat lbl="میانگین بهره‌وری" val={faPercent(k.utilization)} sub="از ظرفیت همزمان وظایف" tone="info" />
          <div className="mt">
            {st.warehouses.map(w => {
              const cap2 = w.capacity.picking + w.capacity.receiving + w.capacity.dispatch + w.capacity.packing;
              const used = w.used.picking + w.used.receiving + w.used.dispatch + w.used.packing;
              const pct = Math.min(100, Math.round(used / Math.max(1, cap2) * 100));
              return (
                <div key={w.id} className="mb">
                  <div className="row tight"><span style={{ fontSize: 12.5 }}>{w.nameFa}</span><div className="spacer" /><span className="tiny">{faPercent(pct)}</span></div>
                  <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <h3>یادداشت شفافیت</h3>
          <p className="muted">
            تمام شاخص‌های بالا معیارهای شبیه‌سازی‌شده‌اند و از داده‌های همین نشست محاسبه می‌شوند. هیچ‌یک
            آمار واقعی دیجی‌کالا، اسنپ‌شاپ یا هر بازارگاه دیگری نیست. نرخ‌ها بر اساس رویه‌های عمومی و
            استانداردهای صنعت OMS/WMS مدل‌سازی شده‌اند <span className="badge-src ind">استاندارد صنعت</span>{' '}
            <span className="badge-src sim">شبیه‌سازی</span>
          </p>
          <div className="divider" />
          <h3>شمارنده‌های خام</h3>
          <KV rows={[
            ['رویدادهای ثبت‌شده', st.events.length.toLocaleString('fa-IR')],
            ['تراکنش‌های دفتر موجودی', st.ledger.length.toLocaleString('fa-IR')],
            ['وظایف ایجادشده', st.tasks.length.toLocaleString('fa-IR')],
            ['بسته‌ها', st.packages.length.toLocaleString('fa-IR')],
            ['توت‌ها', st.totes.length.toLocaleString('fa-IR')],
            ['واحدهای سریالی', st.serials.length.toLocaleString('fa-IR')],
          ]} />
        </div>
      </div>
    </div>
  );
}

// ============================================================== ORDERS ======
function OrdersTable({ e, onOrder }: { e: Engine; onOrder: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState('ALL');
  const st = e.state;
  const rows = st.orders.filter(o => {
    if (flt !== 'ALL' && o.state !== flt) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return o.id.toLowerCase().includes(s) || o.customerNameFa.includes(q) || o.phone.includes(q) ||
      o.items.some(i => i.sku.toLowerCase().includes(s));
  }).slice().reverse();
  return (
    <div className="card">
      <div className="row mb">
        <input className="inp" placeholder="جستجو: شماره سفارش، مشتری، SKU..." value={q} onChange={ev => setQ(ev.target.value)} style={{ maxWidth: 300 }} />
        <select className="inp" value={flt} onChange={ev => setFlt(ev.target.value)} style={{ maxWidth: 240 }}>
          <option value="ALL">همه وضعیت‌ها</option>
          {Object.keys(faOrderState).map(k => <option key={k} value={k}>{faOrderState[k as keyof typeof faOrderState]}</option>)}
        </select>
        <div className="spacer" />
        <span className="tiny">{rows.length.toLocaleString('fa-IR')} سفارش</span>
      </div>
      {rows.length === 0 ? <Empty icon="🔍" text="سفارشی یافت نشد." /> : (
        <table className="tbl">
          <thead><tr><th>سفارش</th><th>زمان</th><th>مشتری</th><th>مبلغ</th><th>وضعیت</th><th>مرسوله</th><th>انبارها</th></tr></thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.id} className="clickable" onClick={() => onOrder(o.id)}>
                <td className="mono">{o.id}</td>
                <td className="num tiny">{faDateTime(o.createdAt)}</td>
                <td>{o.customerNameFa}<div className="tiny">{o.city}</div></td>
                <td className="num">{faMoney(o.totalAmount)}</td>
                <td><OrderChip state={o.state} /></td>
                <td>{o.shipments.length.toLocaleString('fa-IR')}</td>
                <td className="tiny">{[...new Set(o.shipments.map(s => s.warehouseId))].join('، ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================== ORDER DRAWER (ops detail) ===
function OrderDrawer({ e, order, onClose }: { e: Engine; order: Order; onClose: () => void }) {
  const st = e.state;
  const tasks = st.tasks.filter(t => t.orderId === order.id);
  const events = st.events.filter(ev => ev.orderId === order.id);
  const ledger = st.ledger.filter(l => l.orderId === order.id);
  const refunds = st.refunds.filter(r => r.orderId === order.id);
  const returns = st.returns.filter(r => r.orderId === order.id);
  const pkgs = st.packages.filter(p => p.orderId === order.id);
  const totes = st.totes.filter(t => t.orderIds.includes(order.id));
  const [tab, setTab] = useState<'back' | 'tasks' | 'events' | 'inv' | 'trace'>('back');
  const pay = st.payments.find(p => p.id === order.paymentId);
  const resvs = st.reservations.filter(r => r.orderId === order.id);

  return (
    <Drawer wide title={<span>جزئیات عملیاتی <span className="mono">{order.id}</span></span>} onClose={onClose}>
      <div className="row mb">
        <OrderChip state={order.state} />
        <span className="tag">پرداخت: {pay ? faOrderState[pay.status === 'SUCCESS' ? 'PAYMENT_SUCCESS' : pay.status === 'PENDING' ? 'PAYMENT_PENDING' : 'PAYMENT_FAILED'] : '—'}</span>
        <span className="tag">{faMoney(order.totalAmount)}</span>
        <div className="spacer" />
      </div>

      <div className="tabs">
        {([['back', 'پشت‌صحنه'], ['tasks', 'وظایف'], ['events', 'رویدادها'], ['inv', 'دفتر موجودی'], ['trace', 'ردیابی']] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>{t}</button>
        ))}
      </div>

      {tab === 'back' && (
        <div className="grid g2">
          <div className="card tight">
            <h3>پشت‌صحنه هر وضعیت مشتری</h3>
            <div className="tl">
              {e.backstage(order).map((s, i) => (
                <div className="tl-item" key={i}>
                  <div className={`tl-dot ${s.status === 'DONE' ? 'done' : s.status === 'CURRENT' ? 'cur' : 'pend'}`} />
                  <div className="tl-body">
                    <div className="t">{s.labelFa}</div>
                    <div className="d">{s.detailFa}</div>
                    <div className="m">{s.at ? faDateTime(s.at) : '—'} {s.actor !== '—' && `— ${s.actor}`}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card tight">
            <h3>مرسوله‌ها</h3>
            {order.shipments.map(sh => (
              <div className="pad mb" key={sh.id} style={{ marginBottom: 8 }}>
                <div className="row tight">
                  <span className="mono">{sh.id}</span>
                  <ShipmentChip state={sh.state} />
                </div>
                <KV rows={[
                  ['انبار', e.warehouse(sh.warehouseId ?? '')?.nameFa ?? '—'],
                  ['فروشنده', e.seller(sh.sellerId)?.nameFa ?? '—'],
                  ['مدل', faFulfillment[sh.fulfillment]],
                  ['اقلام', sh.itemIdx.map(i => order.items[i].sku).join('، ')],
                  ['حامل / رهگیری', sh.trackingId ? `${st.carriers.find(c => c.id === sh.carrierId)?.nameFa ?? 'حامل شبیه‌سازی‌شده'} — ${sh.trackingId}` : '—'],
                  ['لاین تفکیک', sh.lane ?? '—'],
                ]} />
                <div className="tiny mt">{sh.events.map((ev, i) => <div key={i}>● {faTime(ev.at)} {ev.detailFa ?? ev.type}</div>)}</div>
              </div>
            ))}
            {pkgs.length > 0 && <><h3>بسته‌ها</h3>
              {pkgs.map(p => (
                <div className="row tight" key={p.id} style={{ fontSize: 12 }}>
                  <span className="mono">{p.id}</span>
                  <span className="tag">{faPackageType[p.packageType] ?? p.packageType}</span>
                  <span className="tag">{p.weightKg.toLocaleString('fa-IR')} کیلوگرم</span>
                  <span className="chip blue plain">{faPackageState[p.state]}</span>
                  <span className="tiny">ایستگاه {p.stationId}</span>
                </div>
              ))}</>}
            {totes.length > 0 && <><h3 className="mt">توت‌ها (Totes)</h3>
              {totes.map(t => (
                <div className="row tight" key={t.id} style={{ fontSize: 12 }}>
                  <span className="mono">{t.id}</span>
                  <span className="chip violet plain">{faToteState[t.state]}</span>
                  <span className="tiny">{t.items.length} قلم</span>
                </div>
              ))}</>}
            {refunds.map(r => (
              <div className="pad mt" key={r.id}>
                <b>{r.id}</b> — {faMoney(r.amount)} <span className="chip yellow plain">{faRefundStatus[r.status]}</span>
                <div className="tiny">{r.reason}</div>
              </div>
            ))}
            {returns.map(r => (
              <div className="pad mt" key={r.id}>
                <b className="mono">{r.rma}</b> — {faReturnState[r.state]} {r.disposition && <span className="chip violet plain">{faDisposition[r.disposition]}</span>}
                <div className="tiny">{r.eligibilityReasonFa}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="card tight">
          <table className="tbl">
            <thead><tr><th>وظیفه</th><th>نوع</th><th>وضعیت</th><th>اپراتور</th><th>شروع</th><th>پایان</th><th>خطا</th></tr></thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id}>
                  <td className="mono">{t.id}</td>
                  <td>{faTaskType[t.type]}</td>
                  <td><span className={`chip ${t.status === 'DONE' ? 'green' : t.status === 'FAILED' ? 'red' : t.status === 'CANCELLED' ? 'gray' : 'yellow'} plain`}>{faTaskStatus[t.status]}</span></td>
                  <td className="mono tiny">{t.workerId ?? 'SYSTEM'}</td>
                  <td className="tiny num">{faTime(t.startAt)}</td>
                  <td className="tiny num">{faTime(t.endAt)}</td>
                  <td className="tiny err-c">{t.errorDetailFa ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length === 0 && <Empty icon="⏳" text="وظیفه‌ای ثبت نشده است." />}
        </div>
      )}

      {tab === 'events' && (
        <div className="card tight" style={{ maxHeight: 480, overflowY: 'auto' }}>
          {events.slice().reverse().map(ev => (
            <div className="ev" key={ev.id}>
              <span className="eid">{ev.id}</span>
              <span className="et">{ev.type}</span>
              <span className="ed">{ev.detailFa}</span>
              <span className="ea">{faTime(ev.at)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'inv' && (
        <div className="card tight" style={{ maxHeight: 480, overflowY: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>شناسه</th><th>SKU</th><th>اکشن</th><th>قبل</th><th>بعد</th><th>دلیل</th><th>بازیگر</th></tr></thead>
            <tbody>
              {ledger.slice().reverse().map(l => (
                <tr key={l.id}>
                  <td className="mono tiny">{l.id}</td>
                  <td className="mono">{l.sku}</td>
                  <td><span className="tag">{l.action}</span></td>
                  <td className="tiny">{Object.entries(l.before).map(([k, v]) => `${faInvState[k as keyof typeof faInvState]}=${(v as number).toLocaleString('fa-IR')}`).join('، ')}</td>
                  <td className="tiny">{Object.entries(l.after).map(([k, v]) => `${faInvState[k as keyof typeof faInvState]}=${(v as number).toLocaleString('fa-IR')}`).join('، ')}</td>
                  <td className="tiny">{l.reason}</td>
                  <td className="mono tiny">{l.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ledger.length === 0 && <Empty icon="📒" text="تراکنشی برای این سفارش نیست." />}
          {resvs.length > 0 && <div className="tiny mt">رزروها: {resvs.map(r => `${r.id} (${r.released ? 'آزادشده' : 'فعال'} تا ${faTime(r.expiresAt)})`).join('، ')}</div>}
        </div>
      )}

      {tab === 'trace' && <TraceChain e={e} order={order} />}
    </Drawer>
  );
}

// ============================================================ TRACE =========
function TraceChain({ e, order }: { e: Engine; order: Order }) {
  const st = e.state;
  const steps: { icon: string; t: string; d: React.ReactNode }[] = [];
  steps.push({ icon: '📦', t: `سفارش ${order.id}`, d: <OrderChip state={order.state} /> });
  const pay = st.payments.find(p => p.id === order.paymentId);
  if (pay) steps.push({ icon: '💳', t: `پرداخت ${pay.id}`, d: <span className="mono tiny">{pay.gatewayRef}</span> });
  for (const it of order.items) {
    steps.push({ icon: '🏷️', t: `${it.sku} ×${it.qty.toLocaleString('fa-IR')}`, d: <span className="tiny mono">بارکد {it.barcode}</span> });
    for (const sn of it.serials.slice(0, 3)) {
      const unit = st.serials.find(s => s.serial === sn);
      steps.push({ icon: '🔑', t: `سریال ${sn}`, d: <span className="tiny">{unit ? `${faInvState[unit.state]} — ${e.warehouse(unit.warehouseId)?.nameFa} / ${unit.locationId || '—'}` : '—'}</span> });
    }
  }
  for (const res of st.reservations.filter(r => r.orderId === order.id)) {
    steps.push({ icon: '🔒', t: `رزرو ${res.id}`, d: <span className="tiny">{res.qty} عدد {res.sku} — {res.released ? 'آزادشده' : `فعال تا ${faTime(res.expiresAt)}`}</span> });
  }
  for (const t of st.tasks.filter(t => t.orderId === order.id)) {
    steps.push({ icon: '⚙️', t: `${faTaskType[t.type]} (${t.id})`, d: <span className="tiny">{faTaskStatus[t.status]}{t.workerId && ` — ${t.workerId}`}</span> });
  }
  for (const tp of st.totes.filter(t => t.orderIds.includes(order.id))) {
    steps.push({ icon: '🧺', t: `توت ${tp.id}`, d: <span className="tiny">{faToteState[tp.state]} — {tp.items.map(i => i.sku).join('، ')}</span> });
  }
  for (const p of st.packages.filter(p => p.orderId === order.id)) {
    steps.push({ icon: '🏷️', t: `بسته ${p.id}`, d: <span className="tiny">{faPackageState[p.state]} — برچسب {p.labelCode}</span> });
  }
  for (const m of st.manifests.filter(m => m.packageIds.some(id => st.packages.find(p => p.id === id && p.orderId === order.id)))) {
    steps.push({ icon: '🚚', t: `مانیفست ${m.id}`, d: <span className="tiny">{faManifestStatus[m.status]} — {m.destinationFa}</span> });
  }
  for (const sh of order.shipments.filter(s => s.trackingId)) {
    steps.push({ icon: '🛰️', t: `رهگیری ${sh.trackingId}`, d: <span className="tiny">حامل: {st.carriers.find(c => c.id === 'CAR-01')?.nameFa}</span> });
    for (const ev of sh.events) steps.push({ icon: '📍', t: ev.type, d: <span className="tiny">{ev.detailFa}</span> });
  }
  for (const r of st.returns.filter(r => r.orderId === order.id)) {
    steps.push({ icon: '↩️', t: `مرجوعی ${r.rma}`, d: <span className="tiny">{faReturnState[r.state]}{r.disposition && ` — ${faDisposition[r.disposition]}`}</span> });
  }
  for (const r of st.refunds.filter(r => r.orderId === order.id)) {
    steps.push({ icon: '💰', t: `بازپرداخت ${r.id}`, d: <span className="tiny">{faMoney(r.amount)} — {faRefundStatus[r.status]}</span> });
  }
  return (
    <div className="card tight">
      <h3>زنجیره ردیابی کامل <span className="n">سفارش ← SKU ← سریال ← محل ← وظیفه ← توت ← بسته ← مانیفست ← حامل ← بازگشت ← بازپرداخت</span></h3>
      {steps.map((s, i) => (
        <div className="trace-step" key={i}>
          <div className="tn">{s.icon}</div>
          <div className="tb">
            <div className="tt">{s.t}</div>
            <div className="td">{s.d}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ========================================================== WAREHOUSE =======
function WarehouseView({ e }: { e: Engine }) {
  const st = e.state;
  const [wh, setWh] = useState('WH-TEH-01');
  const [zone, setZone] = useState<string | null>(null);
  const w = st.warehouses.find(x => x.id === wh)!;
  const locs = Object.values(st.locations).filter(l => l.warehouseId === wh && l.kind === 'STORAGE');
  const zones = w.zones;
  const emps = st.employees.filter(em => em.warehouseId === wh);
  const activeTasks = st.tasks.filter(t => t.warehouseId === wh && ['QUEUED', 'ACTIVE'].includes(t.status));
  const zoneLocs = locs.filter(l => !zone || l.zone === zone);

  // inventory truth for this warehouse: state counts vs physical bin contents
  const allSkus = st.products.flatMap(p => p.variants.map(v => v.sku));
  const whState = (state: string) => allSkus.reduce((sum, sku) => sum + (((e.state.inv[sku]?.[wh] as any)?.[state]) ?? 0), 0);
  const sellable = whState('AVAILABLE');
  const resN = whState('RESERVED');
  const allocN = whState('ALLOCATED');
  const pickN = whState('PICKING');
  const recvN = whState('RECEIVED');
  const binTotal = locs.reduce((sum, l) => sum + Object.values(l.contents).reduce((a, b) => a + b, 0), 0);
  const inWhUnits = allSkus.reduce((sum, sku) => sum + Object.values(e.state.inv[sku]?.[wh] ?? {}).reduce((a: number, b) => a + b, 0), 0);
  const binEq = binTotal === sellable + resN + allocN + pickN;

  return (
    <div>
      <div className="wh-tabs">
        {st.warehouses.map(x => (
          <button key={x.id} className={`btn ${wh === x.id ? 'primary' : ''}`} onClick={() => { setWh(x.id); setZone(null); }}>
            {x.nameFa} <span className="mono tiny">{x.id}</span>
          </button>
        ))}
      </div>

      <div className="grid g4 mb">
        <Stat lbl="موجودی قابل فروش (AVAILABLE)" val={sellable.toLocaleString('fa-IR')} sub={`SKU فعال: ${allSkus.filter(sku => ((e.state.inv[sku]?.[wh] as any)?.AVAILABLE ?? 0) > 0).length.toLocaleString('fa-IR')}`} tone="ok" />
        <Stat lbl="در قفسه‌ها (واحدهای در محل)" val={binTotal.toLocaleString('fa-IR')} sub="A + R + AL + PICKING — برابر سنجی زیر" tone="info" />
        <Stat lbl="رزرو + تخصیص" val={(resN + allocN).toLocaleString('fa-IR')} sub={`رزرو ${resN.toLocaleString('fa-IR')} | تخصیص ${allocN.toLocaleString('fa-IR')} | در حال برداشت ${pickN.toLocaleString('fa-IR')}`} tone="warn" />
        <Stat lbl="کل واحدهای این مرکز" val={inWhUnits.toLocaleString('fa-IR')} sub={`دریافت‌شده (RECEIVED): ${recvN.toLocaleString('fa-IR')}`} tone="vio" />
      </div>

      <div className="grid g4 mb">
        <Stat lbl="مناطق (Zones)" val={w.zones.length.toLocaleString('fa-IR')} sub={w.zones.map(z => z.code).join('، ')} tone="info" />
        <Stat lbl="محل‌های انبارش" val={locs.length.toLocaleString('fa-IR')} sub={`بارگذاری: ${locs.filter(l => Object.keys(l.contents).length).length.toLocaleString('fa-IR')}`} tone="vio" />
        <Stat lbl="وظایف فعال" val={activeTasks.length.toLocaleString('fa-IR')} sub={`کارکنان: ${emps.length.toLocaleString('fa-IR')}`} tone="warn" />
        <Stat lbl="ظرفیت" val={w.capacityState === 'CONGESTED' ? 'ازدحام' : w.capacityState === 'BUSY' ? 'شلوغ' : 'عادی'}
          sub={`برداشت ${w.used.picking.toLocaleString('fa-IR')}/${w.capacity.picking.toLocaleString('fa-IR')} | بسته‌بندی ${w.used.packing.toLocaleString('fa-IR')}/${w.capacity.packing.toLocaleString('fa-IR')}`} tone={w.capacityState === 'CONGESTED' ? 'err' : 'ok'} />
      </div>

      <div className="grid g23">
        <div className="card">
          <h3>نقشه محل‌ها (Warehouse Map) <span className="n">WH / Zone / Aisle / Rack / Shelf / Bin</span></h3>
          <div className="row tight mb">
            <button className={`btn sm ${!zone ? 'primary' : ''}`} onClick={() => setZone(null)}>همه</button>
            {zones.map(z => (
              <button key={z.id} className={`btn sm ${zone === z.code ? 'primary' : ''}`} onClick={() => setZone(z.code)}>
                {z.code} — {z.nameFa}
              </button>
            ))}
          </div>
          <div className="zone-map">
            {zoneLocs.slice(0, 60).map(l => {
              const qty = Object.values(l.contents).reduce((a, b) => a + b, 0);
              const skus = Object.keys(l.contents);
              return (
                <div className="zone" key={l.id} title={`${l.id} — ${qty.toLocaleString('fa-IR')} واحد`}>
                  <div className="zt">
                    <span className="mono">{l.zone} / {l.aisle} / {l.rack}</span>
                    <div className="spacer" />
                    <span className={`chip ${qty === 0 ? 'gray' : qty > 30 ? 'green' : 'cyan'} plain`}>{qty.toLocaleString('fa-IR')}</span>
                  </div>
                  <div className="zm mono">{l.shelf} / {l.bin}</div>
                  <div className="tiny">{skus.length ? skus.join('، ') : 'خالی'}</div>
                </div>
              );
            })}
          </div>
          <div className="mt">
            {binEq
              ? <span className="chip green plain">✓ قفسه‌ها ({binTotal.toLocaleString('fa-IR')}) = واحدهای در انبار — A+R+AL+P ({(sellable + resN + allocN + pickN).toLocaleString('fa-IR')})</span>
              : <span className="chip red plain">✗ مغایرت: قفسه‌ها {binTotal.toLocaleString('fa-IR')} ≠ اعداد موجودی {(sellable + resN + allocN + pickN).toLocaleString('fa-IR')}</span>}
          </div>
          {zoneLocs.length > 60 && <div className="tiny mt">نمایش ۶۰ محل از {zoneLocs.length.toLocaleString('fa-IR')} محل...</div>}

          <h3 className="mt">کارکنان (Workforce)</h3>
          <table className="tbl">
            <thead><tr><th>شناسه</th><th>نام</th><th>نقش</th><th>وظایف انجام‌شده</th><th>خطا</th><th>تا چه زمانی مشغول</th></tr></thead>
            <tbody>
              {emps.map(em => (
                <tr key={em.id}>
                  <td className="mono">{em.id}</td>
                  <td>{em.nameFa}</td>
                  <td>{faRole[em.role]}</td>
                  <td className="num">{em.tasksDone.toLocaleString('fa-IR')}</td>
                  <td className={`num ${em.errors ? 'err-c' : ''}`}>{em.errors.toLocaleString('fa-IR')}</td>
                  <td className="tiny num">{em.busyUntil > st.simTime ? faTime(em.busyUntil) : 'آزاد'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>وظایف فعال این مرکز</h3>
          {activeTasks.length === 0 ? <Empty icon="✅" text="وظیفه فعالی نیست." /> : activeTasks.slice(-15).reverse().map(t => (
            <div className="pad mb" key={t.id} style={{ marginBottom: 7 }}>
              <div className="row tight">
                <span className="mono">{t.id}</span>
                <span className={`chip ${t.status === 'ACTIVE' ? 'green' : 'yellow'} plain`}>{faTaskStatus[t.status]}</span>
              </div>
              <div className="tiny">{faTaskType[t.type]} {t.orderId && <>— <span className="mono">{t.orderId}</span></>}</div>
              {t.strategy && <div className="tiny">استراتژی: {faPickStrategy[t.strategy]}</div>}
            </div>
          ))}
          <div className="divider" />
          <h3>خلاصه توت‌ها</h3>
          <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
            {Object.entries(st.totes.reduce<Record<string, number>>((acc, t) => { acc[t.state] = (acc[t.state] ?? 0) + 1; return acc; }, {})).map(([k, v]) => (
              <React.Fragment key={k}>
                <div className="k">{faToteState[k]}</div><div className="v num">{v.toLocaleString('fa-IR')}</div>
              </React.Fragment>
            ))}
            {st.totes.length === 0 && <div className="k">توتی ساخته نشده</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ INBOUND =======
function InboundView({ e, toast }: { e: Engine; toast: (t: string, tone?: string) => void }) {
  const st = e.state;
  const [sku, setSku] = useState(st.products[0].variants[0].sku);
  const [qty, setQty] = useState(20);
  const [whId, setWhId] = useState('WH-TEH-01');
  const [exc, setExc] = useState<InboundExceptionKind>('NONE');

  const create = () => {
    const inb = e.createInbound({
      supplierFa: 'تأمین‌کننده شبیه‌سازی‌شده', warehouseId: whId, sku, qty, exceptionKind: exc,
    });
    toast(`محموله ورودی ${inb.id} ثبت شد.`, 'good');
  };

  return (
    <div>
      <div className="card mb">
        <h3>ثبت رسید ورودی جدید (Inbound Shipment)</h3>
        <div className="grid g4">
          <div className="fld"><label>SKU کالا</label>
            <select className="inp" value={sku} onChange={ev => setSku(ev.target.value)}>
              {st.products.flatMap(p => p.variants.map(v => <option key={v.sku} value={v.sku}>{v.sku} — {p.nameFa}</option>))}
            </select>
          </div>
          <div className="fld"><label>تعداد</label>
            <input className="inp" type="number" min={1} max={100} value={qty} onChange={ev => setQty(Number(ev.target.value) || 1)} />
          </div>
          <div className="fld"><label>انبار مقصد</label>
            <select className="inp" value={whId} onChange={ev => setWhId(ev.target.value)}>
              {st.warehouses.map(w => <option key={w.id} value={w.id}>{w.nameFa}</option>)}
            </select>
          </div>
          <div className="fld"><label>سناریوی کیفیت (exception)</label>
            <select className="inp" value={exc} onChange={ev => setExc(ev.target.value as any)}>
              {Object.entries(faInboundException).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <button className="btn primary" onClick={create}>ثبت محموله ورودی</button>
        <p className="tiny mt">
          فرایند: ثبت → انتقال به گیت → دریافت (تعداد، SKU، بارکد، بازرسی، سریال) → در صورت خطای کنترل‌شده،
          کالا در وضعیت «دریافت‌شده» می‌ماند و تا تأیید عملیات، موجودی قابل فروش (AVAILABLE) نمی‌شود → چیدمان (Put-away).
        </p>
      </div>

      <div className="card">
        <h3>محموله‌های ورودی</h3>
        {st.inbound.length === 0 ? <Empty icon="🛬" text="محموله‌ای ثبت نشده است." /> : (
          <table className="tbl">
            <thead><tr><th>شناسه</th><th>تأمین‌کننده</th><th>انبار</th><th>SKU / تعداد</th><th>وضعیت</th><th>خطا</th><th>اقدام</th></tr></thead>
            <tbody>
              {st.inbound.slice().reverse().map(inb => (
                <tr key={inb.id}>
                  <td className="mono">{inb.id}</td>
                  <td>{inb.supplierFa}</td>
                  <td className="tiny mono">{inb.warehouseId}</td>
                  <td className="mono tiny">{inb.lines[0].sku} ×{inb.lines[0].receivedQty ?? inb.lines[0].expectedQty}</td>
                  <td><span className={`chip ${inb.state === 'PUTAWAY_DONE' ? 'green' : inb.state === 'EXCEPTION' ? 'red' : 'yellow'} plain`}>{faInboundState[inb.state]}</span></td>
                  <td className="tiny err-c">{inb.exceptionDetailFa ?? '—'}</td>
                  <td>
                    {inb.state === 'EXCEPTION' && (
                      <button className="btn sm primary" onClick={() => { e.resolveInbound(inb.id); toast('بررسی ورودی اعمال شد.', 'good'); }}>
                        بررسی و تأیید
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ========================================================== INVENTORY =======
function InventoryView({ e, toast }: { e: Engine; toast: (t: string, tone?: string) => void }) {
  const st = e.state;
  const [tab, setTab] = useState<'ledger' | 'units' | 'count'>('ledger');
  const [ccSku, setCcSku] = useState(st.products[0].variants[0].sku);
  const [ccWh, setCcWh] = useState('WH-TEH-01');
  const [ccDelta, setCcDelta] = useState<number>(0);

  const stateTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const whs of Object.values(st.inv))
      for (const counts of Object.values(whs))
        for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + v;
    return totals;
  }, [st.inv, st.version]);

  return (
    <div>
      <div className="tabs">
        {([['ledger', 'دفتر تراکنش موجودی (Ledger)'], ['units', 'وضعیت واحدها و سریال‌ها'], ['count', 'شمارش چرخه‌ای و اصلاح']] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>{t}</button>
        ))}
      </div>

      {tab === 'ledger' && (
        <div className="card" style={{ maxHeight: 620, overflowY: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>شناسه</th><th>زمان</th><th>SKU</th><th>انبار</th><th>اکشن</th><th>قبل → بعد</th><th>دلیل</th><th>بازیگر</th></tr></thead>
            <tbody>
              {st.ledger.slice().reverse().map(l => (
                <tr key={l.id}>
                  <td className="mono tiny">{l.id}</td>
                  <td className="tiny num">{faTime(l.at)}</td>
                  <td className="mono">{l.sku}</td>
                  <td className="mono tiny">{l.warehouseId}</td>
                  <td><span className="tag">{l.action}</span></td>
                  <td className="tiny">
                    {Object.keys(l.before).map(k => `${faInvState[k as keyof typeof faInvState]}: ${(l.before as any)[k].toLocaleString('fa-IR')} → ${(l.after as any)[k].toLocaleString('fa-IR')}`).join('؛ ')}
                  </td>
                  <td className="tiny">{l.reason}</td>
                  <td className="mono tiny">{l.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'units' && (
        <div className="grid g2">
          <div className="card">
            <h3>تجمیع وضعیت واحدهای موجودی (سراسر شبیه‌سازی)</h3>
            <table className="tbl">
              <thead><tr><th>وضعیت</th><th>تعداد</th></tr></thead>
              <tbody>
                {Object.entries(stateTotals).filter(([, v]) => v > 0).map(([k, v]) => (
                  <tr key={k}>
                    <td><span className="chip blue plain">{(faInvState as any)[k] ?? k}</span> <span className="tiny mono">{k}</span></td>
                    <td className="num">{v.toLocaleString('fa-IR')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>جمع کل واحدها (در طول شبیه‌سازی حفظ می‌شود)</th>
                  <th className="num">{Object.values(stateTotals).reduce((a, b) => a + b, 0).toLocaleString('fa-IR')}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="card" style={{ maxHeight: 560, overflowY: 'auto' }}>
            <h3>واحدهای سریالی <span className="n">({st.serials.length.toLocaleString('fa-IR')} واحد)</span></h3>
            <table className="tbl">
              <thead><tr><th>سریال</th><th>SKU</th><th>انبار</th><th>وضعیت</th><th>محل</th></tr></thead>
              <tbody>
                {st.serials.slice(0, 80).map(s => (
                  <tr key={s.serial}>
                    <td className="mono tiny">{s.serial}</td>
                    <td className="mono">{s.sku}</td>
                    <td className="mono tiny">{s.warehouseId}</td>
                    <td><span className={`chip ${s.state === 'AVAILABLE' ? 'green' : s.state === 'QUARANTINED' || s.state === 'DAMAGED' ? 'red' : 'cyan'} plain`}>{faInvState[s.state]}</span></td>
                    <td className="tiny mono">{s.locationId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {st.serials.length > 80 && <div className="tiny mt">نمایش ۸۰ واحد از {st.serials.length.toLocaleString('fa-IR')} واحد...</div>}
          </div>
        </div>
      )}

      {tab === 'count' && (
        <div>
          <div className="card mb">
            <h3>شمارش چرخه‌ای (Cycle Count)</h3>
            <div className="grid g4">
              <div className="fld"><label>SKU</label>
                <select className="inp" value={ccSku} onChange={ev => setCcSku(ev.target.value)}>
                  {st.products.flatMap(p => p.variants.map(v => <option key={v.sku} value={v.sku}>{v.sku}</option>))}
                </select>
              </div>
              <div className="fld"><label>انبار</label>
                <select className="inp" value={ccWh} onChange={ev => setCcWh(ev.target.value)}>
                  {st.warehouses.map(w => <option key={w.id} value={w.id}>{w.id}</option>)}
                </select>
              </div>
              <div className="fld"><label>اختلاف تعمدی فیزیکی (برای نمایش مغایرت)</label>
                <input className="inp" type="number" min={-10} max={10} value={ccDelta} onChange={ev => setCcDelta(Number(ev.target.value) || 0)} style={{ width: 110 }} />
              </div>
              <div className="fld"><label>&nbsp;</label>
                <button className="btn primary" onClick={() => {
                  const cc = e.startCycleCount(ccSku, ccWh, ccDelta);
                  toast(`شمارش ${cc.id} آغاز شد.`, 'good');
                }}>آغاز شمارش</button>
              </div>
            </div>
            <p className="tiny">تغییر موجودی هرگز بی‌صدا انجام نمی‌شود: مغایرت → استثنا → تحقیق → تأیید اصلاح → ثبت در دفتر (ADJUSTMENT).</p>
          </div>
          <div className="card">
            <h3>سوابق شمارش</h3>
            {st.cycleCounts.length === 0 ? <Empty icon="🔢" text="شمارشی انجام نشده." /> : (
              <table className="tbl">
                <thead><tr><th>شناسه</th><th>SKU</th><th>انبار</th><th>سیستمی</th><th>فیزیکی</th><th>وضعیت</th><th>یادداشت</th><th></th></tr></thead>
                <tbody>
                  {st.cycleCounts.slice().reverse().map(cc => (
                    <tr key={cc.id}>
                      <td className="mono">{cc.id}</td>
                      <td className="mono">{cc.sku}</td>
                      <td className="mono tiny">{cc.warehouseId}</td>
                      <td className="num">{cc.systemQty.toLocaleString('fa-IR')}</td>
                      <td className="num">{cc.physicalQty !== undefined ? cc.physicalQty.toLocaleString('fa-IR') : '—'}</td>
                      <td><span className={`chip ${cc.state === 'MATCHED' || cc.state === 'ADJUSTED' ? 'green' : cc.state === 'DISCREPANCY' ? 'red' : 'yellow'} plain`}>{faCycleCountState[cc.state]}</span></td>
                      <td className="tiny">{cc.noteFa ?? '—'}</td>
                      <td>
                        {cc.state === 'DISCREPANCY' && (
                          <button className="btn sm primary" onClick={() => { e.approveAdjustment(cc.id); toast('اصلاح دفتری اعمال شد.', 'good'); }}>
                            تأیید اصلاح
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ========================================================== EXCEPTIONS ======
function ExceptionCenter({ e, onOpen }: { e: Engine; onOpen: (x: ExceptionRec) => void }) {
  const st = e.state;
  const [flt, setFlt] = useState<'OPEN' | 'ALL'>('OPEN');
  const rows = st.exceptions.filter(x => flt === 'ALL' || x.status !== 'RESOLVED');
  return (
    <div className="card">
      <div className="row mb">
        <button className={`btn sm ${flt === 'OPEN' ? 'primary' : ''}`} onClick={() => setFlt('OPEN')}>فقط باز</button>
        <button className={`btn sm ${flt === 'ALL' ? 'primary' : ''}`} onClick={() => setFlt('ALL')}>همه</button>
        <div className="spacer" />
        <span className="tiny">{rows.length.toLocaleString('fa-IR')} مورد</span>
      </div>
      {rows.length === 0 ? <Empty icon="🎯" text="استثنایی ثبت نشده است." /> : rows.map(ex => (
        <div className={`exc ${ex.severity} ${ex.status === 'RESOLVED' ? 'resolved' : ''}`} key={ex.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(ex)}>
          <div className="row tight">
            <SevChip sev={ex.severity} />
            <b>{faExceptionType[ex.type]}</b>
            <span className="tiny mono">{ex.id}</span>
            <span className={`chip ${ex.status === 'RESOLVED' ? 'green' : ex.status === 'IN_REVIEW' ? 'yellow' : 'red'} plain`}>{faExceptionStatus[ex.status]}</span>
            <div className="spacer" />
            <span className="tiny">مالک: {ex.ownerFa}</span>
            <span className="tiny">{faDateTime(ex.createdAt)}</span>
          </div>
          <div className="muted">{ex.messageFa}</div>
        </div>
      ))}
    </div>
  );
}

function ExcDrawer({ e, ex, onClose, toast }: { e: Engine; ex: ExceptionRec; onClose: () => void; toast: (t: string, tone?: string) => void }) {
  const st = e.state;
  const fresh = st.exceptions.find(x => x.id === ex.id) ?? ex;
  const act = () => {
    const key = fresh.actionKey;
    if (!key) return;
    switch (key) {
      case 'SCAN_MISMATCH':
      case 'LOCATION_MISMATCH':
      case 'DAMAGED':
      case 'INV_MISMATCH': {
        if (fresh.taskId) e.recoverPick(fresh.taskId);
        e.resolveException(fresh.id, 'بازیابی برداشت: تلاش مجدد با محل و SKU صحیح برنامه‌ریزی شد.');
        toast('بازیابی وظیفه برداشت انجام شد.', 'good');
        break;
      }
      case 'SERIAL_MISMATCH': {
        if (fresh.payload?.taskId) e.recoverPick(fresh.payload.taskId);
        e.resolveException(fresh.id, 'ناسازگاری سریال بررسی و تصحیح شد؛ برداشت مجدد برنامه‌ریزی شد.');
        toast('بررسی سریال انجام شد.', 'good');
        break;
      }
      case 'CANCEL_ORDER': {
        e.resolveException(fresh.id, 'سفارش در فرایند لغو و بازپرداخت قرار گرفت.');
        toast('لغو سفارش اعمال شد.', 'good');
        break;
      }
      case 'RETRY_REFUND': {
        if (fresh.payload?.refundId) e.retryRefund(fresh.payload.refundId);
        toast('تلاش مجدد بازپرداخت در صف قرار گرفت.', 'good');
        break;
      }
      case 'APPROVE_ADJUST': {
        if (fresh.payload?.ccId) e.approveAdjustment(fresh.payload.ccId);
        toast('اصلاح دفتری اعمال شد.', 'good');
        break;
      }
      case 'RESOLVE_INBOUND': {
        if (fresh.payload?.inbId) e.resolveInbound(fresh.payload.inbId);
        toast('ورودی بررسی شد.', 'good');
        break;
      }
      case 'MANUAL_RETURN': {
        const ret = st.returns.find(r => r.id === fresh.payload?.returnId);
        if (ret) e.setDisposition(ret.id, 'QUARANTINE');
        toast('بررسی دستی اعمال شد: قرنطینه.', 'good');
        break;
      }
      default:
        e.resolveException(fresh.id, 'تأیید و بستن توسط اپراتور.');
        toast('استثنا بسته شد.', 'good');
    }
    onClose();
  };
  return (
    <Drawer title={<span>استثنای عملیاتی <span className="mono">{fresh.id}</span></span>} onClose={onClose}>
      <div className="row mb">
        <SevChip sev={fresh.severity} />
        <b>{faExceptionType[fresh.type]}</b>
        <span className={`chip ${fresh.status === 'RESOLVED' ? 'green' : 'red'} plain`}>{faExceptionStatus[fresh.status]}</span>
      </div>
      <div className="card tight mb">
        <KV rows={[
          ['پیام', fresh.messageFa],
          ['مالک', fresh.ownerFa],
          ['زمان ایجاد', faDateTime(fresh.createdAt)],
          ['سفارش', fresh.orderId ? <span className="mono">{fresh.orderId}</span> : '—'],
          ['SKU', fresh.sku ? <span className="mono">{fresh.sku}</span> : '—'],
          ['حل‌شده', fresh.resolvedAt ? faDateTime(fresh.resolvedAt) : '—'],
          ['راه‌حل', fresh.resolutionFa ?? '—'],
        ]} />
      </div>
      <div className="card tight mb">
        <h3>مسیر رویداد (Audit Trail)</h3>
        <div className="tl">
          {fresh.steps.map((s, i) => (
            <div className="tl-item" key={i}>
              <div className={`tl-dot ${i === fresh.steps.length - 1 ? 'cur' : 'done'}`} />
              <div className="tl-body">
                <div className="d">{s.textFa}</div>
                <div className="m">{faDateTime(s.at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {fresh.status !== 'RESOLVED' && (
        <button className="btn primary" onClick={act}>
          اقدام بازیابی: {({
            SCAN_MISMATCH: 'تصحیح اسکن و تلاش مجدد برداشت',
            LOCATION_MISMATCH: 'اصلاح محل و تلاش مجدد',
            DAMAGED: 'کنارگذاری کالای آسیب‌دیده و برداشت مجدد',
            INV_MISMATCH: 'تطبیق موجودی و برداشت مجدد',
            SERIAL_MISMATCH: 'بررسی سریال و برداشت مجدد',
            CANCEL_ORDER: 'تأیید لغو و بازپرداخت',
            RETRY_REFUND: 'تلاش مجدد بازپرداخت',
            APPROVE_ADJUST: 'تأیید اصلاح دفتری',
            RESOLVE_INBOUND: 'بررسی ورودی و چیدمان',
            MANUAL_RETURN: 'تعیین تکلیف: قرنطینه',
            ACK: 'تأیید و بستن',
          } as Record<string, string>)[fresh.actionKey ?? 'ACK'] ?? 'اقدام'}
        </button>
      )}
    </Drawer>
  );
}

// ============================================================ RETURNS =======
function ReturnsView({ e }: { e: Engine }) {
  const st = e.state;
  return (
    <div className="grid g2">
      <div className="card">
        <h3>درخواست‌های مرجوعی (Reverse Logistics)</h3>
        {st.returns.length === 0 ? <Empty icon="↩️" text="مرجوعی ثبت نشده است." /> : st.returns.slice().reverse().map(r => (
          <div className="pad mb" key={r.id} style={{ marginBottom: 8 }}>
            <div className="row tight">
              <b className="mono">{r.rma}</b>
              <span className="mono tiny">{r.orderId}</span>
              <span className={`chip ${r.state === 'REJECTED' ? 'red' : r.state === 'CLOSED' ? 'green' : 'yellow'} plain`}>{faReturnState[r.state]}</span>
              {r.disposition && <span className="chip violet plain">{faDisposition[r.disposition]}</span>}
            </div>
            <div className="tiny">دلیل: {r.reasonFa}</div>
            <div className="tiny">صلاحیت: {r.eligibilityReasonFa}</div>
            {r.inspection && <div className="tiny">بازرسی — سریال: {r.inspection.serialOk ? '✔' : '✘'} | ظاهر: {r.inspection.conditionFa} | {r.inspection.notesFa}</div>}
            {r.events.length > 0 && (
              <div className="tiny mt">{r.events.map((ev, i) => <span key={i} style={{ marginInlineEnd: 10 }}>● {faTime(ev.at)} {ev.detailFa}</span>)}</div>
            )}
            {r.eligibility === 'REQUIRES_REVIEW' && r.state !== 'CLOSED' && (
              <button className="btn sm primary mt" onClick={() => e.setDisposition(r.id, 'MANUAL_REVIEW')}>تعیین تکلیف دستی</button>
            )}
          </div>
        ))}
      </div>
      <div className="card">
        <h3>بازپرداخت‌ها (Refunds)</h3>
        {st.refunds.length === 0 ? <Empty icon="💰" text="بازپرداختی ثبت نشده است." /> : (
          <table className="tbl">
            <thead><tr><th>شناسه</th><th>سفارش</th><th>مبلغ</th><th>وضعیت</th><th>دلیل</th></tr></thead>
            <tbody>
              {st.refunds.slice().reverse().map(r => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td className="mono tiny">{r.orderId}</td>
                  <td className="num">{faMoney(r.amount)}</td>
                  <td><span className={`chip ${r.status === 'REFUNDED' ? 'green' : r.status === 'REFUND_FAILED' ? 'red' : 'yellow'} plain`}>{faRefundStatus[r.status]}</span></td>
                  <td className="tiny">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="divider" />
        <h3>تعیین تکلیف مرجوعی‌های دستی</h3>
        {st.returns.filter(r => r.inspection && !r.disposition && !r.inspection.serialOk).length === 0
          ? <div className="tiny">مرجوعی در انتظار بررسی دستی نیست.</div>
          : st.returns.filter(r => r.inspection && !r.disposition && !r.inspection.serialOk).map(r => (
            <div className="row tight mb" key={r.id}>
              <span className="mono">{r.rma}</span>
              <span className="chip red plain">نیازمند بررسی دستی</span>
              {(['RESTOCK', 'OPEN_BOX', 'QUARANTINE', 'DAMAGED', 'SELLER_RETURN'] as const).map(d => (
                <button key={d} className="btn sm" onClick={() => e.setDisposition(r.id, d)}>{faDisposition[d]}</button>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

// ============================================================ SELLERS =======
function SellersView({ e }: { e: Engine }) {
  const st = e.state;
  return (
    <div className="card">
      <h3>فروشندگان و SLA (شبیه‌سازی‌شده — داده‌های واقعی شرکت‌ها نیست)</h3>
      <table className="tbl">
        <thead><tr><th>فروشنده</th><th>مدل تأمین</th><th>انبار</th><th>مهلت تأیید</th><th>مهلت آماده‌سازی</th><th>نرخ لغو</th><th>قابلیت موجودی</th><th>نرخ به‌موقع</th></tr></thead>
        <tbody>
          {st.sellers.map(s => (
            <tr key={s.id}>
              <td>{s.nameFa}<div className="tiny mono">{s.id}</div></td>
              <td><span className={`chip ${s.fulfillment === 'PLATFORM' ? 'green' : s.fulfillment === 'SELLER_FC' ? 'blue' : 'violet'} plain`}>{faFulfillment[s.fulfillment]}</span></td>
              <td className="mono tiny">{s.warehouseId ?? '—'}</td>
              <td className="num">{s.sla.confirmMinutes} دقیقه</td>
              <td className="num">{s.sla.prepareMinutes} دقیقه</td>
              <td className="num">{faPercent(s.sla.cancelRate * 100)}</td>
              <td className="num">{faPercent(s.sla.stockReliability * 100)}</td>
              <td className="num">{faPercent(s.sla.onTimeRate * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="divider" />
      <div className="grid g4">
        <Stat lbl="پرسش از فروشنده" val={st.sellerStats.asked.toLocaleString('fa-IR')} tone="info" />
        <Stat lbl="تأیید" val={st.sellerStats.accepted.toLocaleString('fa-IR')} tone="ok" />
        <Stat lbl="رد" val={st.sellerStats.rejected.toLocaleString('fa-IR')} tone="err" />
        <Stat lbl="نرخ تأیید" val={faPercent(e.kpi().sellerConfirmRate)} tone="ok" />
      </div>
    </div>
  );
}

// ============================================================ SUPPORT =======
function SupportView({ e, onOrder }: { e: Engine; onOrder: (id: string) => void }) {
  const st = e.state;
  const [q, setQ] = useState('');
  const norm = q.trim().toLowerCase();
  const results = norm ? st.orders.filter(o =>
    o.id.toLowerCase().includes(norm) || o.phone.includes(q) || o.customerNameFa.includes(q) ||
    o.items.some(i => i.sku.toLowerCase().includes(norm) || i.serials.some(sn => sn.toLowerCase().includes(norm))) ||
    o.shipments.some(s => s.trackingId?.toLowerCase().includes(norm)) ||
    st.returns.some(r => r.orderId === o.id && (r.rma.toLowerCase().includes(norm)))
  ) : [];
  return (
    <div className="card">
      <h3>جست‌وجوی پشتیبانی مشتریان</h3>
      <p className="tiny mb">
        جست‌وجو با: شماره سفارش، شماره موبایل، نام مشتری، SKU، شماره سریال، شماره رهگیری حامل یا RMA.
        نماینده پشتیبانی چرخه عمر کامل سفارش را می‌بیند؛ اما <b>هیچ دسترسی جادویی برای تغییر داده عملیاتی ندارد</b> —
        هر اقدام از مسیر رویداد/استثنا ثبت می‌شود.
      </p>
      <input className="inp" placeholder="مثلاً ORD-20260929-004821 یا ۰۹۱۲... یا SN-2026-... یا TRK-..." value={q} onChange={ev => setQ(ev.target.value)} />
      {norm && (
        <div className="mt">
          {results.length === 0 ? <Empty icon="🔍" text="نتیجه‌ای یافت نشد." /> : results.map(o => (
            <div className="exc" key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOrder(o.id)}>
              <div className="row tight">
                <span className="mono">{o.id}</span>
                <OrderChip state={o.state} />
                <span className="tiny">{o.customerNameFa} — {o.phone}</span>
                <div className="spacer" />
                <span className="tiny">{faDateTime(o.createdAt)}</span>
              </div>
              <div className="tiny">{o.items.map(i => i.nameFa).join('، ')}</div>
              {o.shipments.map(s => s.trackingId && <span key={s.id} className="mono tiny">رهگیری: {s.trackingId} </span>)}
            </div>
          ))}
        </div>
      )}
      {!norm && <Empty icon="🎧" text="برای شروع جست‌وجو تایپ کنید." />}
    </div>
  );
}

// ============================================================== ADMIN =======
function AdminPanel({ e, toast }: { e: Engine; toast: (t: string, tone?: string) => void }) {
  const st = e.state;
  const f = st.forces;
  const set = (k: keyof typeof f, v: any) => { (f as any)[k] = v; e.notify(); };
  const [scn, setScn] = useState<ScenarioId | null>(st.scenarioId);

  const toggle = (label: string, key: keyof typeof f) => (
    <label className="row tight" style={{ cursor: 'pointer', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(36,54,90,.5)' }}>
      <span style={{ fontSize: 12.5 }}>{label}</span>
      <input type="checkbox" checked={Boolean((f as any)[key])} onChange={ev => set(key, ev.target.checked)} />
    </label>
  );

  return (
    <div className="grid g23">
      <div>
        <div className="card mb">
          <h3>موتور سناریوها (Scenario Engine) <span className="n">اجرا بازنشانی کامل وضعیت می‌سازد</span></h3>
          <div className="grid g3">
            {SCENARIOS.map(s => (
              <div key={s.id} className={`scn ${scn === s.id ? 'on' : ''}`} onClick={() => setScn(s.id)}>
                <div className="sid">{s.id}</div>
                <div className="snm">{s.nameFa}</div>
                <div className="dsc">{s.descFa}</div>
                <div className="tiny mt"><span className="tag">{s.tagFa}</span></div>
              </div>
            ))}
          </div>
          <div className="row mt">
            <button className="btn primary" disabled={!scn} onClick={() => {
              e.applyScenario(scn);
              e.runAll(1500);
              toast(`سناریوی ${scn} اجرا شد.`, 'good');
            }}>▶ اجرای سناریوی انتخاب‌شده</button>
            <button className="btn" onClick={() => { e.applyScenario(null); toast('بازنشانی کامل انجام شد.', 'good'); }}>
              ↺ بازنشانی (حالت آزاد)
            </button>
            <span className="tiny">سناریوها قطعی (deterministic) هستند؛ هر بار همان توالی را تولید می‌کنند، مگر «حالت تصادفی» روشن باشد.</span>
          </div>
        </div>

        <div className="card">
          <h3>بازرسی وضعیت پایگاه داده (از همان state زنده)</h3>
          <div className="grid g4">
            <Stat lbl="سفارش‌ها (Orders)" val={st.orders.length.toLocaleString('fa-IR')} tone="info" />
            <Stat lbl="پرداخت‌ها (Payments)" val={st.payments.length.toLocaleString('fa-IR')} tone="vio" />
            <Stat lbl="وظایف (Tasks)" val={st.tasks.length.toLocaleString('fa-IR')} tone="warn" />
            <Stat lbl="بسته‌ها (Packages)" val={st.packages.length.toLocaleString('fa-IR')} tone="ok" />
            <Stat lbl="مرسولات (Shipments)" val={st.orders.reduce((s, o) => s + o.shipments.length, 0).toLocaleString('fa-IR')} tone="info" />
            <Stat lbl="مرجوعی‌ها (Returns)" val={st.returns.length.toLocaleString('fa-IR')} tone="vio" />
            <Stat lbl="بازپرداخت‌ها (Refunds)" val={st.refunds.length.toLocaleString('fa-IR')} tone="warn" />
            <Stat lbl="رویدادها (Events)" val={st.events.length.toLocaleString('fa-IR')} tone="ok" />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>اجبار سناریو (Forces)</h3>
        <p className="tiny">برای تست و نمایش؛ یک‌بار مصرف مگر «تکرار» روشن باشد.</p>
        {toggle('شکست پرداخت درگاه', 'paymentFail')}
        {toggle('مهلت پرداخت (Timeout)', 'paymentTimeout')}
        {toggle('رد توسط فروشنده (فقط مرسوله‌های فروشنده‌ای)', 'sellerReject')}
        {toggle('تأخیر فروشنده (۳× SLA)', 'sellerDelay')}
        {toggle('کسری موجودی هنگام تخصیص', 'stockShortage')}
        {toggle('خطای اسکن SKU در برداشت', 'wrongScan')}
        {toggle('خطای محل اشتباه در برداشت', 'wrongLocation')}
        {toggle('ناسازگاری سریال در برداشت', 'serialMismatchPick')}
        {toggle('کالای آسیب‌دیده در برداشت', 'damagedPick')}
        {toggle('مغایرت تعداد فیزیکی/سیستمی', 'invMismatch')}
        {toggle('رد درخواست مرجوعی', 'returnReject')}
        {toggle('ناسازگاری سریال مرجوعی', 'serialMismatchReturn')}
        {toggle('آسیب در مرجوعی', 'damagedReturn')}
        {toggle('سوءظظن به تقلب در مرجوعی', 'quarantineReturn')}
        {toggle('شکست بازپرداخت', 'refundFail')}
        {toggle('حالت تصادفی (Random Mode)', 'randomMode')}
        {toggle('سفارش‌های خودکار', 'autoOrders')}
        <div className="fld mt">
          <label>خطای ورودی کالای بعدی</label>
          <select className="inp" value={f.inboundException} onChange={ev => set('inboundException', ev.target.value)}>
            {Object.entries(faInboundException).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="divider" />
        <h3>کنترل زمان شبیه‌سازی</h3>
        <div className="row tight">
          <button className="btn sm" onClick={() => { e.stepOnce(); toast('یک گام جلو رفت.'); }}>مرحله بعد</button>
          <button className="btn sm" onClick={() => { e.runAll(); toast('اجرای کامل تا پایان وظایف.'); }}>اجرای کامل</button>
          <button className="btn sm" onClick={() => { e.running = false; e.notify(); }}>توقف</button>
          <button className="btn sm" onClick={() => { e.autoOrdersEnabled = f.autoOrders; e.running = true; e.notify(); }}>شروع/ادامه</button>
        </div>
        <div className="divider" />
        <h3>بازنشانی</h3>
        <button className="btn danger" onClick={() => { e.applyScenario(scn); e.runAll(1500); toast('سناریو از نو بارگذاری شد.', 'good'); }}>
          ↺ بازنشانی و اجرای مجدد سناریو
        </button>
        <p className="tiny mt">
          بازنشانی، موجودی، رزروها، سفارش‌ها، پرداخت‌ها، وظایف، بسته‌ها، مرسولات، مرجوعی‌ها، بازپرداخت‌ها،
          رویدادها و اعلان‌ها را به حالت اولیه سناریو برمی‌گرداند.
        </p>
      </div>
    </div>
  );
}
