// ============================================================================
// Persian (fa) labels for every technical identifier shown in the UI.
// ============================================================================

import type {
  Category, Disposition, ExceptionType, FulfillmentModel, InvState, OrderState,
  PaymentStatus, PickStrategy, RefundStatus, Severity, ShipmentState, TaskType,
  EmployeeRole, ReturnEligibility, InboundExceptionKind, ScenarioId,
} from './types';

export const faOrderState: Record<OrderState, string> = {
  PAYMENT_PENDING: 'در انتظار پرداخت',
  PAYMENT_SUCCESS: 'پرداخت انجام شد',
  PAYMENT_FAILED: 'پرداخت ناموفق',
  ORDER_CREATED: 'سفارش ثبت شد',
  ALLOCATION_PENDING: 'در حال تخصیص موجودی',
  INVENTORY_RESERVED: 'موجودی رزرو شد',
  SELLER_CONFIRMATION_PENDING: 'در انتظار تأیید فروشنده',
  SELLER_CONFIRMED: 'فروشنده تأیید کرد',
  SELLER_REJECTED: 'فروشنده رد کرد',
  PICKING_PENDING: 'در صف برداشت کالا',
  PICKING: 'در حال برداشت کالا (Picking)',
  PICKED: 'کالا برداشت شد',
  CONSOLIDATION: 'تجمیع سفارش',
  QC_PENDING: 'در انتظار کنترل کیفیت',
  PACKING: 'در حال بسته‌بندی (Packing)',
  PACKED: 'بسته‌بندی شد',
  SORTATION: 'تفکیک مرسولات (Sortation)',
  READY_FOR_DISPATCH: 'آماده ارسال',
  DISPATCHED: 'تحویل شرکت حمل',
  IN_TRANSIT: 'در مسیر ارسال',
  OUT_FOR_DELIVERY: 'در حال تحویل به مشتری',
  DELIVERED: 'تحویل شده',
  CANCELLATION_REQUESTED: 'درخواست لغو ثبت شد',
  CANCELLED: 'لغو شده',
  RETURN_REQUESTED: 'درخواست مرجوعی ثبت شد',
  RETURN_APPROVED: 'مرجوعی تأیید شد',
  RETURN_IN_TRANSIT: 'کالای مرجوعی در مسیر',
  RETURN_RECEIVED: 'کالای مرجوعی دریافت شد',
  RETURN_INSPECTION: 'بازرسی کالای مرجوعی',
  REFUND_PENDING: 'در انتظار بازپرداخت',
  REFUNDED: 'بازپرداخت انجام شد',
  RESTOCK_PENDING: 'در انتظار بازگشت به موجودی',
  RESTOCKED: 'به موجودی بازگشت',
  QUARANTINED: 'در قرنطینه',
  DAMAGED: 'آسیب‌دیده',
};

export const faShipmentState: Record<ShipmentState, string> = {
  ALLOCATED: 'تخصیص‌خورده',
  SELLER_CONFIRMATION_PENDING: 'در انتظار فروشنده',
  SELLER_CONFIRMED: 'فروشنده تأیید کرد',
  SELLER_REJECTED: 'فروشنده رد کرد',
  PICKING_PENDING: 'در صف برداشت',
  PICKING: 'در حال برداشت کالا',
  PICKED: 'برداشت شد',
  CONSOLIDATION: 'تجمیع',
  QC_PENDING: 'کنترل کیفیت',
  PACKING: 'بسته‌بندی',
  PACKED: 'بسته‌بندی شد',
  SORTATION: 'تفکیک مرسولات',
  READY_FOR_DISPATCH: 'آماده ارسال',
  DISPATCHED: 'تحویل شرکت حمل',
  IN_TRANSIT: 'در مسیر ارسال',
  OUT_FOR_DELIVERY: 'در حال تحویل',
  DELIVERED: 'تحویل شده',
  CANCELLED: 'لغو شده',
  INTERCEPTED: 'رهگیری و متوقف شد',
};

export const faInvState: Record<InvState, string> = {
  AVAILABLE: 'موجود و قابل فروش',
  RECEIVED: 'دریافت‌شده (چیدمان نشده)',
  RESERVED: 'رزرو شده',
  ALLOCATED: 'تخصیص‌یافته',
  PICKING: 'در حال برداشت',
  PICKED: 'برداشت‌شده',
  CONSOLIDATED: 'تجمیع‌شده',
  PACKED: 'بسته‌بندی‌شده',
  READY_FOR_DISPATCH: 'آماده ارسال',
  DISPATCHED: 'ارسال‌شده',
  DELIVERED: 'تحویل‌شده',
  RETURN_IN_TRANSIT: 'مرجوعی در مسیر',
  RETURN_RECEIVED: 'مرجوعی دریافت‌شده',
  QUARANTINED: 'قرنطینه',
  DAMAGED: 'آسیب‌دیده',
  RESTOCK_PENDING: 'در انتظار بازچیدانبار',
  RESTOCKED: 'بازچیدانبار شده',
};

export const faPaymentStatus: Record<PaymentStatus, string> = {
  PENDING: 'در انتظار پرداخت',
  SUCCESS: 'موفق',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
  TIMEOUT: 'مهلت پرداخت سپری شد',
};

