import React, { useState } from 'react';
import { Users, Ruler, Store, ShieldCheck } from 'lucide-react';
import { TailorsManager } from '../components/admin/TailorsManager';
import { MeasurementParametersEditor } from '../components/admin/MeasurementParametersEditor';
import { BusinessSettingsEditor } from '../components/admin/BusinessSettingsEditor';
import { activeTabClass, inactiveTabClass } from '../components/ui/tabStyles';
import { AbandonedUploads } from '../components/admin/AbandonedUploads';

type SettingsSection = 'tailors' | 'measurements' | 'business' | 'uploads';

const SECTIONS: { id: SettingsSection; label: string; icon: React.ReactNode; description: string }[] = [
  {id:'uploads',label:'Unused Uploads',icon:<Store size={15}/>,description:'Review abandoned intake attachments without removing saved order files.'},
  { id: 'tailors', label: 'Tailors & Team', icon: <Users size={15} />, description: 'Manage staff accounts, artisan credentials, and role privileges.' },
  {
    id: 'measurements',
    label: 'Measurement Schema',
    icon: <Ruler size={15} />,
    description: 'The master specification fields utilized across every bespoke client passport.',
  },
  { id: 'business', label: 'Atelier Details', icon: <Store size={15} />, description: 'House branding, concierge messaging defaults, and studio contact points.' },
];

export const AdminSettings: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('tailors');
  const current = SECTIONS.find((s) => s.id === activeSection)!;

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Title Section */}
      <div className="text-center space-y-2 max-w-xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-charcoal-800 bg-mustard-50 border border-mustard-200 shadow-sm">
          <ShieldCheck size={13} className="text-mustard-600" />
          <span>Privileged Controls</span>
        </div>
        <h2 className="text-3xl sm:text-4xl text-charcoal-950 font-display font-semibold tracking-tight">Atelier Settings</h2>
        <p className="text-xs sm:text-sm text-gray-500 font-sans">
          Configure the tailoring team, master sizing parameters, and studio credentials.
        </p>
      </div>

      {/* Navigation Pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 justify-start">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-5 py-2.5 text-xs font-semibold rounded-2xl whitespace-nowrap transition-all flex items-center gap-2 shadow-sm border ${
              activeSection === s.id ? `${activeTabClass} border-transparent shadow-md` : `glass ${inactiveTabClass} border-gray-200/80`
            }`}
          >
            {s.icon}
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Section Content Shell */}
      <div className="glass p-6 sm:p-8 rounded-3xl border border-gray-200/60 shadow-luxury space-y-2">
        <h3 className="text-xl sm:text-2xl font-bold text-charcoal-950 font-display">{current.label}</h3>
        <p className="text-xs text-gray-500 mb-6 font-sans">{current.description}</p>

        <div className="pt-2">
          {activeSection === 'tailors' && <TailorsManager />}
          {activeSection === 'measurements' && <MeasurementParametersEditor />}
          {activeSection === 'business' && <BusinessSettingsEditor />}
          {activeSection === 'uploads' && <AbandonedUploads />}
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
