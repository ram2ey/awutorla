import { api } from './api';
import type { BespokeJobOrder, WorkshopStage, PaymentEntry } from '../types/workshop.types';
import { orderBalance, toPesewas } from './money';
import { normalizeDueDate } from './dates';

export interface OrderStatusCount {
  stage: WorkshopStage;
  label: string;
  count: number;
}

export interface TailorLoad {
  tailorName: string;
  activeOrders: number;
  completedOrders: number;
}

const STAGE_LABELS: Record<WorkshopStage, string> = {
  pending: 'Received',
  cutting: 'Cutting',
  fitting: 'Fitting',
  finishing: 'Finishing',
  ready: 'Ready',
  delivered: 'Delivered',
};

const STAGES: WorkshopStage[] = ['pending', 'cutting', 'fitting', 'finishing', 'ready', 'delivered'];

export function computeOrdersByStatus(orders: BespokeJobOrder[]): OrderStatusCount[] {
  return STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: orders.filter((o) => o.stage === stage).length,
  }));
}

export function computeTailorLoads(orders: BespokeJobOrder[]): TailorLoad[] {
  const map = new Map<string, TailorLoad>();
  for (const order of orders) {
    const name = order.assignedTailor || 'Unassigned';
    const entry = map.get(name) || { tailorName: name, activeOrders: 0, completedOrders: 0 };
    if (order.stage === 'delivered') entry.completedOrders += 1;
    else entry.activeOrders += 1;
    map.set(name, entry);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.activeOrders + b.completedOrders - (a.activeOrders + a.completedOrders)
  );
}

export function computeRevenueThisMonth(payments: PaymentEntry[], now = new Date()): number {
  const month = now.toISOString().slice(0, 7);
  return payments.filter((entry) => entry.kind !== 'opening_balance' && entry.occurredOn?.slice(0, 7) === month)
    .reduce((sum, entry) => sum + toPesewas(entry.amount), 0) / 100;
}

export function computeOutstandingBalance(orders: BespokeJobOrder[]): number {
  return orders.reduce((sum, order) => sum + toPesewas(orderBalance(order).due), 0) / 100;
}
export type OrderView = 'active' | 'overdue' | 'unpaid' | 'delivered_unpaid' | 'credit';
export function ordersForView(orders: BespokeJobOrder[], view: OrderView, today = new Date().toISOString().slice(0, 10)) {
  return orders.filter((order) => {
    if (view === 'unpaid') return orderBalance(order).due > 0;
    if (view === 'delivered_unpaid') return order.stage === 'delivered' && orderBalance(order).due > 0;
    if (view === 'credit') return orderBalance(order).credit > 0;
    if (view === 'overdue') { const due = normalizeDueDate(order.dueDate); return order.stage !== 'delivered' && due !== null && due < today; }
    return order.stage !== 'delivered';
  });
}

/**
 * Counts new customer records this calendar month. Separate from the orders
 * data (which already carries everything else the dashboard needs) since it
 * comes from `clients` rather than `orders`.
 */
export async function fetchNewClientsThisMonth(): Promise<number> {
  const startOfMonth = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
  const { count, error } = await api
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfMonth);
  if (error) throw error;
  return count || 0;
}
