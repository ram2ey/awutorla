import { supabase } from './supabase';
import type { PaymentEntry, BespokeJobOrder } from '../types/workshop.types';
import { applyOrderRecord } from './orders';

export const PAYMENT_METHODS = ['Cash in Atelier', 'In-Store POS / Card', 'Direct Bank Transfer', 'Direct MoMo'];
export function mapPaymentRow(row: any): PaymentEntry {
  return { id: row.id, orderId: row.order_id, kind: row.kind, amount: Number(row.amount), currency: 'GHS',
    method: row.method, occurredOn: row.occurred_on, reference: row.reference, notes: row.notes,
    recordedBy: row.recorded_by, recordedByName: row.recorded_by_name || row.staff?.full_name || (row.recorded_by ? 'Staff' : 'Migration'),
    recordedAt: row.recorded_at, reversesPaymentId: row.reverses_payment_id };
}
export function paymentResult(order: BespokeJobOrder, data: any): BespokeJobOrder {
  return applyOrderRecord(order, data.order, (data.payments || []).map(mapPaymentRow));
}
export async function recordPayment(order: BespokeJobOrder, input: {
  submissionKey: string; amount: number; method: string; date: string; reference: string; notes: string; allowCredit: boolean;
}): Promise<BespokeJobOrder> {
  const { data, error } = await (supabase as any).rpc('record_payment', {
    p_order_id: order.id, p_submission_key: input.submissionKey, p_amount: input.amount,
    p_method: input.method, p_occurred_on: input.date, p_reference: input.reference,
    p_notes: input.notes, p_allow_credit: input.allowCredit,
  });
  if (error) throw new Error(error.message || 'Could not confirm this payment. Refresh the ledger before recording another payment.');
  return paymentResult(order, data);
}
export async function reversePayment(order: BespokeJobOrder, paymentId: string, submissionKey: string, reason: string) {
  const { data, error } = await (supabase as any).rpc('reverse_payment', {
    p_payment_id: paymentId, p_submission_key: submissionKey, p_reason: reason,
  });
  if (error) throw new Error(error.message || 'Could not confirm this correction. Refresh the ledger before trying again.');
  return paymentResult(order, data);
}
