import { supabase } from './supabase';
import { readAllRows } from './queryRows';
export interface Fitting {
  id: string; order_id: string; tailor_id: string; starts_at: string; duration_minutes: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed'; notes: string; revision: number;
}
export interface Rework { id: string; reason: string; status: 'open' | 'completed' | 'cancelled'; notes: string; revision: number }
export interface Quality { id: string; work_revision: number; notes: string; checked_at: string; checked_by: string }
export interface Audit { id: string; event: string; actor_name: string; recorded_at: string; details: Record<string, any> }
export async function fetchOperations(orderId: string) {
  const records = await Promise.all(['fitting_appointments','order_rework','order_quality_checks','order_audit'].map((table) =>
    readAllRows((supabase as any).from(table).select('*').eq('order_id',orderId).order('id'))));
  return { fittings: records[0] as Fitting[], rework: records[1] as Rework[], quality: records[2] as Quality[], audit: records[3] as Audit[] };
}
export async function workshopOperation(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as any).rpc(name,args);
  if (error) throw new Error(error.message || 'Could not confirm this workshop change. Refresh before trying again.');
  return data;
}
export const QUALITY_LABELS = { fit: 'Fit and comfort checked', measurements: 'Matches the saved order measurements', seams: 'Seams and construction checked', finish: 'Finishing, pressing and presentation checked' };
export const ghanaTime = (date: string) => new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Accra'}).format(new Date(date));
