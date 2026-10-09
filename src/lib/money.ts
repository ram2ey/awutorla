import type { BespokeJobOrder } from '../types/workshop.types';
export const toPesewas = (amount: number) => Math.round(amount * 100);
export const formatGhs = (amount: number) => `GHS ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function orderBalance(order: Pick<BespokeJobOrder, 'totalAmount' | 'depositPaid'>) {
  const net = toPesewas(order.totalAmount) - toPesewas(order.depositPaid);
  return { due: Math.max(0, net) / 100, credit: Math.max(0, -net) / 100 };
}
/** Ghana uses UTC; receipt dates are calendar dates, not browser-local timestamps. */
export const todayGhana = () => new Date().toISOString().slice(0, 10);
