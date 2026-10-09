import { supabase } from './supabase';
import { resolveOrderSketchUrl } from './storage';
import { mapPaymentRow } from './payments';
import { readAllRows } from './queryRows';
import { saveOfflineJobCard } from './offlineStore';
import type { BespokeJobOrder, ClientBodyMeasurements, OrderTaskItem, PaymentEntry } from '../types/workshop.types';

export function orderMeasurements(row: any): ClientBodyMeasurements {
  const snapshot = row.measurement_snapshot || {};
  return { ...snapshot, clientId: row.client_id || '', clientName: row.client_name, clientPhone: row.client_phone,
    unit: snapshot.unit || 'in', values: snapshot.values || {}, labels: snapshot.labels || {},
    revision: Number(snapshot.revision || 0), updatedAt: snapshot.updatedAt || row.created_at };
}
/** Apply database-confirmed fields without replacing already resolved attachments/tasks. */
export function applyOrderRecord(order: BespokeJobOrder, row: any, payments = order.payments): BespokeJobOrder {
  return { ...order, stage: row.status, depositPaid: Number(row.deposit_paid), totalAmount: Number(row.total_amount),
    currency: 'GHS', dueDate: row.due_date ?? order.dueDate, stageHistory: row.stage_history || [], measurements: orderMeasurements(row), payments,
    updatedAt: row.updated_at, workRevision: Number(row.work_revision || 1), productionCycle: Number(row.production_cycle || 1),
    assignedTailor: row.assigned_tailor ?? order.assignedTailor, assignedTailorId: row.assigned_tailor_id ?? order.assignedTailorId };
}
export async function fetchAllOrders(orderId?: string, orderIds?: string[], clientId?: string): Promise<BespokeJobOrder[]> {
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).order('id');
  if (orderId) query = query.eq('id', orderId);
  if (orderIds) { if (!orderIds.length) return []; query = query.in('id',orderIds); }
  if (clientId) query = query.eq('client_id',clientId);
  const rows = await readAllRows(query);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const taskRows: any[] = []; const paymentRows: any[] = [];
  // Bound the ID list as well as page sizes so large workshops do not exceed URL limits.
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50);
    const [tasks, payments] = await Promise.all([
      readAllRows(supabase.from('order_tasks').select('*').in('order_id', chunk).order('id')),
      readAllRows((supabase.from('payments') as any).select('*, staff:profiles!payments_recorded_by_fkey(full_name)').in('order_id', chunk).order('recorded_at').order('id')),
    ]);
    taskRows.push(...tasks); paymentRows.push(...payments);
  }
  const tasks = new Map<string, OrderTaskItem[]>();
  for (const task of taskRows) {
    const list = tasks.get(task.order_id) || [];
    list.push({ id: task.id, orderId: task.order_id, tailorName: task.tailor_name || 'Staff', title: task.title,
      taskDescription: task.task_description, status: task.status, dueDate: task.due_date,
      assignedAt: task.assigned_at, completedAt: task.completed_at });
    tasks.set(task.order_id, list);
  }
  const payments = new Map<string, PaymentEntry[]>();
  for (const payment of paymentRows) {
    const list = payments.get(payment.order_id) || [];
    list.push(mapPaymentRow(payment)); payments.set(payment.order_id, list);
  }
  const confirmed = await Promise.all(rows.map(async (row) => {
    let attachmentWarning = false;
    const resolve = async (path: string): Promise<string> => {
      try { return await resolveOrderSketchUrl(path); } catch { attachmentWarning = true; return ''; }
    };
    const referenceImages = (await Promise.all((row.reference_images || []).map(resolve))).filter(Boolean);
    const swatchImage = row.swatch_image ? await resolve(row.swatch_image) : undefined;
    return { id: row.id, clientId: row.client_id, clientName: row.client_name, clientPhone: row.client_phone,
      stage: row.status, garmentTitle: row.garment_title, garmentSubtitle: row.garment_subtitle,
      fabricType: row.fabric_type, fabricColor: row.fabric_color, fabricNotes: row.fabric_notes,
      referenceImages, swatchImage, attachmentWarning, measurements: orderMeasurements(row),
      depositPaid: Number(row.deposit_paid), totalAmount: Number(row.total_amount), currency: 'GHS' as const,
      payments: payments.get(row.id) || [], assignedTailor: row.assigned_tailor, assignedTailorId: row.assigned_tailor_id,
      dueDate: row.due_date, createdAt: row.created_at, updatedAt: row.updated_at,
      workRevision: Number(row.work_revision || 1), productionCycle: Number(row.production_cycle || 1),
      tasks: tasks.get(row.id) || [], stageHistory: row.stage_history || [] };
  }));
  confirmed.forEach(saveOfflineJobCard);
  return confirmed;
}
export async function fetchOrder(id: string) {
  const orders = await fetchAllOrders(id);
  if (!orders[0]) throw new Error('Order not found. Refresh the workshop.');
  return orders[0];
}
export function subscribeToOrderChanges(onChange: () => void): () => void {
  const channel = supabase.channel('workshop-orders-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_tasks' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
