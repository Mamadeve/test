// ============================================================================
// Core simulation engine: clock, tasks, OMS state machine, inventory ledger,
// WMS flows (inbound/pick/consolidation/QC/pack/sortation/dispatch), carrier,
// cancellation, reverse logistics, refunds, exceptions, scenario scripting.
// All user-visible strings are Persian (labels come from labels.ts / inline fa).
// ============================================================================

import type {
  Carrier, Coupon, CycleCount, Disposition, Employee, ExceptionRec, ExceptionType,
  Forces, InboundShipment, InventoryLedgerEntry, InvCounts, InvState, Manifest,
  Notification, Order, OrderItem, OrderState, PackageRec, Payment, Product,
  Refund, Reservation, ReturnEligibility, ReturnRequest, ScenarioId, ScriptStep,
  SerialUnit, Shipment, ShipmentState, SimEvent, SimState, SimTask, TaskType,
  Tote, Variant, Warehouse, Severity,
} from './types';
import {
  faOrderState, faPaymentStatus, faMoney, faDateTime,
} from './labels';
import {
  buildProducts, buildSellers, buildCarriers, buildCustomers, buildWarehouses,
  buildEmployees, buildLocations, emptyInvCounts,
} from './seed';
import { getScenario } from './scenarios';

export const SIM_START = Date.parse('2026-09-29T08:00:00+03:30');
const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;

// ---------------------------------------------------------------- utilities -

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** shipment state → progression rank (order flow state = min across live shipments) */
export const SHIPMENT_RANK: Record<ShipmentState, number> = {
  ALLOCATED: 0, SELLER_CONFIRMATION_PENDING: 1, SELLER_CONFIRMED: 2,
  PICKING_PENDING: 3, PICKING: 4, PICKED: 5, CONSOLIDATION: 6, QC_PENDING: 7,
  PACKING: 8, PACKED: 9, SORTATION: 10, READY_FOR_DISPATCH: 11, DISPATCHED: 12,
  IN_TRANSIT: 13, OUT_FOR_DELIVERY: 14, DELIVERED: 15, CANCELLED: -1, INTERCEPTED: -1,
  SELLER_REJECTED: -1,
};

const RANK_TO_ORDER_STATE: Record<number, OrderState> = {
  0: 'INVENTORY_RESERVED', 1: 'SELLER_CONFIRMATION_PENDING', 2: 'SELLER_CONFIRMED',
  3: 'PICKING_PENDING', 4: 'PICKING', 5: 'PICKED', 6: 'CONSOLIDATION',
  7: 'QC_PENDING', 8: 'PACKING', 9: 'PACKED', 10: 'SORTATION',
  11: 'READY_FOR_DISPATCH', 12: 'DISPATCHED', 13: 'IN_TRANSIT',
  14: 'OUT_FOR_DELIVERY', 15: 'DELIVERED',
};

export const ORDER_RANK: Partial<Record<OrderState, number>> = (() => {
  const m: Partial<Record<OrderState, number>> = {};
  for (const [k, v] of Object.entries(RANK_TO_ORDER_STATE)) m[v] = Number(k);
  return m;
})();

/**
 * Allowed explicit order-level transitions. Impossible transitions are rejected
 * by Engine.transition (e.g. DELIVERED → PICKING, or skipping payment).
 */
