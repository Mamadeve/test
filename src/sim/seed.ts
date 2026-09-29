// ============================================================================
// Seed data: 5 demo products (100 units each), variants, warehouses,
// locations, sellers, employees, carriers, customers.
// All identifiers below are SIMULATED — not claims about any real company.
// ============================================================================

import type {
  Carrier, Customer, Employee, InvCounts, Location, Product, Seller, SimState, Variant, Warehouse,
} from './types';

const mkBarcode = (seed: number) => {
  // deterministic 13-digit barcode starting with 890 (Iran GS1 prefix)
  let s = '';
  let x = seed * 2654435761 % 2147483647;
  for (let i = 0; i < 11; i++) { x = (x * 48271) % 2147483647; s += String(x % 10); }
  return '890' + s.slice(0, 10);
};

function variant(productId: string, sku: string, price: number, attrs: Record<string, string>, codeIdx: number): Variant {
  const short = productId.replace('PRD-', '');
  return {
    id: `VAR-${short}-${sku.split('-').slice(1).join('-')}`,
    productId,
    sku,
    barcode: mkBarcode(codeIdx),
    price,
    attrs,
  };
}

export function buildProducts(): Product[] {
  const products: Product[] = [];

  // 1) Smartphone — serialized
  {
    const id = 'PRD-00021';
    const variants: Variant[] = [
      variant(id, 'PHX-BLK-256', 28990000, { رنگ: 'مشکی', حافظه: '۲۵۶ گیگابایت', گارانتی: '۱۸ ماهه' }, 10021),
      variant(id, 'PHX-WHT-256', 28990000, { رنگ: 'سفید', حافظه: '۲۵۶ گیگابایت', گارانتی: '۱۸ ماهه' }, 10022),
      variant(id, 'PHX-BLK-512', 32490000, { رنگ: 'مشکی', حافظه: '۵۱۲ گیگابایت', گارانتی: '۱۸ ماهه' }, 10023),
      variant(id, 'PHX-GRN-512', 32990000, { رنگ: 'سبز', حافظه: '۵۱۲ گیگابایت', گارانتی: '۲۴ ماهه' }, 10024),
    ];
    products.push({
      id, nameFa: 'گوشی هوشمند فونیکس پرو', category: 'SMARTPHONE', brand: 'فونیکس', sellerId: 'SELL-001',
      serialized: true, fragile: true, baseWeightKg: 0.4,
      descriptionFa: 'گوشی پرچم‌بردار با نمایشگر ۶.۷ اینچی، دوربین سه‌گانه و پردازنده نسل جدید.',
      initialQty: 100, variants,
    });
  }

  // 2) Laptop — serialized
  {
    const id = 'PRD-00022';
    const variants: Variant[] = [
      variant(id, 'LPT-GRY-16TB', 41990000, { رنگ: 'خاکستری', رم: '۱۶ گیگابایت', حافظه: '۵۱۲ گیگابایت SSD' }, 10031),
      variant(id, 'LPT-SLV-16TB', 42490000, { رنگ: 'نقره‌ای', رم: '۱۶ گیگابایت', حافظه: '۵۱۲ گیگابایت SSD' }, 10032),
      variant(id, 'LPT-GRY-32TB', 49990000, { رنگ: 'خاکستری', رم: '۳۲ گیگابایت', حافظه: '۱ ترابایت SSD' }, 10033),
      variant(id, 'LPT-BLK-32TB', 51490000, { رنگ: 'مشکی', رم: '۳۲ گیگابایت', حافظه: '۱ ترابایت SSD' }, 10034),
    ];
    products.push({
      id, nameFa: 'لپ‌تاپ اولترابوک نووا ۱۴', category: 'LAPTOP', brand: 'نووا', sellerId: 'SELL-002',
      serialized: true, fragile: true, baseWeightKg: 1.6,
      descriptionFa: 'اولترابوک سبک با صفحه‌نمایش ۱۴ اینچی IPS، مناسب کار و دانشجویی.',
      initialQty: 100, variants,
    });
  }

  // 3) Headphones — not serialized
  {
    const id = 'PRD-00023';
    const variants: Variant[] = [
      variant(id, 'HPH-BLK-ANC', 3490000, { رنگ: 'مشکی', نسخه: 'حذف نویز فعال' }, 10041),
      variant(id, 'H PH-WHT-ANC'.replace(' ', ''), 3490000, { رنگ: 'سفید', نسخه: 'حذف نویز فعال' }, 10042),
      variant(id, 'HPH-BLK-STD', 2190000, { رنگ: 'مشکی', نسخه: 'استاندارد' }, 10043),
      variant(id, 'HPH-BLU-STD', 2290000, { رنگ: 'آبی', نسخه: 'استاندارد' }, 10044),
    ];
    products.push({
      id, nameFa: 'هدفون بی‌سیم اکو ساند', category: 'HEADPHONES', brand: 'اکو', sellerId: 'SELL-003',
      serialized: false, fragile: false, baseWeightKg: 0.25,
      descriptionFa: 'هدفون روگوشی بی‌سیم با باتری ۴۰ ساعته و کیفیت صدای Hi-Res.',
      initialQty: 100, variants,
    });
  }

  // 4) Smartwatch — serialized
  {
    const id = 'PRD-00024';
    const variants: Variant[] = [
      variant(id, 'WCH-BLK-42', 5890000, { رنگ: 'مشکی', اندازه: '۴۲ میلی‌متر' }, 10051),
      variant(id, 'WCH-SLV-42', 5890000, { رنگ: 'نقره‌ای', اندازه: '۴۲ میلی‌متر' }, 10052),
      variant(id, 'WCH-BLK-46', 6490000, { رنگ: 'مشکی', اندازه: '۴۶ میلی‌متر' }, 10053),
      variant(id, 'WCH-GLD-46', 6790000, { رنگ: 'طلایی', اندازه: '۴۶ میلی‌متر' }, 10054),
    ];
    products.push({
      id, nameFa: 'ساعت هوشمند اورا باند', category: 'SMARTWATCH', brand: 'اورا', sellerId: 'SELL-004',
      serialized: true, fragile: false, baseWeightKg: 0.15,
      descriptionFa: 'ساعت هوشمند با سنسور ضربان قلب، GPS و مقاومت در برابر آب.',
      initialQty: 100, variants,
    });
  }

  // 5) Gaming console — serialized
  {
    const id = 'PRD-00025';
    const variants: Variant[] = [
      variant(id, 'CNS-WHT-1TB', 34990000, { نسخه: 'استاندارد', حافظه: '۱ ترابایت' }, 10061),
      variant(id, 'CNS-BLK-1TB', 34990000, { نسخه: 'استاندارد', حافظه: '۱ ترابایت' }, 10062),
      variant(id, 'CNS-BLK-2TB', 39490000, { نسخه: 'دیجیتال', حافظه: '۲ ترابایت' }, 10063),
      variant(id, 'CNS-EDT-2TB', 42990000, { نسخه: 'نسخه ویژه', حافظه: '۲ ترابایت' }, 10064),
    ];
    products.push({
      id, nameFa: 'کنسول بازی نکست‌گیم X', category: 'CONSOLE', brand: 'نکست‌گیم', sellerId: 'SELL-001',
      serialized: true, fragile: true, baseWeightKg: 4.5,
      descriptionFa: 'کنسول بازی نسل جدید با پشتیبانی از 4K و ذخیره‌سازی SSD پرسرعت.',
      initialQty: 100, variants,
    });
  }

  return products;
}

