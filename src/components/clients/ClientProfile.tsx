import React, { useEffect, useState } from 'react';
import { ArrowLeft, Phone, Loader2, PackageOpen, Receipt, Clock, Sparkles } from 'lucide-react';
import type { BespokeJobOrder } from '../../types/workshop.types';
import { fetchAllOrders, subscribeToOrderChanges } from '../../lib/orders';
import { DigitalJobCard } from '../workshop/DigitalJobCard';
import { RecordPaymentModal } from '../workshop/RecordPaymentModal';
import { MeasurementVaultSync } from '../measurements/MeasurementVaultSync';
import { ProgressBadge } from '../ui/ProgressBadge';
import { formatGhs, orderBalance } from '../../lib/money';

interface ClientProfileProps {
  clientId: string;
  clientName: string;
  clientPhone: string;
  onBack: () => void;
}

/**
 * A single client's executive profile for staff — orders, tasks, and measurements in
 * one place with modern haute couture styling.
 */
export const ClientProfile: React.FC<ClientProfileProps> = ({ clientId, clientName, clientPhone, onBack }) => {
  const [orders, setOrders] = useState<BespokeJobOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error,setError]=useState('');
  const [selectedOrder, setSelectedOrder] = useState<BespokeJobOrder | null>(null);
  const [isJobCardOpen, setIsJobCardOpen] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<BespokeJobOrder | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const all = await fetchAllOrders(undefined,undefined,clientId);
        if (isMounted) {setOrders(all);setError('');setSelectedOrder(previous=>previous ? all.find(order=>order.id===previous.id) || previous : null);}
      } catch (err) {
        console.error('[ClientProfile] Failed to load orders:', err);
        if(isMounted)setError('Could not refresh customer orders. Reload before using these records.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    const unsubscribe = subscribeToOrderChanges(load);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [clientId]);

  const handleOrderUpdated = (updated: BespokeJobOrder) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    if (selectedOrder?.id === updated.id) setSelectedOrder(updated);
    if (paymentOrder?.id === updated.id) setPaymentOrder(updated);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/70 hover:bg-gold-50 border border-gray-200/80 text-xs font-medium text-gray-700 hover:text-accent-900 transition-all shadow-sm"
      >
        <ArrowLeft size={14} />
        <span>Back to Client Directory</span>
      </button>

      {/* Client Header Card */}
      <div className="glass p-6 sm:p-7 rounded-3xl flex items-center justify-between gap-4 border border-gold-500/25 shadow-luxury flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-800 to-accent-950 text-gold-300 border border-gold-500/40 flex items-center justify-center text-2xl font-display font-semibold shrink-0 shadow-md">
            {clientName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-gold-800 bg-gold-50/90 px-2.5 py-0.5 rounded-full border border-gold-500/20 uppercase tracking-wider">
                Bespoke Client
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-semibold text-accent-950 truncate mt-1">
              {clientName}
            </h2>
            <div className="text-xs text-gray-500 flex items-center gap-2 mt-1 font-mono">
              <Phone size={12} className="text-gold-700" />
              <span>{clientPhone || 'No phone on file'}</span>
            </div>
          </div>
        </div>


      </div>

      {/* Measurements Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-accent-900 uppercase tracking-widest flex items-center gap-1.5">
            <Sparkles size={13} className="text-gold-600" />
            <span>Measurement Passport</span>
          </h3>
        </div>
        <MeasurementVaultSync targetClientId={clientId} />
      </div>

      {/* Orders Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-accent-900 uppercase tracking-widest">
            Bespoke Orders ({orders.length})
          </h3>
        </div>

        {isLoading ? (
          <div className="p-10 flex flex-col justify-center items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={18} className="animate-spin text-accent-700" />
            <span>Loading bespoke orders...</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center glass rounded-3xl space-y-2 border border-gold-500/20">
            <PackageOpen size={30} className="mx-auto text-gray-300" />
            <h4 className="text-lg font-semibold text-accent-950 font-display">No bespoke orders yet</h4>
            <p className="text-xs text-gray-500">Orders placed for this client will appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {orders.map((order) => {
              const { due: balance, credit } = orderBalance(order);
              return (
                <div
                  key={order.id}
                  onClick={() => {
                    setSelectedOrder(order);
                    setIsJobCardOpen(true);
                  }}
                  className="glass p-5 rounded-2xl hover:border-gold-500/40 hover:shadow-luxury transition-all duration-200 cursor-pointer flex flex-col justify-between gap-3 group"
                >
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <span className="text-[11px] font-mono font-semibold text-accent-700 bg-accent-50/80 px-2 py-0.5 rounded-md border border-accent-200/50">
                        #{order.id}
                      </span>
                      <h4 className="text-base font-semibold text-accent-950 leading-tight mt-2 font-display group-hover:text-accent-800 transition-colors">
                        {order.garmentTitle}
                      </h4>
                    </div>
                    <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-gold-50 text-gold-900 border border-gold-500/30 capitalize shadow-sm">
                      {order.stage}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-500 font-sans">
                    <Clock size={13} className="text-gray-400" />
                    <span>
                      Due {order.dueDate} &bull; Tailor: {order.assignedTailor}
                    </span>
                  </div>

                  <div className="pt-3 border-t border-gray-100/90 space-y-2.5 text-xs">
                    <div onClick={(e) => e.stopPropagation()}>
                      <ProgressBadge
                        label="Payment Progress"
                        percentage={order.totalAmount > 0 ? Math.min(100, (order.depositPaid / order.totalAmount) * 100) : 0}
                        shape="pill-wide"
                        variant={balance > 0 ? 'charcoal' : 'mustard'}
                      />
                      <p className="text-[11px] text-gray-500 font-mono mt-1.5">
                        {formatGhs(order.depositPaid)} / {formatGhs(order.totalAmount)}
                        {balance > 0 && <span className="text-rose-600 font-semibold ml-1.5">(Due {formatGhs(balance)})</span>}
                        {credit > 0 && <span className="text-amber-800 font-semibold ml-1.5">(Customer credit {formatGhs(credit)})</span>}
                      </p>
                    </div>

                    <div className="flex justify-end items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPaymentOrder(order);
                          setIsPaymentModalOpen(true);
                        }}
                        title="Record Payment"
                        className="p-2 rounded-xl bg-white hover:bg-mustard-50 hover:text-charcoal-900 border border-gray-200/80 transition-colors text-gray-600 shadow-sm"
                      >
                        <Receipt size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DigitalJobCard
        order={selectedOrder}
        isOpen={isJobCardOpen}
        onClose={() => setIsJobCardOpen(false)}
        onOrderUpdated={handleOrderUpdated}
      />
      <RecordPaymentModal
        order={paymentOrder}
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onPaymentRecorded={handleOrderUpdated}
      />
    </div>
  );
};

export default ClientProfile;
