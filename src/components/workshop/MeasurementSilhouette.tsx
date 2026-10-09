import React from 'react';
import { Ruler } from 'lucide-react';
import type { ClientBodyMeasurements, MeasurementParameter } from '../../types/workshop.types';

interface MeasurementSilhouetteProps {
  measurements: ClientBodyMeasurements;
  // Optional — supplies proper labels/ordering for each value key. Falls
  // back to a title-cased version of the raw key when omitted.
  parameters?: MeasurementParameter[];
  className?: string;
}

export const MeasurementSilhouette: React.FC<MeasurementSilhouetteProps> = ({
  measurements,
  parameters,
  className = '',
}) => {
  const unit = measurements.unit || 'in';

  const entries =
    measurements.labels && Object.keys(measurements.labels).length > 0
      ? Object.entries(measurements.values).map(([key, value]) => ({ key, label: measurements.labels?.[key] || key.replace(/_/g, ' '), value }))
      : parameters && parameters.length > 0
      ? parameters.map((p) => ({ key: p.key, label: p.label, value: measurements.values[p.key] }))
      : Object.entries(measurements.values).map(([key, value]) => ({
          key,
          label: key.replace(/_/g, ' '),
          value,
        }));

  return (
    <div className={`p-6 glass rounded-2xl border border-gold-500/20 shadow-sm ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-accent-950 uppercase tracking-widest flex items-center gap-1.5">
          <Ruler size={14} className="text-gold-700" />
          <span>Body Measurements</span>
        </span>
        <span className="text-[10px] font-semibold text-gold-800 bg-gold-50/90 px-2 py-0.5 rounded-full border border-gold-500/20 font-mono uppercase">
          Unit: {unit.toUpperCase()}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-gray-500 py-4 text-center">No measurements recorded in passport yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {entries.map((entry) => (
            <div key={entry.key} className="p-3.5 glass-inset rounded-xl text-center border border-gray-200/60 hover:border-gold-500/30 transition-all">
              <div className="text-[11px] font-medium text-gray-500 capitalize truncate">{entry.label}</div>
              <div className="text-base font-bold text-accent-950 mt-0.5 font-mono">
                {entry.value ?? '—'}{' '}
                <span className="text-[11px] font-medium text-gold-700">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {measurements.notes && (
        <div className="mt-4 p-3.5 bg-gradient-to-br from-gold-50 to-accent-50/50 border border-gold-500/20 rounded-xl text-xs text-gray-700">
          <span className="font-semibold text-accent-900 block mb-0.5 font-display text-sm">Fitting & Stature Notes</span>
          <p className="text-gray-600 leading-relaxed font-sans">{measurements.notes}</p>
        </div>
      )}
    </div>
  );
};

export default MeasurementSilhouette;
