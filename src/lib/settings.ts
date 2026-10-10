import { api } from './api';

export interface AppSettings {
  business_name: string;
  contact_phone: string;
  contact_email: string;
  currency: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  business_name: "Awutorla",
  contact_phone: '',
  contact_email: '',
  currency: 'GHS',
};

/**
 * Reads business settings for signed-in staff; writable by admins only.
 */
export async function fetchAppSettings(): Promise<AppSettings> {
  const { data, error } = await api.from('app_settings').select('key, value');
  if (error) throw error;

  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
  for (const row of (data || []) as any[]) {
    if (row.key in settings) {
      (settings as any)[row.key] = row.value ?? (settings as any)[row.key];
    }
  }
  settings.currency = 'GHS';
  return settings;
}

export async function updateAppSetting(key: keyof AppSettings, value: string): Promise<void> {
  if (key === 'currency' && value !== 'GHS') throw new Error('Workshop currency is fixed to GHS.');
  const { error } = await (api.from('app_settings') as any).upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw error;
}