export function buildSellers(): Seller[] {
  return [
    {
      id: 'SELL-001', nameFa: 'فروشگاه مرکزی (پلتفرم)', fulfillment: 'PLATFORM',
      sla: { confirmMinutes: 0, prepareMinutes: 0, cancelRate: 0.01, stockReliability: 0.99, onTimeRate: 0.97 },
    },
    {
      id: 'SELL-002', nameFa: 'پخش آریا دیجیتال', fulfillment: 'SELLER_FC',
      warehouseId: 'WH-TEH-01',
      sla: { confirmMinutes: 30, prepareMinutes: 45, cancelRate: 0.05, stockReliability: 0.93, onTimeRate: 0.91 },
    },
    {
      id: 'SELL-003', nameFa: 'تک‌مال استور', fulfillment: 'SELLER_FULFILLED',
      sla: { confirmMinutes: 60, prepareMinutes: 120, cancelRate: 0.12, stockReliability: 0.86, onTimeRate: 0.82 },
    },
    {
      id: 'SELL-004', nameFa: 'الکترونیک پارسیان', fulfillment: 'SELLER_FULFILLED',
      sla: { confirmMinutes: 45, prepareMinutes: 90, cancelRate: 0.07, stockReliability: 0.9, onTimeRate: 0.88 },
    },
  ];
}

