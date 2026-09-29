import React, { useMemo, useState } from 'react';
import { Engine, ALLOWED_TRANSITIONS, ORDER_RANK, SHIPMENT_RANK, QC_RULES, PACKAGE_RULES } from '../sim/engine';
import type { Order, OrderState } from '../sim/types';
import {
  faDateTime, faTime, faOrderState, faMoney, faInvState, faTaskType, faTaskStatus, faPackageType,
} from '../sim/labels';
import { OrderChip, Stat, PageH, Empty, KV, Drawer } from './common';

type Tab = 'events' | 'machine' | 'flow' | 'physical' | 'db';

export default function SystemView({ e }: { e: Engine }) {
  const st = e.state;
  const [tab, setTab] = useState<Tab>('flow');
  const [flowOrder, setFlowOrder] = useState<string | null>(null);
  const [nodeInfo, setNodeInfo] = useState<{ key: string; data: any } | null>(null);
  const [evFilter, setEvFilter] = useState('');

  const orders = st.orders;
  const selOrder = orders.find(o => o.id === flowOrder) ?? orders[orders.length - 1] ?? null;

  return (
    <div>
      <PageH title="نمای سیستم" desc="نمای فنی: جریان رویدادها (Event Sourcing)، ماشین وضعیت، نمودار فرایند منطقی و فیزیکی، و بازرسی وضعیت پایگاه داده — همه از همان state زنده.">
        <span className="live-dot" />
        <span className="tiny">نسخه state: {st.version.toLocaleString('fa-IR')}</span>
      </PageH>

      <div className="tabs">
        {([['flow', 'نمایش فرایند (منطقی)'], ['physical', 'جریان فیزیکی انبار'], ['events', 'جریان رویدادها'],
        ['machine', 'ماشین وضعیت سفارش'], ['db', 'بازرسی وضعیت داده']] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>{t}</button>
        ))}
      </div>

      {tab === 'flow' && (
        <>
          <div className="row mb">
            <label className="tiny">سفارش مرجع برای رنگ‌بندی گره‌ها:</label>
            <select className="inp" style={{ maxWidth: 340 }} value={flowOrder ?? ''} onChange={ev => setFlowOrder(ev.target.value || null)}>
              <option value="">(آخرین سفارش)</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.id} — {faOrderState[o.state]}</option>)}
            </select>
            {selOrder && <OrderChip state={selOrder.state} />}
          </div>
          <p className="tiny mb">
            گره‌ها تزئینی نیستند: وضعیت هر گره از وضعیت واقعی سفارش انتخاب‌شده محاسبه می‌شود. سبز = انجام‌شده،
            آبی درخشان = در حال حاضر، قرمز = شکست، زرد = مسدود/مشروط، خاکستری = هنوز نرسیده. روی هر گره بزنید تا
            توضیح، داده ورودی/خروجی، بازیگر مسئول، اثر موجودی و اثر قابل‌مشاهده برای مشتری را ببینید.
          </p>
          <LogicalFlow e={e} order={selOrder} onNode={(key, data) => setNodeInfo({ key, data })} />
        </>
      )}

      {tab === 'physical' && (
        <>
          <p className="tiny mb">
            <b>جریان فیزیکی</b> جایی است که کالا/بسته واقعاً در آن قرار دارد — برخلاف جریان منطقی که وضعیت OMS/WMS را می‌گوید.
            مثال: منطقی = سفارش در «بسته‌بندی»؛ فیزیکی = بسته روی «ایستگاه PK-07».
          </p>
          <PhysicalFlow e={e} order={selOrder} />
        </>
      )}

      {tab === 'events' && (
        <div className="card">
          <div className="row mb">
            <input className="inp" style={{ maxWidth: 320 }} placeholder="فیلتر نوع رویداد یا متن..." value={evFilter} onChange={ev => setEvFilter(ev.target.value)} />
            <div className="spacer" />
            <span className="tiny">{st.events.length.toLocaleString('fa-IR')} رویداد ثبت‌شده (EVENT-SOURCING)</span>
          </div>
          <div style={{ maxHeight: 640, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
            {st.events.slice().reverse().filter(ev => !evFilter || ev.type.includes(evFilter) || ev.detailFa.includes(evFilter)).map(ev => (
              <div className="ev" key={ev.id}>
                <span className="eid">{ev.id}</span>
                <span className="et">{ev.type}</span>
                <span className="ed">
                  {ev.detailFa}
                  {ev.prev && <span className="tiny"> <b className="mono">{ev.prev}</b> → <b className="mono">{ev.next}</b></span>}
                  {ev.orderId && <span className="tiny"> — <span className="mono">{ev.orderId}</span></span>}
                </span>
                <span className="ea">{ev.actor}<br />{faTime(ev.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'machine' && <StateMachine e={e} order={selOrder} onOrder={id => setFlowOrder(id)} />}

      {tab === 'db' && <DbInspector e={e} />}
    </div>
  );
}

// ==================================================== LOGICAL FLOWCHART =====
interface FlowNodeDef { key: string; title: string; sub: string; }

const MAIN_FLOW: FlowNodeDef[] = [
  { key: 'ORDER', title: 'سفارش', sub: 'ORDER' },
  { key: 'PAYMENT', title: 'پرداخت', sub: 'PAYMENT' },
  { key: 'OMS', title: 'مدیریت سفارش', sub: 'OMS' },
  { key: 'ALLOC', title: 'تصمیم تخصیص', sub: 'FULFILLMENT' },
  { key: 'INV', title: 'موجودی', sub: 'INVENTORY' },
  { key: 'WH', title: 'انبار (WMS)', sub: 'WAREHOUSE' },
  { key: 'PICK', title: 'برداشت', sub: 'PICKING' },
  { key: 'CONS', title: 'تجمیع', sub: 'CONSOLIDATION' },
  { key: 'QC', title: 'کنترل کیفیت', sub: 'QC' },
  { key: 'PACK', title: 'بسته‌بندی', sub: 'PACKING' },
  { key: 'SORT', title: 'تفکیک', sub: 'SORTATION' },
  { key: 'DISPATCH', title: 'ارسال', sub: 'DISPATCH' },
  { key: 'CARRIER', title: 'حامل', sub: 'CARRIER' },
  { key: 'DELIVERY', title: 'تحویل', sub: 'DELIVERY' },
];

const ORDER_STATE_OF_NODE: Record<string, OrderState[]> = {
  ORDER: ['PAYMENT_PENDING', 'PAYMENT_SUCCESS', 'ORDER_CREATED'],
  PAYMENT: ['PAYMENT_PENDING', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED'],
  OMS: ['ORDER_CREATED', 'ALLOCATION_PENDING'],
  ALLOC: ['ALLOCATION_PENDING'],
  INV: ['INVENTORY_RESERVED', 'SELLER_CONFIRMATION_PENDING', 'SELLER_CONFIRMED'],
  WH: ['PICKING_PENDING'],
  PICK: ['PICKING_PENDING', 'PICKING', 'PICKED'],
  CONS: ['CONSOLIDATION'],
  QC: ['QC_PENDING'],
  PACK: ['PACKING', 'PACKED'],
  SORT: ['SORTATION'],
  DISPATCH: ['READY_FOR_DISPATCH', 'DISPATCHED'],
  CARRIER: ['IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  DELIVERY: ['DELIVERED'],
};

const NODE_META: Record<string, { input: string; output: string; actor: string; inv: string; cust: string }> = {
  ORDER: { input: 'سبد خرید مشتری، آدرس، اقلام', output: 'ORD-…، اقلام سفارش', actor: 'مشتری / فرانت‌اند فروشگاه', inv: '—', cust: '«سفارش شما ثبت شد»' },
  PAYMENT: { input: 'مبلغ، روش پرداخت', output: 'PAY-…، وضعیت SUCCESS/FAILED/TIMEOUT', actor: 'درگاه پرداخت (شبیه‌سازی‌شده)', inv: '—', cust: '«پرداخت شما با موفقیت انجام شد» یا «پرداخت ناموفق بود. سفارش شما تکمیل نشد.»' },
  OMS: { input: 'سفارش + پرداخت موفق', output: 'وضعیت ORDER_CREATED', actor: 'سیستم OMS', inv: '—', cust: 'سفارش در حال پردازش' },
  ALLOC: { input: 'ATP به تفکیک انبار/فروشنده/شهر', output: 'ALLOCATION DECISION + مرسوله(ها)', actor: 'موتور تخصیص', inv: '—', cust: '—' },
  INV: { input: 'تصمیم تخصیص', output: 'رزرو (RESERVED) سپس ALLOCATED + INV-TX', actor: 'سیستم', inv: 'AVAILABLE → RESERVED → ALLOCATED؛ ثبت در دفتر با شناسه INV-TX', cust: '«موجودی کالا برای سفارش شما رزرو شد»' },
  WH: { input: 'مرسوله تخصیص‌یافته', output: 'PICK TASK + TOTE + استراتژی', actor: 'WMS', inv: '—', cust: '«سفارش شما در مرکز پردازش در حال آماده‌سازی است»' },
  PICK: { input: 'پیک‌لیست: SKU، محل، تعداد', output: 'کالا در توت؛ اسکن محل/SKU/سریال', actor: 'اپراتور برداشت (EMP-…)', inv: 'ALLOCATED → PICKING → PICKED؛ کاهش موجودی بین', cust: '«کالاهای سفارش شما جمع‌آوری شدند»' },
  CONS: { input: 'چند خط برداشت از محل‌های مختلف', output: 'یک مرسوله تجمیع‌شده', actor: 'اپراتور تجمیع', inv: 'PICKED → CONSOLIDATED', cust: '—' },
  QC: { input: 'چک‌لیست QC دسته کالا', output: 'PASS/FAIL + ثبت کیفیت', actor: 'اپراتور کنترل کیفیت', inv: 'CONSOLIDATED → PICKED (تأیید)', cust: '—' },
  PACK: { input: 'اقلام تأییدشده + قوانین بسته‌بندی', output: 'PKG-… + برچسب بارکد', actor: 'اپراتور بسته‌بندی (ایستگاه PK-…)', inv: 'PICKED → PACKED', cust: '«سفارش شما بسته‌بندی شد»' },
  SORT: { input: 'بسته + شهر/ناحیه/حامل/سطح خدمت', output: 'SORTATION DECISION + لاین + مانیفست', actor: 'اپراتور ارسال', inv: 'PACKED → READY_FOR_DISPATCH', cust: '—' },
  DISPATCH: { input: 'مانیفست MAN-…', output: 'CARRIER_ACCEPTED + TRK-…', actor: 'حامل / اپراتور تحویل', inv: '—', cust: '«بسته شما به شرکت حمل تحویل داده شد»' },
  CARRIER: { input: 'مرسوله تحویلی', output: 'حوادث IN_TRANSIT/OUT_FOR_DELIVERY', actor: 'شرکت حمل (شبیه‌سازی‌شده)', inv: 'READY_FOR_DISPATCH → DISPATCHED', cust: '«بسته شما در مسیر ارسال است»' },
  DELIVERY: { input: 'محل تحویل + OTP', output: 'POD (رسید تحویل)', actor: 'پیک', inv: 'DISPATCHED → DELIVERED', cust: '«بسته شما تحویل داده شد»' },
};

function nodeStatus(order: Order | null, key: string): 'done' | 'active' | 'failed' | 'blocked' | 'idle' {
  if (!order) return 'idle';
  const st = order.state;
  const states = ORDER_STATE_OF_NODE[key] ?? [];
  // failure branches
  if (key === 'PAYMENT' && st === 'PAYMENT_FAILED') return 'failed';
  if (key === 'INV' && ['CANCELLATION_REQUESTED', 'CANCELLED'].includes(st) && order.cancel?.reasonFa?.includes('موجودی')) return 'failed';
  const reachedStates = new Set(order.history.map(h => h.state));
  const isActive = states.includes(st);
  if (isActive) {
    if (st === 'PAYMENT_FAILED') return 'failed';
    return 'active';
  }
  if (states.some(s => reachedStates.has(s))) return 'done';
  // canceled before reaching?
  if (['CANCELLED'].includes(st)) {
    const rank = ORDER_RANK[st];
    void rank;
    const wasReached = states.some(s => reachedStates.has(s));
    return wasReached ? 'done' : 'idle';
  }
  if (st === 'SELLER_REJECTED') return 'failed';
  return 'idle';
}

function LogicalFlow({ e, order, onNode }: { e: Engine; order: Order | null; onNode: (key: string, data: any) => void }) {
  const st = e.state;
  const inReturn = !!order?.returnId;
  const inCancel = !!order?.cancel?.allowed && ['CANCELLATION_REQUESTED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(order?.state ?? '');
  const sellerBranch = order ? order.shipments.some(s => s.fulfillment !== 'PLATFORM') : false;

  const renderNode = (n: FlowNodeDef) => {
    const status = nodeStatus(order, n.key);
    const meta = NODE_META[n.key];
    const lastEv = order ? st.events.filter(ev => ev.orderId === order.id && ev.detailFa).slice(-1)[0] : null;
    const hist = order?.history.find(h => (ORDER_STATE_OF_NODE[n.key] ?? []).includes(h.state));
    return (
      <div key={n.key} className={`fnode ${status}`}
        onClick={() => onNode(n.key, {
          title: n.title, status, meta,
          order: order ? {
            id: order.id, state: faOrderState[order.state],
            hist: hist ? { at: faDateTime(hist.at), detail: hist.detailFa, actor: hist.actor } : null,
          } : null,
        })}>
        <div className="ft">{n.title}</div>
        <div className="fs">{n.sub}</div>
      </div>
    );
  };

  const Arrow = ({ hot }: { hot?: boolean }) => <div className={`farrow ${hot ? 'hot' : ''}`}>↓</div>;

  return (
    <div className="card">
      <div className="flow-wrap">
        <div className="flow-col">
          <div className="flow-row">{renderNode(MAIN_FLOW[0])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[1])}</div>
          <Arrow hot={order?.state !== 'PAYMENT_PENDING'} />
          {order?.state === 'PAYMENT_FAILED' && (
            <>
              <div className="flow-row">
                <div className="fnode failed" onClick={() => onNode('PAYFAIL', {
                  title: 'شکست پرداخت', status: 'failed',
                  meta: { input: 'نتیجه درگاه', output: 'PAYMENT_FAILED + اعلان', actor: 'درگاه', inv: '—', cust: '«پرداخت ناموفق بود. سفارش شما تکمیل نشد.»' },
                })}>
                  <div className="ft">پرداخت ناموفق</div><div className="fs">FAILED / TIMEOUT</div>
                </div>
              </div>
              <div className="farrow">✕</div>
            </>
          )}
          <div className="flow-row">{renderNode(MAIN_FLOW[2])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[3])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[4])}</div>

          {sellerBranch && (
            <>
              <Arrow hot />
              <div className="flow-row">
                <div className={`fnode ${order?.state === 'SELLER_CONFIRMATION_PENDING' ? 'active' : order?.state === 'SELLER_REJECTED' ? 'failed' : ['SELLER_CONFIRMED', 'PICKING_PENDING', 'PICKING', 'PICKED', 'CONSOLIDATION', 'QC_PENDING', 'PACKING', 'PACKED', 'SORTATION', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order?.state ?? '') ? 'done' : 'idle'}`}
                  onClick={() => onNode('SELLER', {
                    title: 'تأیید فروشنده', status: order?.state === 'SELLER_REJECTED' ? 'failed' : 'active',
                    meta: { input: 'مرسوله فروشنده‌ای', output: 'SELLER_CONFIRMED یا SELLER_REJECTED + کوپن جبرانی', actor: 'فروشنده (SLA)', inv: 'رزرو فروشنده', cust: '«فروشنده سفارش را تأیید کرد» یا اطلاع لغو + کد تخفیف' },
                  })}>
                  <div className="ft">تأیید فروشنده</div>
                  <div className="fs">SELLER BRANCH {order?.state === 'SELLER_REJECTED' ? '— رد شد' : ''}</div>
                </div>
              </div>
            </>
          )}

          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[5])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[6])}</div>
          <Arrow hot />
          <div className="flow-row">
            {renderNode(MAIN_FLOW[7])}
          </div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[8])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[9])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[10])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[11])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[12])}</div>
          <Arrow hot />
          <div className="flow-row">{renderNode(MAIN_FLOW[13])}</div>

          <Arrow />
          <div className="flow-row" style={{ gap: 24 }}>
            <div className={`fnode ${inCancel ? 'blocked' : 'idle'}`}
              onClick={() => onNode('CANCEL', {
                title: 'لغو / استرداد', status: inCancel ? 'blocked' : 'idle',
                meta: { input: 'درخواست مشتری + موتور شرایط لغو', output: 'CANCELLATION_REQUESTED → CANCELLED + REFUND', actor: 'OMS + پشتیبانی', inv: 'آزادسازی رزرو/تخصیص، رهگیری بسته', cust: 'اعلان لغو یا دلیل مسدودی' },
              })}>
              <div className="ft">لغو / استرداد</div>
              <div className="fs">CANCELLATION</div>
            </div>
            <div className={`fnode ${inReturn ? 'active' : order?.state === 'DELIVERED' ? 'blocked' : 'idle'}`}
              onClick={() => onNode('RETURN', {
                title: 'مرجوعی (Reverse Logistics)', status: inReturn ? 'active' : 'idle',
                meta: { input: 'درخواست مرجوعی + موتور صلاحیت', output: 'RMA → بازرسی → تعیین تکلیف → REFUND', actor: 'معکوس لجستیک + بازرس', inv: 'DELIVERED → RETURN_* → RESTOCKED/QUARANTINED/DAMAGED', cust: '«درخواست مرجوعی شما ثبت شد»' },
              })}>
              <div className="ft">مرجوعی</div>
              <div className="fs">RETURN / RMA</div>
            </div>
            <div className={`fnode ${['REFUND_PENDING', 'REFUNDED'].includes(order?.state ?? '') ? 'active' : order?.state === 'REFUNDED' ? 'done' : 'idle'}`}
              onClick={() => onNode('REFUND', {
                title: 'بازپرداخت', status: 'idle',
                meta: { input: 'مبلغ + دلیل', output: 'RFD-… REFUNDED/REFUND_FAILED', actor: 'درگاه بازپرداخت', inv: '—', cust: '«مبلغ … به حساب شما بازپرداخت شد»' },
              })}>
              <div className="ft">بازپرداخت</div>
              <div className="fs">REFUND</div>
            </div>
            <div className={`fnode ${['RESTOCK_PENDING', 'RESTOCKED', 'QUARANTINED', 'DAMAGED'].includes(order?.state ?? '') ? 'active' : order?.state === 'RESTOCKED' ? 'done' : 'idle'}`}
              onClick={() => onNode('DISPO', {
                title: 'تعیین تکلیف موجودی', status: 'idle',
                meta: { input: 'نتیجه بازرسی مرجوعی', output: 'RESTOCK / OPEN_BOX / QUARANTINE / DAMAGED / …', actor: 'بازرس مرجوعی', inv: 'RETURN_RECEIVED → AVAILABLE یا QUARANTINED/DAMAGED', cust: 'اعلان نتیجه مرجوعی' },
              })}>
              <div className="ft">بازچیدانبار / قرنطینه</div>
              <div className="fs">DISPOSITION</div>
            </div>
          </div>
        </div>
      </div>
      <div className="tiny mt">
        توضیح جزئیات هر گره: داده ورودی/خروجی، بازیگر مسئول، اثر موجودی و اثر قابل‌مشاهده برای مشتری در پنل باز‌شونده ارائه می‌شود.
        {' '}<span className="badge-src ind">استاندارد صنعت</span> <span className="badge-src sim">شبیه‌سازی</span>
      </div>
    </div>
  );
}

