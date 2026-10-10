export interface ShopConfig {
  business_name: string; contact_phone: string; contact_email: string; pickup_details: string;
  shop_open: boolean; checkout_enabled: boolean;
}
export interface ShopSettings extends ShopConfig {
  momo_number: string; momo_name: string; version: number; test_order_complete?: boolean;
}
export interface ShopVariant {
  id: string; sku: string; size: string; colour: string; stock: number; available: number; active: boolean;
}
export interface ShopProduct {
  id: string; slug: string; title: string; description: string; category: string; size_guide: string;
  price_pesewas: number; published: boolean; version: number;
  images: { id: string; alt: string; position: number }[]; variants: ShopVariant[];
}
export interface CartItem {
  variant_id: string; slug: string; title: string; size: string; colour: string; quantity: number;
  unit_price: number; image_id?: string;
}
export type ShopStatus = 'awaiting_confirmation' | 'confirmed' | 'ready' | 'fulfilled' | 'cancelled' | 'expired';
export const SHOP_STATUS_LABELS: Record<ShopStatus, string> = {
  awaiting_confirmation: 'Awaiting confirmation', confirmed: 'Confirmed', ready: 'Ready',
  fulfilled: 'Fulfilled', cancelled: 'Cancelled', expired: 'Expired',
};
export interface ShopPayment {
  id: string; kind: 'receipt' | 'reversal' | 'refund'; amount: number; method: 'momo' | 'cash';
  occurred_on: string; reference: string; notes: string; reverses_id: string | null; recorded_by_name: string;
}
export interface ShopOrder {
  id: string; reference: string; customer_name: string; phone: string; address: string;
  fulfilment: 'pickup' | 'delivery'; payment_method: 'momo' | 'cash'; subtotal: number;
  delivery_fee: number | null; total: number | null; paid: number; status: ShopStatus;
  reserved_until: string; created_at: string; version: number; is_test: boolean;
  contact_phone: string; pickup_details: string;
  items: { title: string; description: string; sku: string; size: string; colour: string; quantity: number; unit_price: number }[];
  payment_instructions: { number: string; name: string } | null;
  payments?: ShopPayment[];
  audit?: { action: string; details: Record<string, unknown>; created_at: string; actor: string | null }[];
}
export class ShopApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function shopRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/shop/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { ...(options.body && !(options.body instanceof File) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw new ShopApiError(result.error?.message || 'Could not complete the shop request.', response.status);
  return result.data as T;
}
export const shopPost = <T>(path: string, data: unknown) => shopRequest<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const shopMoney = (pesewas: number) => `GHS ${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const shopImage = (id: string, admin = false) => `/api/shop/${admin ? 'admin/' : ''}images/${id}`;
export function shopToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export const CART_KEY = 'awutorla-shop-cart-v1';
export function readCart(): CartItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CartItem => !!item && typeof item === 'object' &&
      typeof item.variant_id === 'string' && /^[a-f0-9-]{36}$/i.test(item.variant_id) &&
      ['slug', 'title', 'size', 'colour'].every(key => typeof item[key] === 'string') &&
      Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100 &&
      Number.isSafeInteger(item.unit_price) && item.unit_price > 0).slice(0, 30);
  } catch { return []; }
}