export const faRefundStatus: Record<RefundStatus, string> = {
  REFUND_PENDING: 'در انتظار بازپرداخت',
  REFUND_PROCESSING: 'در حال پردازش بازپرداخت',
  REFUNDED: 'بازپرداخت شد',
  REFUND_FAILED: 'بازپرداخت ناموفق',
};

export const faTaskType: Record<TaskType, string> = {
  PAYMENT: 'پردازش پرداخت',
  ALLOCATION: 'تخصیص موجودی',
  SELLER_CONFIRM: 'تأیید فروشنده',
  SELLER_PREPARE: 'آماده‌سازی فروشنده',
  PICK: 'برداشت کالا (Picking)',
  CONSOLIDATION: 'تجمیع سفارش',
  QC: 'کنترل کیفیت (QC)',
  PACK: 'بسته‌بندی (Packing)',
  SORTATION: 'تفکیک مرسولات',
  HANDOVER: 'تحویل به شرکت حمل',
  TRANSIT: 'ขนصال در مسیر',
  OUT_FOR_DELIVERY: 'خروج برای تحویل',
  DELIVERY: 'تحویل به مشتری',
  INBOUND_TRANSIT: 'مسیر رسیدن محموله ورودی',
  RECEIVING: 'دریافت کالا (Receiving)',
  PUTAWAY: 'قرار دادن در محل (Put-away)',
  RETURN_PICKUP: 'دریافت مرجوعی از مشتری',
  RETURN_TRANSIT: 'مرجوعی در مسیر بازگشت',
  RETURN_RECEIVE: 'دریافت کالای مرجوعی',
  RETURN_INSPECT: 'بازرسی مرجوعی',
  DISPOSITION: 'تعیین تکلیف مرجوعی',
  REFUND: 'بازپرداخت وجه',
  TTL_EXPIRY: 'انقضای مهلت رزرو',
  CYCLE_COUNT: 'شمارش چرخه‌ای موجودی',
};

export const faFulfillment: Record<FulfillmentModel, string> = {
  PLATFORM: 'انبار مرکزی پلتفرم',
  SELLER_FC: 'موجودی فروشنده در انبار مرکزی',
  SELLER_FULFILLED: 'ارسال توسط فروشنده',
};

export const faCategory: Record<Category, string> = {
  SMARTPHONE: 'گوشی هوشمند',
  LAPTOP: 'لپ‌تاپ',
  HEADPHONES: 'هدفون',
  SMARTWATCH: ' ساعت هوشمند',
  CONSOLE: 'کنسول بازی',
};

export const faSeverity: Record<Severity, string> = {
  LOW: 'کم',
  MEDIUM: 'متوسط',
  HIGH: 'بالا',
  CRITICAL: 'بحرانی',
};

export const faExceptionType: Record<ExceptionType, string> = {
  INVENTORY_MISMATCH: 'مغایرت موجودی',
  SELLER_TIMEOUT: 'تأخیر فروشنده',
  SELLER_REJECT: 'رد سفارش توسط فروشنده',
  PICK_ERROR: 'خطای برداشت کالا',
  PACK_ERROR: 'خطای بسته‌بندی',
  SERIAL_MISMATCH: 'ناسازگاری شماره سریال',
  DAMAGED_PRODUCT: 'کالای آسیب‌دیده',
  CARRIER_FAILURE: 'خطای شرکت حمل',
  RETURN_ANOMALY: 'ناهنجاری مرجوعی',
  REFUND_FAILURE: 'خطای بازپرداخت',
  PAYMENT_FAILURE: 'خطای پرداخت',
  CAPACITY_CONGESTION: 'ازدحام ظرفیت انبار',
  RECEIVING_EXCEPTION: 'خطای فرایند دریافت کالا',
  ALLOCATION_FAILURE: 'شکست تخصیص موجودی',
  CYCLE_COUNT_DISCREPANCY: 'مغایرت شمارش موجودی',
};

export const faRole: Record<EmployeeRole, string> = {
  PICKER: 'برداشت‌کننده',
  PACKER: 'بسته‌بند',
  QC_OPERATOR: 'اپراتور کنترل کیفیت',
  RECEIVING_OPERATOR: 'اپراتور دریافت کالا',
  DISPATCH_OPERATOR: 'اپراتور ارسال',
  RETURN_INSPECTOR: 'بازرس مرجوعی',
};

export const faDisposition: Record<Disposition, string> = {
  RESTOCK: 'بازگشت به موجودی',
  OPEN_BOX: 'فروش بازشده',
  QUARANTINE: 'قرنطینه',
  DAMAGED: 'ثبت به عنوان آسیب‌دیده',
  REPAIR: 'ارسال به تعمیرات',
  SELLER_RETURN: 'بازگشت به فروشنده',
  DISPOSAL: 'اسقاط',
  MANUAL_REVIEW: 'نیازمند بررسی دستی',
};

export const faEligibility: Record<ReturnEligibility, string> = {
  APPROVED: 'تأیید شد',
  REQUIRES_REVIEW: 'نیازمند بررسی دستی',
  REJECTED: 'رد شد',
};

