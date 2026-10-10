import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, ShoppingBag, Minus, Plus, Trash2, Package, Check, ChevronLeft } from 'lucide-react';
import { CART_KEY, readCart, shopRequest, shopPost, shopMoney, shopImage, shopToken, SHOP_STATUS_LABELS, ShopApiError } from '../lib/shop';
import type { CartItem, ShopConfig, ShopProduct, ShopOrder } from '../lib/shop';

const button = 'inline-flex items-center justify-center gap-2 rounded-full bg-charcoal-950 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'mt-2 block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-mustard-400';
const field = 'block text-sm font-medium';
const defaults: ShopConfig = { business_name: 'Awutorla', contact_phone: '', contact_email: '', pickup_details: '', shop_open: true, checkout_enabled: false };

function ProductCard({ product }: { product: ShopProduct }) {
  const inStock = product.variants.some(v => v.active && Number(v.available) > 0);
  return <a href={`/products/${product.slug}`} className="group block">
    <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-cream-200 relative">
      {product.images[0] ? <img src={shopImage(product.images[0].id)} alt={product.images[0].alt || product.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : <div className="h-full flex items-center justify-center text-gray-400"><ShoppingBag size={48} /></div>}
      {!inStock && <span className="absolute bottom-3 left-3 rounded-full bg-white px-3 py-1.5 text-xs">Sold out</span>}
    </div>
    <p className="mt-4 text-[11px] uppercase tracking-widest text-gray-500">{product.category || 'Ready to wear'}</p>
    <div className="mt-1 flex justify-between gap-3"><h2 className="text-base font-semibold">{product.title}</h2><ArrowRight size={17} className="shrink-0 mt-1" /></div>
    <p className="mt-2 text-sm">{shopMoney(product.price_pesewas)}</p>
  </a>;
}

function Catalogue({ config }: { config: ShopConfig }) {
  const query = new URLSearchParams(location.search);
  const page = Math.max(0, Number(query.get('page') || 0));
  const [search, setSearch] = useState(query.get('search') || '');
  const [result, setResult] = useState<{ products: ShopProduct[]; categories: string[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const queryString = query.toString();
  useEffect(() => { let alive = true; shopRequest<typeof result>(`products?${queryString}`)
    .then(data => { if (alive) setResult(data); }).catch(err => { if (alive) setError(err.message); }); return () => { alive = false; }; }, [queryString]);
  return <>
    <section className="py-12 sm:py-20 border-b border-gray-200">
      <p className="text-xs uppercase tracking-[0.25em] text-gray-500">The ready-to-wear collection</p>
      <h1 className="mt-5 max-w-3xl text-4xl sm:text-6xl leading-[1.1] font-semibold">Made for the way<br />you move.</h1>
      <div className="mt-7 flex flex-wrap justify-between gap-5 items-end"><p className="max-w-md text-sm sm:text-base text-gray-600 leading-7">Discover Awutorla’s ready-to-wear pieces. Find your fit, choose your colour, make it yours.</p>
        <a href="#collection" className="inline-flex items-center justify-center gap-2 rounded-full bg-mustard-400 px-6 py-3 text-sm font-semibold text-charcoal-950 hover:bg-mustard-300">Explore the collection <ArrowRight size={16} /></a></div>
    </section>
    <section id="collection" className="py-10 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8"><div><h2 className="text-2xl font-semibold">The collection</h2><p className="mt-1 text-sm text-gray-500">{result ? `${result.total} piece${result.total === 1 ? '' : 's'}` : 'Loading pieces…'}</p></div>
        <form className="flex flex-wrap gap-2" action="/" method="get"><label className="sr-only" htmlFor="shop-search">Search the collection</label><input id="shop-search" name="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pieces" className="rounded-full border bg-white px-4 py-2.5 text-sm w-44" />
          <label className="sr-only" htmlFor="shop-category">Category</label><select id="shop-category" name="category" defaultValue={query.get('category') || ''} className="rounded-full border bg-white px-4 py-2.5 text-sm"><option value="">All categories</option>{result?.categories.map(c => <option key={c}>{c}</option>)}</select><button className="rounded-full px-4 py-2.5 bg-charcoal-950 text-white text-sm">Find</button></form></div>
      {error && <p role="alert" className="text-rose-700">{error} <a href="/" className="underline">Try again</a></p>}
      {result && !result.products.length && <div className="text-center rounded-3xl border border-gray-200 p-12 sm:p-20"><ShoppingBag size={32} className="mx-auto mb-5 text-gray-400" /><h3 className="text-xl font-semibold">{config.shop_open ? (search || query.get('category') ? 'No matching pieces' : 'A new collection is on its way') : 'The shop is taking a short pause'}</h3><p className="mt-3 text-sm text-gray-500">{search || query.get('category') ? 'Try another search or view the full collection.' : 'Check back soon, or get in touch with the atelier.'}</p>{(search || query.get('category')) && <a href="/" className="underline text-sm mt-4 inline-block">View all pieces</a>}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 sm:gap-x-7 gap-y-10">{result?.products.map(p => <ProductCard product={p} key={p.id} />)}</div>
      {result && result.total > 24 && <div className="mt-10 flex gap-4 justify-center text-sm">{page > 0 && <a className="underline" href={`/?${new URLSearchParams({ search, category: query.get('category') || '', page: String(page - 1) })}`}>Previous</a>}<span>Page {page + 1}</span>{(page + 1) * 24 < result.total && <a className="underline" href={`/?${new URLSearchParams({ search, category: query.get('category') || '', page: String(page + 1) })}`}>Next</a>}</div>}
    </section>
  </>;
}

function ProductPage({ add }: { add: (item: CartItem, available: number) => void }) {
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [error, setError] = useState(''); const [size, setSize] = useState(''); const [colour, setColour] = useState('');
  const [quantity, setQuantity] = useState(1); const [imageIndex, setImageIndex] = useState(0); const [added, setAdded] = useState(false);
  const [bagError, setBagError] = useState('');
  useEffect(() => { let alive = true; shopRequest<ShopProduct>(`products/${encodeURIComponent(decodeURIComponent(location.pathname.slice('/products/'.length)))}`)
    .then(p => { if (!alive) return; setProduct(p); const first = p.variants.find(v => Number(v.available) > 0) || p.variants[0]; setSize(first?.size || ''); setColour(first?.colour || ''); })
    .catch(err => { if (alive) setError(err.message); }); return () => { alive = false; }; }, []);
  if (error) return <div className="py-20"><h1 className="text-2xl">{error}</h1><a href="/" className="underline mt-5 block">Back to collection</a></div>;
  if (!product) return <p className="py-20">Loading piece…</p>;
  const variant = product.variants.find(v => v.size === size && v.colour === colour);
  const available = Number(variant?.available || 0);
  return <div className="py-8 sm:py-12"><a href="/" className="inline-flex items-center gap-2 text-xs text-gray-500 mb-8"><ChevronLeft size={15} /> Back to collection</a>
    <div className="grid md:grid-cols-2 gap-8 lg:gap-16"><div><div className="aspect-[3/4] bg-cream-200 rounded-3xl overflow-hidden">{product.images[imageIndex] && <img src={shopImage(product.images[imageIndex].id)} alt={product.images[imageIndex].alt || product.title} className="w-full h-full object-cover" />}</div>
      {product.images.length > 1 && <div className="flex gap-3 mt-4 overflow-x-auto">{product.images.map((image, i) => <button key={image.id} onClick={() => setImageIndex(i)} aria-label={`View photo ${i + 1}`} aria-pressed={i === imageIndex} className={`w-16 h-20 rounded-lg overflow-hidden shrink-0 border-2 ${i === imageIndex ? 'border-mustard-400' : 'border-transparent'}`}><img src={shopImage(image.id)} alt="" className="h-full w-full object-cover" /></button>)}</div>}</div>
      <div className="md:pt-6"><p className="text-xs uppercase tracking-widest text-gray-500">{product.category || 'Ready to wear'}</p><h1 className="mt-4 text-3xl sm:text-4xl">{product.title}</h1><p className="mt-4 text-xl">{shopMoney(product.price_pesewas)}</p><p className="mt-7 text-sm leading-7 text-gray-600 whitespace-pre-wrap">{product.description}</p>
        <div className="grid grid-cols-2 gap-4 mt-8"><label className={field}>Size<select className={input} value={size} onChange={e => { setSize(e.target.value); const next = product.variants.find(v => v.size === e.target.value && v.colour === colour) || product.variants.find(v => v.size === e.target.value); setColour(next?.colour || ''); setAdded(false); }}>{[...new Set(product.variants.map(v => v.size))].map(s => <option key={s}>{s}</option>)}</select></label>
          <label className={field}>Colour<select className={input} value={colour} onChange={e => { setColour(e.target.value); setAdded(false); }}>{product.variants.filter(v => v.size === size).map(v => <option key={v.id}>{v.colour}</option>)}</select></label></div>
        <p className="mt-3 text-xs text-gray-500">{available ? `${available} available` : 'This option is sold out'}</p>
        <div className="mt-6 flex gap-3"><label className="sr-only" htmlFor="product-quantity">Quantity</label><input id="product-quantity" type="number" min={1} max={Math.min(100, available)} value={quantity} onChange={e => { setQuantity(Number(e.target.value)); setAdded(false); }} className="w-20 rounded-full border bg-white text-center" />
          <button className={`${button} flex-1`} disabled={!variant || quantity < 1 || !Number.isInteger(quantity) || quantity > available || quantity > 100} onClick={() => { if (!variant) return; try { add({ variant_id: variant.id, title: product.title, slug: product.slug, size, colour, quantity, unit_price: product.price_pesewas, image_id: product.images[0]?.id }, available); setAdded(true); setBagError(''); } catch (err) { setBagError((err as Error).message); } }}>{added ? <><Check size={16} /> Added to bag</> : <><ShoppingBag size={16} /> Add to bag</>}</button></div>
        {bagError && <p role="alert" className="text-sm text-rose-700 mt-4">{bagError}</p>}
        {added && <a href="/cart" className="inline-block mt-4 text-sm underline">View your bag</a>}
        <details className="mt-8 border-y py-5"><summary className="text-sm font-semibold cursor-pointer">Size guide</summary><p className="mt-4 text-sm whitespace-pre-wrap leading-7 text-gray-600">{product.size_guide}</p></details>
        <p className="mt-5 text-xs text-gray-500 leading-6">Collect at the atelier or request delivery within Ghana. Delivery fees are agreed with you before payment.</p>
      </div>
    </div>
  </div>;
}

function CartPage({ cart, save, config, checkout = false }: { cart: CartItem[]; save: (items: CartItem[]) => void; config: ShopConfig; checkout?: boolean }) {
  const [live, setLive] = useState<Record<string, ShopProduct | null>>({}); const [loading, setLoading] = useState(true); const [refresh, setRefresh] = useState(0);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [method, setMethod] = useState<'momo' | 'cash'>('momo'); const [address, setAddress] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ key: string; token: string; payload: string } | null>(() => { try { return JSON.parse(sessionStorage.getItem('awutorla-checkout') || 'null'); } catch { return null; } });
  const test = new URLSearchParams(location.search).get('test') === '1';
  const slugs = [...new Set(cart.map(i => i.slug))].sort().join('|');
  useEffect(() => { let alive = true; setLoading(true); setError('');
    Promise.all(slugs ? slugs.split('|').map(async slug => { try { return [slug, await shopRequest<ShopProduct>(`products/${encodeURIComponent(slug)}`)] as const; } catch (err) { if (err instanceof ShopApiError && err.status === 404) return [slug, null] as const; throw err; } }) : [])
      .then(products => { if (alive) setLive(Object.fromEntries(products)); }).catch(err => { if (alive) setError(`Could not check your bag: ${err.message}`); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; }; }, [slugs, refresh]);
  const problems = cart.map(item => { const p = live[item.slug]; const v = p?.variants.find(v => v.id === item.variant_id && v.active); return { item, product: p, variant: v, changed: !!p && p.price_pesewas !== item.unit_price, unavailable: !v || Number(v.available) < item.quantity }; });
  const needsReview = problems.some(p => p.changed || p.unavailable);
  const subtotal = cart.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const edit = (id: string, quantity: number) => { if (busy) return; save(cart.flatMap(i => i.variant_id !== id ? [i] : quantity > 0 ? [{ ...i, quantity: Math.min(100, quantity) }] : [])); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (loading || needsReview || busy) return; setBusy(true); setError('');
    const payload = { customer_name: name, phone, fulfilment, payment_method: method, address, items: cart.map(i => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price: i.unit_price })) };
    const encoded = JSON.stringify(payload);
    const attempt = pending?.payload === encoded ? pending : { key: crypto.randomUUID(), token: shopToken(), payload: encoded };
    setPending(attempt); try { sessionStorage.setItem('awutorla-checkout', JSON.stringify(attempt)); } catch { /* The in-memory key still protects retries. */ }
    try {
      await shopPost<ShopOrder>(test ? 'admin/test-order' : 'orders', { ...payload, submission_key: attempt.key, access_token: attempt.token });
      save([]); try { sessionStorage.removeItem('awutorla-checkout'); } catch { /* Keep access in the URL. */ }
      location.assign(`/order#${attempt.token}`);
    } catch (err) { setError((err as Error).message); if (err instanceof ShopApiError && err.status === 409) setRefresh(v => v + 1); }
    finally { setBusy(false); }
  }
  return <div className="py-10 sm:py-16"><p className="text-xs uppercase tracking-widest text-gray-500">Your selection</p><h1 className="mt-3 text-3xl sm:text-4xl">{checkout ? 'Checkout' : 'Shopping bag'}</h1>
    {test && <p className="mt-5 p-4 bg-mustard-100 rounded-xl text-sm">Admin test checkout. This reserves real stock. Complete the order in Dashboard → Shop Orders, then restore your test stock.</p>}
    {!cart.length ? <div className="py-16"><p className="text-gray-500 mb-6">Your bag is waiting for something lovely.</p><a href="/" className={button}>Explore the collection <ArrowRight size={16} /></a></div> : <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8 lg:gap-12 mt-10">
      <div className="space-y-5">{problems.map(({ item, product, variant, changed, unavailable }) => <div key={item.variant_id} className="flex gap-4 border-b pb-5"><a href={`/products/${item.slug}`} className="w-20 sm:w-28 aspect-[3/4] bg-cream-200 rounded-xl overflow-hidden shrink-0">{item.image_id && <img src={shopImage(item.image_id)} alt={item.title} className="w-full h-full object-cover" />}</a><div className="flex-1"><a href={`/products/${item.slug}`} className="font-semibold text-sm">{item.title}</a><p className="mt-2 text-xs text-gray-500">{item.size} / {item.colour}</p><p className="mt-2 text-sm">{shopMoney(item.unit_price)}</p>
        <div className="mt-3 flex items-center gap-3"><button aria-label={`Decrease quantity of ${item.title}`} disabled={busy} onClick={() => edit(item.variant_id, item.quantity - 1)} className="p-2 border rounded-full"><Minus size={14} /></button><span className="text-sm">{item.quantity}</span><button aria-label={`Increase quantity of ${item.title}`} disabled={busy || item.quantity >= 100 || (!!variant && item.quantity >= Number(variant.available))} onClick={() => edit(item.variant_id, item.quantity + 1)} className="p-2 border rounded-full"><Plus size={14} /></button><button disabled={busy} aria-label={`Remove ${item.title}`} onClick={() => edit(item.variant_id, 0)} className="ml-auto p-2 text-gray-500"><Trash2 size={16} /></button></div>
        {!loading && changed && <p className="mt-3 text-xs text-amber-800">Price changed to {shopMoney(product!.price_pesewas)}. <button disabled={busy} className="underline" onClick={() => save(cart.map(i => i.variant_id === item.variant_id ? { ...i, unit_price: product!.price_pesewas } : i))}>Accept new price</button></p>}
        {!loading && unavailable && <p className="mt-3 text-xs text-rose-700">{variant ? `Only ${variant.available} available. Reduce the quantity or remove this item.` : 'This item is unavailable. Please remove it.'}</p>}</div></div>)}
        <a href="/" className="inline-flex gap-2 items-center text-sm underline"><ChevronLeft size={15} /> Continue shopping</a></div>
      <div><div className="rounded-3xl bg-white border p-6 sm:p-8"><h2 className="text-lg font-semibold">Order summary</h2><div className="flex justify-between text-sm mt-5"><span>Items</span><span>{shopMoney(subtotal)}</span></div><div className="flex justify-between text-sm mt-3"><span>{checkout && fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</span><span>{checkout && fulfilment === 'pickup' ? 'Free' : 'To be confirmed'}</span></div><p className="text-xs text-gray-500 mt-4 leading-6">For Ghana delivery, the atelier will contact you to agree the fee before payment. Your items are held for 24 hours while we confirm your order.</p>
        {error && <p role="alert" className="mt-5 text-sm text-rose-700">{error}</p>}{loading && <p className="text-xs mt-4">Checking current prices and stock…</p>}
        {checkout ? <form onSubmit={submit} className="mt-6 space-y-4"><label className={field}>Full name<input required autoComplete="name" maxLength={120} className={input} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label><label className={field}>Ghanaian phone number<input required type="tel" autoComplete="tel" placeholder="0241234567" className={input} value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} /></label>
          <label className={field}>Receive your order<select className={input} value={fulfilment} disabled={busy} onChange={e => { setFulfilment(e.target.value as 'pickup' | 'delivery'); if (e.target.value === 'delivery') setMethod('momo'); }}><option value="pickup">Collect at the atelier</option><option value="delivery">Delivery within Ghana</option></select></label>
          {fulfilment === 'delivery' ? <label className={field}>Ghana delivery address<textarea required maxLength={1000} placeholder="Street / landmark, town, region and GhanaPost GPS address if available" className={input} value={address} onChange={e => setAddress(e.target.value)} disabled={busy} /></label> : <p className="text-xs text-gray-500 whitespace-pre-wrap">{config.pickup_details}</p>}
          <label className={field}>Payment method<select aria-label="Payment method" className={input} value={method} disabled={busy} onChange={e => setMethod(e.target.value as 'momo' | 'cash')}><option value="momo">Mobile money — verified by staff</option>{fulfilment === 'pickup' && <option value="cash">Cash at pickup</option>}</select></label>
          <p className="text-xs text-gray-500 leading-6">Payment instructions follow staff confirmation. Submitting this order does not take a payment. We use these details to process and fulfil your order.</p>
          <button className={`${button} w-full`} disabled={busy || loading || needsReview || (!config.checkout_enabled && !test)}>{busy ? 'Submitting order…' : 'Place order'} <ArrowRight size={15} /></button>
          {pending && <a href={`/order#${pending.token}`} className="block text-xs underline">Check whether your previous submission succeeded</a>}
          {!config.checkout_enabled && !test && <p className="text-xs text-amber-800">Checkout is not open yet. Please contact the atelier.</p>}
        </form> : <><a href={needsReview || loading || error ? '/cart' : '/checkout'} aria-disabled={needsReview || loading || !!error} className={`${button} w-full mt-6 ${needsReview || loading || error ? 'pointer-events-none opacity-40' : ''}`}>Continue to checkout <ArrowRight size={15} /></a>{!config.checkout_enabled && <p className="text-xs mt-4 text-gray-500">You can prepare your bag; checkout is not open yet.</p>}</>}
        <button type="button" disabled={busy || loading} className="mt-4 text-xs underline text-gray-500" onClick={() => setRefresh(v => v + 1)}>Check prices and stock again</button>
      </div></div>
    </div>}
  </div>;
}

function OrderStatus() {
  const [order, setOrder] = useState<ShopOrder | null>(null); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0); const [copy, setCopy] = useState(false);
  const [token, setToken] = useState(() => location.hash.slice(1));
  useEffect(() => { const changeLink = () => { setToken(location.hash.slice(1)); setOrder(null); setError(''); setCopy(false); }; const update = () => setRefresh(v => v + 1);
    window.addEventListener('hashchange', changeLink); window.addEventListener('focus', update); const timer = setInterval(update, 30000);
    return () => { window.removeEventListener('hashchange', changeLink); window.removeEventListener('focus', update); clearInterval(timer); }; }, []);
  useEffect(() => { let alive = true; if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setError('This order link is incomplete. Use the full link saved after checkout.'); return; }
    shopRequest<ShopOrder>('orders/status', { headers: { Authorization: `Bearer ${token}` } }).then(o => { if (alive) { setOrder(o); setError(''); } }).catch(err => { if (alive) setError(err.message); }); return () => { alive = false; }; }, [refresh, token]);
  return <div className="py-12 sm:py-20 max-w-2xl mx-auto">{!order ? <p role={error ? 'alert' : 'status'}>{error || 'Loading your order…'}</p> : <>
    <div className="h-14 w-14 rounded-full bg-mustard-100 flex items-center justify-center mb-6"><Package size={24} /></div><p className="text-xs uppercase tracking-widest text-gray-500">{order.is_test ? 'Test order' : 'Your order'} · {order.reference}</p><h1 className="mt-4 text-3xl sm:text-4xl">{SHOP_STATUS_LABELS[order.status]}</h1>
    <p className="mt-5 text-sm text-gray-600 leading-7">{order.status === 'awaiting_confirmation' ? 'Thank you. The atelier will contact you to confirm availability and agree any delivery fee. Payment instructions will appear here after confirmation.' : order.status === 'expired' ? 'The 24-hour reservation expired before confirmation. No items are held. Contact the atelier before making any payment; a fresh order is needed.' : order.status === 'cancelled' ? 'This order was cancelled. Contact the atelier about any payment already made.' : order.status === 'fulfilled' ? 'Your order has been collected or dispatched. Thank you for choosing Awutorla.' : 'Your order is confirmed. Check your payment and collection details below.'}</p>
    {order.status === 'awaiting_confirmation' && <p className="mt-4 rounded-xl bg-mustard-50 p-4 text-sm">Items held until {new Date(order.reserved_until).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })} (Ghana time).</p>}
    <div className="mt-8 rounded-3xl border bg-white p-6 space-y-4">{order.items.map((i, index) => <div key={index} className="flex justify-between gap-4 text-sm"><div><p className="font-semibold">{i.title} × {i.quantity}</p><p className="text-xs text-gray-500 mt-1">{i.size} / {i.colour}</p></div><span>{shopMoney(i.unit_price * i.quantity)}</span></div>)}<div className="border-t pt-4 text-sm space-y-3"><p className="flex justify-between"><span>Items</span><span>{shopMoney(order.subtotal)}</span></p><p className="flex justify-between"><span>{order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</span><span>{order.delivery_fee === null ? 'To be confirmed' : shopMoney(order.delivery_fee)}</span></p><p className="flex justify-between font-semibold"><span>Total</span><span>{order.total === null ? 'Awaiting delivery quote' : shopMoney(order.total)}</span></p><p className="flex justify-between"><span>Verified payments</span><span>{shopMoney(order.paid)}</span></p>{order.total !== null && <p className="flex justify-between"><span>Balance</span><span>{shopMoney(Math.max(0, order.total - order.paid))}</span></p>}</div></div>
    {['confirmed', 'ready'].includes(order.status) && order.payment_method === 'cash' && <p className="mt-6 rounded-xl bg-mustard-50 p-5 text-sm">Pay your balance in cash when collecting at the atelier.</p>}
    {order.payment_instructions && order.total !== null && order.paid < order.total && <div className="mt-6 bg-mustard-50 p-5 rounded-2xl text-sm leading-7"><h2 className="font-semibold">Mobile money payment</h2><p>Send {shopMoney(order.total - order.paid)} to {order.payment_instructions.number}.</p><p>Account name: {order.payment_instructions.name}</p><p>Quote {order.reference} and share your transaction reference with the atelier. Staff will verify the receipt.</p></div>}
    <div className="mt-6 text-sm leading-7"><h2 className="font-semibold">{order.fulfilment === 'pickup' ? 'Collection details' : 'Delivery address'}</h2><p className="whitespace-pre-wrap text-gray-600">{order.fulfilment === 'pickup' ? order.pickup_details : order.address}</p>{order.contact_phone && <a className="underline" href={`tel:+${order.contact_phone}`}>Contact the atelier: +{order.contact_phone}</a>}</div>
    <p className="text-xs text-gray-500 mt-8">Save this private link to check your order. Anyone with the full link can view these order details.</p><div className="flex flex-wrap gap-3 mt-4"><button className={button} onClick={() => setRefresh(v => v + 1)}>Refresh status</button><button className="rounded-full border px-5 py-3 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(location.href); setCopy(true); } catch { setError('Copy this page’s full address from your browser to save the order link.'); } }}>{copy ? 'Link copied' : 'Copy order link'}</button></div>
    {error && <p role="alert" className="text-sm text-rose-700 mt-4">{error}</p>}
  </>}</div>;
}

