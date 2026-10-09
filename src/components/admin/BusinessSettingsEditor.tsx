import React, { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import type { AppSettings } from '../../lib/settings';
import { fetchAppSettings, updateAppSetting, DEFAULT_APP_SETTINGS } from '../../lib/settings';

const inputClass =
  'w-full bg-white/90 border border-gray-200/90 rounded-xl p-2.5 text-xs sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500 shadow-sm transition-all';
const labelClass = 'block text-xs font-semibold text-gray-700 mb-1 tracking-wide uppercase';

export const BusinessSettingsEditor: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchAppSettings()
      .then((data) => {
        if (isMounted) setSettings(data);
      })
      .catch((err) => setErrorMessage(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleChange = (key: keyof AppSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    setSaveSuccess(false);
    try {
      await Promise.all((Object.keys(settings) as (keyof AppSettings)[]).map((key) => updateAppSetting(key, settings[key])));
      setSaveSuccess(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center items-center gap-2 text-gray-500 text-sm">
        <Loader2 size={18} className="animate-spin text-accent-700" />
        <span>Loading atelier business settings...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-5 animate-in fade-in">
      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start gap-2 text-xs">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Atelier House Name</label>
          <input
            type="text"
            value={settings.business_name}
            onChange={(e) => handleChange('business_name', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Workshop Currency</label>
          <input
            type="text"
            value={settings.currency}
            readOnly
            aria-label="Workshop currency, fixed to GHS"
            maxLength={3}
            className={`${inputClass} font-mono uppercase`}
          />
          <p className="text-xs text-gray-500 mt-1">Fixed to GHS for all orders, payments and invoices.</p>
        </div>
        <div>
          <label className={labelClass}>Concierge Contact Phone</label>
          <input
            type="tel"
            value={settings.contact_phone}
            onChange={(e) => handleChange('contact_phone', e.target.value)}
            placeholder="024XXXXXXX"
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label className={labelClass}>Concierge Contact Email</label>
          <input
            type="email"
            value={settings.contact_email}
            onChange={(e) => handleChange('contact_email', e.target.value)}
            placeholder="concierge@awutorla.com"
            className={inputClass}
          />
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-2xl text-xs font-semibold flex items-center gap-2 shadow-sm animate-in fade-in">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>Atelier settings saved successfully.</span>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-gray-200/80">
        <button
          type="submit"
          disabled={isSaving}
          className="px-6 py-2.5 bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md shadow-accent-900/15 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={15} className="animate-spin text-gold-300" /> : <Save size={15} className="text-gold-300" />}
          <span>Save Atelier Settings</span>
        </button>
      </div>
    </form>
  );
};

export default BusinessSettingsEditor;