export const faInboundException: Record<InboundExceptionKind, string> = {
  NONE: 'بدون مشکل',
  SHORTAGE: 'کسری تعداد',
  WRONG_SKU: 'کالای اشتباه',
  DAMAGED_PACKAGING: 'بسته‌بندی آسیب‌دیده',
  BARCODE_UNREADABLE: 'بارکد غیرقابل خواندن',
  SERIAL_MISMATCH: 'ناسازگاری سریال',
  COUNTERFEIT_SUSPECT: 'مشکوک به تقلب',
  DOC_ISSUE: 'مشکل مدارک فروشنده',
};

export const faPickStrategy: Record<PickStrategy, string> = {
  SINGLE: 'برداشت تکی سفارش',
  BATCH: 'برداشت گروهی (Batch)',
  WAVE: 'برداشت موجی (Wave)',
  ZONE: 'برداشت منطقه‌ای (Zone)',
};

export const faSeverityColor: Record<Severity, string> = {
  LOW: '#64748b',
  MEDIUM: '#d97706',
  HIGH: '#ea580c',
  CRITICAL: '#dc2626',
};

// --- misc Persian text -------------------------------------------------------

export const faCarrierType = { NATIONAL: 'پست سراسری', LOCAL: 'پیک شهری' } as const;

export const faPaymentsMethod: Record<string, string> = {
  GATEWAY: 'درگاه پرداخت آنلاین',
  WALLET: 'کیف پول',
  COD: 'پرداخت در محل',
};

export const faCities = ['تهران', 'کرج', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'اهواز', 'رشت'] as const;

export const faExceptionStatus: Record<'OPEN' | 'IN_REVIEW' | 'RESOLVED', string> = {
  OPEN: 'باز',
  IN_REVIEW: 'در حال بررسی',
  RESOLVED: 'حل‌شده',
};

export const faToteState: Record<string, string> = {
  EMPTY: 'خالی',
  PICKING: 'در حال برداشت',
  PARTIALLY_FILLED: 'نیمه‌پر',
  FULL: 'پر',
  IN_TRANSIT: 'در مسیر',
  CONSOLIDATION: 'در حال تجمیع',
  COMPLETED: 'تکمیل شد',
};

export const faTaskStatus: Record<string, string> = {
  QUEUED: 'در صف',
  ACTIVE: 'در حال اجرا',
  DONE: 'انجام شده',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
};

export const faCycleCountState: Record<string, string> = {
  COUNTING: 'در حال شمارش',
  DISCREPANCY: 'مغایرت ثبت شد',
  INVESTIGATING: 'در حال بررسی',
  APPROVED: 'تأیید اصلاح',
  ADJUSTED: 'اصلاح دفتری انجام شد',
  MATCHED: 'مطابق',
};

export const faPackageType: Record<string, string> = {
  SMALL: 'کوچک', MEDIUM: 'متوسط', LARGE: 'بزرگ', FRAGILE: 'شکستنی',
};

export const faPackageState: Record<string, string> = {
  PACKING: 'در حال بسته‌بندی',
  PACKED: 'بسته‌بندی شد',
  LABELED: 'برچسب خورد',
  SORTED: 'تفکیک شد',
  LOADED: 'سوار خودرو شد',
  IN_TRANSIT: 'در مسیر',
  OUT_FOR_DELIVERY: 'در حال تحویل',
  DELIVERED: 'تحویل شده',
  RETURNED: 'مرجوعی',
  CLOSED: 'بسته شد',
};

export const faInboundState: Record<string, string> = {
  EXPECTED: 'در انتظار ورود',
  ARRIVED: 'در گیت ورود',
  RECEIVING: 'در حال دریافت کالا',
  RECEIVED: 'دریافت شد',
  PUTAWAY_DONE: 'چیدمان تکمیل شد',
  EXCEPTION: 'دارای خطا',
};

export const faManifestStatus: Record<string, string> = {
  READY: 'آماده',
  HANDOVER: 'تحویل شرکت حمل',
  DEPARTED: 'حرکت کرد',
};

export const faReturnState: Record<string, string> = {
  REQUESTED: 'درخواست ثبت شد',
  APPROVED: 'تأیید شد',
  REJECTED: 'رد شد',
  IN_TRANSIT: 'در مسیر بازگشت',
  RECEIVED: 'دریافت شد',
  INSPECTION: 'در حال بازرسی',
  DISPOSITIONED: 'تعیین تکلیف شد',
  CLOSED: 'بسته شد',
};

export const faNarration = (n: number) =>
  n.toLocaleString('fa-IR');

export const faDateTime = (t: number) => {
  const d = new Date(t);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} — ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const faTime = (t: number) => {
  const d = new Date(t);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const faDuration = (ms: number) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m.toLocaleString('fa-IR')} دقیقه`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h.toLocaleString('fa-IR')} ساعت و ${rm.toLocaleString('fa-IR')} دقیقه`;
};

export const faMoney = (n: number) => `${n.toLocaleString('fa-IR')} تومان`;

export const faPercent = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('fa-IR')}٪`;
