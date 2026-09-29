import React, { useState } from 'react';
import type { OrderState, Severity, ShipmentState } from '../sim/types';
import { faOrderState, faShipmentState, faDateTime } from '../sim/labels';

// ---------------------------------------------------------------- chips -----

const ORDER_COLORS: Record<OrderState, string> = {
  PAYMENT_PENDING: 'yellow', PAYMENT_SUCCESS: 'green', PAYMENT_FAILED: 'red',
  ORDER_CREATED: 'blue', ALLOCATION_PENDING: 'cyan', INVENTORY_RESERVED: 'cyan',
  SELLER_CONFIRMATION_PENDING: 'yellow', SELLER_CONFIRMED: 'green',
  SELLER_REJECTED: 'red', PICKING_PENDING: 'blue', PICKING: 'blue', PICKED: 'cyan',
  CONSOLIDATION: 'violet', QC_PENDING: 'violet', PACKING: 'orange', PACKED: 'orange',
  SORTATION: 'pink', READY_FOR_DISPATCH: 'green', DISPATCHED: 'blue', IN_TRANSIT: 'cyan',
  OUT_FOR_DELIVERY: 'orange', DELIVERED: 'green', CANCELLATION_REQUESTED: 'yellow',
  CANCELLED: 'red', RETURN_REQUESTED: 'yellow', RETURN_APPROVED: 'green',
  RETURN_IN_TRANSIT: 'cyan', RETURN_RECEIVED: 'blue', RETURN_INSPECTION: 'violet',
  REFUND_PENDING: 'yellow', REFUNDED: 'green', RESTOCK_PENDING: 'yellow',
  RESTOCKED: 'green', QUARANTINED: 'red', DAMAGED: 'red',
};

export function OrderChip({ state }: { state: OrderState }) {
  return <span className={`chip ${ORDER_COLORS[state] ?? 'gray'}`}>{faOrderState[state]}</span>;
}

export function ShipmentChip({ state }: { state: ShipmentState }) {
  const color = state === 'DELIVERED' ? 'green' : state === 'CANCELLED' || state === 'SELLER_REJECTED' ? 'red'
    : ['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(state) ? 'cyan' : 'blue';
  return <span className={`chip ${color}`}>{faShipmentState[state]}</span>;
}

export function SevChip({ sev }: { sev: Severity }) {
  const m: Record<Severity, string> = { LOW: 'gray', MEDIUM: 'yellow', HIGH: 'orange', CRITICAL: 'red' };
  const fa: Record<Severity, string> = { LOW: 'کم', MEDIUM: 'متوسط', HIGH: 'بالا', CRITICAL: 'بحرانی' };
  return <span className={`chip ${m[sev]} plain`}>{fa[sev]}</span>;
}

// -------------------------------------------------------------- stat card ---
export function Stat({ lbl, val, sub, tone = '' }: { lbl: string; val: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="lbl">{lbl}</div>
      <div className="val">{val}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- drawer ----
export function Drawer({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" style={wide ? { width: 'min(920px, 96vw)' } : undefined}>
        <div className="drawer-h">
          <h3>{title}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-b">{children}</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- modal -----
export function Modal({ title, onClose, children, footer }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-wrap">
        <div className="modal">
          <div className="modal-h"><h3>{title}</h3><button className="x" onClick={onClose}>✕</button></div>
          <div className="modal-b">{children}</div>
          {footer && <div className="modal-f">{footer}</div>}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------- page header --
export function PageH({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="page-h">
      <h2>{title}</h2>
      <div className="spacer" />
      {children}
      {desc && <div className="desc">{desc}</div>}
    </div>
  );
}

// ------------------------------------------------------------ empty state ---
export function Empty({ icon, text }: { icon: string; text: string }) {
  return <div className="empty"><div className="big">{icon}</div>{text}</div>;
}

// ----------------------------------------------------------- key/value ------
export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ------------------------------------------------------- methodology note ---
export function Disclosure() {
  return (
    <div className="disclosure">
      <h4>درباره مدل شبیه‌سازی <span className="n" style={{ color: 'var(--txt3)', fontWeight: 600, fontSize: 12 }}>(Model &amp; Methodology Disclosure)</span></h4>
      <p>
        این برنامه یک <b>شبیه‌ساز تعاملی آموزشی</b> از چرخه فروش بازارگاهی، مدیریت سفارش (OMS)، مدیریت انبار (WMS)،
        تکمیل سفارش و لجستیک معکوس است. همهٔ داده‌ها، زمان‌ها و رفتارها در همین مرورگر تولید می‌شوند.
      </p>
      <p>
        <span className="badge-src pub">مستند عمومی</span>
        مفاهیم پایه — سبد خرید، پرداخت اینترنتی، پیگیری مرسوله، مرجوعی کالا، بارکد و شماره رهگیری — بر اساس
        مستندات عمومی و تجربهٔ رایج خرید از فروشگاه‌های اینترنتی مدل شده‌اند.
      </p>
      <p>
        <span className="badge-src ind">استاندارد صنعت</span>
        الگوهای عملیاتی — ماشین وضعیت سفارش، چرخهٔ موجودی (رزرو/تخصیص/برداشت/بسته‌بندی)، سه مدل ارسال
        (پلتفرمی / انبار فروشنده / ارسال فروشنده)، شمارش چرخه‌ای، کنترل کیفیت، مانیفست و صدور بارنامه —
        بر اساس شیوه‌های مستندشده و استانداردهای شناخته‌شدهٔ صنعت خرده‌فروشی و زنجیره تأمین مدل شده‌اند.
      </p>
      <p>
        <span className="badge-src sim">شبیه‌سازی</span>
        اعداد و زمان‌ها — مهلت‌های پرداخت و تأیید فروشنده، سرعت کارکنان، ظرفیت انبارها، نرخ خطا، رفتار درگاه
        پرداخت، سیاست‌های SLA و جزئیات ۲۵ سناریو — <b>سرهم‌بندی‌شده برای آموزش‌اند</b> و رویه یا آمار داخلی هیچ
        شرکت واقعی را بازتاب نمی‌دهند.
      </p>
      <p className="tiny">
        ⚠️ هیچ فرایند یا عددی به‌عنوان رویهٔ داخلی دیجی‌کالا، اسنپ‌شاپ یا هر برند دیگری ادعا نمی‌شود؛ نام‌های
        فروشندگان، انبارها و کالاها نیز صرفاً نمونه‌های فرضی‌اند. این مدل «مدل شبیه‌سازی‌شده بر اساس رویه‌های
        عمومی و استانداردهای صنعت» است.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ toast hook ----
export function useToasts() {
  const [toasts, setToasts] = useState<{ id: number; text: string; tone?: string }[]>([]);
  const push = (text: string, tone?: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  };
  const node = (
    <div className="toasts">
      {toasts.map(t => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.text}</div>)}
    </div>
  );
  return { push, node };
}

export { faOrderState, faDateTime };
