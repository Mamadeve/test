// ============================================================================
// Scenario engine: 25+ deterministic scenarios. Each scenario sets forces,
// seeds orders/scripts so the same sequence occurs every run (unless the
// random-mode flag is toggled by the user).
// ============================================================================

import type { ScenarioId } from './types';
import type { Engine } from './engine';

export interface ScenarioDef {
  id: ScenarioId;
  nameFa: string;
  descFa: string;
  tagFa: string;
  setup: (e: Engine) => void;
}

/** run engine until the newest order reaches a state (or fail-safe cap) */
function runUntil(e: Engine, pred: () => boolean, maxIter = 500): boolean {
  for (let i = 0; i < maxIter; i++) {
    if (pred()) return true;
    const before = e.state.simTime;
    e.stepOnce();
    if (e.state.simTime === before && !pred()) {
      // no time-based events; force process once more then bail
      e.runAll(50);
      return pred();
    }
  }
  return pred();
}

function latestOrder(e: Engine) { return e.state.orders[e.state.orders.length - 1]; }

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'SC-01', nameFa: '۱. تکمیل مرکزی موفق', tagFa: 'پایه',
    descFa: 'یک سفارش عادی از انبار مرکزی پلتفرم: پرداخت موفق، تخصیص، برداشت، بسته‌بندی، ارسال و تحویل.',
    setup(e) {
      e.scenarioOrder({ productIdx: 0, variantIdx: 0, qty: 1 });
      e.runAll(200);
    },
  },
  {
    id: 'SC-02', nameFa: '۲. شکست پرداخت', tagFa: 'پرداخت',
    descFa: 'پرداخت ناموفق: سفارش تکمیل نمی‌شود، پیام خطا و استثنا ثبت می‌شود.',
    setup(e) {
      e.scenarioOrder({ productIdx: 2, variantIdx: 0, qty: 1, paymentOutcome: 'FAIL' });
      e.runAll(80);
    },
  },
  {
    id: 'SC-03', nameFa: '۳. تأیید فروشنده', tagFa: 'فروشنده',
    descFa: 'سفارش فروشنده (ارسال مستقیم) که فروشنده در مهلت SLA تأیید می‌کند و آماده‌سازی می‌کند.',
    setup(e) {
      e.scenarioOrder({ productIdx: 3, variantIdx: 0, qty: 1 }); // smartwatch → SELL-004
      e.runAll(300);
    },
  },
  {
    id: 'SC-04', nameFa: '۴. رد فروشنده', tagFa: 'فروشنده',
    descFa: 'فروشنده قادر به تأمین نیست: رد سفارش، آزادسازی موجودی، بازپرداخت و کد تخفیف جبرانی.',
    setup(e) {
      e.state.forces.sellerReject = true;
      e.scenarioOrder({ productIdx: 3, variantIdx: 1, qty: 1 });
      e.runAll(200);
    },
  },
  {
    id: 'SC-05', nameFa: '۵. کسری موجودی', tagFa: 'موجودی',
    descFa: 'موتور تخصیص موجودی قابل وعده کافی نمی‌یابد؛ سفارش لغو و بازپرداخت می‌شود.',
    setup(e) {
      e.state.forces.stockShortage = true;
      e.scenarioOrder({ productIdx: 0, variantIdx: 2, qty: 2 });
      e.runAll(120);
    },
  },
  {
    id: 'SC-06', nameFa: '۶. مغایرت موجودی هنگام برداشت', tagFa: 'موجودی',
    descFa: 'تعداد فیزیکی کالا با سیستم مطابقت ندارد؛ وظیفه برداشت متوقف و استثنا ثبت می‌شود.',
    setup(e) {
      e.state.forces.invMismatch = true;
      e.scenarioOrder({ productIdx: 2, variantIdx: 1, qty: 1 });
      e.runAll(250);
    },
  },
  {
    id: 'SC-07', nameFa: '۷. اسکن SKU اشتباه', tagFa: 'خطای انبار',
    descFa: 'کالای اسکن‌شده با سفارش مطابقت ندارد؛ خطای برداشت و اقدام بازیابی در مرکز استثنا.',
    setup(e) {
      e.state.forces.wrongScan = true;
      e.scenarioOrder({ productIdx: 0, variantIdx: 1, qty: 1 });
      e.runAll(250);
    },
  },
  {
    id: 'SC-08', nameFa: '۸. مکان اشتباه', tagFa: 'خطای انبار',
    descFa: 'اپراتور محل اشتباهی را اسکن کرده؛ وظیفه برداشت متوقف و برای بازیابی علامت خورده است.',
    setup(e) {
      e.state.forces.wrongLocation = true;
      e.scenarioOrder({ productIdx: 4, variantIdx: 0, qty: 1 });
      e.runAll(250);
    },
  },
  {
    id: 'SC-09', nameFa: '۹. کالای آسیب‌دیده در ورودی', tagFa: 'ورودی',
    descFa: 'محموله ورودی با بسته‌بندی آسیب‌دیده می‌رسد؛ کالا در انتظار بررسی می‌ماند تا عملیات تأیید کند.',
    setup(e) {
      const inb = e.createInbound({
        supplierFa: 'تأمین‌کننده مرکزی (شبیه‌سازی‌شده)', warehouseId: 'WH-TEH-01',
        sku: e.state.products[0].variants[0].sku, qty: 20, exceptionKind: 'DAMAGED_PACKAGING',
      });
      e.runAll(200);
      void inb;
    },
  },
  {
    id: 'SC-10', nameFa: '۱۰. ناسازگاری سریال ورودی', tagFa: 'ورودی',
    descFa: 'شماره سریال دریافتی با مدارک ناسازگار است؛ دریافت متوقف و بررسی دستی لازم است.',
    setup(e) {
      e.createInbound({
        supplierFa: 'فروشنده تک‌مال (شبیه‌سازی‌شده)', warehouseId: 'WH-TEH-01',
        sku: e.state.products[1].variants[0].sku, qty: 10, exceptionKind: 'SERIAL_MISMATCH',
      });
      e.runAll(200);
    },
  },
  {
    id: 'SC-11', nameFa: '۱۱. لغو پیش از برداشت', tagFa: 'لغو',
    descFa: 'مشتری قبل از شروع برداشت لغو می‌کند: رزرو آزاد، وظایف لغو، بازپرداخت کامل.',
    setup(e) {
      const o = e.scenarioOrder({ productIdx: 2, variantIdx: 0, qty: 1 });
      e.state.script.push({ when: 'INVENTORY_RESERVED', action: 'CANCEL' });
      e.runAll(300);
      void o;
    },
  },
  {
    id: 'SC-12', nameFa: '۱۲. لغو حین برداشت', tagFa: 'لغو',
    descFa: 'لغو در میانه برداشت: وظیفه برداشت لغو و کالای نیمه‌برداشت‌شده به ALLOCATED برمی‌گردد.',
    setup(e) {
      e.scenarioOrder({ productIdx: 0, variantIdx: 3, qty: 1 });
      e.state.script.push({ when: 'PICKING', action: 'CANCEL' });
      e.runAll(400);
    },
  },
  {
    id: 'SC-13', nameFa: '۱۳. لغو پس از بسته‌بندی', tagFa: 'لغو',
    descFa: 'بسته رهگیری (intercept) می‌شود پیش از تحویل به حامل؛ موجودی آزاد و بازپرداخت انجام می‌شود.',
    setup(e) {
      e.scenarioOrder({ productIdx: 2, variantIdx: 2, qty: 1 });
      e.state.script.push({ when: 'PACKED', action: 'CANCEL' });
      e.runAll(500);
    },
  },
  {
    id: 'SC-14', nameFa: '۱۴. لغو پس از تحویل حامل', tagFa: 'لغو',
    descFa: 'پس از CARRIER_ACCEPTED لغو عادی مسدود است: «امکان لغو عادی سفارش به پایان رسیده است.»',
    setup(e) {
      e.scenarioOrder({ productIdx: 4, variantIdx: 1, qty: 1 });
      e.state.script.push({ when: 'DISPATCHED', action: 'CANCEL' });
      e.runAll(600);
    },
  },
  {
    id: 'SC-15', nameFa: '۱۵. ارسال تفکیک‌شده (Split Shipment)', tagFa: 'چندمرسوله‌ای',
    descFa: 'یک سفارش با کالاهایی از انبارهای مختلف → چند مرسوله، چند بسته، چند ردیف رهگیری.',
    setup(e) {
      e.state.splitPolicy = 'ALWAYS_SPLIT';
      // platform phone (multi-wh) + seller FC laptop (WH-01) + seller hub watch
      e.scenarioOrder({
        items: [
          { productIdx: 0, variantIdx: 0, qty: 1 },
          { productIdx: 1, variantIdx: 0, qty: 1 },
          { productIdx: 3, variantIdx: 0, qty: 1 },
        ],
      });
      e.runAll(700);
    },
  },
  {
    id: 'SC-16', nameFa: '۱۶. سفارش چند-انباره', tagFa: 'چندمرسوله‌ای',
    descFa: 'موتور تخصیص، انبارهای WH-TEH-01/02/03 را برای سفارش چندکالایی انتخاب می‌کند (تجمیع یا تفکیک).',
    setup(e) {
      e.scenarioOrder({
        items: [
          { productIdx: 0, variantIdx: 0, qty: 3 },
          { productIdx: 4, variantIdx: 0, qty: 2 },
        ],
        city: 'تهران',
      });
      e.runAll(700);
    },
  },
  {
    id: 'SC-17', nameFa: '۱۷. مرجوعی تأییدشده', tagFa: 'مرجوعی',
    descFa: 'سفارش تحویل‌شده → درخواست مرجوعی → تأیید → بازگشت → بازرسی → بازپرداخت → بازچیدانبار.',
    setup(e) {
      const o = e.scenarioOrder({ productIdx: 2, variantIdx: 0, qty: 1 });
      e.runAll(700);
      if (o.state !== 'DELIVERED') runUntil(e, () => o.state === 'DELIVERED');
      e.state.script.push({ when: 'DELIVERED', action: 'RETURN' });
      e.requestReturn(o.id, [0], 'کالا مطابق توضیحات نیست');
      e.runAll(700);
    },
  },
  {
    id: 'SC-18', nameFa: '۱۸. رد مرجوعی', tagFa: 'مرجوعی',
    descFa: 'موتور صلاحیت مرجوعی درخواست را رد می‌کند و دلیل را به مشتری اعلام می‌کند.',
    setup(e) {
      e.state.forces.returnReject = true;
      const o = e.scenarioOrder({ productIdx: 4, variantIdx: 2, qty: 1 });
      e.runAll(700);
      if (o.state !== 'DELIVERED') runUntil(e, () => o.state === 'DELIVERED');
      e.requestReturn(o.id, [0], 'پشیمانی از خرید');
      e.runAll(50);
    },
  },
  {
    id: 'SC-19', nameFa: '۱۹. ناسازگاری سریال در مرجوعی', tagFa: 'مرجوعی',
    descFa: 'سریال کالای برگشتی با سفارش نمی‌خواند: پردازش خودکار متوقف، «نیازمند بررسی دستی».',
    setup(e) {
      e.state.forces.serialMismatchReturn = true;
      const o = e.scenarioOrder({ productIdx: 0, variantIdx: 0, qty: 1 });
      e.runAll(700);
      if (o.state !== 'DELIVERED') runUntil(e, () => o.state === 'DELIVERED');
      e.requestReturn(o.id, [0], 'کالای دریافتی اشتباه است');
      e.runAll(700);
    },
  },
  {
    id: 'SC-20', nameFa: '۲۰. مرجوعی آسیب‌دیده', tagFa: 'مرجوعی',
    descFa: 'بازرسی آسیب فیزیکی تشخیص می‌دهد؛ تعیین تکلیف: آسیب‌دیده + بازپرداخت وجه.',
    setup(e) {
      e.state.forces.damagedReturn = true;
      const o = e.scenarioOrder({ productIdx: 1, variantIdx: 0, qty: 1 });
      e.runAll(800);
      if (o.state !== 'DELIVERED') runUntil(e, () => o.state === 'DELIVERED');
      e.requestReturn(o.id, [0], 'کالا در اثر حمل آسیب دیده است');
      e.runAll(800);
    },
  },
  {
    id: 'SC-21', nameFa: '۲۱. مرجوعی و بازچیدانبار', tagFa: 'مرجوعی',
    descFa: 'مرجوعی سالم: کالا پس از بازرسی به موجودی قابل فروش برمی‌گردد (RESTOCK).',
    setup(e) {
      const o = e.scenarioOrder({ productIdx: 2, variantIdx: 3, qty: 1 });
      e.runAll(700);
      if (o.state !== 'DELIVERED') runUntil(e, () => o.state === 'DELIVERED');
      e.requestReturn(o.id, [0], 'اندازه مناسب نیست');
      e.runAll(800);
    },
  },
  {
    id: 'SC-22', nameFa: '۲۲. قرنطینه مرجوعی', tagFa: 'مرجوعی',
    descFa: 'نشانه‌های سوءاستفاده مشاهده می‌شود؛ کالا قرنطینه و از موجودی فروش خارج می‌شود.',
    setup(e) {
      e.state.forces.quarantineReturn = true;
      const o = e.scenarioOrder({ productIdx: 4, variantIdx: 3, qty: 1 });
      e.runAll(800);
      if (o.state !== 'DELIVERED') runUntil(e, () => o.state === 'DELIVERED');
      e.requestReturn(o.id, [0], 'کالا باز شده و ناقص است');
      e.runAll(800);
    },
  },
  {
    id: 'SC-23', nameFa: '۲۳. شکست بازپرداخت', tagFa: 'بازپرداخت',
    descFa: 'درگاه بازپرداخت خطا می‌دهد؛ استثنای REFUND_FAILURE و تلاش مجدد از مرکز استثنا.',
    setup(e) {
      e.state.forces.refundFail = true;
      const o = e.scenarioOrder({ productIdx: 2, variantIdx: 1, qty: 1 });
      e.state.script.push({ when: 'INVENTORY_RESERVED', action: 'CANCEL' });
      e.runAll(500);
      void o;
    },
  },
  {
    id: 'SC-24', nameFa: '۲۴. مغایرت شمارش موجودی', tagFa: 'موجودی',
    descFa: 'شمارش چرخه‌ای مغایرت نشان می‌دهد: تحقیق، تأیید و اصلاح دفتری در دفتر انبار.',
    setup(e) {
      const sku = e.state.products[0].variants[0].sku;
      e.startCycleCount(sku, 'WH-TEH-01', -2);
      e.runAll(120);
    },
  },
  {
    id: 'SC-25', nameFa: '۲۵. ازدحام ظرفیت انبار', tagFa: 'ظرفیت',
    descFa: 'چند سفارش همزمان → صف برداشت، هشدار «ظرفیت عملیاتی مرکز تکمیل شده است» و تأخیر در پردازش.',
    setup(e) {
      e.scenarioOrder({ productIdx: 0, variantIdx: 0, qty: 2 });
      e.scenarioOrder({ productIdx: 2, variantIdx: 0, qty: 3 });
      e.scenarioOrder({ productIdx: 4, variantIdx: 0, qty: 1 });
      e.scenarioOrder({ productIdx: 3, variantIdx: 1, qty: 2 });
      e.scenarioOrder({ productIdx: 1, variantIdx: 0, qty: 1 });
      e.runAll(400);
    },
  },
];

export function getScenario(id: ScenarioId | null | undefined): ScenarioDef | undefined {
  if (!id) return undefined;
  return SCENARIOS.find(s => s.id === id);
}