export const ALLOWED_TRANSITIONS: Record<OrderState, OrderState[]> = {
  PAYMENT_PENDING: ['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'CANCELLATION_REQUESTED', 'CANCELLED'],
  PAYMENT_SUCCESS: ['ORDER_CREATED'],
  PAYMENT_FAILED: [],
  ORDER_CREATED: ['ALLOCATION_PENDING'],
  ALLOCATION_PENDING: ['INVENTORY_RESERVED', 'CANCELLATION_REQUESTED'],
  INVENTORY_RESERVED: ['SELLER_CONFIRMATION_PENDING', 'PICKING_PENDING', 'CANCELLATION_REQUESTED'],
  SELLER_CONFIRMATION_PENDING: ['SELLER_CONFIRMED', 'SELLER_REJECTED', 'CANCELLATION_REQUESTED'],
  SELLER_CONFIRMED: ['PICKING_PENDING', 'PACKING', 'PACKED', 'CANCELLATION_REQUESTED'],
  SELLER_REJECTED: ['REFUND_PENDING', 'CANCELLED'],
  PICKING_PENDING: ['PICKING', 'CANCELLATION_REQUESTED'],
  PICKING: ['PICKED', 'CANCELLATION_REQUESTED'],
  PICKED: ['CONSOLIDATION', 'QC_PENDING', 'CANCELLATION_REQUESTED'],
  CONSOLIDATION: ['QC_PENDING', 'CANCELLATION_REQUESTED'],
  QC_PENDING: ['PACKING', 'CANCELLATION_REQUESTED'],
  PACKING: ['PACKED', 'CANCELLATION_REQUESTED'],
  PACKED: ['SORTATION', 'CANCELLATION_REQUESTED'],
  SORTATION: ['READY_FOR_DISPATCH', 'CANCELLATION_REQUESTED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELLATION_REQUESTED'],
  DISPATCHED: ['IN_TRANSIT'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['RETURN_REQUESTED'],
  CANCELLATION_REQUESTED: ['CANCELLED', 'REFUND_PENDING'],
  CANCELLED: ['REFUND_PENDING', 'REFUNDED'],
  RETURN_REQUESTED: ['RETURN_APPROVED', 'DELIVERED'],
  RETURN_APPROVED: ['RETURN_IN_TRANSIT'],
  RETURN_IN_TRANSIT: ['RETURN_RECEIVED'],
  RETURN_RECEIVED: ['RETURN_INSPECTION'],
  RETURN_INSPECTION: ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: ['RESTOCK_PENDING', 'CANCELLED', 'QUARANTINED', 'DAMAGED'],
  RESTOCK_PENDING: ['RESTOCKED', 'QUARANTINED', 'DAMAGED'],
  RESTOCKED: [],
  QUARANTINED: [],
  DAMAGED: [],
};

// --------------------------------------------------------------- QC rules ---

export const QC_RULES: Record<string, { labelFa: string; mandatory: boolean }[]> = {
  SMARTPHONE: [
    { labelFa: 'بازدید ظاهری دستگاه', mandatory: true },
    { labelFa: 'تطبیق تعداد', mandatory: true },
    { labelFa: 'کنترل شماره سریال', mandatory: true },
    { labelFa: 'سلامت مهر و موم کارخانه', mandatory: true },
    { labelFa: 'کامل بودن لوازم جانبی', mandatory: true },
    { labelFa: 'روشن شدن دستگاه (نمونه‌ای)', mandatory: false },
  ],
  LAPTOP: [
    { labelFa: 'بازدید ظاهری دستگاه', mandatory: true },
    { labelFa: 'کنترل شماره سریال', mandatory: true },
    { labelFa: 'سلامت بسته‌بندی و ضربه‌گیر', mandatory: true },
    { labelFa: 'کامل بودن شارژر و کابل', mandatory: true },
    { labelFa: 'بررسی صفحه‌نمایش (نمونه‌ای)', mandatory: false },
  ],
  HEADPHONES: [
    { labelFa: 'بازدید ظاهری', mandatory: true },
    { labelFa: 'تطبیق تعداد', mandatory: true },
    { labelFa: 'سلامت بسته‌بندی', mandatory: true },
  ],
  SMARTWATCH: [
    { labelFa: 'بازدید ظاهری', mandatory: true },
    { labelFa: 'کنترل شماره سریال', mandatory: true },
    { labelFa: 'تطبیق تعداد', mandatory: true },
    { labelFa: 'سلامت بندها و شارژر (نمونه‌ای)', mandatory: false },
  ],
  CONSOLE: [
    { labelFa: 'بازدید ظاهری', mandatory: true },
    { labelFa: 'کنترل شماره سریال', mandatory: true },
    { labelFa: 'سلامت مهر و موم', mandatory: true },
    { labelFa: 'کامل بودن کابل‌ها و دسته بازی', mandatory: true },
    { labelFa: 'بررسی وزن بسته', mandatory: true },
  ],
};

export const PACKAGE_RULES = [
  { id: 'R1', descFa: 'کالای تکی کوچک → بسته کوچک' },
  { id: 'R2', descFa: 'چند کالای کوچک در یک سفارش → بسته متوسط' },
  { id: 'R3', descFa: 'کالای شکننده → بسته‌بندی ضربه‌گیر ویژه' },
  { id: 'R4', descFa: 'کالای بزرگ و سنگین (کنسول/لپ‌تاپ) → بسته بزرگ' },
  { id: 'R5', descFa: 'کالای حساس → بسته‌بندی خاص (شبیه‌سازی‌شده)' },
];

export function defaultForces(): Forces {
  return {
    paymentFail: false, paymentTimeout: false, sellerReject: false, sellerDelay: false,
    stockShortage: false, wrongScan: false, wrongLocation: false, serialMismatchPick: false,
    damagedPick: false, invMismatch: false, returnReject: false, serialMismatchReturn: false,
    damagedReturn: false, quarantineReturn: false, refundFail: false,
    inboundException: 'NONE', randomMode: false, autoOrders: false,
  };
}

function DISPOSITION_NOTE(d: Disposition): string {
  const m: Record<Disposition, string> = {
    RESTOCK: 'بازگشت به موجودی قابل فروش (مدل شبیه‌سازی‌شده بر اساس رویه‌های عمومی).',
    OPEN_BOX: 'بازگشت به موجودی با برچسب «بازشده».',
    QUARANTINE: 'قرنطینه — خارج از موجودی قابل فروش تا بررسی نهایی.',
    DAMAGED: 'ثبت به عنوان آسیب‌دیده — ارزش فروش صفر.',
    REPAIR: 'ارسال به تعمیرات.',
    SELLER_RETURN: 'بازگشت به فروشنده.',
    DISPOSAL: 'اسقاط.',
    MANUAL_REVIEW: 'نیازمند بررسی دستی کارشناس.',
  };
  return m[d];
}

// =========================================================== Engine class ===

export class Engine {
  state: SimState;
  private listeners = new Set<() => void>();
  private rng: () => number = Math.random;
  running = false;
  speedMult = 60;         // simulated seconds per real second
  autoOrdersEnabled = false;
  private procCount = 0;

  constructor(scenarioId: ScenarioId | null = null) {
    this.state = this.buildState(scenarioId);
    this.applyScenarioSetup(scenarioId);
  }

  // ---------------------------------------------------------- subscription --
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  notify = () => {
    this.state.version++;
    this.listeners.forEach(f => f());
  };

  // ------------------------------------------------------------ id helpers --
  private nextId(prefix: string, key: string, width = 6): string {
    const n = (this.state.counters[key] = (this.state.counters[key] ?? 0) + 1);
    return `${prefix}-${pad(n, width)}`;
  }

  private nextIdDated(prefix: string, key: string, width = 6): string {
    const n = (this.state.counters[key] = (this.state.counters[key] ?? 0) + 1);
    return `${prefix}-${ymd(this.state.simTime)}-${pad(n, width)}`;
  }

  // ------------------------------------------------------------ event log ---
  private pushEvent(type: string, o: {
    actor?: string; orderId?: string; sku?: string; prev?: string; next?: string; detailFa: string;
  }) {
    const ev: SimEvent = {
      id: this.nextId('EVENT', 'ev', 6),
      type, actor: o.actor ?? 'SYSTEM', orderId: o.orderId, sku: o.sku,
      prev: o.prev, next: o.next, at: this.state.simTime, detailFa: o.detailFa,
    };
    this.state.events.push(ev);
    if (this.state.events.length > 4000) this.state.events.splice(0, 500);
    return ev;
  }

  notifyCustomer(titleFa: string, bodyFa: string, kind: Notification['kind'], orderId?: string) {
    const n: Notification = {
      id: this.nextId('NTF', 'ntf', 6), at: this.state.simTime,
      titleFa, bodyFa, kind, orderId, read: false, audience: 'CUSTOMER',
    };
    this.state.notifications.unshift(n);
    if (this.state.notifications.length > 300) this.state.notifications.pop();
  }

  private notifyOps(titleFa: string, bodyFa: string, kind: Notification['kind'], orderId?: string) {
    const n: Notification = {
      id: this.nextId('NTF', 'ntf', 6), at: this.state.simTime,
      titleFa, bodyFa, kind, orderId, read: false, audience: 'OPS',
    };
    this.state.notifications.unshift(n);
    if (this.state.notifications.length > 300) this.state.notifications.pop();
  }

  addException(type: ExceptionType, severity: Severity, messageFa: string, o: {
    orderId?: string; taskId?: string; sku?: string; ownerFa: string;
    actionKey?: string; payload?: Record<string, any>; links?: ExceptionRec['links'];
    stepFa?: string;
  }): ExceptionRec {
    const rec: ExceptionRec = {
      id: this.nextId('EXC', 'exc', 6), type, severity, messageFa,
      orderId: o.orderId, taskId: o.taskId, sku: o.sku, ownerFa: o.ownerFa,
      status: 'OPEN', createdAt: this.state.simTime,
      actionKey: o.actionKey, payload: o.payload, links: o.links,
      steps: [{ at: this.state.simTime, textFa: o.stepFa ?? 'خطا شناسایی و ثبت شد.' }],
    };
    this.state.exceptions.unshift(rec);
    this.notifyOps('استثنای عملیاتی ثبت شد', messageFa, 'EXCEPTION', o.orderId);
    this.pushEvent(`EXCEPTION_${type}`, { orderId: o.orderId, sku: o.sku, detailFa: messageFa, actor: 'SYSTEM' });
    return rec;
  }

  resolveException(id: string, resolutionFa: string) {
    const ex = this.state.exceptions.find(e => e.id === id);
    if (!ex || ex.status === 'RESOLVED') return;
    ex.status = 'RESOLVED';
    ex.resolvedAt = this.state.simTime;
    ex.resolutionFa = resolutionFa;
    ex.steps.push({ at: this.state.simTime, textFa: `راه‌حل اعمال شد: ${resolutionFa}` });
    this.pushEvent('EXCEPTION_RESOLVED', { orderId: ex.orderId, detailFa: `${ex.id}: ${resolutionFa}`, actor: 'OPS' });
    this.notify();
  }

  // ----------------------------------------------------------- state build --
  private buildState(scenarioId: ScenarioId | null): SimState {
    const seed = scenarioId ? (parseInt(scenarioId.slice(3), 10) * 7919 + 13) : 20260929;
    this.rng = mulberry32(seed);
    const products = buildProducts();
    const sellers = buildSellers();
    const warehouses = buildWarehouses();
    const locations = buildLocations(warehouses);
    const employees = buildEmployees();
    const inv: SimState['inv'] = {};
    const serials: SerialUnit[] = [];
    const ledger: InventoryLedgerEntry[] = [];

    const state: SimState = {
      simTime: SIM_START, scenarioId, scenarioNameFa: '', products, sellers,
      customers: buildCustomers(), carriers: buildCarriers(), warehouses, locations,
      employees, inv, serials, reservations: [], ledger, orders: [], payments: [],
      refunds: [], coupons: [], tasks: [], totes: [], packages: [], manifests: [],
      inbound: [], returns: [], exceptions: [], events: [], notifications: [],
      cycleCounts: [], counters: {
        ord: 4820, pay: 120, inv: 980, ev: 980, ntf: 40, exc: 30, tote: 420,
        ship: 60, ret: 40, rfd: 10, pkg: 9820, man: 41, inb: 11, cc: 5,
        cpn: 6, rma: 41, sn: 18290, task_PICK: 980, task_PACK: 100,
      },
      pickStats: { picks: 0, errors: 0, packs: 0, packErrors: 0 },
      sellerStats: { asked: 0, accepted: 0, rejected: 0, timeout: 0 },
      deliveryStats: { dispatched: 0, onTime: 0, delivered: 0, totalMinutes: 0 },
      cancelStats: { requested: 0, allowed: 0 },
      returnStats: { requested: 0, approved: 0, rejected: 0 },
      inventoryAdjustments: 0, inventoryCounts: 0, congestionNotifiedAt: 0,
      seededAt: SIM_START, script: [], splitPolicy: 'CONSOLIDATE_FIRST', rngSeed: seed,
      forces: defaultForces(), version: 0,
    };

    // --- seller hub pseudo-warehouse must exist before stock placement ------
    warehouses.push({
      id: 'WH-SEL-01', nameFa: 'انبار فروشندگان (ارسال مستقیم فروشنده)', city: 'تهران',
      regions: ['تهران', 'کرج', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'اهواز', 'رشت'],
      zones: [{ id: 'WH-SEL-01/Z-S', warehouseId: 'WH-SEL-01', code: 'Z-S', nameFa: 'منطقه نگهداری فروشنده' }],
      capacity: { receiving: 4, picking: 4, packing: 4, dispatch: 6 },
      used: { receiving: 0, picking: 0, packing: 0, dispatch: 0 },
      capacityState: 'NORMAL',
    });
    for (let a = 1; a <= 2; a++) for (let r = 1; r <= 2; r++) for (let sh = 1; sh <= 2; sh++) for (let b = 1; b <= 4; b++) {
      const id = `WH-SEL-01/Z-S/S0${a}/R0${r}/S0${sh}/B0${b}`;
      locations[id] = {
        id, warehouseId: 'WH-SEL-01', zone: 'Z-S', aisle: `S0${a}`,
        rack: `R0${r}`, shelf: `S0${sh}`, bin: `B0${b}`, kind: 'STORAGE', contents: {}, capacity: 50,
      };
    }
    for (const code of ['DOCK-IN', 'STAGE-01', 'QC-01', 'RET-01']) {
      const id = `WH-SEL-01/${code}`;
      locations[id] = {
        id, warehouseId: 'WH-SEL-01', zone: '-', aisle: '-', rack: '-', shelf: '-',
        bin: code, kind: code === 'DOCK-IN' ? 'DOCK' : code === 'RET-01' ? 'RETURNS' : code === 'QC-01' ? 'QC' : 'STAGING',
        contents: {}, capacity: 200,
      };
    }

    // --- seed stock: each product starts with exactly 100 units ------------
    for (const p of products) {
      const perVariant = Math.floor(p.initialQty / p.variants.length); // 25
      for (const v of p.variants) {
        inv[v.sku] = {};
        const plan: [string, number][] = [];
        if (p.sellerId === 'SELL-002') plan.push(['WH-TEH-01', perVariant]);
        else if (p.sellerId === 'SELL-003' || p.sellerId === 'SELL-004') plan.push(['WH-SEL-01', perVariant]);
        else {
          plan.push(['WH-TEH-01', Math.round(perVariant * 0.4)]);
          plan.push(['WH-TEH-02', Math.round(perVariant * 0.35)]);
          plan.push(['WH-TEH-03', perVariant - Math.round(perVariant * 0.4) - Math.round(perVariant * 0.35)]);
        }
        for (const [whId, qty] of plan) {
          if (qty <= 0) continue;
          inv[v.sku][whId] = emptyInvCounts();
          inv[v.sku][whId].AVAILABLE = qty;
          // zone must exist in the target warehouse (WH-SEL-01 only has Z-S)
          const zoneCode = whId === 'WH-SEL-01' ? 'Z-S'
            : p.category === 'HEADPHONES' ? 'Z-B'
              : p.category === 'CONSOLE' ? 'Z-C' : 'Z-A';
          const bins = Object.values(locations).filter(l =>
            l.warehouseId === whId && l.kind === 'STORAGE' && l.zone === zoneCode);
          if (bins.length) {
            const perBin = Math.max(1, Math.ceil(qty / Math.min(3, bins.length)));
            let left = qty, bi = 0;
            while (left > 0) {
              const bin = bins[bi % bins.length];
              bin.contents[v.sku] = (bin.contents[v.sku] ?? 0) + Math.min(perBin, left);
              left -= Math.min(perBin, left); bi++;
            }
          }
          ledger.push({
            id: `INV-TX-${pad(state.counters.inv += 1, 6)}`, sku: v.sku, warehouseId: whId,
            before: { AVAILABLE: 0 }, after: { AVAILABLE: qty }, action: 'INITIAL_STOCK',
            delta: qty, reason: 'موجودی اولیه سناریو (شبیه‌سازی‌شده)', actor: 'SYSTEM',
            at: SIM_START,
          });
          if (p.serialized) {
            for (let i = 0; i < qty; i++) {
              const sn = state.counters['sn'] = (state.counters['sn'] ?? 18290) + 1;
              serials.push({
                serial: `SN-2026-${pad(sn, 8)}`, sku: v.sku, warehouseId: whId,
                locationId: '', state: 'AVAILABLE', receivedAt: SIM_START,
              });
            }
          }
        }
      }
    }
    // assign serials to storage locations that hold their sku
    for (const s of serials) {
      if (s.locationId) continue;
      const loc = Object.values(locations).find(l =>
        l.warehouseId === s.warehouseId && l.kind === 'STORAGE' && (l.contents[s.sku] ?? 0) > 0);
      if (loc) s.locationId = loc.id;
    }

    state.warehouses = warehouses;
    return state;
  }

  // ---------------------------------------------------------- lookups -------
  product(id: string) { return this.state.products.find(p => p.id === id); }
  variant(variantId: string): Variant | undefined {
    for (const p of this.state.products) { const v = p.variants.find(x => x.id === variantId); if (v) return v; }
    return undefined;
  }
  variantBySku(sku: string): Variant | undefined {
    for (const p of this.state.products) { const v = p.variants.find(x => x.sku === sku); if (v) return v; }
    return undefined;
  }
  seller(id: string) { return this.state.sellers.find(s => s.id === id); }
  warehouse(id: string) { return this.state.warehouses.find(w => w.id === id); }
  customer(id: string) { return this.state.customers.find(c => c.id === id); }

  available(sku: string, whId: string): number {
    return this.state.inv[sku]?.[whId]?.AVAILABLE ?? 0;
  }
  totalAvailable(sku: string): number {
    const m = this.state.inv[sku]; if (!m) return 0;
    return Object.values(m).reduce((s, c) => s + (c.AVAILABLE ?? 0), 0);
  }

  // ---------------------------------------------------------- inventory ops -
  private ensureCounts(sku: string, whId: string): InvCounts {
    const m = this.state.inv[sku] ?? (this.state.inv[sku] = {});
    return m[whId] ?? (m[whId] = emptyInvCounts());
  }

  mutateInv(sku: string, whId: string, changes: Partial<InvCounts>, action: string,
    reason: string, actor: string, orderId?: string) {
    const counts = this.ensureCounts(sku, whId);
    const keys = Object.keys(changes) as InvState[];
    const before: Partial<InvCounts> = {};
    for (const k of keys) before[k] = counts[k];
    let delta = 0;
    for (const k of keys) {
      counts[k] = (counts[k] ?? 0) + (changes[k] ?? 0);
      if (counts[k] < 0) {
        counts[k] = 0;
        this.addException('INVENTORY_MISMATCH', 'CRITICAL',
          `موجودی منفی شد (${k}، ${sku}) — سیستم صفر کرد و رویداد ثبت شد.`, {
          sku, ownerFa: 'تیم کنترل موجودی', orderId, actionKey: 'ACK',
        });
      }
      delta += changes[k] ?? 0;
    }
    const after: Partial<InvCounts> = {};
    for (const k of keys) after[k] = counts[k];
    const entry: InventoryLedgerEntry = {
      id: this.nextId('INV-TX', 'inv', 6), sku, warehouseId: whId, before, after,
      action, delta, reason, actor, at: this.state.simTime, orderId,
    };
    this.state.ledger.push(entry);
    if (this.state.ledger.length > 3000) this.state.ledger.splice(0, 400);
    return entry;
  }

  /** move n serialized units of sku/wh between states (mirror of count changes) */
  moveSerials(sku: string, whId: string, from: InvState, to: InvState, qty: number,
    orderId?: string, locId?: string) {
    // order-aware: when an orderId is given, prefer units already tagged with it (or untagged
    // for first-touch transitions like AVAILABLE→RESERVED) so concurrent orders never steal
    // each other's serials.
    const pool = this.state.serials.filter(s =>
      s.sku === sku && s.warehouseId === whId && s.state === from &&
      (orderId === undefined || s.orderId === orderId || s.orderId === undefined));
    for (let i = 0; i < qty && i < pool.length; i++) {
      pool[i].state = to;
      if (to === 'AVAILABLE') pool[i].orderId = undefined;
      else if (orderId) pool[i].orderId = orderId;
      if (locId !== undefined) pool[i].locationId = locId;
    }
  }

  reserve(sku: string, whId: string, qty: number, orderId: string): boolean {
    if (this.available(sku, whId) < qty) return false;
    this.mutateInv(sku, whId, { AVAILABLE: -qty, RESERVED: qty }, 'RESERVE',
      `رزرو برای سفارش ${orderId}`, 'SYSTEM', orderId);
    this.moveSerials(sku, whId, 'AVAILABLE', 'RESERVED', qty, orderId);
    const res: Reservation = {
      id: this.nextId('RSV', 'rsv', 6), orderId, sku, warehouseId: whId, qty,
      createdAt: this.state.simTime, expiresAt: this.state.simTime + 3 * HOUR,
    };
    this.state.reservations.push(res);
    this.schedule('TTL_EXPIRY', 3 * HOUR, { reservationId: res.id, orderId });
    this.pushEvent('INVENTORY_RESERVED', {
      orderId, sku, prev: 'AVAILABLE', next: 'RESERVED',
      detailFa: `موجودی ${qty} عدد ${sku} رزرو شد.`,
    });
    return true;
  }

  releaseReservation(res: Reservation, reason: string) {
    if (res.released) return;
    res.released = true;
    const counts = this.state.inv[res.sku]?.[res.warehouseId];
    if (!counts || counts.RESERVED < res.qty) return;
    this.mutateInv(res.sku, res.warehouseId, { RESERVED: -res.qty, AVAILABLE: res.qty }, 'RELEASE',
      reason, 'SYSTEM', res.orderId);
    this.moveSerials(res.sku, res.warehouseId, 'RESERVED', 'AVAILABLE', res.qty, res.orderId);
    this.pushEvent('RESERVATION_RELEASED', {
      orderId: res.orderId, sku: res.sku, prev: 'RESERVED', next: 'AVAILABLE', detailFa: reason,
    });
  }

  // ----------------------------------------------------------- scheduling ---
  schedule(type: TaskType, durationMs: number, payload: Record<string, any>, o: {
    orderId?: string; shipmentId?: string; returnId?: string; warehouseId?: string;
    needsWorker?: boolean; role?: Employee['role']; startDelayMs?: number; toteId?: string;
  } = {}): SimTask {
    const prefixMap: Partial<Record<TaskType, string>> = {
      PICK: 'PICK', PACK: 'PACK', CONSOLIDATION: 'CONS', QC: 'QC', SORTATION: 'SORT',
      HANDOVER: 'HAND', PAYMENT: 'PAY', ALLOCATION: 'ALLOC', SELLER_CONFIRM: 'SLC',
      SELLER_PREPARE: 'SLP', TRANSIT: 'TRN', OUT_FOR_DELIVERY: 'OFD', DELIVERY: 'DLV',
      RECEIVING: 'RCV', PUTAWAY: 'PUT', INBOUND_TRANSIT: 'INB', RETURN_PICKUP: 'RTP',
      RETURN_TRANSIT: 'RTT', RETURN_RECEIVE: 'RRC', RETURN_INSPECT: 'RIN',
      DISPOSITION: 'DSP', REFUND: 'RFD', TTL_EXPIRY: 'TTL', CYCLE_COUNT: 'CNT',
    };
    const key = `task_${type}`;
    const n = (this.state.counters[key] = (this.state.counters[key] ?? 0) + 1);
    const id = `${prefixMap[type] ?? 'TSK'}-${pad(n, 6)}`;
    const startAt = this.state.simTime + (o.startDelayMs ?? 0);
    const task: SimTask = {
      id, type, status: 'QUEUED', orderId: o.orderId, shipmentId: o.shipmentId,
      returnId: o.returnId, warehouseId: o.warehouseId, startAt,
      endAt: startAt + durationMs, payload: { ...payload, durationMs, needsWorker: !!o.needsWorker, role: o.role },
      toteId: o.toteId,
    };
    this.state.tasks.push(task);
    return task;
  }

  private freeWorker(role: Employee['role'], whId: string): Employee | undefined {
    const now = this.state.simTime;
    return this.state.employees
      .filter(e => e.role === role && e.warehouseId === whId && e.busyUntil <= now)
      .sort((a, b) => a.busyUntil - b.busyUntil)[0];
  }

  // -------------------------------------------------------- order creation --
  placeOrder(input: {
    customerId: string; items: { variantId: string; qty: number }[];
    city?: string; addressFa?: string; paymentMethod?: string;
    paymentOutcome?: 'AUTO' | 'SUCCESS' | 'FAIL' | 'TIMEOUT';
    noteFa?: string;
  }): Order {
    const st = this.state;
    const cust = this.customer(input.customerId) ?? st.customers[0];
    const method = input.paymentMethod ?? 'GATEWAY';

    const orderItems: OrderItem[] = input.items.map(ii => {
      const v = this.variant(ii.variantId)!;
      const p = this.product(v.productId)!;
      return {
        variantId: v.id, productId: v.productId, sku: v.sku, barcode: v.barcode,
        nameFa: `${p.nameFa} — ${Object.values(v.attrs).join('، ')}`,
        qty: ii.qty, unitPrice: v.price, serials: [],
      };
    });
    const total = orderItems.reduce((s, i) => s + i.unitPrice * i.qty, 0);

    const order: Order = {
      id: this.nextIdDated('ORD', 'ord', 6),
      createdAt: st.simTime, customerId: cust.id, customerNameFa: cust.nameFa,
      phone: cust.phone, city: input.city ?? cust.city, addressFa: input.addressFa ?? cust.addressFa,
      items: orderItems, shipments: [], state: 'PAYMENT_PENDING',
      fulfillmentSummary: [], sellerIds: [], totalAmount: total,
      expectedDelivery: st.simTime + 2 * DAY, history: [], customerNote: input.noteFa,
    };
    order.history.push({ state: 'PAYMENT_PENDING', at: st.simTime, detailFa: 'سفارش در انتظار پرداخت است.', actor: 'SYSTEM' });
    st.orders.push(order);

    const pay: Payment = {
      id: this.nextIdDated('PAY', 'pay', 6),
      gatewayRef: `GW-${ymd(st.simTime)}-${pad(Math.floor(this.rng() * 900000) + 100000, 6)}`,
      orderId: order.id, amount: total, method, status: 'PENDING', at: st.simTime,
    };
    st.payments.push(pay);
    order.paymentId = pay.id;

    this.schedule('PAYMENT', 2 * MIN, { outcome: input.paymentOutcome ?? 'AUTO', method }, { orderId: order.id });
    this.pushEvent('ORDER_SUBMITTED', { orderId: order.id, actor: cust.nameFa, detailFa: `سفارش ${order.id} ثبت شد.` });
    this.notifyCustomer('سفارش شما ثبت شد', `سفارش ${order.id} ثبت شد و در انتظار پرداخت است.`, 'ORDER', order.id);
    this.notify();
    return order;
  }

  // ------------------------------------------------------------ transitions -
  transition(order: Order, next: OrderState, detailFa: string, actor = 'SYSTEM'): boolean {
    if (order.state === next) return true;
    const allowed = ALLOWED_TRANSITIONS[order.state] ?? [];
    if (!allowed.includes(next)) {
      this.addException('ALLOCATION_FAILURE', 'CRITICAL',
        `گذار غیرمجاز وضعیت مسدود شد: ${faOrderState[order.state]} → ${faOrderState[next]}`, {
        orderId: order.id, ownerFa: 'تیم کنترل فرایند', actionKey: 'ACK',
        stepFa: 'سیستم مانع گذار نامعتبر شد (ماشین وضعیت سفارش).',
      });
      return false;
    }
    const prev = order.state;
    order.state = next;
    order.history.push({ state: next, at: this.state.simTime, detailFa, actor });
    this.pushEvent(`ORDER_${next}`, { orderId: order.id, prev, next, detailFa, actor });
    this.runScripts(order);
    this.notify();
    return true;
  }

  private setShipmentState(sh: Shipment, next: ShipmentState, detailFa: string) {
    if (sh.state === next) return;
    const prev = sh.state;
    sh.state = next;
    const whName = this.warehouse(sh.warehouseId ?? '')?.nameFa ?? 'مسیر حمل';
    sh.events.push({ type: next, at: this.state.simTime, locationFa: whName, detailFa });
    this.pushEvent(`SHIPMENT_${next}`, { orderId: sh.orderId, prev, next, detailFa });
    this.syncOrderFromShipments(sh.orderId);
  }

  /**
   * Aggregate: order flow state = minimum rank across live shipments.
   * Monotonic forward only; terminal/admin states (payment, cancel, return...)
   * are never touched here.
   */
  syncOrderFromShipments(orderId: string) {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order) return;
    const curRank = ORDER_RANK[order.state];
    if (curRank === undefined) return;              // payment / cancel / return flows
    const live = order.shipments.filter(s => s.state !== 'CANCELLED' && s.state !== 'INTERCEPTED');
    if (!live.length) return;
    const allDone = live.every(s => s.state === 'DELIVERED');
    const minRank = Math.min(...live.map(s => SHIPMENT_RANK[s.state]));
    const target: OrderState | undefined = allDone ? 'DELIVERED' : RANK_TO_ORDER_STATE[Math.max(0, minRank)];
    if (!target || target === order.state) return;
    const tRank = ORDER_RANK[target];
    if (tRank === undefined || tRank < curRank) return;
    const prev = order.state;
    order.state = target;
    order.history.push({ state: target, at: this.state.simTime, detailFa: `همگام‌سازی از وضعیت مرسوله‌ها: ${faOrderState[target]}`, actor: 'SYSTEM' });
    this.pushEvent(`ORDER_${target}`, { orderId: order.id, prev, next: target, detailFa: `وضعیت سفارش از مرسوله‌ها همگام شد: ${faOrderState[target]}` });
    if (target === 'DELIVERED') {
      this.notifyCustomer('سفارش تحویل داده شد', `سفارش ${order.id} کامل تحویل داده شد. از خرید شما سپاسگزاریم.`, 'ORDER', order.id);
    }
    this.runScripts(order);
    this.notify();
  }

  // ------------------------------------------------------------ time control -
  tick(realDtMs: number) {
    if (this.running) {
      this.state.simTime += realDtMs * this.speedMult;
      this.process();
    }
    this.notify();
  }

  /** advance to the next event boundary and process it */
  stepOnce() {
    const next = this.nextEventTime();
    if (next !== null && next > this.state.simTime) this.state.simTime = next;
    this.process();
    this.notify();
  }

  /** run until no runnable tasks remain */
  runAll(maxIter = 4000) {
    let i = 0;
    while (i++ < maxIter) {
      const next = this.nextEventTime();
      if (next === null) break;
      if (next > this.state.simTime) this.state.simTime = next;
      this.process();
    }
    this.notify();
  }

  private nextEventTime(): number | null {
    let min: number | null = null;
    for (const t of this.state.tasks) {
      if (t.status === 'ACTIVE') {
        if (min === null || t.endAt < min) min = t.endAt;
      } else if (t.status === 'QUEUED') {
        // due-now tasks must still count, otherwise runAll() bails before process()
        const at = t.startAt > this.state.simTime ? t.startAt : this.state.simTime;
        if (min === null || at < min) min = at;
      }
    }
    if (min === null && this.autoOrdersEnabled) {
      // keep free/random mode progressing even when the task list is empty
      const any = (this.state as any)._autoNext;
      if (any === undefined || any <= this.state.simTime) return this.state.simTime;
      return any;
    }
    return min;
  }

  process() {
    if (this.procCount > 50) return;
    this.procCount++;
    try {
      let guard = 0;
      while (guard++ < 800) {
        const now = this.state.simTime;
        // 1) complete due ACTIVE tasks (ordered by end time)
        const dueActive = this.state.tasks
          .filter(t => t.status === 'ACTIVE' && t.endAt <= now)
          .sort((a, b) => a.endAt - b.endAt);
        if (dueActive.length) {
          for (const t of [...dueActive]) this.completeTask(t);
          continue;
        }
        // 2) activate due QUEUED tasks (one batch per loop)
        const dueQueued = this.state.tasks
          .filter(t => t.status === 'QUEUED' && t.startAt <= now)
          .sort((a, b) => a.startAt - b.startAt);
        let acted = false;
        for (const t of dueQueued) {
          if (this.activateTask(t)) { acted = true; break; }
        }
        if (acted) continue;
        // 3) auto orders (random / free mode)
        if (this.autoOrdersEnabled) {
          const any = (this.state as any)._autoNext;
          if (any === undefined) (this.state as any)._autoNext = now + 20 * MIN;
          else if (now >= any) {
            (this.state as any)._autoNext = now + 30 * MIN;
            this.autoOrder();
            continue;
          }
        }
        break;
      }
      this.updateCapacity();
    } finally {
      this.procCount--;
    }
  }

  private activateTask(t: SimTask): boolean {
    if (t.payload['needsWorker']) {
      const role = t.payload['role'] as Employee['role'];
      const w = this.freeWorker(role, t.warehouseId!);
      if (!w) {
        t.startAt = this.state.simTime + 5 * MIN;
        t.endAt = t.startAt + (t.payload['durationMs'] ?? MIN);
        this.detectCongestion(t.warehouseId!);
        return false;
      }
      w.busyUntil = t.endAt;
      t.workerId = w.id;
      t.status = 'ACTIVE';
      this.onTaskStart(t);
      return true;
    }
    t.status = 'ACTIVE';
    this.onTaskStart(t);
    return true;
  }

  private detectCongestion(whId: string) {
    const wh = this.warehouse(whId); if (!wh) return;
    const waiting = this.state.tasks.filter(t =>
      t.status === 'QUEUED' && t.warehouseId === whId && t.startAt <= this.state.simTime + 5 * MIN).length;
    if (waiting > wh.capacity.picking + 1 &&
      this.state.simTime - this.state.congestionNotifiedAt > HOUR) {
      this.state.congestionNotifiedAt = this.state.simTime;
      this.addException('CAPACITY_CONGESTION', 'HIGH',
        `ظرفیت عملیاتی مرکز تکمیل شده است (${wh.nameFa}) — ${waiting} وظیفه در صف انتظار.`, {
        ownerFa: 'مدیر عملیات انبار', actionKey: 'ACK',
        stepFa: 'سیستم صف ایجاد کرد؛ افزایش نیرو یا انتقال به مرکز جایگزین پیشنهاد شد.',
      });
      this.notifyCustomer('تأخیر در پردازش سفارش', 'به دلیل ازدحام عملیاتی، پردازش سفارش شما با تأخیر انجام می‌شود.', 'WAREHOUSE');
    }
  }

  private updateCapacity() {
    const now = this.state.simTime;
    for (const wh of this.state.warehouses) {
      const act = (type: TaskType) => this.state.tasks.filter(t => t.status === 'ACTIVE' && t.warehouseId === wh.id && t.type === type).length;
      const waiting = this.state.tasks.filter(t =>
        t.status === 'QUEUED' && t.warehouseId === wh.id && t.startAt <= now + 5 * MIN).length;
      wh.used.picking = act('PICK');
      wh.used.packing = act('PACK') + act('QC');
      wh.used.receiving = act('RECEIVING') + act('PUTAWAY');
      wh.used.dispatch = act('HANDOVER') + act('SORTATION');
      const load = wh.used.picking + wh.used.packing + wh.used.receiving + wh.used.dispatch + waiting;
      const cap = wh.capacity.picking + wh.capacity.packing + wh.capacity.receiving + wh.capacity.dispatch;
      wh.capacityState = load > cap * 0.9 ? 'CONGESTED' : load > cap * 0.6 ? 'BUSY' : 'NORMAL';
    }
  }

  // ------------------------------------------------------------ task start ---
  private onTaskStart(t: SimTask) {
    const order = t.orderId ? this.state.orders.find(o => o.id === t.orderId) : undefined;
    switch (t.type) {
      case 'PICK': {
        if (!order) break;
        this.transition(order, 'PICKING', 'برداشت کالا (Picking) آغاز شد.', t.workerId ?? 'SYSTEM');
        const sh = order.shipments.find(s => s.id === t.shipmentId);
        if (sh) this.setShipmentState(sh, 'PICKING', 'برداشت کالا آغاز شد');
        for (const line of t.payload['lines'] as { sku: string; qty: number; whId: string }[]) {
          this.mutateInv(line.sku, line.whId, { ALLOCATED: -line.qty, PICKING: line.qty }, 'PICK_START',
            `برداشت برای ${order.id}`, t.workerId ?? 'SYSTEM', order.id);
          this.moveSerials(line.sku, line.whId, 'ALLOCATED', 'PICKING', line.qty, order.id);
        }
        const tote = t.toteId ? this.state.totes.find(x => x.id === t.toteId) : undefined;
        if (tote) { tote.state = 'PICKING'; tote.updatedAt = this.state.simTime; }
        break;
      }
      case 'CONSOLIDATION': break;   // order state already CONSOLIDATION via sync
      case 'QC': break;
      case 'PACK': this.transition(order!, 'PACKING', 'بسته‌بندی (Packing) آغاز شد.', t.workerId ?? 'SYSTEM'); break;
      case 'SORTATION': this.transition(order!, 'SORTATION', 'تفکیک مرسولات (Sortation) آغاز شد.', t.workerId ?? 'SYSTEM'); break;
      case 'SELLER_CONFIRM': this.transition(order!, 'SELLER_CONFIRMATION_PENDING', 'درخواست تأیید برای فروشنده ارسال شد.', t.payload['sellerId']); break;
      case 'RETURN_INSPECT': this.transition(order!, 'RETURN_INSPECTION', 'بازرسی کالای مرجوعی آغاز شد.', t.workerId ?? 'SYSTEM'); break;
      default: break;
    }
    this.notify();
  }

  // ---------------------------------------------------------- task complete --
  private completeTask(t: SimTask) {
    if (t.status !== 'ACTIVE') return;
    t.status = 'DONE';
    const worker = t.workerId ? this.state.employees.find(e => e.id === t.workerId) : undefined;
    if (worker) worker.tasksDone++;
    const order = t.orderId ? this.state.orders.find(o => o.id === t.orderId) : undefined;

    switch (t.type) {
      case 'PAYMENT': this.completePayment(t, order!); break;
      case 'ALLOCATION': this.completeAllocation(t, order!); break;
      case 'SELLER_CONFIRM': this.completeSellerConfirm(t, order!); break;
      case 'SELLER_PREPARE': this.completeSellerPrepare(t, order!); break;
      case 'PICK': this.completePick(t, order!); break;
      case 'CONSOLIDATION': this.completeConsolidation(t, order!); break;
      case 'QC': this.completeQc(t, order!); break;
      case 'PACK': this.completePack(t, order!); break;
      case 'SORTATION': this.completeSortation(t, order!); break;
      case 'HANDOVER': this.completeHandover(t, order!); break;
      case 'TRANSIT': this.completeTransit(t, order!); break;
      case 'OUT_FOR_DELIVERY': this.completeOfd(t, order!); break;
      case 'DELIVERY': this.completeDelivery(t, order!); break;
      case 'INBOUND_TRANSIT': this.completeInboundArrival(t); break;
      case 'RECEIVING': this.completeReceiving(t); break;
      case 'PUTAWAY': this.completePutaway(t); break;
      case 'RETURN_PICKUP': this.completeReturnPickup(t); break;
      case 'RETURN_TRANSIT': this.completeReturnTransit(t); break;
      case 'RETURN_RECEIVE': this.completeReturnReceive(t); break;
      case 'RETURN_INSPECT': this.completeReturnInspect(t); break;
      case 'DISPOSITION': this.completeDisposition(t); break;
      case 'REFUND': this.completeRefund(t, order); break;
      case 'TTL_EXPIRY': this.completeTtl(t); break;
      case 'CYCLE_COUNT': this.completeCycleCount(t); break;
      default: break;
    }
    this.notify();
  }

  // -------------------------------------------------------------- payments ---
  private completePayment(t: SimTask, order: Order) {
    const pay = this.state.payments.find(p => p.id === order.paymentId)!;
    const f = this.state.forces;
    let outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT' = 'SUCCESS';
    const forced = t.payload['outcome'] as string;
    if (forced === 'FAIL' || f.paymentFail) outcome = 'FAILED';
    else if (forced === 'TIMEOUT' || f.paymentTimeout) outcome = 'TIMEOUT';
    else if (forced !== 'SUCCESS' && f.randomMode && this.rng() < 0.12) outcome = this.rng() < 0.5 ? 'FAILED' : 'TIMEOUT';
    f.paymentFail = false;
    f.paymentTimeout = false;

    if (outcome === 'SUCCESS') {
      pay.status = 'SUCCESS';
      pay.at = this.state.simTime;
      this.pushEvent('PAYMENT_SUCCESS', { orderId: order.id, detailFa: `پرداخت ${faMoney(pay.amount)} موفق بود.`, actor: 'GATEWAY' });
      this.notifyCustomer('پرداخت موفق', 'پرداخت شما با موفقیت انجام شد.', 'PAYMENT', order.id);
      this.transition(order, 'PAYMENT_SUCCESS', 'پرداخت با موفقیت انجام شد.', 'GATEWAY');
      this.transition(order, 'ORDER_CREATED', 'سفارش در سیستم مدیریت سفارش (OMS) ایجاد شد.');
      this.transition(order, 'ALLOCATION_PENDING', 'در حال تخصیص موجودی (Inventory Allocation)...');
      this.schedule('ALLOCATION', 1 * MIN, {}, { orderId: order.id });
    } else {
      pay.status = outcome === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';
      pay.at = this.state.simTime;
      pay.failureReason = outcome === 'TIMEOUT' ? 'مهلت پرداخت منقضی شد' : 'موجودی حساب یا اتصال درگاه نامعتبر';
      this.pushEvent('PAYMENT_FAILED', { orderId: order.id, detailFa: `پرداخت ${faPaymentStatus[pay.status]}: ${pay.failureReason}`, actor: 'GATEWAY' });
      this.notifyCustomer('پرداخت ناموفق', 'پرداخت ناموفق بود. سفارش شما تکمیل نشد.', 'PAYMENT', order.id);
      this.transition(order, 'PAYMENT_FAILED', `پرداخت ناموفق بود (${pay.failureReason}). سفارش تکمیل نشد.`, 'GATEWAY');
      this.addException('PAYMENT_FAILURE', 'MEDIUM', `پرداخت سفارش ${order.id} ناموفق شد: ${pay.failureReason}`, {
        orderId: order.id, ownerFa: 'پشتیبانی مالی', actionKey: 'ACK',
      });
    }
  }

  // ------------------------------------------------------------ allocation ---
  private completeAllocation(t: SimTask, order: Order) {
    const f = this.state.forces;
    if (f.stockShortage) {
      f.stockShortage = false;
      this.failAllocation(order, 'کسری موجودی هنگام تخصیص (سناریوی اجباری)');
      return;
    }

    const itemWH: Record<number, string> = {};
    let allocOk = true;

    for (let i = 0; i < order.items.length && allocOk; i++) {
      const item = order.items[i];
      const prod = this.product(item.productId)!;
      const seller = this.seller(prod.sellerId)!;
      if (seller.fulfillment === 'SELLER_FULFILLED') {
        itemWH[i] = 'WH-SEL-01';
        if (this.available(item.sku, 'WH-SEL-01') < item.qty) allocOk = false;
      } else if (seller.fulfillment === 'SELLER_FC') {
        const whId = seller.warehouseId ?? 'WH-TEH-01';
        if (this.available(item.sku, whId) < item.qty) allocOk = false;
        else itemWH[i] = whId;
      } else {
        const serving = this.state.warehouses.filter(w =>
          w.id !== 'WH-SEL-01' && w.regions.includes(order.city) && this.available(item.sku, w.id) >= item.qty);
        const anyWh = this.state.warehouses.filter(w =>
          w.id !== 'WH-SEL-01' && this.available(item.sku, w.id) >= item.qty);
        const pool = serving.length ? serving : anyWh;
        if (!pool.length) { allocOk = false; break; }
        pool.sort((a, b) => this.available(item.sku, b.id) - this.available(item.sku, a.id));
        itemWH[i] = pool[0].id;
      }
    }
    if (!allocOk) { this.failAllocation(order, 'موجودی قابل وعده (ATP) برای یک یا چند کالا کافی نیست'); return; }

    // CONSOLIDATE_FIRST: merge all platform items into one warehouse if possible
    if (this.state.splitPolicy === 'CONSOLIDATE_FIRST') {
      const platformIdxs = order.items.map((_, i) => i).filter(i =>
        this.seller(this.product(order.items[i].productId)!.sellerId)!.fulfillment === 'PLATFORM');
      if (platformIdxs.length > 1 && new Set(platformIdxs.map(i => itemWH[i])).size > 1) {
        const candidates = this.state.warehouses.filter(w =>
          w.id !== 'WH-SEL-01' && w.regions.includes(order.city) &&
          platformIdxs.every(i => this.available(order.items[i].sku, w.id) >= order.items[i].qty));
        if (candidates.length) {
          candidates.sort((a, b) =>
            platformIdxs.reduce((s, i) => s + this.available(order.items[i].sku, b.id), 0) -
            platformIdxs.reduce((s, i) => s + this.available(order.items[i].sku, a.id), 0));
          for (const i of platformIdxs) itemWH[i] = candidates[0].id;
        }
      }
    }

    // group items into shipments per warehouse
    const groups = new Map<string, number[]>();
    for (let i = 0; i < order.items.length; i++) {
      const key = itemWH[i];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }

    for (const [whId, idxs] of groups) {
      const firstProd = this.product(order.items[idxs[0]].productId)!;
      const seller = this.seller(firstProd.sellerId)!;
      const wh = this.warehouse(whId)!;
      const sh: Shipment = {
        id: this.nextId('SHP', 'ship', 6), orderId: order.id, warehouseId: whId,
        sellerId: seller.id, fulfillment: seller.fulfillment, state: 'ALLOCATED',
        itemIdx: idxs, pickTaskIds: [], events: [],
        deliveryEta: wh.regions.includes(order.city) ? this.state.simTime + 2 * DAY : this.state.simTime + 3 * DAY,
        interceptable: true,
      };
      sh.events.push({ type: 'ALLOCATED', at: this.state.simTime, locationFa: wh.nameFa, detailFa: 'کالاها به این مرسوله تخصیص یافتند.' });
      order.shipments.push(sh);

      for (const i of idxs) {
        const item = order.items[i];
        if (!this.reserve(item.sku, whId, item.qty, order.id)) { allocOk = false; break; }
        this.mutateInv(item.sku, whId, { RESERVED: -item.qty, ALLOCATED: item.qty }, 'ALLOCATE',
          `تخصیص موجودی برای ${order.id} (مرسوله ${sh.id})`, 'SYSTEM', order.id);
        this.moveSerials(item.sku, whId, 'RESERVED', 'ALLOCATED', item.qty, order.id);
      }
      if (!allocOk) break;

      if (!order.fulfillmentSummary.includes(seller.fulfillment)) order.fulfillmentSummary.push(seller.fulfillment);
      if (!order.sellerIds.includes(seller.id)) order.sellerIds.push(seller.id);
      this.pushEvent('ALLOCATION_DECISION', {
        orderId: order.id, detailFa: `مرسوله ${sh.id} در ${wh.nameFa} تخصیص یافت (${idxs.length} قلم کالا).`,
      });
    }

    if (!allocOk) { this.failAllocation(order, 'ناتوانی در رزرو موجودی پس از تصمیم تخصیص'); return; }

    this.transition(order, 'INVENTORY_RESERVED', 'موجودی کالاها رزرو و تخصیص یافت (ALLOCATED).');
    this.notifyCustomer('موجودی رزرو شد', 'موجودی کالاهای سفارش شما رزرو شد و سفارش در حال آماده‌سازی است.', 'ORDER', order.id);

    for (const sh of order.shipments) {
      const seller = this.seller(sh.sellerId)!;
      if (seller.fulfillment !== 'PLATFORM') {
        const delayMult = this.state.forces.sellerDelay ? 3 : 1;
        this.schedule('SELLER_CONFIRM', Math.max(5, seller.sla.confirmMinutes) * MIN * delayMult,
          { sellerId: seller.id }, { orderId: order.id, shipmentId: sh.id });
        this.setShipmentState(sh, 'SELLER_CONFIRMATION_PENDING', 'در انتظار تأیید فروشنده');
      } else {
        this.createPickTask(order, sh);
      }
    }
  }

  private failAllocation(order: Order, reasonFa: string) {
    this.addException('ALLOCATION_FAILURE', 'HIGH', `تخصیص موجودی برای سفارش ${order.id} ناموفق بود — ${reasonFa}.`, {
      orderId: order.id, ownerFa: 'کارشناس تخصیص موجودی', actionKey: 'CANCEL_ORDER',
      stepFa: 'سیستم موجودی قابل وعده (ATP) را بررسی کرد و کافی نبود.',
    });
    this.transition(order, 'CANCELLATION_REQUESTED', `عدم تخصیص: ${reasonFa} — ورود به فرایند لغو.`);
    this.doCancel(order, reasonFa, true);
  }

  // -------------------------------------------------------- seller confirm ---
  private completeSellerConfirm(t: SimTask, order: Order) {
    const seller = this.seller(t.payload['sellerId'])!;
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh || sh.state !== 'SELLER_CONFIRMATION_PENDING') return;
    const f = this.state.forces;
    let accept = true;
    if (f.sellerReject) { accept = false; f.sellerReject = false; }
    else if (f.randomMode && this.rng() > seller.sla.stockReliability) accept = false;

    this.state.sellerStats.asked++;
    if (accept) {
      this.state.sellerStats.accepted++;
      this.pushEvent('SELLER_CONFIRMED', { orderId: order.id, actor: seller.id, detailFa: `${seller.nameFa} سفارش را تأیید کرد.` });
      this.notifyCustomer('فروشنده سفارش را تأیید کرد', `${seller.nameFa} سفارش شما را تأیید کرد و در حال آماده‌سازی است.`, 'SELLER', order.id);
      this.setShipmentState(sh, 'SELLER_CONFIRMED', 'فروشنده تأیید کرد');
      if (seller.fulfillment === 'SELLER_FULFILLED') {
        this.schedule('SELLER_PREPARE', Math.max(10, seller.sla.prepareMinutes) * MIN,
          { sellerId: seller.id }, { orderId: order.id, shipmentId: sh.id });
      } else {
        this.createPickTask(order, sh);
      }
    } else {
      this.state.sellerStats.rejected++;
      this.setShipmentState(sh, 'SELLER_REJECTED', 'فروشنده قادر به تأمین نیست');
      this.addException('SELLER_REJECT', 'HIGH', `${seller.nameFa} قادر به تأمین سفارش ${order.id} نیست.`, {
        orderId: order.id, ownerFa: 'مدیر فروشندگان', actionKey: 'ACK',
        stepFa: 'موجودی فروشنده آزاد شد و کد تخفیف جبران خسارت صادر گردید.',
      });
      this.pushEvent('SELLER_REJECTED', { orderId: order.id, actor: seller.id, detailFa: 'فروشنده سفارش را رد کرد.' });
      this.releaseShipmentInventory(order, sh, 'رد فروشنده — آزادسازی موجودی');
      if (order.state !== 'SELLER_REJECTED') {
        // aggregate sync may hold order at SELLER_CONFIRMATION_PENDING
        const prev = order.state;
        order.state = 'SELLER_REJECTED';
        order.history.push({ state: 'SELLER_REJECTED', at: this.state.simTime, detailFa: `فروشنده ${seller.nameFa} سفارش را رد کرد.`, actor: seller.id });
        this.pushEvent('ORDER_SELLER_REJECTED', { orderId: order.id, prev, next: 'SELLER_REJECTED', detailFa: 'فروشنده سفارش را رد کرد؛ بازپرداخت آغاز شد.' });
      }
      this.notifyCustomer('سفارش لغو شد', 'فروشنده قادر به تأمین کالا نبود؛ سفارش لغو و مبلغ بازپرداخت می‌شود.', 'SELLER', order.id);
      const cpn: Coupon = {
        id: this.nextId('CPN', 'cpn', 6), code: `COMP-${pad(this.state.counters['cpn'] ?? 6, 4)}`,
        customerId: order.customerId, orderId: order.id, amount: Math.round(order.totalAmount * 0.05),
        reasonFa: 'عذرخواهی بابت رد سفارش توسط فروشنده', issuedAt: this.state.simTime,
        expiresAt: this.state.simTime + 30 * DAY, used: false,
      };
      this.state.coupons.push(cpn);
      this.notifyCustomer('کد تخفیف هدیه', `کد تخفیف ${cpn.code} به پاس عذرخواهی صادر شد.`, 'SELLER', order.id);
      this.issueRefund(order, order.totalAmount, 'بازپرداخت بابت رد سفارش توسط فروشنده');
      this.transition(order, 'REFUND_PENDING', 'در حال بازپرداخت وجه بابت رد سفارش...');
    }
  }

  private completeSellerPrepare(t: SimTask, order: Order) {
    const seller = this.seller(t.payload['sellerId'])!;
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh || sh.state !== 'SELLER_CONFIRMED') return;
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      this.mutateInv(item.sku, sh.warehouseId!, { ALLOCATED: -item.qty, PACKED: item.qty }, 'SELLER_PACK',
        `فروشنده کالا را برداشت و بسته‌بندی کرد (${order.id})`, seller.id, order.id);
      this.moveSerials(item.sku, sh.warehouseId!, 'ALLOCATED', 'PACKED', item.qty, order.id);
      // physical: leave seller bin
      const loc = Object.values(this.state.locations).find(l =>
        l.warehouseId === sh.warehouseId && l.kind === 'STORAGE' && (l.contents[item.sku] ?? 0) > 0);
      if (loc) loc.contents[item.sku] = Math.max(0, loc.contents[item.sku] - item.qty);
    }
    this.setShipmentState(sh, 'PACKED', 'بسته توسط فروشنده آماده شد');
    const pkg = this.createPackage(order, sh, 'DOOR-SELLER');
    pkg.state = 'LABELED';
    pkg.history.push({ state: 'LABELED', at: this.state.simTime });
    this.setShipmentState(sh, 'READY_FOR_DISPATCH', 'بسته فروشنده آماده تحویل به حامل');
    this.notifyCustomer('سفارش در حال آماده‌سازی توسط فروشنده', `${seller.nameFa} بسته شما را آماده کرده است.`, 'SELLER', order.id);
    this.schedule('HANDOVER', 10 * MIN, { carrierId: this.pickCarrier(order).id, pkgId: pkg.id },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId });
  }

  // ---------------------------------------------------------------- picking ---
  private createPickTask(order: Order, sh: Shipment) {
    const whId = sh.warehouseId!;
    const lines: { sku: string; qty: number; whId: string; locId: string }[] = [];
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      const locs = Object.values(this.state.locations).filter(l =>
        l.warehouseId === whId && l.kind === 'STORAGE' && (l.contents[item.sku] ?? 0) > 0);
      let need = item.qty;
      for (const loc of locs) {
        if (need <= 0) break;
        const take = Math.min(need, loc.contents[item.sku] ?? 0);
        lines.push({ sku: item.sku, qty: take, whId, locId: loc.id });
        need -= take;
      }
      if (need > 0) lines.push({ sku: item.sku, qty: need, whId, locId: `${whId}/STAGE-01` });
    }
    const multiLoc = new Set(lines.map(l => l.locId)).size > 1;
    const queuedPicks = this.state.tasks.filter(t =>
      t.type === 'PICK' && (t.status === 'QUEUED' || t.status === 'ACTIVE') && t.warehouseId === whId).length;
    const strategy: SimTask['strategy'] = multiLoc ? 'ZONE' : queuedPicks >= 3 ? 'WAVE' : queuedPicks >= 1 ? 'BATCH' : 'SINGLE';

    const tote: Tote = {
      id: this.nextId('TOTE', 'tote', 6), warehouseId: whId, state: 'EMPTY',
      orderIds: [order.id], shipmentIds: [sh.id], items: [], locationId: `${whId}/STAGE-01`,
      updatedAt: this.state.simTime,
    };
    this.state.totes.push(tote);

    const duration = (8 + lines.length * 2 + (strategy !== 'SINGLE' ? 4 : 0)) * MIN;
    const task = this.schedule('PICK', duration, { lines, strategy, shipmentId: sh.id },
      { orderId: order.id, shipmentId: sh.id, warehouseId: whId, needsWorker: true, role: 'PICKER', toteId: tote.id });
    sh.pickTaskIds.push(task.id);
    this.setShipmentState(sh, 'PICKING_PENDING', `وظیفه برداشت ${task.id} ایجاد شد (استراتژی: ${strategy})`);
    this.pushEvent('PICK_TASK_CREATED', { orderId: order.id, detailFa: `وظیفه ${task.id} با استراتژی ${strategy} ایجاد شد.` });
  }

  private completePick(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    const f = this.state.forces;
    const lines = t.payload['lines'] as { sku: string; qty: number; whId: string; locId: string }[];

    if (f.wrongScan) { f.wrongScan = false; this.failPick(t, order, 'WRONG_SKU', 'کالای اسکن‌شده با سفارش مطابقت ندارد.', 'SCAN_MISMATCH'); return; }
    if (f.wrongLocation) { f.wrongLocation = false; this.failPick(t, order, 'WRONG_LOCATION', 'محل اسکن‌شده با محل تعیین‌شده در وظیفه مطابقت ندارد.', 'LOCATION_MISMATCH'); return; }
    if (f.serialMismatchPick) { f.serialMismatchPick = false; this.failPick(t, order, 'SERIAL_MISMATCH', 'شماره سریال کالای برداشت‌شده با سفارش ناسازگار است — نیازمند بررسی دستی.', 'SERIAL_MISMATCH'); return; }
    if (f.damagedPick) { f.damagedPick = false; this.failPick(t, order, 'DAMAGED', 'کالای برداشت‌شده آسیب فیزیکی دارد و قابل ارسال نیست.', 'DAMAGED'); return; }
    if (f.invMismatch) { f.invMismatch = false; this.failPick(t, order, 'INV_MISMATCH', 'تعداد فیزیکی کالا با موجودی سیستمی مطابقت ندارد.', 'INV_MISMATCH'); return; }

    this.state.pickStats.picks++;
    const tote = t.toteId ? this.state.totes.find(x => x.id === t.toteId) : undefined;

    for (const line of lines) {
      this.mutateInv(line.sku, line.whId, { PICKING: -line.qty, PICKED: line.qty }, 'PICK',
        `برداشت برای ${order.id} از ${line.locId}`, t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(line.sku, line.whId, 'PICKING', 'PICKED', line.qty, order.id, line.locId);
      const loc = this.state.locations[line.locId];
      if (loc && (loc.contents[line.sku] ?? 0) >= line.qty) loc.contents[line.sku] -= line.qty;
      if (tote) tote.items.push({ sku: line.sku, qty: line.qty });
    }
    // record serials on order items for serialized goods
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      const v = this.variantBySku(item.sku)!;
      if (this.product(v.productId)?.serialized) {
        item.serials = this.state.serials
          .filter(s => s.sku === item.sku && s.orderId === order.id && s.state === 'PICKED')
          .map(s => s.serial);
      }
    }
    if (tote) {
      tote.state = tote.items.length >= sh.itemIdx.length ? 'FULL' : 'PARTIALLY_FILLED';
      tote.updatedAt = this.state.simTime;
    }

    this.transition(order, 'PICKED', 'همه کالاهای مرسوله برداشت شدند.', t.workerId ?? 'SYSTEM');
    this.setShipmentState(sh, 'PICKED', 'برداشت کامل شد');
    this.pushEvent('PICK_COMPLETED', { orderId: order.id, detailFa: `برداشت ${taskDesc(lines)} کامل شد.`, actor: t.workerId ?? 'SYSTEM' });
    this.notifyCustomer('کالاهای شما جمع‌آوری شد', 'کالاهای سفارش شما در مرکز پردازش جمع‌آوری شدند.', 'ORDER', order.id);

    if (new Set(lines.map(l => l.locId)).size > 1) {
      if (tote) { tote.state = 'CONSOLIDATION'; tote.updatedAt = this.state.simTime; }
      this.schedule('CONSOLIDATION', 5 * MIN, { lines: lines.length },
        { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId, needsWorker: true, role: 'PACKER', toteId: t.toteId });
      this.setShipmentState(sh, 'CONSOLIDATION', 'در صف تجمیع (چند محل برداشت)');
    } else {
      this.createQcTask(order, sh, t.toteId, false); // direct path: units already PICKED
    }
  }

  private failPick(t: SimTask, order: Order, kind: string, msgFa: string, actionKey: string) {
    this.state.pickStats.errors++;
    const worker = t.workerId ? this.state.employees.find(e => e.id === t.workerId) : undefined;
    if (worker) worker.errors++;
    t.status = 'FAILED';
    t.errorType = kind;
    t.errorDetailFa = msgFa;
    t.blocking = true;
    const exType: ExceptionType =
      kind === 'INV_MISMATCH' ? 'INVENTORY_MISMATCH' : kind === 'SERIAL_MISMATCH' ? 'SERIAL_MISMATCH'
        : kind === 'DAMAGED' ? 'DAMAGED_PRODUCT' : 'PICK_ERROR';
    const sev: Severity = kind === 'SERIAL_MISMATCH' ? 'CRITICAL' : 'HIGH';
    this.addException(exType, sev, msgFa, {
      orderId: order.id, taskId: t.id, sku: (t.payload['lines'] as any[])[0]?.sku,
      ownerFa: 'سرپرست برداشت انبار', actionKey, payload: { taskId: t.id },
      stepFa: 'وظیفه برداشت متوقف شد؛ بازیابی از مرکز استثنا امکان‌پذیر است.',
    });
    this.notifyCustomer('خطا در پردازش سفارش', 'مشکلی در آماده‌سازی سفارش شما پیش آمد؛ تیم عملیات در حال رسیدگی است.', 'EXCEPTION', order.id);
    this.notify();
  }

  /** ops action: recover a failed pick task (retry) */
  recoverPick(taskId: string) {
    const t = this.state.tasks.find(x => x.id === taskId);
    if (!t || !t.orderId) return;
    const order = this.state.orders.find(o => o.id === t.orderId)!;
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    t.status = 'CANCELLED';
    for (const line of t.payload['lines'] as any[]) {
      const counts = this.state.inv[line.sku]?.[line.whId];
      if (counts && counts.PICKING > 0) {
        const q = Math.min(counts.PICKING, line.qty);
        this.mutateInv(line.sku, line.whId, { PICKING: -q, ALLOCATED: q }, 'PICK_RETRY',
          'بازگشت به ALLOCATED برای تلاش مجدد برداشت', 'OPS', order.id);
      }
    }
    const tote = this.state.totes.find(x => x.id === t.toteId);
    if (tote) { tote.state = 'EMPTY'; tote.items = []; tote.updatedAt = this.state.simTime; }
    const nt = this.schedule('PICK', t.payload['durationMs'] ?? 10 * MIN,
      { lines: t.payload['lines'], strategy: t.payload['strategy'], shipmentId: sh.id },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId, needsWorker: true, role: 'PICKER', toteId: t.toteId });
    sh.pickTaskIds.push(nt.id);
    this.pushEvent('PICK_RECOVERED', { orderId: order.id, detailFa: `تلاش مجدد برداشت ${nt.id} برنامه‌ریزی شد.`, actor: 'OPS' });
    this.notify();
  }

  // ---------------------------------------------------------- consolidation --
  private completeConsolidation(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      this.mutateInv(item.sku, sh.warehouseId!, { PICKED: -item.qty, CONSOLIDATED: item.qty }, 'CONSOLIDATE',
        `تجمیع سفارش ${order.id}`, t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(item.sku, sh.warehouseId!, 'PICKED', 'CONSOLIDATED', item.qty, order.id);
    }
    const tote = t.toteId ? this.state.totes.find(x => x.id === t.toteId) : undefined;
    if (tote) { tote.state = 'COMPLETED'; tote.updatedAt = this.state.simTime; }
    this.pushEvent('CONSOLIDATION_DONE', { orderId: order.id, detailFa: 'تجمیع کالاهای چند محل کامل شد.' });
    this.setShipmentState(sh, 'QC_PENDING', 'تجمیع کامل — در صف QC');
    this.createQcTask(order, sh, t.toteId);
  }

  // -------------------------------------------------------------------- QC ---
  private createQcTask(order: Order, sh: Shipment, toteId?: string, consolidated = true) {
    this.schedule('QC', 5 * MIN, { checks: 4, consolidated },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId, needsWorker: true, role: 'QC_OPERATOR', toteId });
    this.setShipmentState(sh, 'QC_PENDING', 'کنترل کیفیت در صف');
  }

  private completeQc(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    const consolidated = t.payload['consolidated'] === true;
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      if (consolidated) {
        this.mutateInv(item.sku, sh.warehouseId!, { CONSOLIDATED: -item.qty, PICKED: item.qty }, 'QC_PASS',
          `کنترل کیفیت سفارش ${order.id} موفق`, t.workerId ?? 'SYSTEM', order.id);
        this.moveSerials(item.sku, sh.warehouseId!, 'CONSOLIDATED', 'PICKED', item.qty, order.id);
      } else {
        // direct path: units never left PICKED — record a zero-delta snapshot for audit only
        this.mutateInv(item.sku, sh.warehouseId!, { PICKED: 0 }, 'QC_PASS',
          `کنترل کیفیت سفارش ${order.id} موفق (تک‌محل، بدون تجمیع)`, t.workerId ?? 'SYSTEM', order.id);
      }
    }
    this.pushEvent('QC_PASSED', { orderId: order.id, detailFa: 'کنترل کیفیت با موفقیت انجام شد.', actor: t.workerId ?? 'SYSTEM' });
    this.setShipmentState(sh, 'PACKING', 'QC موفق — در صف بسته‌بندی');
    this.schedule('PACK', 6 * MIN, {}, { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId, needsWorker: true, role: 'PACKER' });
  }

  // ---------------------------------------------------------------- packing --
  private completePack(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    this.state.pickStats.packs++;
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      this.mutateInv(item.sku, sh.warehouseId!, { PICKED: -item.qty, PACKED: item.qty }, 'PACK',
        `بسته‌بندی سفارش ${order.id}`, t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(item.sku, sh.warehouseId!, 'PICKED', 'PACKED', item.qty, order.id);
    }
    const pkg = this.createPackage(order, sh, t.workerId ?? 'PK-07');
    this.transition(order, 'PACKED', `بسته‌بندی کامل شد (بسته ${pkg.id}).`, t.workerId ?? 'SYSTEM');
    this.setShipmentState(sh, 'PACKED', `بسته‌بندی شد (${pkg.id})`);
    this.notifyCustomer('سفارش شما بسته‌بندی شد', 'کالاهای سفارش شما بسته‌بندی و برچسب‌گذاری شدند.', 'ORDER', order.id);
    this.schedule('SORTATION', 4 * MIN, { pkgId: pkg.id },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId, needsWorker: true, role: 'DISPATCH_OPERATOR' });
  }

  private createPackage(order: Order, sh: Shipment, stationId: string): PackageRec {
    const items = sh.itemIdx.map(i => order.items[i]);
    const totalW = items.reduce((s, it) => {
      const p = this.product(this.variantBySku(it.sku)!.productId)!;
      return s + p.baseWeightKg * it.qty;
    }, 0);
    const hasFragile = items.some(it => this.product(this.variantBySku(it.sku)!.productId)!.fragile);
    const hasBig = items.some(it => ['LAPTOP', 'CONSOLE'].includes(this.product(this.variantBySku(it.sku)!.productId)!.category));
    const packageType = hasBig ? 'LARGE' : items.length > 1 || items.some(i => i.qty > 1) ? 'MEDIUM' : 'SMALL';
    const carrier = this.pickCarrier(order);
    const pkg: PackageRec = {
      id: this.nextIdDated('PKG', 'pkg', 6), orderId: order.id, shipmentId: sh.id,
      warehouseId: sh.warehouseId ?? 'WH-SEL-01', stationId,
      packageType: hasFragile ? `${packageType}+FRAGILE` : packageType,
      weightKg: Math.round((totalW + 0.3) * 100) / 100,
      dims: packageType === 'SMALL' ? '۲۰×۱۵×۸' : packageType === 'MEDIUM' ? '۳۵×۲۵×۱۵' : '۵۰×۴۰×۳۰',
      carrierId: carrier.id, serviceLevelFa: order.city === 'تهران' ? 'ارسال سریع شهری' : 'ارسال استاندارد سراسری',
      destinationFa: `${order.city} — ${order.addressFa.slice(0, 35)}...`,
      labelCode: String(8900000000000 + this.state.counters['pkg']),
      state: 'PACKED', history: [{ state: 'PACKED', at: this.state.simTime }],
    };
    this.state.packages.push(pkg);
    this.pushEvent('PACKAGE_CREATED', { orderId: order.id, detailFa: `بسته ${pkg.id} ساخته شد (${pkg.packageType}، ${pkg.weightKg} کیلوگرم).` });
    return pkg;
  }

  private pickCarrier(order: Order): Carrier {
    const local = order.city === 'تهران' || order.city === 'کرج';
    return this.state.carriers.find(c => (local ? c.type === 'LOCAL' : c.type === 'NATIONAL')) ?? this.state.carriers[0];
  }

  // -------------------------------------------------------------- sortation --
  private completeSortation(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    const pkg = this.state.packages.find(p => p.id === t.payload['pkgId']);
    if (!pkg) return;
    const wh = this.warehouse(sh.warehouseId ?? 'WH-SEL-01')!;
    const carrier = this.state.carriers.find(c => c.id === pkg.carrierId)!;
    const lane = `${wh.id} ← ${order.city} ← ${carrier.id} ← ${pkg.serviceLevelFa.includes('سریع') ? 'EXPRESS' : 'STANDARD'}`;
    sh.lane = lane;
    pkg.state = 'SORTED';
    pkg.history.push({ state: 'SORTED', at: this.state.simTime });
    sh.events.push({ type: 'SORTATION_DECISION', at: this.state.simTime, locationFa: wh.nameFa, detailFa: `مسیر تفکیک: ${lane}` });
    this.pushEvent('SORTATION_DECISION', { orderId: order.id, detailFa: `تصمیم تفکیک: ${lane}` });
    // inventory PACKED → READY_FOR_DISPATCH
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      this.mutateInv(item.sku, sh.warehouseId!, { PACKED: -item.qty, READY_FOR_DISPATCH: item.qty }, 'STAGE_DISPATCH',
        `قرارگیری در لاین ارسال (${sh.id})`, t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(item.sku, sh.warehouseId!, 'PACKED', 'READY_FOR_DISPATCH', item.qty, order.id);
    }
    sh.staged = true;
    this.transition(order, 'READY_FOR_DISPATCH', 'بسته تفکیک شد و آماده ارسال است.', t.workerId ?? 'SYSTEM');
    this.setShipmentState(sh, 'READY_FOR_DISPATCH', 'آماده ارسال');
    this.addToManifest(order, sh, pkg, carrier);
    this.schedule('HANDOVER', 10 * MIN, { carrierId: carrier.id, pkgId: pkg.id },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId });
  }

  private addToManifest(order: Order, sh: Shipment, pkg: PackageRec, carrier: Carrier) {
    const whId = sh.warehouseId ?? 'WH-SEL-01';
    let m = this.state.manifests.find(x => x.status === 'READY' && x.carrierId === carrier.id &&
      x.warehouseId === whId && x.destinationFa === order.city);
    if (!m) {
      m = {
        id: this.nextIdDated('MAN', 'man', 4), carrierId: carrier.id, warehouseId: whId,
        destinationFa: order.city, packageIds: [], status: 'READY', createdAt: this.state.simTime,
      };
      this.state.manifests.push(m);
    }
    m.packageIds.push(pkg.id);
    sh.manifestId = m.id;
  }

  // -------------------------------------------------------------- handover ---
  private completeHandover(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    const pkg = this.state.packages.find(p => p.id === t.payload['pkgId']);
    if (!pkg) return;
    const manifest = this.state.manifests.find(m => m.id === sh.manifestId);
    const carrier = this.state.carriers.find(c => c.id === t.payload['carrierId'])!;
    // stage exactly once (seller path stages here; platform already staged at sortation)
    if (!sh.staged) {
      for (const i of sh.itemIdx) {
        const item = order.items[i];
        const c = this.state.inv[item.sku]?.[sh.warehouseId!];
        if (c && c.PACKED > 0) {
          this.mutateInv(item.sku, sh.warehouseId!, { PACKED: -item.qty, READY_FOR_DISPATCH: item.qty }, 'STAGE_DISPATCH',
            `قرارگیری در لاین ارسال (${sh.id})`, 'SYSTEM', order.id);
          this.moveSerials(item.sku, sh.warehouseId!, 'PACKED', 'READY_FOR_DISPATCH', item.qty, order.id);
        }
      }
      sh.staged = true;
    }
    pkg.state = 'LOADED';
    pkg.history.push({ state: 'LOADED', at: this.state.simTime });
    if (manifest && manifest.status === 'READY') {
      manifest.status = 'HANDOVER';
      manifest.handoverAt = this.state.simTime;
    }
    this.state.counters['track'] = (this.state.counters['track'] ?? 0) + 1;
    sh.trackingId = `TRK-${ymd(this.state.simTime)}-${pad(this.state.counters['track'], 6)}`;
    sh.interceptable = false;
    const whName = this.warehouse(sh.warehouseId ?? '')?.nameFa ?? '';
    sh.events.push({ type: 'CARRIER_ACCEPTED', at: this.state.simTime, locationFa: whName, detailFa: `${carrier.nameFa} بسته را تحویل گرفت. شماره رهگیری ${sh.trackingId}` });
    this.transition(order, 'DISPATCHED', 'بسته به شرکت حمل تحویل داده شد.', 'CARRIER');
    this.setShipmentState(sh, 'DISPATCHED', 'تحویل حامل');
    this.state.deliveryStats.dispatched++;
    if (manifest && manifest.status === 'HANDOVER' && manifest.packageIds.every(id => {
      const p = this.state.packages.find(x => x.id === id);
      return p && ['LOADED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED'].includes(p.state);
    })) manifest.status = 'DEPARTED';
    this.notifyCustomer('بسته شما تحویل شرکت حمل شد', `بسته ${pkg.id} به ${carrier.nameFa} تحویل شد. شماره رهگیری: ${sh.trackingId}`, 'ORDER', order.id);
    this.schedule('TRANSIT', carrier.type === 'LOCAL' ? 90 * MIN : 4 * HOUR, { pkgId: pkg.id },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId, startDelayMs: 5 * MIN });
  }

  private completeTransit(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    const pkg = this.state.packages.find(p => p.id === t.payload['pkgId']);
    if (!pkg) return;
    pkg.state = 'IN_TRANSIT';
    pkg.history.push({ state: 'IN_TRANSIT', at: this.state.simTime });
    for (const item of sh.itemIdx.map(i => order.items[i])) {
      this.mutateInv(item.sku, sh.warehouseId!, { READY_FOR_DISPATCH: -item.qty, DISPATCHED: item.qty }, 'DISPATCH',
        `حرکت مرسوله ${sh.id}`, 'CARRIER', order.id);
      this.moveSerials(item.sku, sh.warehouseId!, 'READY_FOR_DISPATCH', 'DISPATCHED', item.qty, order.id);
    }
    sh.events.push({ type: 'IN_TRANSIT', at: this.state.simTime, locationFa: 'مرکز توزیع', detailFa: 'مرسوله در مسیر ارسال است.' });
    this.transition(order, 'IN_TRANSIT', 'مرسوله در مسیر ارسال است.', 'CARRIER');
    this.setShipmentState(sh, 'IN_TRANSIT', 'در مسیر ارسال');
    this.notifyCustomer('بسته شما در مسیر ارسال است', `مرسوله ${sh.trackingId} در مسیر ${order.city} است.`, 'ORDER', order.id);
    const wh = this.warehouse(sh.warehouseId ?? '');
    const near = wh && (wh.city === order.city || wh.regions.includes(order.city));
    this.schedule('OUT_FOR_DELIVERY', 30 * MIN, { pkgId: t.payload['pkgId'] },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId, startDelayMs: near ? 3 * HOUR : 8 * HOUR });
  }

  private completeOfd(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    const pkg = this.state.packages.find(p => p.id === t.payload['pkgId']);
    if (!pkg) return;
    pkg.state = 'OUT_FOR_DELIVERY';
    pkg.history.push({ state: 'OUT_FOR_DELIVERY', at: this.state.simTime });
    sh.events.push({ type: 'OUT_FOR_DELIVERY', at: this.state.simTime, locationFa: `مرکز توزیع ${order.city}`, detailFa: 'پیک در مسیر تحویل است.' });
    this.transition(order, 'OUT_FOR_DELIVERY', 'مرسوله برای تحویل به مشتری خارج شد.', 'CARRIER');
    this.setShipmentState(sh, 'OUT_FOR_DELIVERY', 'در حال تحویل');
    this.notifyCustomer('بسته شما در حال تحویل است', 'پیک در مسیر تحویل سفارش شماست.', 'ORDER', order.id);
    this.schedule('DELIVERY', 45 * MIN, { pkgId: t.payload['pkgId'] },
      { orderId: order.id, shipmentId: sh.id, warehouseId: sh.warehouseId });
  }

  private completeDelivery(t: SimTask, order: Order) {
    const sh = order.shipments.find(s => s.id === t.shipmentId);
    if (!sh) return;
    const pkg = this.state.packages.find(p => p.id === t.payload['pkgId']);
    if (!pkg) return;
    pkg.state = 'DELIVERED';
    pkg.history.push({ state: 'DELIVERED', at: this.state.simTime });
    const otp = pad(Math.floor(this.rng() * 90000) + 10000, 5);
    const pod = `تحویل به ${order.customerNameFa} — کد تأیید ${otp} — یادداشت: «تحویل به همسایه طبقه دوم داده شد» (شبیه‌سازی‌شده)`;
    sh.events.push({ type: 'DELIVERED', at: this.state.simTime, locationFa: order.city, detailFa: pod });
    for (const item of sh.itemIdx.map(i => order.items[i])) {
      this.mutateInv(item.sku, sh.warehouseId!, { DISPATCHED: -item.qty, DELIVERED: item.qty }, 'DELIVER',
        `تحویل مرسوله ${sh.id}`, 'CARRIER', order.id);
      this.moveSerials(item.sku, sh.warehouseId!, 'DISPATCHED', 'DELIVERED', item.qty, order.id);
    }
    this.state.deliveryStats.delivered++;
    if (this.state.simTime <= order.expectedDelivery) this.state.deliveryStats.onTime++;
    this.state.deliveryStats.totalMinutes += (this.state.simTime - order.createdAt) / MIN;
    this.setShipmentState(sh, 'DELIVERED', 'تحویل موفق');
    pkg.state = 'CLOSED';
    pkg.history.push({ state: 'CLOSED', at: this.state.simTime });
    this.notifyCustomer('تحویل موفق', `مرسوله ${sh.id} تحویل داده شد. ${pod}`, 'ORDER', order.id);
    this.syncOrderFromShipments(order.id);
  }

  // ------------------------------------------------------------ cancellation -
  evaluateCancellation(order: Order): { allowed: boolean; reasonFa: string; stageFa: string } {
    if (order.state === 'PAYMENT_FAILED') return { allowed: false, reasonFa: 'پرداخت ناموفق بود؛ سفارشی برای لغو وجود ندارد.', stageFa: 'پرداخت' };
    if (order.state === 'CANCELLED') return { allowed: false, reasonFa: 'سفارش قبلاً لغو شده است.', stageFa: 'پایان‌یافته' };
    if (order.state === 'DELIVERED') return { allowed: false, reasonFa: 'سفارش تحویل شده است؛ از «درخواست مرجوعی» استفاده کنید.', stageFa: 'تحویل شده' };
    if (order.state === 'SELLER_REJECTED') return { allowed: false, reasonFa: 'سفارش توسط فروشنده رد شد و بازپرداخت در جریان است.', stageFa: 'رد فروشنده' };
    if (['RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_IN_TRANSIT', 'RETURN_RECEIVED', 'RETURN_INSPECTION',
      'REFUND_PENDING', 'REFUNDED', 'RESTOCK_PENDING', 'RESTOCKED', 'QUARANTINED', 'DAMAGED'].includes(order.state))
      return { allowed: false, reasonFa: 'سفارش وارد فرایند مرجوعی/بازپرداخت شده است.', stageFa: 'مرجوعی' };
    const anyHanded = order.shipments.some(s => ['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(s.state));
    if (anyHanded) {
      return {
        allowed: false, stageFa: 'تحویل حامل',
        reasonFa: 'امکان لغو عادی سفارش به پایان رسیده است. پس از تحویل می‌توانید درخواست مرجوعی ثبت کنید.',
      };
    }
    const anyPreparing = order.shipments.some(s =>
      ['PICKING', 'PICKED', 'CONSOLIDATION', 'QC_PENDING', 'PACKING', 'PACKED', 'SORTATION', 'READY_FOR_DISPATCH'].includes(s.state));
    if (anyPreparing) {
      return {
        allowed: true, stageFa: 'در حال آماده‌سازی در انبار',
        reasonFa: 'سفارش در حال آماده‌سازی است؛ لغو انجام می‌شود و بسته در صورت وجود رهگیری (intercept) خواهد شد.',
      };
    }
    if (order.state === 'PAYMENT_PENDING') return { allowed: true, stageFa: 'پرداخت', reasonFa: 'پرداخت هنوز انجام نشده؛ سفارش لغو و پرداخت متوقف می‌شود.' };
    return { allowed: true, stageFa: 'پیش از برداشت', reasonFa: 'سفارش هنوز وارد انبار نشده؛ لغو کامل با بازپرداخت وجه امکان‌پذیر است.' };
  }

  requestCancellation(orderId: string, reasonFa: string): { ok: boolean; messageFa: string } {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order) return { ok: false, messageFa: 'سفارش یافت نشد.' };
    const verdict = this.evaluateCancellation(order);
    this.state.cancelStats.requested++;
    order.cancel = {
      requestedAt: this.state.simTime, reasonFa, allowed: verdict.allowed,
      blockedReasonFa: verdict.allowed ? undefined : verdict.reasonFa,
    };
    if (!verdict.allowed) {
      this.pushEvent('CANCELLATION_BLOCKED', { orderId: order.id, detailFa: verdict.reasonFa, actor: 'CUSTOMER' });
      this.notifyCustomer('امکان لغو سفارش نیست', verdict.reasonFa, 'ORDER', order.id);
      this.notify();
      return { ok: false, messageFa: verdict.reasonFa };
    }
    this.state.cancelStats.allowed++;
    this.transition(order, 'CANCELLATION_REQUESTED', `درخواست لغو ثبت شد (${reasonFa}).`, 'CUSTOMER');
    this.pushEvent('CANCELLATION_ALLOWED', { orderId: order.id, detailFa: `لغو مجاز — مرحله: ${verdict.stageFa}`, actor: 'OPS' });
    this.doCancel(order, reasonFa, this.state.payments.find(p => p.id === order.paymentId)?.status === 'SUCCESS');
    this.notify();
    return { ok: true, messageFa: 'درخواست لغو پذیرفته شد؛ سفارش در حال لغو است.' };
  }

  private doCancel(order: Order, reasonFa: string, refundNeeded: boolean) {
    // cancel outstanding tasks
    for (const t of this.state.tasks.filter(t => t.orderId === order.id && (t.status === 'QUEUED' || t.status === 'ACTIVE'))) {
      t.status = 'CANCELLED';
      if (t.workerId) {
        const w = this.state.employees.find(e => e.id === t.workerId);
        if (w && w.busyUntil > this.state.simTime) w.busyUntil = this.state.simTime;
      }
      if (t.type === 'PICK') {
        for (const line of (t.payload['lines'] as any[])) {
          const counts = this.state.inv[line.sku]?.[line.whId];
          if (counts && counts.PICKING > 0) {
            const q = Math.min(counts.PICKING, line.qty);
            this.mutateInv(line.sku, line.whId, { PICKING: -q, ALLOCATED: q }, 'CANCEL_UNPICK',
              `لغو سفارش ${order.id} — بازگشت به تخصیص`, 'SYSTEM', order.id);
          }
        }
      }
    }
    for (const sh of order.shipments) {
      if (sh.state === 'CANCELLED' || sh.state === 'INTERCEPTED' || sh.state === 'DELIVERED') continue;
      if (['PACKED', 'SORTATION', 'READY_FOR_DISPATCH'].includes(sh.state)) {
        const pkg = this.state.packages.find(p => p.shipmentId === sh.id);
        if (pkg) { pkg.state = 'INTERCEPTED'; pkg.history.push({ state: 'INTERCEPTED', at: this.state.simTime }); }
        sh.state = 'INTERCEPTED';
        const whName = this.warehouse(sh.warehouseId ?? '')?.nameFa ?? '';
        sh.events.push({ type: 'INTERCEPTED', at: this.state.simTime, locationFa: whName, detailFa: 'بسته پیش از خروج رهگیری و متوقف شد.' });
        this.pushEvent('PACKAGE_INTERCEPTED', { orderId: order.id, detailFa: `بسته ${pkg?.id ?? sh.id} رهگیری شد.` });
      } else {
        sh.state = 'CANCELLED';
        sh.events.push({ type: 'CANCELLED', at: this.state.simTime, locationFa: '', detailFa: 'مرسوله لغو شد.' });
      }
      this.releaseShipmentInventory(order, sh, `لغو سفارش — ${reasonFa}`);
    }
    for (const res of this.state.reservations.filter(r => r.orderId === order.id && !r.released)) {
      this.releaseReservation(res, `لغو سفارش ${order.id}`);
    }
    this.notifyCustomer('سفارش لغو شد', `سفارش ${order.id} لغو شد. ${reasonFa}`, 'ORDER', order.id);
    const pay = this.state.payments.find(p => p.id === order.paymentId);
    if (refundNeeded && pay?.status === 'SUCCESS') {
      this.issueRefund(order, pay.amount, `بازپرداخت بابت لغو سفارش: ${reasonFa}`);
      this.transition(order, 'REFUND_PENDING', 'در حال بازپرداخت وجه بابت لغو سفارش...');
    } else {
      if (pay && pay.status === 'PENDING') pay.status = 'CANCELLED';
      this.transition(order, 'CANCELLED', `سفارش نهایی لغو شد: ${reasonFa}`);
    }
  }

  private releaseShipmentInventory(order: Order, sh: Shipment, reason: string) {
    if (sh.state === 'DELIVERED' || !sh.warehouseId) return;
    const whId = sh.warehouseId;
    const returnBin = Object.values(this.state.locations).find(l =>
      l.warehouseId === whId && l.kind === 'STORAGE' && l.zone !== 'Z-D');
    for (const i of sh.itemIdx) {
      const item = order.items[i];
      const counts = this.state.inv[item.sku]?.[whId];
      if (!counts) continue;
      let left = item.qty;
      for (const st of ['READY_FOR_DISPATCH', 'PACKED', 'CONSOLIDATED', 'PICKED', 'PICKING', 'ALLOCATED'] as InvState[]) {
        const q = Math.min(counts[st] ?? 0, left);
        if (q > 0) {
          this.mutateInv(item.sku, whId, { [st]: -q, AVAILABLE: q } as Partial<InvCounts>, 'CANCEL_RELEASE',
            reason, 'SYSTEM', order.id);
          if (returnBin) returnBin.contents[item.sku] = (returnBin.contents[item.sku] ?? 0) + q;
          left -= q;
        }
      }
      const prod = this.product(item.productId);
      if (prod?.serialized) {
        for (const s of this.state.serials.filter(s => s.sku === item.sku && s.warehouseId === whId && s.orderId === order.id && s.state !== 'AVAILABLE')) {
          s.state = 'AVAILABLE'; s.orderId = undefined;
          if (returnBin) s.locationId = returnBin.id;
        }
      }
    }
  }

  // ---------------------------------------------------------------- refunds --
  issueRefund(order: Order, amount: number, reasonFa: string): Refund {
    const pay = this.state.payments.find(p => p.id === order.paymentId)!;
    const r: Refund = {
      id: this.nextId('RFD', 'rfd', 6), paymentId: pay.id, orderId: order.id, amount,
      reason: reasonFa, status: 'REFUND_PENDING', at: this.state.simTime,
    };
    this.state.refunds.push(r);
    this.pushEvent('REFUND_CREATED', { orderId: order.id, detailFa: `${r.id}: ${faMoney(amount)} — ${reasonFa}` });
    this.schedule('REFUND', 3 * MIN, { refundId: r.id }, { orderId: order.id });
    this.notify();
    return r;
  }

  private completeRefund(t: SimTask, order: Order | undefined) {
    const r = this.state.refunds.find(x => x.id === t.payload['refundId']);
    if (!r) return;
    const f = this.state.forces;
    if (f.refundFail) {
      f.refundFail = false;
      r.status = 'REFUND_FAILED';
      r.at = this.state.simTime;
      this.addException('REFUND_FAILURE', 'HIGH', `بازپرداخت ${r.id} ناموفق بود — نیاز به تلاش مجدد.`, {
        orderId: r.orderId, ownerFa: 'پشتیبانی مالی', actionKey: 'RETRY_REFUND', payload: { refundId: r.id },
        stepFa: 'درگاه بازپرداخت خطا داد؛ تلاش مجدد دستی لازم است.',
      });
      this.notifyCustomer('خطا در بازپرداخت', 'بازپرداخت وجه با خطا مواجه شد؛ پشتیبانی در حال رسیدگی است.', 'PAYMENT', r.orderId);
      return;
    }
    r.status = 'REFUNDED';
    r.resolvedAt = this.state.simTime;
    this.pushEvent('REFUND_COMPLETED', { orderId: r.orderId, detailFa: `${r.id} به مبلغ ${faMoney(r.amount)} بازپرداخت شد.`, actor: 'GATEWAY' });
    this.notifyCustomer('بازپرداخت انجام شد', `مبلغ ${faMoney(r.amount)} به حساب شما بازپرداخت شد.`, 'PAYMENT', r.orderId);
    if (order) {
      if (order.state === 'REFUND_PENDING') {
        this.transition(order, 'REFUNDED', 'بازپرداخت وجه کامل شد.', 'GATEWAY');
        const isCancelFlow = !order.returnId;
        if (isCancelFlow) {
          this.transition(order, 'CANCELLED', 'سفارش نهایی لغو شد و مبلغ بازپرداخت گردید.');
        }
      }
    }
  }

  retryRefund(refundId: string) {
    const r = this.state.refunds.find(x => x.id === refundId);
    if (!r) return;
    r.status = 'REFUND_PROCESSING';
    this.schedule('REFUND', 2 * MIN, { refundId: r.id }, { orderId: r.orderId });
    const ex = this.state.exceptions.find(e => e.actionKey === 'RETRY_REFUND' && e.payload?.refundId === refundId && e.status !== 'RESOLVED');
    if (ex) this.resolveException(ex.id, 'تلاش مجدد بازپرداخت در صف قرار گرفت.');
    this.notify();
  }

  // -------------------------------------------------------------------- TTL --
  private completeTtl(t: SimTask) {
    const res = this.state.reservations.find(r => r.id === t.payload['reservationId']);
    if (!res || res.released) return;
    const order = this.state.orders.find(o => o.id === res.orderId);
    if (!order) return;
    const earlyStates: OrderState[] = ['PAYMENT_PENDING', 'ALLOCATION_PENDING', 'INVENTORY_RESERVED', 'SELLER_CONFIRMATION_PENDING'];
    if (earlyStates.includes(order.state)) {
      this.releaseReservation(res, `انقضای مهلت رزرو (${order.id})`);
      this.addException('INVENTORY_MISMATCH', 'MEDIUM', `رزرو موجودی سفارش ${order.id} منقضی شد و آزاد شد.`, {
        orderId: order.id, ownerFa: 'کارشناس تخصیص موجودی', actionKey: 'ACK',
      });
      if (order.state !== 'PAYMENT_PENDING') {
        this.transition(order, 'CANCELLATION_REQUESTED', 'مهلت رزرو منقضی شد؛ سفارش لغو می‌شود.');
        this.doCancel(order, 'انقضای مهلت رزرو موجودی', true);
      }
    }
  }

  // ----------------------------------------------------------- inbound flow --
  createInbound(o: {
    supplierFa: string; warehouseId: string; sku: string; qty: number;
    sellerId?: string; exceptionKind?: InboundShipment['exceptionKind'];
  }): InboundShipment {
    const inb: InboundShipment = {
      id: this.nextIdDated('INB', 'inb', 4), supplierFa: o.supplierFa, sellerId: o.sellerId,
      warehouseId: o.warehouseId, appointmentAt: this.state.simTime + 2 * HOUR,
      state: 'EXPECTED', lines: [{ sku: o.sku, expectedQty: o.qty }],
      exceptionKind: o.exceptionKind ?? this.state.forces.inboundException ?? 'NONE',
      dockLocationId: `${o.warehouseId}/DOCK-IN`, createdAt: this.state.simTime,
    };
    this.state.forces.inboundException = 'NONE';
    this.state.inbound.push(inb);
    this.pushEvent('INBOUND_CREATED', { sku: o.sku, detailFa: `محموله ورودی ${inb.id} از ${o.supplierFa} ثبت شد.` });
    this.notifyOps('محموله ورودی ثبت شد', `${inb.id} — ${o.qty} عدد ${o.sku} — انتظار ورود در ${faDateTime(inb.appointmentAt)}`, 'WAREHOUSE');
    this.schedule('INBOUND_TRANSIT', 30 * MIN, { inbId: inb.id }, { warehouseId: o.warehouseId, startDelayMs: 10 * MIN });
    this.notify();
    return inb;
  }

  private completeInboundArrival(t: SimTask) {
    const inb = this.state.inbound.find(x => x.id === t.payload['inbId']);
    if (!inb) return;
    inb.state = 'ARRIVED';
    inb.gateAt = this.state.simTime;
    this.pushEvent('GATE_IN', { sku: inb.lines[0].sku, detailFa: `محموله ${inb.id} به گیت ورود رسید.` });
    this.notifyOps('ورود محموله به گیت', `${inb.id} وارد گیت دریافت شد.`, 'WAREHOUSE');
    this.schedule('RECEIVING', 20 * MIN, { inbId: inb.id }, { warehouseId: inb.warehouseId, needsWorker: true, role: 'RECEIVING_OPERATOR' });
    this.notify();
  }

  private completeReceiving(t: SimTask) {
    const inb = this.state.inbound.find(x => x.id === t.payload['inbId']);
    if (!inb) return;
    const line = inb.lines[0];
    const sku = line.sku;
    const prod = this.state.products.find(p => p.variants.some(v => v.sku === sku));
    const ex = inb.exceptionKind;

    if (ex !== 'NONE') {
      inb.state = 'EXCEPTION';
      const detailMap: Record<string, string> = {
        SHORTAGE: `کسری تعداد: ${line.expectedQty} درخواست شده، ${Math.max(0, line.expectedQty - 3)} دریافت شد.`,
        WRONG_SKU: 'کالای دریافتی با SKU سفارش خرید مطابقت ندارد.',
        DAMAGED_PACKAGING: 'بسته‌بندی کالا آسیب دیده است.',
        BARCODE_UNREADABLE: 'بارکد کالا غیرقابل خواندن است.',
        SERIAL_MISMATCH: 'شماره سریال دریافتی با مدارک مطابقت ندارد.',
        COUNTERFEIT_SUSPECT: 'کالا مشکوک به تقلب است — توقیف شد.',
        DOC_ISSUE: 'مدارک فروشنده ناقص است.',
      };
      inb.exceptionDetailFa = detailMap[ex] ?? 'خطای دریافت کالا.';
      const receivedQty = ex === 'SHORTAGE' ? Math.max(0, line.expectedQty - 3) : line.expectedQty;
      line.receivedQty = receivedQty;
      if (receivedQty > 0) {
        this.mutateInv(sku, inb.warehouseId, { RECEIVED: receivedQty }, 'RECEIVE_HELD',
          `دریافت با خطا (${inb.id}) — موجودی در انتظار بررسی`, t.workerId ?? 'SYSTEM');
      }
      this.addException('RECEIVING_EXCEPTION', ex === 'COUNTERFEIT_SUSPECT' ? 'CRITICAL' : 'HIGH',
        `خطای دریافت کالا (${inb.id}): ${inb.exceptionDetailFa}`, {
        sku, ownerFa: 'سرپرست دریافت کالا', actionKey: 'RESOLVE_INBOUND', payload: { inbId: inb.id },
        links: { kind: 'inbound', id: inb.id },
        stepFa: 'کالا در ناحیه QC نگهداری می‌شود تا بررسی تکمیل شود (موجودی AVAILABLE نشده است).',
      });
      this.notifyOps('خطای دریافت کالا', `${inb.id}: ${inb.exceptionDetailFa}`, 'EXCEPTION');
      this.pushEvent('RECEIVING_EXCEPTION', { sku, detailFa: inb.exceptionDetailFa });
      this.notify();
      return;
    }

    line.receivedQty = line.expectedQty;
    inb.state = 'RECEIVED';
    this.mutateInv(sku, inb.warehouseId, { RECEIVED: line.expectedQty }, 'RECEIVE',
      `رسید کالا ${inb.id} — تأیید تعداد و بارکد`, t.workerId ?? 'SYSTEM');
    if (prod?.serialized) {
      for (let i = 0; i < line.expectedQty; i++) {
        const sn = this.state.counters['sn'] = (this.state.counters['sn'] ?? 18290) + 1;
        this.state.serials.push({
          serial: `SN-2026-${pad(sn, 8)}`, sku, warehouseId: inb.warehouseId,
          locationId: inb.dockLocationId, state: 'RECEIVED', receivedAt: this.state.simTime,
        });
      }
    }
    this.pushEvent('GOODS_RECEIPT', { sku, detailFa: `رسید ${inb.id}: ${line.expectedQty} عدد تأیید شد.` });
    this.notifyOps('دریافت کالا تأیید شد', `${inb.id} — ${line.expectedQty} عدد ${sku} رسید و در انتظار چیدمان است.`, 'WAREHOUSE');
    this.schedule('PUTAWAY', 15 * MIN, { inbId: inb.id }, { warehouseId: inb.warehouseId, needsWorker: true, role: 'RECEIVING_OPERATOR' });
    this.notify();
  }

  /** ops resolves an inbound exception → proceeds (or rejects the shipment) */
  resolveInbound(inbId: string) {
    const inb = this.state.inbound.find(x => x.id === inbId);
    if (!inb || inb.state !== 'EXCEPTION') return;
    const line = inb.lines[0];
    const ex = this.state.exceptions.find(e => e.links?.id === inbId && e.status !== 'RESOLVED');
    if (inb.exceptionKind === 'COUNTERFEIT_SUSPECT' || inb.exceptionKind === 'WRONG_SKU') {
      if (ex) this.resolveException(ex.id, 'کالا مرجوع تأمین‌کننده شد؛ وارد موجودی نشد.');
      inb.exceptionDetailFa = (inb.exceptionDetailFa ?? '') + ' — مرجوع تأمین‌کننده شد.';
      this.pushEvent('INBOUND_REJECTED', { sku: line.sku, detailFa: `${inb.id} رد شد و مرجوع گردید.` });
      this.notifyOps('محموله مرجوع شد', `${inb.id} رد و مرجوع تأمین‌کننده شد.`, 'WAREHOUSE');
      this.notify();
      return;
    }
    if (ex) this.resolveException(ex.id, 'بررسی تکمیل شد؛ کالا برای چیدمان آزاد شد.');
    inb.state = 'RECEIVED';
    this.pushEvent('INBOUND_CLEARED', { sku: line.sku, detailFa: `${inb.id} پس از بررسی پذیرفته شد.` });
    this.schedule('PUTAWAY', 15 * MIN, { inbId: inb.id }, { warehouseId: inb.warehouseId, needsWorker: true, role: 'RECEIVING_OPERATOR' });
    this.notify();
  }

  private completePutaway(t: SimTask) {
    const inb = this.state.inbound.find(x => x.id === t.payload['inbId']);
    if (!inb) return;
    const line = inb.lines[0];
    const qty = line.receivedQty ?? line.expectedQty;
    const prod = this.state.products.find(p => p.variants.some(v => v.sku === line.sku));
    const zoneCode = prod?.category === 'HEADPHONES' ? 'Z-B' : prod?.category === 'CONSOLE' ? 'Z-C'
      : inb.warehouseId === 'WH-SEL-01' ? 'Z-S' : 'Z-A';
    const bins = Object.values(this.state.locations).filter(l =>
      l.warehouseId === inb.warehouseId && l.kind === 'STORAGE' && l.zone === zoneCode);
    bins.sort((a, b) => Object.values(a.contents).reduce((s, n) => s + n, 0) - Object.values(b.contents).reduce((s, n) => s + n, 0));
    const dest = bins[0];
    if (qty > 0 && dest) {
      this.mutateInv(line.sku, inb.warehouseId, { RECEIVED: -qty, AVAILABLE: qty }, 'PUTAWAY',
        `چیدمان ${inb.id} در ${dest.id}`, t.workerId ?? 'SYSTEM');
      dest.contents[line.sku] = (dest.contents[line.sku] ?? 0) + qty;
      if (prod?.serialized) {
        for (const s of this.state.serials.filter(s => s.sku === line.sku && s.warehouseId === inb.warehouseId && s.state === 'RECEIVED')) {
          s.state = 'AVAILABLE'; s.locationId = dest.id;
        }
      }
    }
    inb.state = 'PUTAWAY_DONE';
    this.pushEvent('PUTAWAY_COMPLETED', { sku: line.sku, detailFa: `${qty} عدد ${line.sku} در ${dest?.id} چیدمان شد — موجودی قابل فروش.` });
    this.notifyOps('چیدمان تکمیل شد', `${inb.id} → ${dest?.id} — موجودی AVAILABLE شد.`, 'WAREHOUSE');
    this.notify();
  }

  // ------------------------------------------------------------------ returns -
  evaluateReturnEligibility(order: Order, _itemIdx: number[], reasonFa: string): { verdict: ReturnEligibility; reasonFa: string } {
    if (order.state !== 'DELIVERED' && order.state !== 'RETURN_REQUESTED') {
      return { verdict: 'REJECTED', reasonFa: 'تنها سفارش‌های تحویل‌شده واجد شرایط مرجوعی هستند.' };
    }
    const deliveredEvt = order.history.find(h => h.state === 'DELIVERED');
    const daysSince = deliveredEvt ? (this.state.simTime - deliveredEvt.at) / DAY : 99;
    if (daysSince > 7) return { verdict: 'REJECTED', reasonFa: 'مهلت ۷ روزه مرجوعی سپری شده است.' };
    if (this.state.forces.returnReject) {
      this.state.forces.returnReject = false;
      return { verdict: 'REJECTED', reasonFa: 'درخواست مرجوعی بر اساس سیاست مرجوعی پذیرفته نشد (شبیه‌سازی‌شده).' };
    }
    if (reasonFa.includes('پشیمانی') && daysSince > 3) {
      return { verdict: 'REQUIRES_REVIEW', reasonFa: 'مهلت مرجوعی بابت پشیمانی از خرید ۳ روز است؛ نیازمند بررسی دستی.' };
    }
    const existing = this.state.returns.find(r => r.orderId === order.id && r.state !== 'REJECTED' && r.state !== 'CLOSED');
    if (existing) return { verdict: 'REJECTED', reasonFa: 'برای این سفارش درخواست مرجوعی باز وجود دارد.' };
    if (reasonFa.includes('معیوب') || reasonFa.includes('مغایرت') || reasonFa.includes('آسیب')) {
      return { verdict: 'APPROVED', reasonFa: 'دلیل موجه (کالای معیوب/مغایرت) — تأیید خودکار.' };
    }
    return { verdict: 'APPROVED', reasonFa: 'در مهلت مرجوعی و واجد شرایط (مدل شبیه‌سازی‌شده بر اساس رویه‌های عمومی).' };
  }

  requestReturn(orderId: string, itemIdx: number[], reasonFa: string): { ok: boolean; messageFa: string; returnId?: string } {
    const order = this.state.orders.find(o => o.id === orderId);
    if (!order) return { ok: false, messageFa: 'سفارش یافت نشد.' };
    if (order.state !== 'DELIVERED') return { ok: false, messageFa: 'تنها پس از تحویل می‌توان درخواست مرجوعی ثبت کرد.' };
    this.state.returnStats.requested++;
    this.transition(order, 'RETURN_REQUESTED', `درخواست مرجوعی ثبت شد: ${reasonFa}`, 'CUSTOMER');
    const verdict = this.evaluateReturnEligibility(order, itemIdx, reasonFa);
    const ret: ReturnRequest = {
      id: this.nextId('RET', 'ret', 6), rma: `RMA-2026-${pad((this.state.counters['rma'] = (this.state.counters['rma'] ?? 41) + 1), 6)}`,
      orderId, itemIdx, reasonFa, qty: itemIdx.reduce((s, i) => s + (order.items[i]?.qty ?? 0), 0),
      createdAt: this.state.simTime, eligibility: 'PENDING',
      state: 'REQUESTED', events: [{ type: 'REQUESTED', at: this.state.simTime, detailFa: `درخواست مرجوعی: ${reasonFa}` }],
    };
    this.state.returns.push(ret);
    order.returnId = ret.id;
    this.notifyCustomer('درخواست مرجوعی ثبت شد', `درخواست مرجوعی شما (${ret.rma}) ثبت شد و در حال بررسی است.`, 'RETURN', order.id);
    this.pushEvent('RETURN_REQUESTED', { orderId: order.id, detailFa: `${ret.rma}: ${reasonFa}`, actor: 'CUSTOMER' });

    ret.eligibility = verdict.verdict;
    ret.eligibilityReasonFa = verdict.reasonFa;
    if (verdict.verdict === 'REJECTED') {
      this.state.returnStats.rejected++;
      ret.state = 'REJECTED';
      ret.events.push({ type: 'REJECTED', at: this.state.simTime, detailFa: verdict.reasonFa });
      this.transition(order, 'DELIVERED', `مرجوعی رد شد: ${verdict.reasonFa}`);
      this.notifyCustomer('مرجوعی رد شد', verdict.reasonFa, 'RETURN', order.id);
      this.notify();
      return { ok: false, messageFa: verdict.reasonFa, returnId: ret.id };
    }
    this.state.returnStats.approved++;
    ret.state = 'APPROVED';
    ret.events.push({ type: 'APPROVED', at: this.state.simTime, detailFa: verdict.reasonFa });
    this.transition(order, 'RETURN_APPROVED', `مرجوعی تأیید شد: ${verdict.reasonFa}`);
    this.notifyCustomer('مرجوعی تأیید شد', `${verdict.reasonFa} هماهنگی بازگشت کالا آغاز شد.`, 'RETURN', order.id);
    const carrier = this.state.carriers[0];
    ret.carrierId = carrier.id;
    this.state.counters['rtrack'] = (this.state.counters['rtrack'] ?? 0) + 1;
    ret.trackingId = `RTRK-${ymd(this.state.simTime)}-${pad(this.state.counters['rtrack'], 6)}`;
    this.schedule('RETURN_PICKUP', 2 * HOUR, { returnId: ret.id }, { orderId: order.id, returnId: ret.id });
    this.notify();
    return {
      ok: true, returnId: ret.id,
      messageFa: verdict.verdict === 'REQUIRES_REVIEW'
        ? 'درخواست شما دریافت شد و نیازمند بررسی دستی است؛ پس از تأیید، مراحل بازگشت آغاز می‌شود.'
        : 'مرجوعی تأیید شد؛ هماهنگی بازگشت کالا آغاز شد.',
    };
  }

  private completeReturnPickup(t: SimTask) {
    const ret = this.state.returns.find(r => r.id === t.payload['returnId']);
    if (!ret) return;
    const order = this.state.orders.find(o => o.id === ret.orderId)!;
    ret.events.push({ type: 'PICKED_BY_CARRIER', at: this.state.simTime, detailFa: `حامل کالا را از مشتری تحویل گرفت (${ret.trackingId}).` });
    this.transition(order, 'RETURN_IN_TRANSIT', 'کالای مرجوعی در مسیر بازگشت است.');
    ret.state = 'IN_TRANSIT';
    const whId = order.shipments[0]?.warehouseId ?? 'WH-TEH-01';
    for (const i of ret.itemIdx) {
      const item = order.items[i];
      this.mutateInv(item.sku, whId, { DELIVERED: -item.qty, RETURN_IN_TRANSIT: item.qty }, 'RETURN_TRANSIT',
        `مرجوعی ${ret.rma} در مسیر`, 'CARRIER', order.id);
      this.moveSerials(item.sku, whId, 'DELIVERED', 'RETURN_IN_TRANSIT', item.qty, order.id);
    }
    this.pushEvent('RETURN_IN_TRANSIT', { orderId: order.id, detailFa: `${ret.rma} در مسیر بازگشت.` });
    this.schedule('RETURN_TRANSIT', 4 * HOUR, { returnId: ret.id }, { orderId: order.id, returnId: ret.id });
    this.notify();
  }

  private completeReturnTransit(t: SimTask) {
    const ret = this.state.returns.find(r => r.id === t.payload['returnId']);
    if (!ret) return;
    const order = this.state.orders.find(o => o.id === ret.orderId)!;
    ret.events.push({ type: 'ARRIVED_FC', at: this.state.simTime, detailFa: 'کالای مرجوعی به مرکز تکمیل رسید.' });
    this.schedule('RETURN_RECEIVE', 20 * MIN, { returnId: ret.id },
      { orderId: order.id, returnId: ret.id, warehouseId: order.shipments[0]?.warehouseId ?? 'WH-TEH-01', needsWorker: true, role: 'RECEIVING_OPERATOR' });
    this.notify();
  }

  private completeReturnReceive(t: SimTask) {
    const ret = this.state.returns.find(r => r.id === t.payload['returnId']);
    if (!ret) return;
    const order = this.state.orders.find(o => o.id === ret.orderId)!;
    ret.state = 'RECEIVED';
    ret.events.push({ type: 'RETURN_RECEIVED', at: this.state.simTime, detailFa: 'رسید مرجوعی: اسکن رهگیری، سفارش، SKU و سریال انجام شد.' });
    this.transition(order, 'RETURN_RECEIVED', 'کالای مرجوعی دریافت و اسکن شد.', t.workerId ?? 'SYSTEM');
    const whId = order.shipments[0]?.warehouseId ?? 'WH-TEH-01';
    for (const i of ret.itemIdx) {
      const item = order.items[i];
      this.mutateInv(item.sku, whId, { RETURN_IN_TRANSIT: -item.qty, RETURN_RECEIVED: item.qty }, 'RETURN_RECEIVE',
        `دریافت مرجوعی ${ret.rma}`, t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(item.sku, whId, 'RETURN_IN_TRANSIT', 'RETURN_RECEIVED', item.qty, order.id);
    }
    this.pushEvent('RETURN_RECEIVED', { orderId: order.id, detailFa: `${ret.rma} دریافت شد.` });
    this.schedule('RETURN_INSPECT', 45 * MIN, { returnId: ret.id },
      { orderId: order.id, returnId: ret.id, warehouseId: whId, needsWorker: true, role: 'RETURN_INSPECTOR' });
    this.notify();
  }

  private completeReturnInspect(t: SimTask) {
    const ret = this.state.returns.find(r => r.id === t.payload['returnId']);
    if (!ret) return;
    const order = this.state.orders.find(o => o.id === ret.orderId)!;
    const f = this.state.forces;
    const item = order.items[ret.itemIdx[0]];

    let serialOk = true, conditionGood = true, fraud = false;
    let notes = 'کالا از نظر هویت، سریال، ظاهر و لوازم جانبی بررسی شد؛ مشکلی یافت نشد.';
    if (f.serialMismatchReturn) { f.serialMismatchReturn = false; serialOk = false; fraud = true; notes = 'شماره سریال کالای برگشتی با سفارش ناسازگار است — توقف پردازش خودکار، «نیازمند بررسی دستی». (SERIAL MISMATCH)'; }
    if (f.damagedReturn) { f.damagedReturn = false; conditionGood = false; notes = 'کالا دارای آسیب فیزیکی (ترک صفحه/خط روی بدنه) است.'; }
    if (f.quarantineReturn) { f.quarantineReturn = false; fraud = true; conditionGood = false; notes = 'نشانه‌های سوءاستفاده یا دستکاری مشاهده شد؛ کالا قرنطینه می‌شود.'; }

    ret.inspection = {
      identityOk: true, serialOk, conditionFa: conditionGood ? 'سالم' : 'آسیب‌دیده',
      accessoriesOk: conditionGood, misuse: !conditionGood && fraud, fraudSuspect: fraud,
      notesFa: notes, inspectorId: t.workerId ?? 'EMP-01', at: this.state.simTime,
    };
    ret.state = 'INSPECTION';
    ret.events.push({ type: 'INSPECTED', at: this.state.simTime, detailFa: notes });
    this.transition(order, 'RETURN_INSPECTION', `بازرسی مرجوعی: ${notes}`, t.workerId ?? 'SYSTEM');

    if (!serialOk) {
      this.addException('SERIAL_MISMATCH', 'CRITICAL', `ناسازگاری سریال در مرجوعی ${ret.rma} — «نیازمند بررسی دستی».`, {
        orderId: order.id, sku: item.sku, ownerFa: 'بازرس ارشد مرجوعی',
        actionKey: 'MANUAL_RETURN', payload: { returnId: ret.id }, links: { kind: 'return', id: ret.id },
        stepFa: 'پردازش خودکار متوقف شد تا بررسی دستی انجام شود.',
      });
      this.notifyCustomer('مرجوعی نیازمند بررسی دستی', 'به دلیل ناسازگاری سریال، مرجوعی شما توسط کارشناس بررسی می‌شود.', 'RETURN', order.id);
      this.notify();
      return; // waits for ops disposition decision
    }
    let disp: Disposition = 'RESTOCK';
    if (!conditionGood) disp = 'DAMAGED';
    else if (fraud) disp = 'QUARANTINE';
    else if (this.rng() < 0.15) disp = 'OPEN_BOX';
    this.scheduleDisposition(order, ret, disp);
    this.notify();
  }

  private scheduleDisposition(order: Order, ret: ReturnRequest, disp: Disposition) {
    this.schedule('DISPOSITION', 10 * MIN, { returnId: ret.id, disposition: disp, phase: 1 },
      { orderId: order.id, returnId: ret.id, warehouseId: order.shipments[0]?.warehouseId ?? 'WH-TEH-01', needsWorker: true, role: 'RETURN_INSPECTOR' });
  }

  /** ops picks disposition for a manual-review (serial mismatch) return */
  setDisposition(returnId: string, disp: Disposition) {
    const ret = this.state.returns.find(r => r.id === returnId);
    if (!ret) return;
    const order = this.state.orders.find(o => o.id === ret.orderId)!;
    const ex = this.state.exceptions.find(e => e.links?.kind === 'return' && e.links.id === returnId && e.status !== 'RESOLVED');
    if (ex) this.resolveException(ex.id, `تعیین تکلیف دستی: ${disp}`);
    this.scheduleDisposition(order, ret, disp);
    this.notify();
  }

  /**
   * Phase 1: decide disposition + start refund. Phase 2 (after refund settles):
   * apply inventory/accounting changes and final order state.
   */
  private completeDisposition(t: SimTask) {
    const ret = this.state.returns.find(r => r.id === t.payload['returnId']);
    if (!ret) return;
    const order = this.state.orders.find(o => o.id === ret.orderId)!;

    if ((t.payload['phase'] ?? 1) === 1) {
      const disp = t.payload['disposition'] as Disposition;
      ret.disposition = disp;
      ret.dispositionNoteFa = DISPOSITION_NOTE(disp);
      ret.events.push({ type: 'DISPOSITION_DECIDED', at: this.state.simTime, detailFa: ret.dispositionNoteFa });
      if (order.state === 'RETURN_INSPECTION') {
        this.transition(order, 'REFUND_PENDING', 'تعیین تکلیف مرجوعی؛ بازپرداخت وجه آغاز شد.');
      }
      this.issueRefund(order, order.totalAmount, `بازپرداخت بابت مرجوعی ${ret.rma} (${ret.reasonFa})`);
      // phase 2 after refund (3 min) settles
      this.schedule('DISPOSITION', 6 * MIN, { returnId: ret.id, disposition: disp, phase: 2, retries: 0 },
        { orderId: order.id, returnId: ret.id, warehouseId: order.shipments[0]?.warehouseId ?? 'WH-TEH-01', needsWorker: true, role: 'RETURN_INSPECTOR' });
      this.notify();
      return;
    }

    // ---- phase 2 ----
    const retries = t.payload['retries'] ?? 0;
    if (order.state === 'REFUND_PENDING' && retries < 10) {
      // refund not settled yet (or failed) — wait and retry phase 2
      this.schedule('DISPOSITION', 5 * MIN, { ...t.payload, retries: retries + 1 },
        { orderId: order.id, returnId: ret.id, warehouseId: order.shipments[0]?.warehouseId ?? 'WH-TEH-01', needsWorker: true, role: 'RETURN_INSPECTOR' });
      this.notify();
      return;
    }
    const disp = t.payload['disposition'] as Disposition;
    const whId = order.shipments[0]?.warehouseId ?? 'WH-TEH-01';
    const item = order.items[ret.itemIdx[0]];

    if (disp === 'RESTOCK' || disp === 'OPEN_BOX' || disp === 'REPAIR') {
      this.mutateInv(item.sku, whId, { RETURN_RECEIVED: -item.qty, RESTOCK_PENDING: item.qty }, 'RESTOCK_PENDING',
        `تعیین تکلیف ${ret.rma} → بازگشت به موجودی`, t.workerId ?? 'SYSTEM', order.id);
      this.transition(order, 'RESTOCK_PENDING', 'کالا برای بازگشت به موجودی آماده می‌شود.');
      const loc = Object.values(this.state.locations).find(l =>
        l.warehouseId === whId && l.kind === 'STORAGE' && l.zone !== 'Z-D');
      if (loc) loc.contents[item.sku] = (loc.contents[item.sku] ?? 0) + item.qty;
      this.mutateInv(item.sku, whId, { RESTOCK_PENDING: -item.qty, AVAILABLE: item.qty }, 'RESTOCKED',
        'بازگشت کالای مرجوعی به موجودی قابل فروش', t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(item.sku, whId, 'RETURN_RECEIVED', 'AVAILABLE', item.qty, undefined, loc?.id);
      this.transition(order, 'RESTOCKED', 'کالا به موجودی قابل فروش بازگشت.', t.workerId ?? 'SYSTEM');
      this.notifyCustomer('مرجوعی تکمیل شد', 'کالای مرجوعی شما دریافت و به موجودی بازگشت داده شد.', 'RETURN', order.id);
    } else if (disp === 'DAMAGED') {
      this.mutateInv(item.sku, whId, { RETURN_RECEIVED: -item.qty, DAMAGED: item.qty }, 'DAMAGE',
        `ثبت آسیب مرجوعی ${ret.rma}`, t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(item.sku, whId, 'RETURN_RECEIVED', 'DAMAGED', item.qty, order.id);
      this.transition(order, 'DAMAGED', 'کالا به عنوان آسیب‌دیده ثبت شد.', t.workerId ?? 'SYSTEM');
      this.notifyCustomer('مرجوعی — کالای آسیب‌دیده', 'کالای مرجوعی شما آسیب‌دیده ثبت شد؛ بازپرداخت وجه انجام شد.', 'RETURN', order.id);
    } else {
      this.mutateInv(item.sku, whId, { RETURN_RECEIVED: -item.qty, QUARANTINED: item.qty }, 'QUARANTINE',
        `قرنطینه مرجوعی ${ret.rma}`, t.workerId ?? 'SYSTEM', order.id);
      this.moveSerials(item.sku, whId, 'RETURN_RECEIVED', 'QUARANTINED', item.qty, order.id);
      this.transition(order, 'QUARANTINED', 'کالا قرنطینه شد (دور از موجودی قابل فروش).', t.workerId ?? 'SYSTEM');
      this.notifyCustomer('مرجوعی در قرنطینه', 'کالای مرجوعی شما قرنطینه شد و پس از بررسی نهایی تعیین تکلیف می‌شود.', 'RETURN', order.id);
    }
    ret.state = 'CLOSED';
    this.pushEvent('RETURN_CLOSED', { orderId: order.id, detailFa: `${ret.rma} بسته شد — تعیین تکلیف: ${ret.dispositionNoteFa}` });
    this.notify();
  }

  // ----------------------------------------------------------- cycle counts --
  startCycleCount(sku: string, whId: string, forceDiscrepancy?: number): CycleCount {
    const cc: CycleCount = {
      id: this.nextId('CNT', 'cc', 6), sku, warehouseId: whId,
      systemQty: this.available(sku, whId), state: 'COUNTING', createdAt: this.state.simTime,
    };
    this.state.cycleCounts.push(cc);
    this.pushEvent('CYCLE_COUNT_STARTED', { sku, detailFa: `شمارش چرخه‌ای ${sku} در ${whId} آغاز شد.` });
    this.schedule('CYCLE_COUNT', 10 * MIN, { ccId: cc.id, forceDiscrepancy },
      { warehouseId: whId, needsWorker: true, role: 'QC_OPERATOR' });
    this.notify();
    return cc;
  }

  private completeCycleCount(t: SimTask) {
    const cc = this.state.cycleCounts.find(c => c.id === t.payload['ccId']);
    if (!cc) return;
    this.state.inventoryCounts++;
    const forced = t.payload['forceDiscrepancy'] as number | undefined;
    const disc = forced !== undefined ? forced
      : (this.state.forces.randomMode && this.rng() < 0.4 ? -Math.ceil(this.rng() * 3) : 0);
    const physical = Math.max(0, cc.systemQty + (disc || 0));
    cc.physicalQty = physical;
    if (physical === cc.systemQty) {
      cc.state = 'MATCHED';
      cc.resolvedAt = this.state.simTime;
      cc.noteFa = 'شمارش فیزیکی با موجودی سیستمی مطابقت دارد.';
      this.pushEvent('CYCLE_COUNT_MATCHED', { sku: cc.sku, detailFa: `${cc.sku}: شمارش مطابق (${physical}).` });
    } else {
      cc.state = 'DISCREPANCY';
      cc.noteFa = `مغایرت: سیستم ${cc.systemQty} ← فیزیکی ${physical}.`;
      this.addException('CYCLE_COUNT_DISCREPANCY', 'HIGH',
        `مغایرت موجودی ${cc.sku} در ${cc.warehouseId}: سیستمی=${cc.systemQty}، فیزیکی=${physical}.`, {
        sku: cc.sku, ownerFa: 'کارشناس انبارگردانی', actionKey: 'APPROVE_ADJUST', payload: { ccId: cc.id },
        stepFa: 'شمارش، تحقیق و تأیید اصلاح دفتری لازم است؛ تغییر پنهانی ممنوع.',
      });
      this.pushEvent('INVENTORY_DISCREPANCY', { sku: cc.sku, prev: String(cc.systemQty), next: String(physical), detailFa: cc.noteFa });
      this.notifyOps('مغایرت موجودی', `${cc.sku}: ${cc.noteFa}`, 'EXCEPTION');
    }
    this.notify();
  }

  approveAdjustment(ccId: string) {
    const cc = this.state.cycleCounts.find(c => c.id === ccId);
    if (!cc || cc.state !== 'DISCREPANCY' || cc.physicalQty === undefined) return;
    const diff = cc.physicalQty - cc.systemQty;
    if (diff !== 0) {
      this.mutateInv(cc.sku, cc.warehouseId, { AVAILABLE: diff }, 'ADJUSTMENT',
        `اصلاح دفتری پس از تحقیق (${cc.id})`, 'OPS_APPROVAL');
      const loc = Object.values(this.state.locations).find(l =>
        l.warehouseId === cc.warehouseId && l.kind === 'STORAGE' && (l.contents[cc.sku] ?? 0) > 0);
      if (loc) loc.contents[cc.sku] = Math.max(0, loc.contents[cc.sku] + diff);
      this.state.inventoryAdjustments++;
    }
    cc.state = 'ADJUSTED';
    cc.resolvedAt = this.state.simTime;
    cc.noteFa = (cc.noteFa ?? '') + ' — اصلاح دفتری با تأیید اعمال شد.';
    const ex = this.state.exceptions.find(e => e.actionKey === 'APPROVE_ADJUST' && e.payload?.ccId === ccId && e.status !== 'RESOLVED');
    if (ex) this.resolveException(ex.id, `اصلاح دفتری ${diff > 0 ? '+' : ''}${diff} واحد اعمال شد.`);
    this.pushEvent('LEDGER_ADJUSTED', { sku: cc.sku, prev: String(cc.systemQty), next: String(cc.physicalQty), detailFa: `اصلاح دفتری ${cc.id} تأیید شد.` });
    this.notify();
  }

  // -------------------------------------------------------- scenario scripts -
  private runScripts(order: Order) {
    for (const s of this.state.script) {
      if (s.done || s.when !== order.state) continue;
      if (s.targetSuffix && !order.id.endsWith(s.targetSuffix)) continue;
      s.done = true;
      if (s.action === 'CANCEL') this.requestCancellation(order.id, 'درخواست لغو خودکار (اجرای سناریو)');
      else if (s.action === 'RETURN') this.requestReturn(order.id, order.items.map((_, i) => i), 'کالا مطابق سفارش نیست (اجرای سناریو)');
    }
  }

  private autoOrder() {
    const cust = this.state.customers[Math.floor(this.rng() * this.state.customers.length)];
    const nItems = 1 + Math.floor(this.rng() * 2);
    const items: { variantId: string; qty: number }[] = [];
    for (let i = 0; i < nItems; i++) {
      const p = this.state.products[Math.floor(this.rng() * this.state.products.length)];
      const v = p.variants[Math.floor(this.rng() * p.variants.length)];
      items.push({ variantId: v.id, qty: 1 + Math.floor(this.rng() * 2) });
    }
    this.placeOrder({ customerId: cust.id, items, paymentOutcome: 'SUCCESS' });
  }

  // ------------------------------------------------------- scenario loading --
  applyScenario(id: ScenarioId | null): void {
    this.running = false;
    this.state = this.buildState(id);
    this.applyScenarioSetup(id);
    this.notify();
  }

  private applyScenarioSetup(id: ScenarioId | null) {
    const s = getScenario(id);
    this.state.scenarioId = id;
    this.state.scenarioNameFa = s ? s.nameFa : 'حالت آزاد (بدون سناریو)';
    this.autoOrdersEnabled = this.state.forces.autoOrders;
    (this.state as any)._autoNext = undefined;
    if (s && s.setup) s.setup(this);
    this.notify();
  }

  /** convenience: place a demo order for scenario setups */
  scenarioOrder(opts: {
    productIdx?: number; variantIdx?: number; qty?: number; city?: string;
    customerId?: string; paymentOutcome?: 'AUTO' | 'SUCCESS' | 'FAIL' | 'TIMEOUT';
    items?: { productIdx: number; variantIdx: number; qty: number }[];
    method?: string;
  }): Order {
    let items: { variantId: string; qty: number }[];
    if (opts.items?.length) {
      items = opts.items.map(i => ({
        variantId: this.state.products[i.productIdx].variants[i.variantIdx].id, qty: i.qty,
      }));
    } else {
      const p = this.state.products[opts.productIdx ?? 0];
      const v = p.variants[opts.variantIdx ?? 0];
      items = [{ variantId: v.id, qty: opts.qty ?? 1 }];
    }
    return this.placeOrder({
      customerId: opts.customerId ?? 'CUS-0001', items, city: opts.city,
      paymentOutcome: opts.paymentOutcome ?? 'SUCCESS', paymentMethod: opts.method,
    });
  }

  // --------------------------------------------------------- KPI snapshot ----
  kpi() {
    const st = this.state;
    const total = st.orders.length;
    const terminal = st.orders.filter(o => ['DELIVERED', 'CANCELLED'].includes(o.state)).length;
    const elapsedH = Math.max(0.1, (st.simTime - st.seededAt) / HOUR);
    const cancels = st.orders.filter(o => o.state === 'CANCELLED').length;
    const onTimeD = st.deliveryStats.delivered ? (st.deliveryStats.onTime / st.deliveryStats.delivered) * 100 : 100;
    const acc = st.inventoryCounts ? Math.max(0, (1 - st.inventoryAdjustments / st.inventoryCounts)) * 100 : 100;
    const avgMin = st.deliveryStats.delivered ? st.deliveryStats.totalMinutes / st.deliveryStats.delivered : 0;
    const capTotal = st.warehouses.reduce((s, w) => s + w.capacity.picking + w.capacity.packing + w.capacity.receiving + w.capacity.dispatch, 0);
    const usedTotal = st.warehouses.reduce((s, w) => s + w.used.picking + w.used.packing + w.used.receiving + w.used.dispatch, 0);
    return {
      ordersProcessed: terminal,
      ordersPending: total - terminal,
      pickRate: Math.round(st.pickStats.picks / elapsedH),
      packRate: Math.round(st.pickStats.packs / elapsedH),
      onTimeDispatch: st.deliveryStats.dispatched ? (st.deliveryStats.onTime / st.deliveryStats.dispatched) * 100 : 100,
      onTimeDelivery: onTimeD,
      sellerConfirmRate: st.sellerStats.asked ? (st.sellerStats.accepted / st.sellerStats.asked) * 100 : 100,
      cancellationRate: total ? (cancels / total) * 100 : 0,
      returnRate: st.deliveryStats.delivered ? (st.returnStats.requested / st.deliveryStats.delivered) * 100 : 0,
      inventoryAccuracy: acc,
      pickErrors: st.pickStats.errors,
      packErrors: st.pickStats.packErrors,
      avgProcessMinutes: Math.round(avgMin),
      utilization: capTotal ? (usedTotal / capTotal) * 100 : 0,
      deliveredCount: st.deliveryStats.delivered,
      openExceptions: st.exceptions.filter(e => e.status !== 'RESOLVED').length,
      totalOrders: total,
    };
  }

  // ---------------------------------------------------- backstage builder ----
  backstage(order: Order): { labelFa: string; status: 'DONE' | 'CURRENT' | 'PENDING'; detailFa: string; actor: string; at?: number }[] {
    const steps: { state: OrderState; labelFa: string; detailFa: string }[] = [
      { state: 'PAYMENT_PENDING', labelFa: 'ثبت سفارش و پرداخت', detailFa: 'سفارش مشتری ثبت و پرداخت آغاز شد.' },
      { state: 'ORDER_CREATED', labelFa: 'ایجاد سفارش در OMS', detailFa: 'سفارش در سیستم مدیریت سفارش ایجاد شد.' },
      { state: 'ALLOCATION_PENDING', labelFa: 'تصمیم موتور تخصیص', detailFa: 'انبار، فروشنده و مدل ارسال انتخاب شد.' },
      { state: 'INVENTORY_RESERVED', labelFa: 'رزرو و تخصیص موجودی', detailFa: 'موجودی رزرو و سپس ALLOCATED شد.' },
      { state: 'SELLER_CONFIRMATION_PENDING', labelFa: 'تأیید فروشنده', detailFa: 'فروشنده برای تأیید مهلت دارد.' },
      { state: 'PICKING_PENDING', labelFa: 'ایجاد وظیفه برداشت', detailFa: 'پیک‌لیست، توت و استراتژی برداشت تعیین شد.' },
      { state: 'PICKING', labelFa: 'برداشت کالا (Picking)', detailFa: 'اپراتور محل را اسکن، کالا و سریال را تأیید کرد.' },
      { state: 'PICKED', labelFa: 'تکمیل برداشت', detailFa: 'کالاها در توت قرار گرفتند.' },
      { state: 'CONSOLIDATION', labelFa: 'تجمیع سفارش', detailFa: 'کالاهای چند محل در یک بسته تجمیع شدند.' },
      { state: 'QC_PENDING', labelFa: 'کنترل کیفیت (QC)', detailFa: 'چک‌لیست QC بر اساس دسته کالا اجرا شد.' },
      { state: 'PACKING', labelFa: 'بسته‌بندی (Packing)', detailFa: 'ایستگاه بسته‌بندی نوع بسته و وزن را تعیین کرد.' },
      { state: 'PACKED', labelFa: 'تکمیل بسته‌بندی', detailFa: 'بسته و برچسب بارکد ایجاد شد.' },
      { state: 'SORTATION', labelFa: 'تفکیک مرسولات', detailFa: 'تصمیم تفکیک: شهر، ناحیه، حامل و سطح خدمت.' },
      { state: 'READY_FOR_DISPATCH', labelFa: 'آماده ارسال', detailFa: 'بسته در لاین ارسال و مانیفست قرار گرفت.' },
      { state: 'DISPATCHED', labelFa: 'تحویل حامل', detailFa: 'حوادث حامل و شماره رهگیری ثبت شد.' },
      { state: 'IN_TRANSIT', labelFa: 'در مسیر ارسال', detailFa: 'مرسوله از انبار خارج و در حال حرکت است.' },
      { state: 'OUT_FOR_DELIVERY', labelFa: 'خارج برای تحویل', detailFa: 'پیک آخرین مایل را آغاز کرد.' },
      { state: 'DELIVERED', labelFa: 'تحویل به مشتری', detailFa: 'رسید تحویل (POD) با کد تأیید ثبت شد.' },
    ];
    const cur = (() => {
      const r = ORDER_RANK[order.state];
      if (r !== undefined) return r;
      if (['CANCELLATION_REQUESTED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(order.state) && !order.returnId)
        return Math.max(0, ...order.shipments.map(s => SHIPMENT_RANK[s.state] >= 0 ? SHIPMENT_RANK[s.state] : 0));
      if (order.returnId) return steps.length - 1;
      return 0;
    })();
    const cancelled = ['CANCELLATION_REQUESTED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(order.state) && !order.returnId;
    const inReturn = !!order.returnId;
    const base = steps.map((s, i) => {
      const status: 'DONE' | 'CURRENT' | 'PENDING' = i < cur ? 'DONE' : i === cur ? 'CURRENT' : 'PENDING';
      const hist = order.history.filter(h => h.state === s.state).pop();
      return { labelFa: s.labelFa, status, detailFa: hist?.detailFa ?? s.detailFa, actor: hist?.actor ?? '—', at: hist?.at };
    });
    if (cancelled) {
      const done = ['CANCELLED', 'REFUNDED'].includes(order.state);
      base.push({
        labelFa: 'لغو و بازپرداخت', status: done ? 'DONE' : 'CURRENT',
        detailFa: order.cancel?.blockedReasonFa ?? order.cancel?.reasonFa ?? 'لغو سفارش',
        actor: 'CUSTOMER', at: order.cancel?.requestedAt,
      });
    }
    if (inReturn) {
      const done = ['RESTOCKED', 'REFUNDED', 'QUARANTINED', 'DAMAGED'].includes(order.state);
      base.push({
        labelFa: 'مرجوعی و بازپرداخت', status: done ? 'DONE' : 'CURRENT',
        detailFa: 'مسیر معکوس: مجوز مرجوعی، بازگشت، بازرسی، تعیین تکلیف و بازپرداخت.',
        actor: 'SYSTEM', at: undefined,
      });
    }
    return base;
  }
}

function taskDesc(lines: { sku: string; qty: number }[]) {
  return lines.map(l => `${l.qty}×${l.sku}`).join('، ');
}
