import React, { useEffect, useState } from 'react';
import { Search, User, Phone, Loader2, UserPlus, Users, ArrowRight } from 'lucide-react';
import { workshopOperation } from '../lib/workshopOperations';
import { PageControls } from '../components/ui/PageControls';
import { ClientProfile } from '../components/clients/ClientProfile';
import { QuickIntakeModal } from '../components/workshop/QuickIntakeModal';

interface ClientRow {
  id: string;
  full_name: string | null;
  phone_number: string | null;
}

export const Clients: React.FC = () => {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);
  const [page,setPage]=useState(0);const [total,setTotal]=useState(0);const [error,setError]=useState('');const [reload,setReload]=useState(0);
  const [searchTerm,setSearchTerm]=useState('');

  useEffect(()=>{const timer=setTimeout(()=>{setSearchTerm(searchQuery);setPage(0);},250);return()=>clearTimeout(timer);},[searchQuery]);
  useEffect(()=>{let active=true;setIsLoading(true);
    workshopOperation('workshop_client_page',{p_search:searchTerm.trim(),p_page:page}).then(data=>{if(active){setClients(data.records);setTotal(Number(data.total));setError('');}})
      .catch(err=>{if(active)setError(err.message || 'Could not load customer records.');})
      .finally(()=>{if(active)setIsLoading(false);});return()=>{active=false;};
  },[searchTerm,page,reload]);
  const filtered=clients;
  if (selectedClientId) {
    const client = clients.find((c) => c.id === selectedClientId);
    return (
      <ClientProfile
        clientId={selectedClientId}
        clientName={client?.full_name || 'Client'}
        clientPhone={client?.phone_number || ''}
        onBack={() => setSelectedClientId(null)}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Title Section */}
      <div className="text-center space-y-2 max-w-xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-accent-800 bg-accent-50/80 border border-accent-200/60 shadow-sm">
          <Users size={13} className="text-gold-600" />
          <span>Client Roster</span>
        </div>
        <h2 className="text-3xl sm:text-4xl text-accent-950 font-display font-semibold tracking-tight">Clients</h2>
        <p className="text-xs sm:text-sm text-gray-500 font-sans">
          Search and manage bespoke profiles, measurement passports, and order histories.
        </p>
      </div>

      {/* Action and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search customers"
            placeholder="Search by client name or phone number..."
            className="w-full glass-inset pl-10 pr-4 py-3 text-sm text-gray-900 placeholder-gray-400 rounded-2xl border border-gray-200/80 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 shadow-sm transition-all"
          />
          <Search size={16} className="absolute left-3.5 top-3.5 text-gray-400" />
        </div>
        <button
          onClick={() => setIsIntakeOpen(true)}
          className="px-5 py-3 bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 hover:to-accent-500 text-white font-semibold text-xs sm:text-sm rounded-2xl shadow-md shadow-accent-900/15 transition-all duration-200 flex items-center justify-center gap-2 shrink-0 hover:scale-[1.02]"
        >
          <UserPlus size={15} className="text-gold-300" />
          <span>New Client</span>
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-rose-700">{error} <button onClick={()=>setReload(v=>v+1)} className="underline">Retry customer records</button></p>}
      {/* Content Area */}
      {isLoading ? (
        <div className="p-16 flex flex-col justify-center items-center gap-3 text-gray-500 text-sm">
          <Loader2 size={20} className="animate-spin text-accent-700" />
          <span>Loading client directory...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center glass rounded-3xl space-y-3 border border-gold-500/20">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gold-50 text-gold-700 flex items-center justify-center border border-gold-500/20 shadow-sm">
            <User size={26} />
          </div>
          <h4 className="text-xl font-semibold text-accent-950 font-display">No clients found</h4>
          <p className="text-xs sm:text-sm text-gray-500 max-w-sm mx-auto">
            {searchQuery ? `No client matches "${searchQuery}".` : 'Register your first bespoke client to begin.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedClientId(c.id)}
              className="text-left glass p-5 rounded-2xl hover:border-gold-500/40 hover:shadow-luxury transition-all duration-200 flex items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent-800 to-accent-950 text-gold-300 border border-gold-500/30 flex items-center justify-center shrink-0 font-display font-semibold text-sm shadow-sm group-hover:scale-105 transition-transform">
                  {(c.full_name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-accent-950 truncate group-hover:text-accent-800 transition-colors">
                    {c.full_name || 'Unnamed Client'}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5 font-mono">
                    <Phone size={11} className="text-gold-700" />
                    <span>{c.phone_number || 'No phone'}</span>
                  </div>
                </div>
              </div>

              <div className="w-7 h-7 rounded-lg bg-gray-50 group-hover:bg-gold-50 text-gray-400 group-hover:text-accent-800 flex items-center justify-center transition-colors shrink-0">
                <ArrowRight size={13} />
              </div>
            </button>
          ))}
        </div>
      )}

      <PageControls page={page} total={total} onChange={setPage} label="Customers"/>
      <QuickIntakeModal
        isOpen={isIntakeOpen}
        onClose={() => setIsIntakeOpen(false)}
        onOrderCreated={() => {
          setIsIntakeOpen(false);
          setSearchQuery('');setPage(0);setReload(v=>v+1);
        }}
      />
    </div>
  );
};

export default Clients;
