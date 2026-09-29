import React, { useEffect, useRef, useState } from 'react';
import { getEngine, useEngineTick } from './store';
import type { Engine } from './sim/engine';
import { faDateTime, faTime } from './sim/labels';
import CustomerView from './ui/CustomerView';
import OpsView from './ui/OpsView';
import SystemView from './ui/SystemView';
import { Disclosure } from './ui/common';

type Perspective = 'customer' | 'ops' | 'system';

const PERSPECTIVES: { k: Perspective; t: string; ic: string }[] = [
  { k: 'customer', t: 'مشتری', ic: '🛍️' },
  { k: 'ops', t: 'عملیات', ic: '🗼' },
  { k: 'system', t: 'سیستم', ic: '⚙️' },
];

export default function App() {
  const e: Engine = getEngine();
  useEngineTick(400);
  const [persp, setPersp] = useState<Perspective>('customer');
  const [focusOrder, setFocusOrder] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const st = e.state;

  // clock loop: advance sim while running
  useEffect(() => {
    const id = setInterval(() => {
      if (e.running) e.tick(400 * speedRef.current);
    }, 400);
    return () => clearInterval(id);
  }, []);

  const visibleNotifs = st.notifications.filter(n =>
    persp === 'customer' ? n.audience === 'CUSTOMER' : n.audience === 'OPS');
  const unread = visibleNotifs.filter(n => !n.read).length;
  const openExcs = st.exceptions.filter(x => x.status !== 'RESOLVED').length;
  const markAllRead = () => {
    visibleNotifs.forEach(n => { n.read = true; });
    e.notify();
  };
  const onMyOrder = (id: string) => { setFocusOrder(id); setPersp('ops'); };

  // ------------------------------------------------- simulation controls --
  const start = () => { e.running = true; e.autoOrdersEnabled = st.forces.autoOrders; e.notify(); };
  const pause = () => { e.running = false; e.notify(); };
  const stepOnce = () => { e.running = false; e.stepOnce(); };
  const runFast = () => { setSpeed(4); e.speedMult = 4; e.running = true; e.notify(); };
  const runFull = () => { setSpeed(8); e.speedMult = 8; e.notify(); e.runAll(); };
  const reset = () => {
    if (window.confirm('همه وضعیت‌ها به ابتدای سناریو بازنشانی شود؟')) {
      e.running = false;
      e.applyScenario(st.scenarioId);
      e.notify();
    }
  };

  const SimControls = ({ cls }: { cls?: string }) => (
    <div className={`sim-controls ${cls ?? ''}`}>
      <button className={`go ${e.running ? 'on' : ''}`} onClick={start}>▶ شروع</button>
      <button className={`stop ${!e.running ? 'on' : ''}`} onClick={pause}>⏸ توقف</button>
      <button onClick={stepOnce}>⏭ مرحله بعد</button>
      <button className={speed === 4 ? 'on' : ''} onClick={runFast}>⏩ اجرای سریع</button>
      <button className={speed === 8 ? 'on' : ''} onClick={runFull}>⏭ اجرای کامل</button>
      <button onClick={reset}>↺ بازنشانی</button>
    </div>
  );

  return (
    <div className={`app ${persp === 'customer' ? 'cust-mode' : ''}`}>
      <header className="hdr">
        <button className="hamburger" onClick={() => setNavOpen(v => !v)} aria-label="فهرست">☰</button>
        <div className="brand">
          <div className="logo">پ</div>
          <div>
            <h1>بازارگاه و زنجیره تأمین</h1>
            <div className="sub">شبیه‌ساز تعاملی — Marketplace · OMS · WMS</div>
          </div>
        </div>
        <div className="hdr-kpi hide-m" title="مجموع موجودی قابل فروش همه محصولات در همه انبارها — همان عددی که ویترین مشتری نمایش می‌دهد">
          <b>{st.products.reduce((s, p) => s + p.variants.reduce((a, v) => a + e.totalAvailable(v.sku), 0), 0).toLocaleString('fa-IR')}</b>
          <span>موجودی قابل فروش</span>
        </div>
        <div className="modes">
          {PERSPECTIVES.map(p => (
            <button key={p.k} className={persp === p.k ? 'on' : ''} onClick={() => setPersp(p.k)}>{p.t}</button>
          ))}
        </div>
        <div className="hdr-right">
          <div className="clock hide-m">
            <span className="t">{faDateTime(st.simTime)}</span>
            <span className="spd">سرعت ×{speed.toLocaleString('fa-IR')}</span>
          </div>
          <SimControls cls="hide-m" />
          <div className="bell" onClick={() => { setNotifOpen(v => !v); if (!notifOpen && unread) markAllRead(); }} title="اعلان‌ها">
            🔔{unread > 0 && <span className="dot">{unread.toLocaleString('fa-IR')}</span>}
          </div>
        </div>
      </header>

      <div className="body">
        <nav className={`side ${navOpen ? 'open' : ''}`}>
          <div className="grp">پرسپکتیو نمایش</div>
          {PERSPECTIVES.map(p => (
            <button key={p.k} className={persp === p.k ? 'on' : ''} onClick={() => { setPersp(p.k); setNavOpen(false); }}>
              <span className="ic">{p.ic}</span> {p.t}
              {p.k === 'ops' && openExcs > 0 && <span className="cnt bad">{openExcs.toLocaleString('fa-IR')}</span>}
              {p.k === 'customer' && unread > 0 && <span className="cnt">{unread.toLocaleString('fa-IR')}</span>}
            </button>
          ))}

          <div className="grp">کنترل زمان شبیه‌سازی</div>
          <SimControls cls="show-m" />

          <div className="grp">وضعیت</div>
          <div className="pad" style={{ fontSize: 11.5, lineHeight: 2 }}>
            <div>حالت: <b className={e.running ? 'ok-c' : 'warn-c'}>{e.running ? 'در حال اجرا' : 'متوقف'}</b></div>
            <div>سناریو: <b>{st.scenarioId ?? 'حالت آزاد'}</b></div>
            <div>زمان: <b className="mono">{faDateTime(st.simTime)}</b></div>
            <div>سفارش‌های زنده: <b>{st.orders.filter(o => !['DELIVERED', 'CANCELLED', 'PAYMENT_FAILED'].includes(o.state)).length.toLocaleString('fa-IR')}</b></div>
          </div>

          <div className="grp">راهنما</div>
          <p className="tiny" style={{ padding: '0 10px' }}>
            سه پرسپکتیو یک state مشترک را از زوایای مختلف می‌بینند. داده‌ای جعلی نیست؛ سناریوها قطعی‌اند
            و بازنشانی کامل، سیستم را به ابتدای کار برمی‌گرداند.
          </p>
        </nav>

        {navOpen && <div className="overlay nav-ov" onClick={() => setNavOpen(false)} />}

        <main className="main">
          {persp === 'customer' && (
            <CustomerView e={e} onOpenOrder={onMyOrder} focusOrderId={null} clearFocus={() => { }} toast={(m, t) => e.notifyCustomer('اعلان', m, t === 'bad' ? 'SYSTEM' : 'ORDER')} />
          )}
          {persp === 'ops' && <OpsView e={e} focusOrderId={focusOrder} clearFocus={() => setFocusOrder(null)} />}
          {persp === 'system' && <SystemView e={e} />}
          <Disclosure />
        </main>
      </div>

      <footer className="ftr">
        <span>مدل شبیه‌سازی تعاملی؛ بازیگر دیده‌شده: <b>مشتری</b> — مدل: بازارگاه / OMS / WMS / لجستیک معکوس</span>
        <span className="tiny">مرجع: مستند عمومی، استاندارد صنعت و مدل‌سازی شبیه‌سازی‌شده — نه افشا و نه داده‌های داخلی هیچ شرکتی.</span>
        <div className="spacer" />
        <span className="badge-src pub">مستند عمومی</span>
        <span className="badge-src ind">استاندارد صنعت</span>
        <span className="badge-src sim">شبیه‌سازی</span>
      </footer>

      {notifOpen && (
        <>
          <div className="overlay" style={{ zIndex: 110 }} onClick={() => setNotifOpen(false)} />
          <div className="notif-panel">
            <div className="head">
              <b>اعلان‌ها</b>
              <span className="tiny">({visibleNotifs.length.toLocaleString('fa-IR')} مورد)</span>
              <div className="spacer" />
              <button className="x" onClick={() => setNotifOpen(false)}>✕</button>
            </div>
            <div className="list">
              {visibleNotifs.length === 0
                ? <div className="empty"><div className="big">🔔</div>اعلانی وجود ندارد.</div>
                : visibleNotifs.slice().reverse().map(n => (
                  <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
                    <div className="ic">🔔</div>
                    <div>
                      <div className="t">{n.titleFa}</div>
                      <div className="b">{n.bodyFa}</div>
                      <div className="dt">{n.orderId ? `${n.orderId} — ` : ''}{faTime(n.at)}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
