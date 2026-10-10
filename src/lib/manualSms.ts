import { api } from './api';
import { readAllRows } from './queryRows';
export interface ManualSms {
  id: string; order_id: string; stage: string; recipient: string; content: string; status: string;
  sent_at: string | null; sent_by: string | null; created_at: string; last_error: string | null;
  production_cycle?: number; reviewed_at?: string | null; review_notes?: string | null;
  reviewer?: { full_name: string | null } | null;
  staff?: { full_name: string | null } | null;
  orders: { id: string; status: string; client_name: string; garment_title: string; production_cycle?: number };
}
export const canRecordManualSms = (notice: Pick<ManualSms, 'status' | 'stage' | 'orders'>) =>
  ['pending', 'failed'].includes(notice.status) && notice.stage === notice.orders.status
    && ((notice as ManualSms).production_cycle || 1) === (notice.orders.production_cycle || 1);
export async function fetchManualSms(orderId?: string): Promise<ManualSms[]> {
  let query = (api.from('sms_notifications') as any).select(
    '*, staff:profiles!sms_notifications_sent_by_fkey(full_name), reviewer:profiles!sms_notifications_reviewed_by_fkey(full_name), orders!inner(id,status,client_name,garment_title,production_cycle)'
  ).order('created_at', { ascending: false }).order('id');
  if (orderId) query = query.eq('order_id', orderId);
  else query = query.in('status', ['pending', 'failed', 'sending', 'submitted']);
  const data = await readAllRows<ManualSms>(query);
  return data.filter((notice) => orderId || canRecordManualSms(notice) || ['sending','submitted'].includes(notice.status));
}
export async function recordManualSms(id: string) {
  const { error } = await (api as any).rpc('record_manual_sms', { p_notification_id: id });
  if (error) throw new Error(error.message || 'Could not save the SMS record. Refresh before trying again.');
}