export function buildCarriers(): Carrier[] {
  return [
    { id: 'CAR-01', nameFa: 'شرکت حمل سراسری پارس‌پست (شبیه‌سازی‌شده)', type: 'NATIONAL' },
    { id: 'CAR-02', nameFa: 'پیک شهری راپیدو (شبیه‌سازی‌شده)', type: 'LOCAL' },
  ];
}

export function buildCustomers(): Customer[] {
  return [
    { id: 'CUS-0001', nameFa: 'سارا محمدی', phone: '۰۹۱۲۱۲۳۴۵۶۷', city: 'تهران', addressFa: 'تهران، سعادت‌آباد، خیابان علامه، پلاک ۱۲' },
    { id: 'CUS-0002', nameFa: 'رضا احمدی', phone: '۰۹۱۲۹۸۷۶۵۴۳', city: 'اصفهان', addressFa: 'اصفهان، خیابان چهارباغ بالا، نبش کوچه بهاران، پلاک ۳۴' },
    { id: 'CUS-0003', nameFa: 'مریم کریمی', phone: '۰۹۳۵۵۵۵۱۲۳۴', city: 'مشهد', addressFa: 'مشهد، بلوار سجاد، ساختمان پزشکان، طبقه دوم' },
    { id: 'CUS-0004', nameFa: 'امیر حسینی', phone: '۰۹۱۲۷۷۷۸۸۹۹', city: 'تبریز', addressFa: 'تبریز، خیابان آزادی، جنب بانک مرکزی، پلاک ۷' },
    { id: 'CUS-0005', nameFa: 'نگار صادقی', phone: '۰۹۰۱۱۱۱۲۲۳۳', city: 'تهران', addressFa: 'تهران، میدان ونک، خیابان ملاصدرا، پلاک ۱۰۱' },
  ];
}

export function buildWarehouses(): Warehouse[] {
  const zonesFor = (wh: string): Warehouse['zones'] => [
    { id: `${wh}/Z-A`, warehouseId: wh, code: 'Z-A', nameFa: 'منطقه الکترونیک' },
    { id: `${wh}/Z-B`, warehouseId: wh, code: 'Z-B', nameFa: 'منطقه کوچک‌جثه' },
    { id: `${wh}/Z-C`, warehouseId: wh, code: 'Z-C', nameFa: 'منطقه سنگین' },
    { id: `${wh}/Z-D`, warehouseId: wh, code: 'Z-D', nameFa: 'منطقه مرجوعی و قرنطینه' },
  ];
  return [
    {
      id: 'WH-TEH-01', nameFa: 'مرکز تکمیل سفارش تهران ۱', city: 'تهران',
      regions: ['تهران', 'کرج', 'رشت'],
      zones: zonesFor('WH-TEH-01'),
      capacity: { receiving: 8, picking: 6, packing: 5, dispatch: 10 },
      used: { receiving: 0, picking: 0, packing: 0, dispatch: 0 },
      capacityState: 'NORMAL',
    },
    {
      id: 'WH-TEH-02', nameFa: 'مرکز تکمیل سفارش تهران ۲', city: 'تهران',
      regions: ['تهران', 'اصفهان', 'شیراز'],
      zones: zonesFor('WH-TEH-02'),
      capacity: { receiving: 6, picking: 5, packing: 4, dispatch: 8 },
      used: { receiving: 0, picking: 0, packing: 0, dispatch: 0 },
      capacityState: 'NORMAL',
    },
    {
      id: 'WH-TEH-03', nameFa: 'مرکز تکمیل سفارش تهران ۳', city: 'کرج',
      regions: ['تهران', 'کرج', 'تبریز', 'مشهد', 'اهواز'],
      zones: zonesFor('WH-TEH-03'),
      capacity: { receiving: 5, picking: 4, packing: 4, dispatch: 6 },
      used: { receiving: 0, picking: 0, packing: 0, dispatch: 0 },
      capacityState: 'NORMAL',
    },
  ];
}

