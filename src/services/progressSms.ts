import { api } from '../lib/api';
import type { BespokeJobOrder } from '../types/workshop.types';
export async function advanceOrder(order: BespokeJobOrder) {
  const { data, error } = await (api as any).rpc('advance_order_stage', {
    p_order_id: order.id, p_expected_stage: order.stage,
  });
  if (error) throw new Error(error.message || 'Could not confirm this change. Refresh the order before advancing again.');
  return { order: data, message: 'Stage saved. A progress SMS is ready for staff to send and record.' };
}
