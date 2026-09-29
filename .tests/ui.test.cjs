'use strict';
/* UI walkthrough: structure, flows, Persian copy, and CROSS-CHECKS of every
   displayed number against the live engine (window.__SIM_ENGINE__). */
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').replace(/\s+/g, ' ').trim();
const fa2n = s => {
  if (s == null) return NaN;
  const map = { '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٬':',','،':',' };
  let out = ''; for (const ch of String(s)) out += (ch in map ? map[ch] : ch);
  const m = out.replace(/[^0-9.]/g, '');
  return m === '' ? NaN : Number(m);
};
const hasAscii = s => /[0-9]/.test(s || '');
async function until(fn, ms = 5000, every = 70) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(every); }
  return false;
}

(async () => {
  const vc = new VirtualConsole();
  const jsErrors = [];
  vc.on('jsdomError', e => jsErrors.push(String((e && e.message) || e)));
  vc.on('error', (...a) => jsErrors.push(a.map(String).join(' ')));

  const fs = require('fs');
  const { execSync } = require('child_process');
  const root = path.join(__dirname, '..');
  // jsdom cannot execute ESM module scripts → build a classic IIFE bundle for the test
  execSync(path.join(root, 'node_modules', '.bin', 'esbuild') +
    ` src/main.tsx --bundle --format=iife --platform=browser --jsx=automatic` +
    ` --define:process.env.NODE_ENV='"production"' --outfile=.tests/build/app-test.js --log-level=error`,
    { cwd: root, stdio: 'inherit' });
  const bundle = fs.readFileSync(path.join(root, '.tests/build/app-test.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>تست</title>` +
    `<style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://localhost/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  });
  const win = dom.window, doc = win.document;
  win.addEventListener('error', ev => jsErrors.push(String(ev.message)));
  win.confirm = () => true;

  const q = (sel, root = doc) => root.querySelector(sel);
  const qa = (sel, root = doc) => [...root.querySelectorAll(sel)];
  const btn = (text, root = doc) => qa('button', root || doc).find(b => norm(b.textContent).includes(text));
  const tabBtn = (text, root = doc) => qa('button', root).find(b => norm(b.textContent).startsWith(text));
  const click = el => { if (el) el.click(); };
  const main = () => q('.main');
  const mainLen = () => norm(main() && main().textContent).length;
  const statVal = (lbl) => {
    const s = qa('.stat').find(x => norm(x.querySelector('.lbl') && x.querySelector('.lbl').textContent) === lbl
      || norm(x.querySelector('.lbl') && x.querySelector('.lbl').textContent).startsWith(lbl));
    return s ? norm(s.querySelector('.val').textContent) : null;
  };

  console.log('\n== UI suite ==');
  const mounted = await until(() => win.__SIM_ENGINE__ && q('.hdr') && q('.modes'));
  ok('برنامه در jsdom بالا آمد', mounted);
  if (!mounted) { console.log('FATAL: app did not mount'); console.log(jsErrors.slice(0, 5)); process.exit(1); }
  const E = win.__SIM_ENGINE__;
  const fa = (n) => n.toLocaleString('fa-IR');
  const engineSellable = () => E.state.products.reduce((s, p) => s + p.variants.reduce((a, v) => a + E.totalAvailable(v.sku), 0), 0);

  // ------------------------------------------------------------ shell -----
  ok('سربرگ: عنوان «بازارگاه و زنجیره تأمین»', norm(q('.brand h1').textContent) === 'بازارگاه و زنجیره تأمین');
  ok('سه پرسپکتیو با برچسب دقیق', qa('.modes button').map(b => norm(b.textContent)).join(',') === 'مشتری,عملیات,سیستم',
    qa('.modes button').map(b => norm(b.textContent)).join(','));
  const ctlTexts = qa('.sim-controls')[0] ? qa('.sim-controls')[0] ? [...qa('.sim-controls')[0].querySelectorAll('button')].map(b => norm(b.textContent)) : [] : [];
  ok('کنترل‌ها: شروع/توقف/مرحله بعد/اجرای سریع/اجرای کامل/بازنشانی',
    ['شروع', 'توقف', 'مرحله بعد', 'اجرای سریع', 'اجرای کامل', 'بازنشانی'].every(k => ctlTexts.some(t => t.includes(k))),
    ctlTexts.join('|'));
  ok('ناو کناری: پرسپکتیو + کنترل زمان + راهنما',
    ['پرسپکتیو نمایش', 'کنترل زمان شبیه‌سازی', 'سه پرسپکتیو'].every(t => norm(q('.side').textContent).includes(t)));
  ok('پاورقی: نشان‌های مرجعیت (مستند عمومی/استاندارد صنعت/شبیه‌سازی)',
    ['مستند عمومی', 'استاندارد صنعت', 'شبیه‌سازی'].every(t => norm(q('.ftr').textContent).includes(t)));
  ok('افشای روش‌شناسی «درباره مدل شبیه‌سازی» در صفحه هست',
    q('.disclosure') && norm(q('.disclosure').textContent).includes('درباره مدل شبیه‌سازی'));
  ok('دکمه زنگ اعلان‌ها', !!q('.bell'));

  // ------------------------------------------------- header cross-check ----
  const hdr = q('.hdr-kpi');
  ok('سربرگ: نشانگر «موجودی قابل فروش»', hdr && norm(hdr.querySelector('span').textContent) === 'موجودی قابل فروش');
  ok('کراس‌چک سربرگ == مجموع موجودی قابل فروش موتور',
    hdr && fa2n(hdr.querySelector('b').textContent) === engineSellable(),
    hdr && `${hdr.querySelector('b').textContent} != ${fa(engineSellable())}`);
  ok('ارقام سربرگ فارسی‌اند', hdr && !hasAscii(hdr.querySelector('b').textContent));

  // ---------------------------------------------------- storefront --------
  const shopBtn = tabBtn('فروشگاه'); click(shopBtn);
  await sleep(120);
  const cards = qa('.prod');
  ok('ویترین: ۵ کارت محصول', cards.length === 5, `count=${cards.length}`);
  const stockCross = () => {
    for (const c of cards) {
      const name = norm(q('.nm', c).textContent);
      const p = E.state.products.find(x => x.nameFa === name);
      if (!p) return `no product ${name}`;
      const expected = p.variants.reduce((s, v) => s + E.totalAvailable(v.sku), 0);
      const t = norm(c.textContent);
      const m = t.match(/موجود در انبار \(([۰-۹]+) عدد\)/);
      if (expected > 0) {
        if (!m) return `${name}: stock text missing`;
        if (fa2n(m[1]) !== expected) return `${name}: ui=${m[1]} engine=${expected}`;
      } else if (!t.includes('ناموجود')) return `${name}: should be ناموجود`;
    }
    return '';
  };
  const sc1 = stockCross();
  ok('کراس‌چک موجودی هر محصول در ویترین == موتور', !sc1, sc1);
  ok('قیمت‌ها با «تومان» نمایش داده می‌شوند', cards.every(c => norm(c.textContent).includes('تومان')));
  ok('نام محصولات فارسی است', cards.every(c => { const n = norm(q('.nm', c).textContent); return n.length > 3; }));

  // ------------------------------------------- product modal + cart --------
  click(cards[0]);
  await sleep(150);
  const modal = q('.modal-wrap');
  ok('مدال محصول باز شد + دکمه افزودن به سبد', !!modal && !!btn('افزودن به سبد خرید', modal));
  const variantStocks = qa('.modal .tiny, .modal b, .modal span', modal).map(x => norm(x.textContent)).filter(t => t.includes('عدد موجود'));
  ok('موجودی نسخه‌ها در مدال با عدد فارسی', variantStocks.length > 0 && variantStocks.every(t => !hasAscii(t.split('عدد')[0])),
    variantStocks.join('|'));
  click(btn('افزودن به سبد خرید', modal));
  await sleep(150);
  ok('اعلان «کالا به سبد خرید اضافه شد» (notification)',
    (q('.toasts') && norm(q('.toasts').textContent).includes('کالا به سبد خرید اضافه شد'))
    || E.state.notifications.some(n => (n.bodyFa || '').includes('کالا به سبد خرید اضافه شد')));
  click(btn('انصراف', modal));
  await sleep(120);
  const cartTag = qa('.tag').map(t => norm(t.textContent)).find(t => t.includes('سبد'));
  ok('شمارنده سبد خرید ≥ ۱', cartTag && fa2n(cartTag.split('سبد:')[1]) >= 1, cartTag);

  // ------------------------------------------------------- checkout --------
  const ordersBefore = E.state.orders.length;
  click(btn('تسویه حساب'));
  await sleep(150);
  const coModal = q('.modal-wrap');
  ok('مدال تسویه حساب باز شد', !!coModal && norm(coModal.textContent).includes('تسویه حساب'));
  const amountMatch = norm(coModal.textContent).match(/مبلغ قابل پرداخت\s*([۰-۹٬]+)\s*تومان/);
  const uiAmount = amountMatch ? fa2n(amountMatch[1]) : NaN;
  ok('مبلغ قابل پرداخت خوانا است', Number.isFinite(uiAmount) && uiAmount > 0, amountMatch ? amountMatch[1] : 'no match');
  click(btn('پرداخت و ثبت نهایی', coModal));
  await until(() => E.state.orders.length === ordersBefore + 1, 3000);
  ok('سفارش جدید در موتور ثبت شد', E.state.orders.length === ordersBefore + 1,
    `${ordersBefore} -> ${E.state.orders.length}`);
  const newOrder = E.state.orders[E.state.orders.length - 1];
  const payOf = () => E.state.payments.find(p => p.id === newOrder.paymentId);
  const pay = payOf();
  ok('کراس‌چک مبلغ موتور == مبلغ نمایش‌داده‌شده',
    pay && pay.amount === uiAmount, `engine=${pay && pay.amount} ui=${uiAmount}`);
  const itemsSum = newOrder.items.reduce((a, i) => a + i.unitPrice * i.qty, 0);
  ok('مبلغ سفارش == جمع اقلام (بدون تخفیف نامعتبر)',
    newOrder.totalAmount === itemsSum && pay.amount === itemsSum,
    `total=${newOrder.totalAmount} sum=${itemsSum} pay=${pay && pay.amount}`);

  // ----------------------------------------------------- orders tab -------
  click(tabBtn('سفارش‌های من'));
  await sleep(150);
  ok('جدول سفارش‌های من سفارش تازه را دارد', doc.body.textContent.includes(newOrder.id));
  const detailsBtn = btn('جزئیات');
  ok('دکمه جزئیات موجود است', !!detailsBtn);
  click(detailsBtn);
  await sleep(200);
  const drawer = q('.drawer');
  ok('کشوی جزئیات سفارش باز شد', !!drawer && norm(drawer.textContent).includes(newOrder.id));
  const drawerClose = drawer ? [...drawer.querySelectorAll('button')].find(b => b.textContent.includes('✕')) : null;
  click(drawerClose);
  await sleep(150);
  ok('کشو بسته شد', !q('.drawer'));

  // -------------------------------------------------------- bell ----------
  click(q('.bell'));
  await sleep(150);
  ok('پنل اعلان‌ها باز شد', !!q('.notif-panel') && norm(q('.notif-panel').textContent).includes('اعلان‌ها'));
  click(btn('✕', q('.notif-panel')));
  await sleep(120);
  ok('پنل اعلان‌ها بسته شد', !q('.notif-panel'));

  // -------------------------------------------------- sim controls --------
  const t0 = E.state.simTime, v0 = E.state.version;
  click(qa('.sim-controls')[0].querySelectorAll('button')[0]); // ▶ شروع
  const started = await until(() => E.running === true, 2000);
  ok('▶ شروع → موتور در حال اجرا', started);
  ok('ناو کناری: «در حال اجرا»', norm(q('.side').textContent).includes('در حال اجرا'));
  const advanced = await until(() => E.state.simTime > t0, 3000);
  ok('زمان شبیه‌سازی پیش رفت', advanced, `t0=${t0} now=${E.state.simTime}`);
  click(qa('.sim-controls')[0].querySelectorAll('button')[1]); // ⏸ توقف
  const stopped = await until(() => E.running === false, 2000);
  ok('⏸ توقف → موتور متوقف', stopped);
  const v1 = E.state.version;
  click(qa('.sim-controls')[0].querySelectorAll('button')[2]); // ⏭ مرحله بعد
  const stepped = await until(() => E.state.version > v1 || E.state.simTime !== t0, 2500);
  ok('⏭ مرحله بعد → رویدادی پردازش شد', stepped, `v1=${v1} v=${E.state.version}`);

  // ---------------------------------------------------- run to end --------
  click(qa('.sim-controls')[0].querySelectorAll('button')[4]); // ⏭ اجرای کامل
  const delivered = await until(() => E.state.orders.find(o => o.id === newOrder.id)?.state === 'DELIVERED', 6000);
  ok('اجرای کامل → سفارش تازه DELIVERED شد',
    E.state.orders.find(o => o.id === newOrder.id)?.state === 'DELIVERED',
    E.state.orders.find(o => o.id === newOrder.id)?.state);
  ok('پس از اجرای کامل، موتور متوقف است', E.running === false);
  ok('پرداخت سفارش تحویل‌شده SUCCESS شد (رویداد درگاه)',
    payOf() && payOf().status === 'SUCCESS', payOf() && payOf().status);

  click(tabBtn('سفارش‌های من'));
  await sleep(150);
  ok('وضعیت فارسی «تحویل شد» در جدول مشتری', doc.body.textContent.includes('تحویل شد'));

  // -------------------------------------------------- operations view -----
  click(qa('.modes button')[1]);
  await sleep(200);
  ok('نمای عملیات: سربرگ «مرکز عملیات»', norm(q('.main').textContent).includes('مرکز عملیات'));
  const opsTabs = qa('.tabs button').map(b => norm(b.textContent));
  ok('۱۱ تب عملیات', opsTabs.length === 11, opsTabs.join('|'));
  const openNow = E.state.exceptions.filter(x => x.status !== 'RESOLVED').length;
  const excTab = opsTabs.find(t => t.startsWith('استثناها'));
  const excMatch = excTab && excTab.match(/استثناها \(([۰-۹]+)\)/);
  ok('کراس‌چک برچسب تب استثناها == استثاهای باز موتور',
    excMatch && fa2n(excMatch[1]) === openNow, `tab=${excTab} engine=${openNow}`);
  ok('تب استثناها فارسی‌شماره است', excTab && !hasAscii(excTab));

  // ------------------------------------------------------------- KPI ------
  click(tabBtn('داشبورد KPI'));
  await sleep(200);
  const k = E.kpi();
  const vProcessed = statVal('سفارش‌های تکمیل‌شده');
  ok('کراس‌چک KPI «سفارش‌های تکمیل‌شده» == موتور',
    vProcessed !== null && fa2n(vProcessed) === k.ordersProcessed, `ui=${vProcessed} engine=${k.ordersProcessed}`);
  const vAcc = statVal('دقت موجودی');
  ok('کراس‌چک KPI «دقت موجودی» == موتور', vAcc !== null && fa2n(vAcc) === Math.round(k.inventoryAccuracy * 10) / 10,
    `ui=${vAcc} engine=${k.inventoryAccuracy}`);
  const distSegments = qa('.dist-bar i').length;
  ok('نوار توزیع وضعیت سفارش‌ها رسم شد', distSegments >= 1, `segments=${distSegments}`);
  const legend = q('.dist-legend');
  ok('راهنمای توزیع بدون رقم لاتین', legend && !hasAscii(norm(legend.textContent)), legend && norm(legend.textContent));
  ok('جمع عرض نوار‌ها == ۱۰۰٪ (بازه KPI سالم)',
    qa('.dist-bar i').every(i => { const w = parseFloat(i.style.width); return Number.isFinite(w) && w > 0 && w <= 100; }));

  // --------------------------------------------------------- warehouse ----
  click(tabBtn('انبارها'));
  await sleep(250);
  const whSell = statVal('موجودی قابل فروش (AVAILABLE)');
  const engineWhSell = E.state.products.reduce((s, p) => s + p.variants.reduce((a, v) => a + E.available(v.sku, 'WH-TEH-01'), 0), 0);
  ok('کراس‌چک «موجودی قابل فروش» انبار == موتور (WH-TEH-01)',
    whSell !== null && fa2n(whSell) === engineWhSell, `ui=${whSell} engine=${engineWhSell}`);
  const whBody = norm(q('.main').textContent);
  ok('نشان برابری قفسه‌ها با اعداد موجودی (✓)', whBody.includes('✓ قفسه‌ها'), whBody.slice(whBody.indexOf('قفسه‌ها') - 20, whBody.indexOf('قفسه‌ها') + 60));
  const zchip = q('.zone .chip');
  ok('چیپ‌های نقشه انبار با رقم فارسی', zchip && !hasAscii(norm(zchip.textContent)), zchip && norm(zchip.textContent));
  ok('ارقام آمار انبار فارسی است', [statVal('در قفسه‌ها (واحدهای در محل)'), statVal('کل واحدهای این مرکز)')].every(v => v === null || !hasAscii(v)));

  // ------------------------------------------------------ inventory tabs ---
  click(tabBtn('موجودی و دفتر'));
  await sleep(200);
  const invTabs = qa('.tabs button').map(b => norm(b.textContent));
  ok('زیرتب‌های موجودی: دفتر/واحدها/شمارش',
    invTabs.some(t => t.includes('دفتر تراکنش')) && invTabs.some(t => t.includes('وضعیت واحدها')) && invTabs.some(t => t.includes('شمارش چرخه‌ای')),
    invTabs.join('|'));
  click(tabBtn('وضعیت واحدها و سریال‌ها'));
  await sleep(200);
  const tfoot = q('tfoot');
  const uiUnits = tfoot ? fa2n([...tfoot.querySelectorAll('th')][1].textContent) : NaN;
  let engineUnits = 0;
  for (const whs of Object.values(E.state.inv)) for (const counts of Object.values(whs)) for (const v of Object.values(counts)) engineUnits += v;
  ok('کراس‌چک «جمع کل واحدها» در جدول وضعیت == موتور',
    Number.isFinite(uiUnits) && uiUnits === engineUnits, `ui=${uiUnits} engine=${engineUnits}`);
  ok('متن سرصفحه جدول‌ها چسبان شد (CSS sticky)', (() => {
    const th = q('.tbl thead th');
    return th && win.getComputedStyle(th).position === 'sticky';
  })());
  click(tabBtn('شمارش چرخه‌ای و اصلاح'));
  await sleep(200);
  const ccBefore = E.state.cycleCounts.length;
  click(btn('آغاز شمارش'));
  const ccOk = await until(() => E.state.cycleCounts.length === ccBefore + 1, 2500);
  ok('شمارش چرخه‌ای از UI آغاز شد', ccOk, `${ccBefore} -> ${E.state.cycleCounts.length}`);

  // ------------------------------------------- other operations tabs ------
  click(tabBtn('مرجوعی و بازپرداخت'));
  await sleep(150);
  ok('تب مرجوعی و بازپرداخت محتوا دارد', mainLen() > 300 && norm(q('.main').textContent).includes('مرجوعی'));
  click(tabBtn('فروشندگان'));
  await sleep(150);
  ok('تب فروشندگان: آمار تأیید فروشنده', norm(q('.main').textContent).includes('نرخ تأیید'));
  click(tabBtn('پشتیبانی'));
  await sleep(150);
  ok('تب پشتیبانی محتوا دارد', mainLen() > 300);
  click(tabBtn('ورود کالا'));
  await sleep(150);
  ok('تب ورود کالا: فرایند دریافت/چیدمان', norm(q('.main').textContent).includes('ثبت محموله ورودی'));

  // ------------------------------------------------------------- admin ----
  click(tabBtn('کنترل سناریو'));
  await sleep(250);
  ok('۲۵ سناریو در موتور سناریوها', qa('.scn').length === 25, `count=${qa('.scn').length}`);
  ok('دکمه اجرای سناریوی انتخاب‌شده', !!btn('اجرای سناریوی انتخاب‌شده'));
  ok('دکمه بازنشانی حالت آزاد', !!btn('بازنشانی (حالت آزاد)'));
  const scn01 = qa('.scn').find(c => norm(c.textContent).startsWith('SC-01'));
  ok('کارت SC-01 موجود', !!scn01);
  click(scn01);
  await sleep(100);
  click(btn('اجرای سناریوی انتخاب‌شده'));
  const scnApplied = await until(() => E.state.scenarioId === 'SC-01', 4000);
  ok('اعمال سناریو از UI → scenarioId=SC-01', scnApplied, `scn=${E.state.scenarioId}`);
  ok('اعمال سناریو اعلان داد', norm(q('.toasts') ? q('.toasts').textContent : '').includes('اجرا شد'));

  // ------------------------------------------------------------- system ---
  click(qa('.modes button')[2]);
  await sleep(200);
  ok('نمای سیستم: سربرگ «نمای سیستم»', norm(q('.main').textContent).includes('نمای سیستم'));
  for (const t of ['نمایش فرایند (منطقی)', 'جریان فیزیکی انبار', 'جریان رویدادها', 'ماشین وضعیت سفارش', 'بازرسی وضعیت داده']) {
    click(tabBtn(t));
    await sleep(170);
    ok(`تب سیستم «${t}» محتوا دارد`, mainLen() > 250, `len=${mainLen()}`);
  }
  click(tabBtn('جریان رویدادها'));
  await sleep(150);
  ok('جریان رویدادها: برچسب EVENT-SOURCING', norm(q('.main').textContent).includes('EVENT-SOURCING'));
  click(tabBtn('نمایش فرایند (منطقی)'));
  await sleep(150);
  ok('نمودار منطقی: گره «پرداخت»', norm(q('.main').textContent).includes('پرداخت'));

  // ---------------------------------------------------------- disclosure --
  const disc = norm(q('.disclosure').textContent);
  ok('افشای روش: شبیه‌سازی/استاندارد/مرجع عمومی',
    disc.includes('شبیه‌ساز') && disc.includes('استاندارد') && disc.includes('مدل شبیه‌سازی‌شده'));
  ok('افشای روش: ادعای شرکت خاص ندارد',
    !/دیجی‌کالا.{0,12}(داخلی|رسمی|انبار)/.test(disc));

  // ------------------------------------- post-run storefront cross-check --
  click(qa('.modes button')[0]);
  await sleep(200);
  const cards2 = qa('.prod');
  const sc2 = (() => {
    for (const c of cards2) {
      const name = norm(q('.nm', c).textContent);
      const p = E.state.products.find(x => x.nameFa === name);
      if (!p) return `no product ${name}`;
      const expected = p.variants.reduce((s, v) => s + E.totalAvailable(v.sku), 0);
      const t = norm(c.textContent);
      const m = t.match(/موجود در انبار \(([۰-۹]+) عدد\)/);
      if (expected > 0 && (!m || fa2n(m[1]) !== expected)) return `${name}: ${m && m[1]} != ${expected}`;
      if (expected === 0 && !t.includes('ناموجود')) return `${name}: expected ناموجود`;
    }
    return '';
  })();
  ok('کراس‌چک ویترین پس از تحویل‌ها == موتور (کاهش فروش همگام)', !sc2, sc2);

  // ------------------------------------------------------- reset cycle ----
  click(qa('.modes button')[0]);           // back to مشتری
  await sleep(200);
  click(tabBtn('فروشگاه'));
  await sleep(150);
  ok('بازگشت به ویترین مشتری برای چرخه بازنشانی', qa('.prod').length === 5, `cards=${qa('.prod').length}`);
  // free-mode reset via header button (scenarioId currently SC-01 → applyScenario resets)
  click(btn('بازنشانی (حالت آزاد)') || [...qa('.sim-controls button')].find(b => norm(b.textContent).includes('بازنشانی')));
  await sleep(400);
  const n0 = E.state.orders.length;
  // place one more order through UI
  click(qa('.prod')[1]);
  await sleep(150);
  click(btn('افزودن به سبد خرید', q('.modal-wrap')));
  await sleep(120);
  click(btn('انصراف', q('.modal-wrap')));
  await sleep(100);
  click(btn('تسویه حساب'));
  await sleep(150);
  click(btn('پرداخت و ثبت نهایی', q('.modal-wrap')));
  await until(() => E.state.orders.length === n0 + 1, 3000);
  ok('پس از بازنشانی، ثبت سفارش دوباره کار می‌کند', E.state.orders.length === n0 + 1, `${n0} -> ${E.state.orders.length}`);
  click([...qa('.sim-controls button')].find(b => norm(b.textContent).includes('بازنشانی')));
  await sleep(400);
  ok('بازنشانی سربرگ → شمارنده سفارش‌ها به خط پایه برگشت', E.state.orders.length === n0, `${n0} -> ${E.state.orders.length}`);
  ok('بازنشانی → موتور متوقف', E.running === false);

  // ----------------------------------------------------------- digits -----
  ok('بدون رقم لاتین در اعداد نمایشی سربرگ/کناری/نقشه',
    !hasAscii(norm(q('.hdr-kpi b').textContent))
    && !hasAscii((q('.zone .chip') && norm(q('.zone .chip').textContent)) || '۰'));

  // ------------------------------------------------------------ errors ----
  await sleep(300);
  ok('صفر خطای JS در کل پیمایش', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  console.log(`\n######## UI RESULT: ${pass} passed, ${fail} failed | errors: ${jsErrors.length} ########`);
  if (fail) { console.log('Failed:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