export default function Shop() {
  const [config, setConfig] = useState(defaults); const [configError, setConfigError] = useState(''); const [cart, setCart] = useState(readCart); const [storageError, setStorageError] = useState('');
  useEffect(() => { let alive = true; shopRequest<ShopConfig>('config').then(c => { if (alive) setConfig(c); }).catch(() => { if (alive) setConfigError('The shop is temporarily unavailable. Please refresh to try again.'); }); return () => { alive = false; }; }, []);
  function save(items: CartItem[]) { setCart(items); try { localStorage.setItem(CART_KEY, JSON.stringify(items)); setStorageError(''); } catch { setStorageError('Your browser could not save the bag. Allow site storage before navigating to checkout.'); } }
  const path = location.pathname;
  const add = (item: CartItem, available: number) => { const existing = cart.find(i => i.variant_id === item.variant_id); const quantity = item.quantity + (existing?.quantity || 0); if (quantity > available || quantity > 100) throw new Error('Your bag already contains the available quantity. Review it before adding more.'); save([...cart.filter(i => i.variant_id !== item.variant_id), { ...item, quantity }]); };
  return <div className="min-h-screen bg-cream-100 text-charcoal-950"><header className="border-b border-gray-200"><div className="max-w-7xl mx-auto px-5 sm:px-10 py-5 flex items-center justify-between gap-5"><a href="/" aria-label={`${config.business_name} homepage`}><img src="/logo.png" alt={config.business_name} className="h-10 sm:h-12 w-auto" /></a><nav aria-label="Shop navigation" className="flex items-center gap-5 sm:gap-8 text-sm"><a href="/" className="hidden sm:block">Collection</a><a href="/cart" className="inline-flex items-center gap-2"><ShoppingBag size={19} /><span>Bag ({cart.reduce((s, i) => s + i.quantity, 0)})</span></a></nav></div></header>
    <main className="max-w-7xl mx-auto px-5 sm:px-10">{storageError && <p role="alert" className="mt-5 bg-rose-50 p-4 text-sm text-rose-700 rounded-xl">{storageError}</p>}{configError ? <p role="alert" className="py-16 text-sm text-rose-700">{configError}</p> : path.startsWith('/products/') ? <ProductPage add={add} /> : path === '/cart' || path === '/checkout' ? <CartPage cart={cart} save={save} config={config} checkout={path === '/checkout'} /> : path === '/order' ? <OrderStatus /> : path === '/' || path === '/shop' ? <Catalogue config={config} /> : <div className="py-20"><h1 className="text-3xl">Page not found</h1><a href="/" className="underline mt-5 block">Back to collection</a></div>}</main>
    <footer className="border-t mt-12"><div className="max-w-7xl mx-auto px-5 sm:px-10 py-10 flex flex-wrap justify-between gap-7 text-xs text-gray-500"><div><p className="font-semibold text-charcoal-950 text-sm">{config.business_name}</p><p className="mt-2">Ready to wear. Made to be yours.</p>{config.contact_phone && <a className="block mt-3 underline" href={`tel:+${config.contact_phone}`}>+{config.contact_phone}</a>}{config.contact_email && <a className="block mt-2 underline" href={`mailto:${config.contact_email}`}>{config.contact_email}</a>}</div><div className="space-y-3"><p>Studio pickup · Delivery within Ghana</p><p>Prices in GHS · Staff-verified payments</p><a href="/staff" className="inline-block underline">Staff sign in</a></div></div></footer>
  </div>;
}