export function buildEmployees(): Employee[] {
  const names = ['علی رضایی', 'حسن محمدی', ' Fatemeh', 'مهدی قاسمی', 'زهرا نوری', 'امیر عباسی',
    'نیما کاظمی', 'فرشاد بهرامی', 'الهام سلطانی', 'رامین مرادی', 'بهنام صادقی', 'شقایق رحیمی',
    'کامران ایزدی', 'مهسا عبدی', 'پارسا نعمتی', 'سینا شریفی', 'نوشین موسوی', 'داریوش فرجی',
    'یاسمن نیک‌رو', 'کیان رستمی'];
  const roles: Employee['role'][] = ['PICKER', 'PACKER', 'QC_OPERATOR', 'RECEIVING_OPERATOR', 'DISPATCH_OPERATOR', 'RETURN_INSPECTOR'];
  const list: Employee[] = [];
  let i = 0;
  for (const wh of ['WH-TEH-01', 'WH-TEH-02', 'WH-TEH-03']) {
    const suffix = wh.slice(-2);
    for (const role of roles) {
      const count = role === 'PICKER' ? 3 : role === 'PACKER' ? 2 : 1;
      for (let c = 0; c < count; c++) {
        const raw = names[i % names.length];
        const nameFa = raw === ' Fatemeh' ? 'فاطمه زارعی' : raw;
        list.push({
          id: `EMP-${suffix}-${String(i + 1).padStart(3, '0')}`,
          nameFa, role, warehouseId: wh, busyUntil: 0, tasksDone: 0, errors: 0,
        });
        i++;
      }
    }
  }
  return list;
}

/** Build the location hierarchy for a warehouse: WH / Z / Aisle / Rack / Shelf / Bin */
export function buildLocations(warehouses: Warehouse[]): Record<string, Location> {
  const locs: Record<string, Location> = {};
  for (const wh of warehouses) {
    for (const zone of wh.zones) {
      const aisles = zone.code === 'Z-A' ? ['A01', 'A02', 'A03'] : zone.code === 'Z-B' ? ['B01', 'B02'] : zone.code === 'Z-C' ? ['C01', 'C02'] : ['D01'];
      for (const aisle of aisles) {
        for (let rack = 1; rack <= 4; rack++) {
          for (let shelf = 1; shelf <= 2; shelf++) {
            for (let bin = 1; bin <= 3; bin++) {
              const id = `${wh.id}/${zone.code}/${aisle}/R${String(rack).padStart(2, '0')}/S${String(shelf).padStart(2, '0')}/B${String(bin).padStart(2, '0')}`;
              locs[id] = {
                id, warehouseId: wh.id, zone: zone.code, aisle,
                rack: `R${String(rack).padStart(2, '0')}`,
                shelf: `S${String(shelf).padStart(2, '0')}`,
                bin: `B${String(bin).padStart(2, '0')}`,
                kind: 'STORAGE', contents: {}, capacity: 50,
              };
            }
          }
        }
      }
    }
    // docks / staging / qc / returns areas
    const extra: [string, Location['kind'], string][] = [
      ['DOCK-IN', 'DOCK', 'بارانداز ورود'],
      ['STAGE-01', 'STAGING', 'منطقه تجمیع'],
      ['QC-01', 'QC', 'ایستگاه کنترل کیفیت'],
      ['RET-01', 'RETURNS', 'ناحیه مرجوعی'],
    ];
    for (const [code, kind, _n] of extra) {
      const id = `${wh.id}/${code}`;
      locs[id] = {
        id, warehouseId: wh.id, zone: '-', aisle: '-', rack: '-', shelf: '-', bin: code,
        kind, contents: {}, capacity: 200,
      };
    }
  }
  return locs;
}

export function storageLocationsFor(whId: string, locs: Record<string, Location>): Location[] {
  return Object.values(locs).filter(l => l.warehouseId === whId && l.kind === 'STORAGE');
}

export function emptyInvCounts(): InvCounts {
  return {
    AVAILABLE: 0, RECEIVED: 0, RESERVED: 0, ALLOCATED: 0, PICKING: 0, PICKED: 0,
    CONSOLIDATED: 0, PACKED: 0, READY_FOR_DISPATCH: 0, DISPATCHED: 0,
    DELIVERED: 0, RETURN_IN_TRANSIT: 0, RETURN_RECEIVED: 0, QUARANTINED: 0,
    DAMAGED: 0, RESTOCK_PENDING: 0, RESTOCKED: 0,
  };
}
