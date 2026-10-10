import { api } from './api';
import type { MeasurementParameter } from '../types/workshop.types';

function mapParameterRow(row: any): MeasurementParameter {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

/**
 * Fetches the admin-managed, global list of measurement parameters (e.g.
 * bust, waist — plus anything an admin has added), ordered for display.
 */
export async function fetchMeasurementParameters(includeInactive = false): Promise<MeasurementParameter[]> {
  let query = api.from('measurement_parameters').select('*').order('display_order', { ascending: true });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapParameterRow);
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Adds a new measurement parameter to the shared list — it will appear on
 * every client's measurement form from this point on. Admin-only (enforced
 * by RLS regardless of what calls this).
 */
export async function createMeasurementParameter(label: string, displayOrder: number): Promise<MeasurementParameter> {
  const key = slugify(label);
  if (!key) throw new Error('Enter a parameter name.');

  const { data, error } = await (api.from('measurement_parameters') as any)
    .insert({ key, label: label.trim(), display_order: displayOrder })
    .select()
    .single();
  if (error) throw error;
  return mapParameterRow(data);
}

/**
 * Soft-deletes (or restores) a parameter — historical values on existing
 * clients are preserved rather than orphaned.
 */
export async function setMeasurementParameterActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await (api.from('measurement_parameters') as any)
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw error;
}

export async function reorderMeasurementParameter(id: string, displayOrder: number): Promise<void> {
  const { error } = await (api.from('measurement_parameters') as any)
    .update({ display_order: displayOrder })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Renames a parameter's display label. The slug `key` is left untouched so
 * existing recorded values (keyed by parameter_id, not by key) are unaffected.
 */
export async function updateMeasurementParameterLabel(id: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Enter a parameter name.');

  const { error } = await (api.from('measurement_parameters') as any)
    .update({ label: trimmed })
    .eq('id', id);
  if (error) throw error;
}
