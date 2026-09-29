import React, { useMemo, useState } from 'react';
import { Engine } from '../sim/engine';
import type { Order, Product, Variant } from '../sim/types';
import { faMoney, faDateTime, faTime, faDuration, faOrderState, faPaymentStatus, faInvState, faReturnState } from '../sim/labels';
import { OrderChip, ShipmentChip, Drawer, Modal, PageH, Empty, KV, Stat } from './common';

interface CartLine { variantId: string; qty: number; }

export default function CustomerView({ e, onOpenOrder, focusOrderId, clearFocus, toast }: {
  e: Engine;
  onOpenOrder?: (id: string) => void;
  focusOrderId?: string | null;
  clearFocus?: () => void;
  toast: (t: string, tone?: string) => void;
}) {
  const [tab, setTab] = useState<'shop' | 'orders' | 'returns' | 'notif' | 'coupons'>('shop');
  const [viewProduct, setViewProduct] = useState<Product | null>(null);
  const [selVariant, setSelVariant] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [payOutcome, setPayOutcome] = useState<'SUCCESS' | 'FAIL' | 'TIMEOUT'>('SUCCESS');
  const [payMethod, setPayMethod] = useState('GATEWAY');
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<Order | null>(null);
  const [returnFor, setReturnFor] = useState<Order | null>(null);
  const [returnReason, setReturnReason] = useState('کالا مطابق توضیحات نیست');
  const [backstage, setBackstage] = useState(false);

  const st = e.state;
  const customer = st.customers[0];

  // auto-focus order passed from other perspectives
  React.useEffect(() => {
    if (focusOrderId) { setOpenOrder(focusOrderId); clearFocus?.(); }
  }, [focusOrderId]);

  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cart.reduce((s, l) => {
    const v = findVariant(e, l.variantId);
    return s + (v ? v.price * l.qty : 0);
  }, 0);

  const myOrders = st.orders.filter(o => o.customerId === customer.id);
  const myReturns = st.returns.filter(r => r.orderId && myOrders.some(o => o.id === r.orderId));
  const myNotifs = st.notifications.filter(n => n.audience === 'CUSTOMER');

  function addToCart() {
    if (!selVariant || qty < 1) return;
    setCart(c => {
      const ex = c.find(l => l.variantId === selVariant);
      if (ex) return c.map(l => l.variantId === selVariant ? { ...l, qty: l.qty + qty } : l);
      return [...c, { variantId: selVariant, qty }];
    });
    setViewProduct(null);
    toast('کالا به سبد خرید اضافه شد.', 'good');
  }

  function doCheckout() {
    if (!cart.length) return;
    const order = e.placeOrder({
      customerId: customer.id,
      items: cart.map(l => ({ variantId: l.variantId, qty: l.qty })),
      city: customer.city, addressFa: customer.addressFa,
      paymentMethod: payMethod, paymentOutcome: payOutcome,
    });
    setCart([]);
    setCheckout(false);
    setTab('orders');
    setOpenOrder(order.id);
    toast(payOutcome === 'FAIL' ? 'پرداخت ناموفق بود. سفارش شما تکمیل نشد.' : 'سفارش شما ثبت شد.', payOutcome === 'FAIL' ? 'bad' : 'good');
  }

  return (
    <div>
      <PageH title="فروشگاه مشتری" desc="نمای مشتری: خرید، پرداخت، پیگیری سفارش، لغو و مرجوعی — همه رویدادها از همان موتور شبیه‌سازی عملیاتی می‌آیند.">
        <div className="row tight">
          <span className="tag">🛒 سبد: {cartCount.toLocaleString('fa-IR')}</span>
          <button className="btn" onClick={() => setTab('orders')}>سفارش‌های من ({myOrders.length.toLocaleString('fa-IR')})</button>
          <button className="btn primary" disabled={!cart.length} onClick={() => setCheckout(true)}>
            تسویه حساب {cartTotal > 0 && `(${faMoney(cartTotal)})`}
          </button>
        </div>
      </PageH>

      <div className="tabs">
        {([
          ['shop', 'فروشگاه'], ['orders', 'سفارش‌های من'], ['returns', 'مرجوعی‌ها'],
          ['notif', `اعلان‌ها (${myNotifs.filter(n => !n.read).length.toLocaleString('fa-IR')})`],
          ['coupons', 'کدهای تخفیف'],
        ] as const).map(([k, t]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as any)}>{t}</button>
        ))}
      </div>

      {tab === 'shop' && (
        <>
          <div className="prod-grid">
            {st.products.map(p => {
              const total = p.variants.reduce((s, v) => s + e.totalAvailable(v.sku), 0);
              const emoji = { SMARTPHONE: '📱', LAPTOP: '💻', HEADPHONES: '🎧', SMARTWATCH: '⌚', CONSOLE: '🎮' }[p.category];
              return (
                <div className="prod" key={p.id} onClick={() => { setViewProduct(p); setSelVariant(p.variants[0].id); setQty(1); }}>
                  <div className="ph">{emoji}</div>
                  <div className="info">
                    <div className="nm">{p.nameFa}</div>
                    <div className="tiny">{p.brand} — <span className="mono">{p.id}</span></div>
                    <div className="pr">{faMoney(p.variants[0].price)}</div>
                    <div className="st">
                      {total > 0
                        ? <span className="ok-c">موجود در انبار ({total.toLocaleString('fa-IR')} عدد)</span>
                        : <span className="err-c">ناموجود</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {viewProduct && (
            <Modal title={viewProduct.nameFa} onClose={() => setViewProduct(null)}
              footer={<>
                <button className="btn" onClick={() => setViewProduct(null)}>انصراف</button>
                <button className="btn primary" onClick={addToCart} disabled={!selVariant}>افزودن به سبد خرید</button>
              </>}>
              <p className="muted">{viewProduct.descriptionFa}</p>
              <div className="row tight mb">
                <span className="tag">دسته: {viewProduct.category}</span>
                <span className="tag">شناسه: <span className="mono">{viewProduct.id}</span></span>
                <span className="tag">{viewProduct.serialized ? 'کالای سریال‌دار 🔢' : 'بدون سریال'}</span>
                <span className="tag">فروشنده: {e.seller(viewProduct.sellerId)?.nameFa}</span>
              </div>
              <div className="fld">
                <label>انتخاب نوع کالا (ورینت)</label>
                <div className="var-pick">
                  {viewProduct.variants.map(v => {
                    const stock = e.totalAvailable(v.sku);
                    return (
                      <div key={v.id} className={`var-opt ${selVariant === v.id ? 'on' : ''}`} onClick={() => setSelVariant(v.id)}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                            {Object.entries(v.attrs).map(([k, val]) => `${k}: ${val}`).join('، ')}
                          </div>
                          <div className="sk mono">{v.sku} — بارکد {v.barcode}</div>
                        </div>
                        <div style={{ textAlign: 'end' }}>
                          <div className="pz">{faMoney(v.price)}</div>
                          <div className={`tiny ${stock > 0 ? 'ok-c' : 'err-c'}`}>
                            {stock > 0 ? `${stock.toLocaleString('fa-IR')} عدد موجود` : 'ناموجود'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="fld">
                <label>تعداد</label>
                <input className="inp" type="number" min={1} max={10} value={qty}
                  onChange={ev => setQty(Math.max(1, Math.min(10, Number(ev.target.value) || 1)))} style={{ width: 120 }} />
              </div>
            </Modal>
          )}
        </>
      )}

      {tab === 'orders' && (
        myOrders.length === 0 ? <Empty icon="📦" text="هنوز سفارشی ثبت نکرده‌اید." /> : (
          <div className="card">
            <table className="tbl">
              <thead>
                <tr><th>شماره سفارش</th><th>تاریخ</th><th>اقلام</th><th>مبلغ</th><th>وضعیت</th><th></th></tr>
              </thead>
              <tbody>
                {myOrders.slice().reverse().map(o => (
                  <tr key={o.id} className="clickable" onClick={() => setOpenOrder(o.id)}>
                    <td className="mono">{o.id}</td>
                    <td className="num">{faDateTime(o.createdAt)}</td>
                    <td>{o.items.map(i => `${i.qty.toLocaleString('fa-IR')}× ${i.nameFa.split('—')[0].trim()}`).join('، ')}</td>
                    <td className="num">{faMoney(o.totalAmount)}</td>
                    <td><OrderChip state={o.state} /></td>
                    <td><button className="btn sm" onClick={ev => { ev.stopPropagation(); setOpenOrder(o.id); }}>جزئیات</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'returns' && (
        myReturns.length === 0 ? <Empty icon="↩️" text="مرجوعی‌ای ثبت نشده است." /> : (
          <div className="card">
            <table className="tbl">
              <thead><tr><th>RMA</th><th>سفارش</th><th>دلیل</th><th>صلاحیت</th><th>وضعیت</th><th>تعیین تکلیف</th></tr></thead>
              <tbody>
                {myReturns.map(r => (
                  <tr key={r.id}>
                    <td className="mono">{r.rma}</td>
                    <td className="mono">{r.orderId}</td>
                    <td>{r.reasonFa}</td>
                    <td>{r.eligibility === 'APPROVED' ? <span className="chip green">تأیید</span>
                      : r.eligibility === 'REJECTED' ? <span className="chip red">رد</span>
                        : r.eligibility === 'REQUIRES_REVIEW' ? <span className="chip yellow">بررسی دستی</span>
                          : <span className="chip gray">در حال بررسی</span>}</td>
                    <td>{faReturnState[r.state]}</td>
                    <td className="tiny">{r.dispositionNoteFa ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'notif' && (
        myNotifs.length === 0 ? <Empty icon="🔔" text="اعلانی وجود ندارد." /> : (
          <div>
            {myNotifs.map(n => (
              <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
                <div className="ic">{{ ORDER: '📦', PAYMENT: '💳', RETURN: '↩️', WAREHOUSE: '🏭', SELLER: '🏪', SYSTEM: '⚙️', EXCEPTION: '⚠️' }[n.kind]}</div>
                <div style={{ flex: 1 }}>
                  <div className="t">{n.titleFa}</div>
                  <div className="b">{n.bodyFa}</div>
                  <div className="dt">{faDateTime(n.at)} {n.orderId && <>— <span className="mono">{n.orderId}</span></>}</div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'coupons' && (
        st.coupons.length === 0 ? <Empty icon="🎟️" text="کد تخفیفی صادر نشده است." /> : (
          <div className="grid g3">
            {st.coupons.map(c => (
              <div className="card tight" key={c.id}>
                <div className="mono" style={{ fontSize: 17, fontWeight: 800, color: 'var(--acc2)' }}>{c.code}</div>
                <div className="muted">{faMoney(c.amount)} اعتبار</div>
                <div className="tiny">{c.reasonFa}</div>
                <div className="tiny">اعتبار تا: {faDateTime(c.expiresAt)}</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ---------------- checkout modal ---------------- */}
      {checkout && (
        <Modal title="تسویه حساب" onClose={() => setCheckout(false)}
          footer={<>
            <button className="btn" onClick={() => setCheckout(false)}>انصراف</button>
            <button className="btn primary" onClick={doCheckout}>پرداخت و ثبت نهایی</button>
          </>}>
          <KV rows={[
            ['مشتری', `${customer.nameFa} — ${customer.phone}`],
            ['آدرس', customer.addressFa],
            ['اقلام سبد', cart.map(l => {
              const v = findVariant(e, l.variantId)!;
              const p = e.product(v.productId)!;
              return `${l.qty.toLocaleString('fa-IR')}× ${p.nameFa}`;
            }).join('، ')],
            ['مبلغ قابل پرداخت', <b className="acc-c">{faMoney(cartTotal)}</b>],
          ]} />
          <div className="divider" />
          <div className="fld">
            <label>روش پرداخت (شبیه‌سازی‌شده)</label>
            <select className="inp" value={payMethod} onChange={ev => setPayMethod(ev.target.value)}>
              <option value="GATEWAY">درگاه پرداخت آنلاین</option>
              <option value="WALLET">کیف پول</option>
            </select>
          </div>
          <div className="fld">
            <label>نتیجه پرداخت (کنترل شبیه‌سازی — برای نمایش سناریوها)</label>
            <select className="inp" value={payOutcome} onChange={ev => setPayOutcome(ev.target.value as any)}>
              <option value="SUCCESS">موفق ✅</option>
              <option value="FAIL">ناموفق ❌ (نمایش «پرداخت ناموفق بود. سفارش شما تکمیل نشد.»)</option>
              <option value="TIMEOUT">مهلت سپری شد ⏱️</option>
            </select>
          </div>
        </Modal>
      )}

      {/* ---------------- cancel modal ---------------- */}
      {cancelFor && (
        <CancelModal e={e} order={cancelFor} onClose={() => setCancelFor(null)} toast={toast} />
      )}

      {/* ---------------- return modal ---------------- */}
      {returnFor && (
        <Modal title={`درخواست مرجوعی — ${returnFor.id}`} onClose={() => setReturnFor(null)}
          footer={<>
            <button className="btn" onClick={() => setReturnFor(null)}>انصراف</button>
            <button className="btn primary" onClick={() => {
              const res = e.requestReturn(returnFor.id, returnFor.items.map((_, i) => i), returnReason);
              toast(res.messageFa, res.ok ? 'good' : 'bad');
              if (res.ok) setReturnFor(null);
            }}>ثبت درخواست مرجوعی</button>
          </>}>
          <div className="fld">
            <label>دلیل مرجوعی</label>
            <select className="inp" value={returnReason} onChange={ev => setReturnReason(ev.target.value)}>
              <option>کالا مطابق توضیحات نیست</option>
              <option>کالا معیوب است</option>
              <option>مغایرت رنگ یا مدل</option>
              <option>اندازه مناسب نیست</option>
              <option>پشیمانی از خرید</option>
              <option>کالا باز شده و ناقص است</option>
            </select>
          </div>
          <p className="tiny">
            موتور صلاحیت مرجوعی، وضعیت تحویل، مهلت ۷ روزه، دسته کالا، دلیل و سوابق قبلی را بررسی می‌کند و نتیجه
            «تأیید» / «نیازمند بررسی دستی» / «رد» را ثبت می‌کند.
          </p>
        </Modal>
      )}

      {/* ---------------- order detail drawer ---------------- */}
      {openOrder && (() => {
        const o = st.orders.find(x => x.id === openOrder);
        if (!o) return null;
        const pay = st.payments.find(p => p.id === o.paymentId);
        const canc = e.evaluateCancellation(o);
        const canReturn = o.state === 'DELIVERED' && !o.returnId;
        const canCancel = canc.allowed && !['CANCELLED', 'CANCELLATION_REQUESTED'].includes(o.state);
        return (
          <Drawer wide title={<span>سفارش <span className="mono">{o.id}</span></span>} onClose={() => { setOpenOrder(null); setBackstage(false); }}>
            <div className="row mb">
              <OrderChip state={o.state} />
              {pay && <span className={`chip ${pay.status === 'SUCCESS' ? 'green' : pay.status === 'PENDING' ? 'yellow' : 'red'} plain`}>
                پرداخت: {faPaymentStatus[pay.status]}
              </span>}
              <div className="spacer" />
              <button className={`btn sm ${backstage ? 'primary' : ''}`} onClick={() => setBackstage(b => !b)}>
                👁 نمای پشت‌صحنه (Backstage)
              </button>
            </div>

            <div className="grid g2 mb">
              <div className="card tight">
                <h3>اطلاعات سفارش</h3>
                <KV rows={[
                  ['زمان ثبت', faDateTime(o.createdAt)],
                  ['مشتری', `${o.customerNameFa} — ${o.phone}`],
                  ['آدرس تحویل', o.addressFa],
                  ['مبلغ', faMoney(o.totalAmount)],
                  ['تحویل مورد انتظار', faDateTime(o.expectedDelivery)],
                  ['مدل‌های ارسال', o.fulfillmentSummary.map(f => ({ PLATFORM: 'انبار مرکزی', SELLER_FC: 'موجودی فروشنده در FC', SELLER_FULFILLED: 'ارسال فروشنده' }[f])).join('، ') || '—'],
                  ['فروشنده‌ها', o.sellerIds.map(id => e.seller(id)?.nameFa).join('، ') || '—'],
                ]} />
              </div>
              <div className="card tight">
                <h3>اقلام</h3>
                <table className="tbl">
                  <thead><tr><th>کالا</th><th>SKU</th><th>تعداد</th><th>قیمت</th></tr></thead>
                  <tbody>
                    {o.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.nameFa}</td>
                        <td className="mono">{it.sku}</td>
                        <td>{it.qty.toLocaleString('fa-IR')}</td>
                        <td className="num">{faMoney(it.unitPrice * it.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {o.items.some(i => i.serials.length) && (
                  <div className="tiny mt">
                    سریال‌ها: {o.items.flatMap(i => i.serials.map(s => <span key={s} className="mono" style={{ marginInlineEnd: 8 }}>{s}</span>))}
                  </div>
                )}
              </div>
            </div>

            {o.shipments.length > 0 && (
              <div className="card tight mb">
                <h3>مرسوله‌ها و رویدادهای حمل <span className="n">({o.shipments.length})</span></h3>
                {o.shipments.map(sh => (
                  <div key={sh.id} className="pad mb" style={{ marginBottom: 8 }}>
                    <div className="row tight">
                      <span className="mono">{sh.id}</span>
                      <span className="tag">{e.warehouse(sh.warehouseId ?? '')?.nameFa}</span>
                      <span className="tag">{e.seller(sh.sellerId)?.nameFa}</span>
                      <ShipmentChip state={sh.state} />
                      {sh.trackingId && <span className="mono tiny">رهگیری: {sh.trackingId}</span>}
                      {sh.lane && <span className="tiny">مسیر: {sh.lane}</span>}
                    </div>
                    <div className="tiny mt" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      {sh.events.map((ev, i) => (
                        <span key={i}>● {faTime(ev.at)} — {ev.detailFa ?? ev.type}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid g2 mb">
              <div className="card tight">
                <h3>تایم‌لاین وضعیت‌ها</h3>
                <div className="tl">
                  {o.history.map((h, i) => (
                    <div className="tl-item" key={i}>
                      <div className={`tl-dot ${i === o.history.length - 1 ? 'cur' : 'done'}`} />
                      <div className="tl-body">
                        <div className="t">{faOrderState[h.state]}</div>
                        <div className="d">{h.detailFa}</div>
                        <div className="m">{faDateTime(h.at)} — توسط {h.actor}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card tight">
                <h3>{backstage ? 'نمای پشت‌صحنه (Backstage)' : 'تایم‌لاین رویدادها'}</h3>
                {backstage ? (
                  <div className="tl">
                    {e.backstage(o).map((s, i) => (
                      <div className="tl-item" key={i}>
                        <div className={`tl-dot ${s.status === 'DONE' ? 'done' : s.status === 'CURRENT' ? 'cur' : 'pend'}`} />
                        <div className="tl-body">
                          <div className="t">{s.labelFa}</div>
                          <div className="d">{s.detailFa}</div>
                          <div className="m">{s.at ? faDateTime(s.at) : '—'} {s.actor !== '—' && `— بازیگر: ${s.actor}`}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {st.events.filter(ev => ev.orderId === o.id).slice().reverse().map(ev => (
                      <div className="ev" key={ev.id}>
                        <span className="eid">{ev.id}</span>
                        <span className="et">{ev.type}</span>
                        <span className="ed">{ev.detailFa}</span>
                        <span className="ea">{faTime(ev.at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="row">
              {canCancel && (
                <button className="btn danger" onClick={() => setCancelFor(o)}>درخواست لغو سفارش</button>
              )}
              {!canc.allowed && !['CANCELLED', 'PAYMENT_FAILED'].includes(o.state) && (
                <span className="chip yellow plain" title={canc.reasonFa}>امکان لغو: {canc.reasonFa}</span>
              )}
              {canReturn && (
                <button className="btn" onClick={() => setReturnFor(o)}>↩ درخواست مرجوعی</button>
              )}
              {o.returnId && (
                <span className="chip violet plain">مرجوعی: {st.returns.find(r => r.id === o.returnId)?.rma}</span>
              )}
            </div>
          </Drawer>
        );
      })()}
    </div>
  );
}

function findVariant(e: Engine, id: string): Variant | undefined { return e.variant(id); }

function CancelModal({ e, order, onClose, toast }: { e: Engine; order: Order; onClose: () => void; toast: (t: string, tone?: string) => void }) {
  const [reason, setReason] = useState('پشیمانی از خرید');
  const verdict = e.evaluateCancellation(order);
  return (
    <Modal title={`لغو سفارش ${order.id}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>انصراف</button>
        <button className="btn danger" disabled={!verdict.allowed} onClick={() => {
          const res = e.requestCancellation(order.id, reason);
          toast(res.messageFa, res.ok ? 'good' : 'bad');
          onClose();
        }}>تأیید لغو</button>
      </>}>
      <div className="fld">
        <label>دلیل لغو</label>
        <select className="inp" value={reason} onChange={ev => setReason(ev.target.value)}>
          <option>پشیمانی از خرید</option>
          <option>یافتن کالای ارزان‌تر</option>
          <option>اشتباه در انتخاب</option>
          <option>نیاز فوری نداشتم</option>
        </select>
      </div>
      <div className={`pad ${verdict.allowed ? '' : 'warn-c'}`} style={{ borderColor: verdict.allowed ? 'rgba(52,211,153,.4)' : 'rgba(251,191,36,.5)' }}>
        <b>موتور شرایط لغو (Cancellation Eligibility Engine):</b>
        <div className="mt">
          {verdict.allowed ? <span className="ok-c">✔ مجاز — </span> : <span className="err-c">✖ مسدود — </span>}
          {verdict.reasonFa}
        </div>
        <div className="tiny mt">مرحله ارزیابی: {verdict.stageFa} | وضعیت فعلی: {faOrderState[order.state]}</div>
      </div>
      {!verdict.allowed && (
        <p className="tiny mt">
          دکمه لغو پنهان نمی‌شود؛ دلیل عدم امکان به شما نمایش داده می‌شود. اگر سفارش تحویل شده باشد، مسیر
          «درخواست مرجوعی» جایگزین لغو است.
        </p>
      )}
    </Modal>
  );
}