// ===================================================== PHYSICAL FLOW ========
function PhysicalFlow({ e, order }: { e: Engine; order: Order | null }) {
  const st = e.state;
  const nodes = [
    { key: 'RECEIVING', t: 'دریافت کالا', s: 'Receiving' },
    { key: 'STORAGE', t: 'انبارش', s: 'Storage' },
    { key: 'PICKING', t: 'برداشت', s: 'Picking' },
    { key: 'TRANSFER', t: 'انتقال/نوار نقاله', s: 'Transfer' },
    { key: 'CONSOLIDATION', t: 'تجمیع', s: 'Consolidation' },
    { key: 'QC', t: 'کنترل کیفیت', s: 'QC' },
    { key: 'PACKING', t: 'بسته‌بندی', s: 'Packing' },
    { key: 'SORTATION', t: 'تفکیک', s: 'Sortation' },
    { key: 'DISPATCH', t: 'بارگیری و ارسال', s: 'Dispatch' },
    { key: 'CARRIER', t: 'حامل', s: 'Carrier' },
    { key: 'DELIVERY', t: 'تحویل', s: 'Delivered' },
  ];
  const rankOf = (o: Order | null): number => {
    if (!o) return -1;
    const r = ORDER_RANK[o.state];
    if (r !== undefined) return r;
    if (o.returnId) return 16;
    if (['CANCELLATION_REQUESTED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(o.state)) return -2;
    if (o.state === 'PAYMENT_FAILED') return -3;
    return -1;
  };
  const rk = rankOf(order);
  const statusOf = (i: number): 'done' | 'active' | 'idle' => {
    // map logical rank to physical node index (0..10)
    const map: Record<number, number> = { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 8, 12: 9, 13: 9, 14: 10, 15: 10 };
    const activeIdx = map[rk] ?? (rk > 15 ? 10 : -1);
    if (i < activeIdx) return 'done';
    if (i === activeIdx) return 'active';
    return 'idle';
  };

  const pkg = order ? st.packages.find(p => p.orderId === order.id) : null;
  const tote = order ? st.totes.find(t => t.orderIds.includes(order.id)) : null;
  const loc = order?.shipments[0]
    ? Object.values(st.locations).find(l => l.warehouseId === order.shipments[0].warehouseId && Object.keys(l.contents).length > 0)
    : null;

  const detailOf = (key: string): string => {
    if (!order) return 'سفارشی انتخاب نشده.';
    switch (key) {
      case 'RECEIVING': return `کالاها از تأمین‌کننده وارد و در ${order.shipments[0] ? e.warehouse(order.shipments[0].warehouseId ?? '')?.nameFa : '—'} رسید شدند (یا در موجودی اولیه سناریو چیدمان شده‌اند).`;
      case 'STORAGE': return loc ? `کالا در محل ${loc.id} نگهداری می‌شود.` : 'محل انبارش: در حال حاضر کالایی در سینی نیست.';
      case 'PICKING': return tote ? `کالا در توت ${tote.id} (${tote.items.length.toLocaleString('fa-IR')} قلم) — وضعیت: ${tote.state}` : 'هنوز توتی برای این سفارش ساخته نشده.';
      case 'TRANSFER': return 'کالا/توت از مسیر برداشت به سمت تجمیع/ایستگاه QC منتقل می‌شود.';
      case 'CONSOLIDATION': return order.shipments.some(s => s.pickTaskIds.length > 0) ? 'اقلام چندمحلی روی میز تجمیع یکجا شدند.' : 'نیازی به تجمیع نبود (تک‌محل).';
      case 'QC': return 'بازرسی چشمی، تعداد، سریال و مهر و موم طبق چک‌لیست دسته کالا.';
      case 'PACKING': return pkg ? `بسته ${pkg.id} روی ایستگاه ${pkg.stationId} — نوع ${faPackageType[pkg.packageType] ?? pkg.packageType}، وزن ${pkg.weightKg} کیلوگرم، ابعاد ${pkg.dims}` : 'بسته‌ای هنوز ساخته نشده.';
      case 'SORTATION': return pkg && pkg.state !== 'PACKED' ? `بسته در مسیر ${order.shipments[0]?.lane ?? '—'} قرار گرفت.` : 'در انتظار تصمیم تفکیک (شهر/ناحیه/حامل/سطح خدمت).';
      case 'DISPATCH': return order.shipments[0]?.manifestId ? `مانیفست ${order.shipments[0].manifestId} — ${order.shipments[0].trackingId ?? 'در انتظار تحویل'}` : 'مانیفست هنوز تشکیل نشده.';
      case 'CARRIER': return order.shipments[0]?.trackingId ? `حامل بسته را تحویل گرفته — رهگیری ${order.shipments[0].trackingId}` : 'بسته هنوز نزد حامل نیست.';
      case 'DELIVERY': return order.state === 'DELIVERED' ? 'رسید تحویل (POD) با کد تأیید ثبت شده است.' : 'در انتظار تحویل.';
      default: return '';
    }
  };

  return (
    <div className="card">
      <div className="flow-wrap">
        <div className="flow-col">
          {nodes.map((n, i) => (
            <React.Fragment key={n.key}>
              {i > 0 && <div className={`farrow ${statusOf(i) !== 'idle' ? 'hot' : ''}`}>↓</div>}
              <div className={`fnode ${statusOf(i)}`} style={{ minWidth: 300, textAlign: 'start' }}
                onClick={() => { /* inline details below */ }}>
                <div className="row tight">
                  <div className="ft">{n.t}</div>
                  <span className="tiny mono">{n.s}</span>
                  <div className="spacer" />
                  {i === 2 && tote && <span className="tag mono">{tote.id}</span>}
                  {i === 6 && pkg && <span className="tag mono">{pkg.id}</span>}
                  {i === 8 && order?.shipments[0]?.trackingId && <span className="tag mono">{order.shipments[0].trackingId}</span>}
                </div>
                <div className="tiny" style={{ color: 'var(--txt2)' }}>{detailOf(n.key)}</div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="grid g2 mt">
        <div className="pad">
          <b>تفکیک منطقی ↔ فیزیکی</b>
          <div className="tiny mt">
            منطقی: سفارش = {order ? faOrderState[order.state] : '—'}<br />
            فیزیکی: {pkg ? `بسته ${pkg.id} در ${pkg.stationId} — ${pkg.state}` : tote ? `کالا در توت ${tote.id}` : 'کالا در محل انبارش/در حال برداشت'}
          </div>
        </div>
        <div className="pad">
          <b>قوانین بسته‌بندی (پیکربندی‌پذیر، شبیه‌سازی‌شده)</b>
          <div className="tiny mt">{PACKAGE_RULES.map(r => <div key={r.id}>• {r.descFa}</div>)}</div>
        </div>
      </div>
    </div>
  );
}

// ======================================================= STATE MACHINE ======
function StateMachine({ e, order, onOrder }: { e: Engine; order: Order | null; onOrder: (id: string) => void }) {
  const st = e.state;
  const allStates = Object.keys(ALLOWED_TRANSITIONS) as OrderState[];
  const reached = new Set(order?.history.map(h => h.state) ?? []);
  const current = order?.state;
  const nexts = current ? (ALLOWED_TRANSITIONS[current] ?? []) : [];
  return (
    <div className="grid g32">
      <div className="card">
        <h3>سفارش مرجع</h3>
        <select className="inp" value={order?.id ?? ''} onChange={ev => onOrder(ev.target.value)} style={{ marginBottom: 10 }}>
          {st.orders.map(o => <option key={o.id} value={o.id}>{o.id}</option>)}
        </select>
        {order && <KV rows={[
          ['شناسه', <span className="mono">{order.id}</span>],
          ['وضعیت فعلی', <><b>{faOrderState[order.state]}</b> <span className="tiny mono">{order.state}</span></>],
          ['تاریخچه', `${order.history.length.toLocaleString('fa-IR')} گذار`],
          ['مرسوله‌ها', order.shipments.map(s => `${s.id}: ${s.state}`).join('، ') || '—'],
        ]} />}
        <div className="divider" />
        <h3>گذارهای مجاز از وضعیت فعلی</h3>
        {nexts.length === 0 ? <div className="tiny">وضعیت نهایی است (terminal).</div> : nexts.map(n => (
          <div className="row tight" key={n} style={{ marginBottom: 5 }}>
            <span className="acc-c">→</span> <span style={{ fontSize: 12.5 }}>{faOrderState[n]}</span>
            <span className="tiny mono">{n}</span>
          </div>
        ))}
        <div className="divider" />
        <p className="tiny">
          قواعد غیرممکن هرگز اجرا نمی‌شوند: مثلاً <span className="mono">DELIVERED → PICKING</span> یا
          <span className="mono"> RETURNED → AVAILABLE</span> بدون تعیین تکلیف، توسط ماشین وضعیت مسدود می‌شوند.
          کالای مرجوعی تنها پس از تأیید گردش کار تعیین تکلیف، به موجودی برمی‌گردد.
        </p>
      </div>
      <div className="card">
        <h3>تمام وضعیت‌های ماشین <span className="n">سبز=رسیده، آبی=فعلی، زرد=گذار بعدی مجاز</span></h3>
        <div className="sm-grid">
          {allStates.map(s => {
            const cls = s === current ? 'cur' : reached.has(s) ? 'reached' : nexts.includes(s) ? 'next' : '';
            return (
              <div key={s} className={`sm-cell ${cls}`}>
                {faOrderState[s]}
                <span className="en">{s}</span>
              </div>
            );
          })}
        </div>
        <div className="divider" />
        <h3>گذارهای تعریف‌شده</h3>
        <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: 11.5 }}>
          {allStates.map(s => (
            <div key={s} style={{ marginBottom: 4 }}>
              <span className="mono">{s}</span> → <span className="mono acc-c">
                {(ALLOWED_TRANSITIONS[s] ?? []).join(' | ') || '(terminal)'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ========================================================= DB INSPECTOR =====
function DbInspector({ e }: { e: Engine }) {
  const st = e.state;
  const [tbl, setTbl] = useState('ORDERS');
  const tables: Record<string, React.ReactNode> = {};

  tables['ORDERS'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>state</th><th>customer</th><th>amount</th><th>shipments</th><th>createdAt</th></tr></thead>
      <tbody>{st.orders.map(o => (
        <tr key={o.id}><td className="mono">{o.id}</td><td className="mono">{o.state}</td><td>{o.customerNameFa}</td>
          <td className="num">{o.totalAmount}</td><td className="num">{o.shipments.length}</td><td className="tiny num">{faTime(o.createdAt)}</td></tr>
      ))}</tbody>
    </table>
  );
  tables['PAYMENTS'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>orderId</th><th>amount</th><th>status</th><th>gatewayRef</th></tr></thead>
      <tbody>{st.payments.map(p => (
        <tr key={p.id}><td className="mono">{p.id}</td><td className="mono">{p.orderId}</td>
          <td className="num">{p.amount}</td><td className="mono">{p.status}</td><td className="mono tiny">{p.gatewayRef}</td></tr>
      ))}</tbody>
    </table>
  );
  tables['INVENTORY'] = (
    <table className="tbl">
      <thead><tr><th>sku</th><th>warehouse</th><th>state</th><th>qty</th></tr></thead>
      <tbody>{Object.entries(st.inv).flatMap(([sku, whs]) =>
        Object.entries(whs).flatMap(([wh, counts]) =>
          Object.entries(counts).filter(([, v]) => v > 0).map(([state, v]) => (
            <tr key={`${sku}-${wh}-${state}`}><td className="mono">{sku}</td><td className="mono">{wh}</td>
              <td className="mono">{state}</td><td className="num">{v}</td></tr>
          ))
        ))}</tbody>
    </table>
  );
  tables['TASKS'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>type</th><th>status</th><th>order</th><th>warehouse</th><th>startAt</th><th>endAt</th></tr></thead>
      <tbody>{st.tasks.slice(-80).map(t => (
        <tr key={t.id}><td className="mono">{t.id}</td><td className="mono">{t.type}</td><td className="mono">{t.status}</td>
          <td className="mono tiny">{t.orderId ?? '—'}</td><td className="mono tiny">{t.warehouseId ?? '—'}</td>
          <td className="tiny num">{faTime(t.startAt)}</td><td className="tiny num">{faTime(t.endAt)}</td></tr>
      ))}</tbody>
    </table>
  );
  tables['PACKAGES'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>orderId</th><th>type</th><th>weight</th><th>station</th><th>state</th><th>carrier</th></tr></thead>
      <tbody>{st.packages.map(p => (
        <tr key={p.id}><td className="mono">{p.id}</td><td className="mono">{p.orderId}</td><td>{faPackageType[p.packageType] ?? p.packageType}</td>
          <td className="num">{p.weightKg}</td><td className="mono">{p.stationId}</td><td className="mono">{p.state}</td>
          <td className="mono tiny">{p.carrierId}</td></tr>
      ))}</tbody>
    </table>
  );
  tables['SHIPMENTS'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>order</th><th>wh</th><th>state</th><th>tracking</th><th>manifest</th></tr></thead>
      <tbody>{st.orders.flatMap(o => o.shipments.map(s => (
        <tr key={s.id}><td className="mono">{s.id}</td><td className="mono">{o.id}</td><td className="mono">{s.warehouseId}</td>
          <td className="mono">{s.state}</td><td className="mono tiny">{s.trackingId ?? '—'}</td>
          <td className="mono tiny">{s.manifestId ?? '—'}</td></tr>
      )))}</tbody>
    </table>
  );
  tables['RETURNS'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>rma</th><th>order</th><th>eligibility</th><th>state</th><th>disposition</th></tr></thead>
      <tbody>{st.returns.map(r => (
        <tr key={r.id}><td className="mono">{r.id}</td><td className="mono">{r.rma}</td><td className="mono">{r.orderId}</td>
          <td className="mono">{r.eligibility}</td><td className="mono">{r.state}</td><td className="mono">{r.disposition ?? '—'}</td></tr>
      ))}</tbody>
    </table>
  );
  tables['REFUNDS'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>paymentId</th><th>order</th><th>amount</th><th>status</th></tr></thead>
      <tbody>{st.refunds.map(r => (
        <tr key={r.id}><td className="mono">{r.id}</td><td className="mono">{r.paymentId}</td><td className="mono">{r.orderId}</td>
          <td className="num">{r.amount}</td><td className="mono">{r.status}</td></tr>
      ))}</tbody>
    </table>
  );
  tables['EXCEPTIONS'] = (
    <table className="tbl">
      <thead><tr><th>id</th><th>type</th><th>severity</th><th>status</th><th>owner</th><th>message</th></tr></thead>
      <tbody>{st.exceptions.map(x => (
        <tr key={x.id}><td className="mono">{x.id}</td><td className="mono">{x.type}</td><td>{x.severity}</td>
          <td className="mono">{x.status}</td><td>{x.ownerFa}</td><td className="tiny">{x.messageFa}</td></tr>
      ))}</tbody>
    </table>
  );

  const names = Object.keys(tables);
  return (
    <div className="card">
      <div className="tabs">
        {names.map(n => <button key={n} className={tbl === n ? 'on' : ''} onClick={() => setTbl(n)}>{n}</button>)}
      </div>
      <div style={{ maxHeight: 620, overflowY: 'auto' }}>{tables[tbl]}</div>
      <div className="tiny mt">جدول‌ها مستقیماً از همان state زنده موتور تولید می‌شوند — هیچ داده تکراری/جعلی نگهداری نمی‌شود.</div>
    </div>
  );
}
