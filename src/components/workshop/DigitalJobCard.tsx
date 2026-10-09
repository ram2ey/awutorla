import React, { useState, useEffect, useRef } from 'react';
import {
  Scissors,
  CheckCircle2,
  Phone,
  Calendar,
  Layers,
  Sparkles,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Plus,
  AlertOctagon,
  Clock,
  Receipt,
  FileDown,
  Image as ImageIcon,
} from 'lucide-react';
import type { BespokeJobOrder, WorkshopStage, OrderTaskItem, TaskStatus, MeasurementParameter } from '../../types/workshop.types';
import { MeasurementSilhouette } from './MeasurementSilhouette';
import { RecordPaymentModal } from './RecordPaymentModal';
import { supabase } from '../../lib/supabase';
import { saveOfflineJobCard } from '../../lib/offlineStore';
import { fetchMeasurementParameters } from '../../lib/measurementParameters';
import { fetchAppSettings, DEFAULT_APP_SETTINGS } from '../../lib/settings';
import type { AppSettings } from '../../lib/settings';
import { activeTabClass, inactiveTabClass } from '../ui/tabStyles';
import { useAuth } from '../../lib/auth';
import { advanceOrder } from '../../services/progressSms';
import { OrderSmsHistory } from './OrderSmsHistory';
import { fetchStaffMembers } from '../../lib/clients';
import type { StaffMember } from '../../lib/clients';
import { Modal } from '../ui/Modal';
import { PaymentLedger } from './PaymentLedger';
import { applyOrderRecord, fetchOrder } from '../../lib/orders';
import { orderBalance, formatGhs } from '../../lib/money';
import { normalizeDueDate } from '../../lib/dates';
import { WorkshopOperations } from './WorkshopOperations';

export function getNextStage(current: WorkshopStage): WorkshopStage {
  switch (current) {
    case 'pending':
      return 'cutting';
    case 'cutting':
      return 'fitting';
    case 'fitting':
      return 'finishing';
    case 'finishing':
      return 'ready';
    case 'ready':
      return 'delivered';
    default:
      return 'delivered';
  }
}

interface DigitalJobCardProps {
  order: BespokeJobOrder | null;
  isOpen: boolean;
  onClose: () => void;
  onOrderUpdated: (updatedOrder: BespokeJobOrder) => void;
}

export const DigitalJobCard: React.FC<DigitalJobCardProps> = ({
  order,
  isOpen,
  onClose,
  onOrderUpdated,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'measurements' | 'tasks' | 'fabric' | 'history' | 'notifications' | 'payments' | 'operations'>('measurements');
  const [confirmMeasurements, setConfirmMeasurements] = useState(false);
  const [applyingMeasurements, setApplyingMeasurements] = useState(false);
  const [dueDraft, setDueDraft] = useState('');
  const [savingDue, setSavingDue] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [lastNotification, setLastNotification] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskTailor, setNewTaskTailor] = useState('');
  const [measurementParameters, setMeasurementParameters] = useState<MeasurementParameter[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const renewAttachments=useRef<()=>Promise<void>>(async()=>{});
  renewAttachments.current=async()=>{if(!order)return;try{onOrderUpdated(await fetchOrder(order.id));}catch{setActionError('Could not renew attachment access. Check the connection and refresh.');}};
  useEffect(()=>{
    if(!isOpen || !order?.id)return;
    const timer=setInterval(()=>void renewAttachments.current(),45*60*1000);
    const onFocus=()=>void renewAttachments.current();window.addEventListener('focus',onFocus);
    return()=>{clearInterval(timer);window.removeEventListener('focus',onFocus);};
  },[isOpen,order?.id]);

  useEffect(() => {
    let isMounted = true;
    fetchMeasurementParameters()
      .then((params) => {
        if (isMounted) setMeasurementParameters(params);
      })
      .catch((err) => console.error('[DigitalJobCard] Failed to load measurement parameters:', err));
    fetchAppSettings()
      .then((settings) => {
        if (isMounted) setAppSettings(settings);
      })
      .catch((err) => console.error('[DigitalJobCard] Failed to load business settings:', err));
    return () => {
      isMounted = false;
    };
  }, []);

  // Reset transient view state each time the card opens for a (possibly different) order
  useEffect(() => {
    if (isOpen && order) {
      setActiveTab('measurements');
      setIsAdvancing(false);
      setIsPaymentModalOpen(false);
      setLastNotification(null);
      setNewTaskTitle('');
      setActionError(null);
      setConfirmMeasurements(false);
      setDueDraft(normalizeDueDate(order.dueDate) || '');
      fetchStaffMembers().then((members) => {
        setStaff(members);
        setNewTaskTailor(order.assignedTailorId || members.find((member) => member.full_name === order.assignedTailor)?.id || members[0]?.id || '');
      }).catch(() => setActionError('Could not load staff assignments.'));
    }
    // Stage/payment updates to the same open card should preserve its current tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, isOpen]);

  if (!isOpen || !order) return null;

  // Sub-tasks state
  const currentTasks = order.tasks || [];
  const nextStage = getNextStage(order.stage);
  const isFinalStage = order.stage === 'delivered';
  const { due: remainingBalance, credit } = orderBalance(order);

  // Handle Sub-Task Status Toggle
  const handleToggleTaskStatus = async (taskId: string, currentStatus: TaskStatus) => {
    let nextStatus: TaskStatus = 'in_progress';
    if (currentStatus === 'pending') nextStatus = 'in_progress';
    else if (currentStatus === 'in_progress') nextStatus = 'completed';
    else if (currentStatus === 'completed') nextStatus = 'blocked';
    else if (currentStatus === 'blocked') nextStatus = 'pending';

    const updatedTasks = currentTasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: nextStatus,
            completedAt: nextStatus === 'completed' ? new Date().toISOString() : undefined,
          }
        : t
    );

    const updatedOrder: BespokeJobOrder = {
      ...order,
      tasks: updatedTasks,
    };

    setActionError(null);
    try {
      const { error } = await (supabase.from('order_tasks') as any)
        .update({
          status: nextStatus,
          completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
        })
        .eq('id', taskId).eq('status', currentStatus).select('id').single();
      if (error) throw error;
      saveOfflineJobCard(updatedOrder);
      onOrderUpdated(updatedOrder);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update task. Refresh the order and try again.');
    }
  };

  // Handle Add New Sub-Task
  const handleAddNewTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const tailor = staff.find((member) => member.id === newTaskTailor);
    if (!tailor) { setActionError('Select an active staff member.'); return; }

    const newTask: OrderTaskItem = {
      id: `tsk-${crypto.randomUUID()}`,
      orderId: order.id,
      tailorName: tailor.full_name || 'Staff',
      title: newTaskTitle.trim(),
      status: 'pending',
      assignedAt: new Date().toISOString(),
    };

    const updatedTasks = [...currentTasks, newTask];
    const updatedOrder: BespokeJobOrder = {
      ...order,
      tasks: updatedTasks,
    };

    setActionError(null);
    if (user) {
      try {
        const { error } = await (supabase.from('order_tasks') as any).insert({
          id: newTask.id,
          order_id: order.id,
          tailor_id: tailor.id,
          tailor_name: tailor.full_name || 'Staff',
          title: newTask.title,
          status: newTask.status,
        });
        if (error) throw error;
        saveOfflineJobCard(updatedOrder);
        onOrderUpdated(updatedOrder);
        setNewTaskTitle('');
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not save task. Please try again.');
      }
    }
  };

  const handleMarkStageComplete = async () => {
    setIsAdvancing(true);
    setActionError(null);
    setLastNotification(null);
    try {
      const result = await advanceOrder(order);
      const updated = applyOrderRecord(order, result.order);
      saveOfflineJobCard(updated);
      onOrderUpdated(updated);
      setLastNotification(result.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not advance this order.');
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleDownloadInvoice = async () => {
    try {
      const { downloadInvoicePdf } = await import('../../lib/invoice');
      downloadInvoicePdf(order, appSettings);
    } catch {
      setActionError('Could not generate the invoice. Please try again.');
    }
  };

  const applyLatestMeasurements = async () => {
    setApplyingMeasurements(true); setActionError(null);
    try {
      const { data, error } = await (supabase as any).rpc('apply_order_measurements', {
        p_order_id: order.id, p_expected_capture: order.measurements.capturedAt || null,
      });
      if (error) throw new Error(error.message);
      const updated = applyOrderRecord(order, data);
      saveOfflineJobCard(updated); onOrderUpdated(updated); setConfirmMeasurements(false);
    } catch (err) { setActionError(err instanceof Error ? err.message : 'Could not apply measurements.'); }
    finally { setApplyingMeasurements(false); }
  };
  const saveDueDate = async () => {
    setSavingDue(true); setActionError(null);
    try {
      const { data, error } = await (supabase.from('orders') as any).update({ due_date: dueDraft })
        .eq('id', order.id).eq('due_date', order.dueDate).select('*').single();
      if (error) throw new Error('Could not confirm this due date. Refresh the order before trying again.');
      const updated = applyOrderRecord(order, data); saveOfflineJobCard(updated); onOrderUpdated(updated);
    } catch (err) { setActionError(err instanceof Error ? err.message : 'Could not save due date.'); }
    finally { setSavingDue(false); }
  };

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'measurements', label: 'Measurements' },
    { id: 'tasks', label: `Tasks (${currentTasks.length})` },
    { id: 'operations', label: 'Fittings & Quality' },
    { id: 'fabric', label: 'Fabric & Specs' },
    { id: 'history', label: `History (${order.stageHistory.length})` },
    { id: 'notifications', label: 'SMS History' },
    { id: 'payments', label: 'Payments' },
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={order.garmentTitle}
        subtitle={`Artisan Job Card // #${order.id}`}
        icon={<Scissors size={18} className="text-accent-800" />}
        maxWidth="max-w-5xl"
      >
        {/* Client, Financial, & Tailor Metadata Banner */}
        <div className="px-6 py-4 bg-gray-50/70 border-b border-gray-200/80 flex flex-wrap justify-between items-center gap-4 text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Client</span>
              <span className="font-semibold text-accent-950 font-display text-sm">{order.clientName}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600 font-mono">
              <Phone size={12} className="text-gold-700" />
              <span>{order.clientPhone}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-white/90 px-3.5 py-2 rounded-xl border border-gold-500/25 shadow-sm">
            <div>
              <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Financial Balance</span>
              <span className="font-semibold text-gray-900 font-mono">
                Paid: {formatGhs(order.depositPaid)} / {formatGhs(order.totalAmount)}
                {remainingBalance > 0 ? (
                  <span className="text-rose-600 font-semibold ml-1.5 font-sans">(Due: {formatGhs(remainingBalance)})</span>
                ) : credit > 0 ? (
                  <span className="text-amber-800 font-semibold ml-1.5 font-sans">(Customer credit: {formatGhs(credit)})</span>
                ) : (
                  <span className="text-emerald-700 font-semibold ml-1.5 font-sans">(Settled)</span>
                )}
              </span>
            </div>

            <button
              onClick={() => setIsPaymentModalOpen(true)}
              className="px-3 py-1.5 bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Receipt size={12} className="text-gold-300" />
              <span>Record</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDownloadInvoice}
              title="Download invoice PDF"
              className="px-3 py-1.5 bg-white/90 hover:bg-white border border-gray-200 text-accent-900 font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <FileDown size={12} className="text-gold-700" />
              <span>Invoice</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <div>
              <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Master Artisan</span>
              <span className="font-semibold text-accent-950">{order.assignedTailor}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600 font-mono">
              <Calendar size={12} className="text-gold-700" />
              <span>Due: {order.dueDate}</span>
            </div>
          </div>
        </div>

        {actionError && <p role="alert" className="px-6 py-3 text-xs bg-rose-50 text-rose-700">{actionError}</p>}
        {lastNotification && <p role="status" className="px-6 py-3 text-xs bg-mustard-50 text-charcoal-900">{lastNotification}</p>}

        <div className="p-6 sm:p-7 space-y-6">
          {/* Navigation Tabs */}
          <div className="flex gap-2 border-b border-gray-200/80 pb-2 overflow-x-auto scrollbar-none">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all duration-200 ${
                  activeTab === t.id ? `${activeTabClass} shadow-sm` : inactiveTabClass
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* TAB: Measurements */}
          {activeTab === 'measurements' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <MeasurementSilhouette measurements={order.measurements} parameters={measurementParameters} />

              <div className="p-5 rounded-2xl bg-gradient-to-br from-gold-50/70 to-accent-50/50 border border-gold-500/25 text-sm shadow-sm space-y-2">
                <div className="flex items-center gap-2 text-accent-900 font-semibold">
                  <ShieldCheck size={16} className="text-gold-700" />
                  <span className="font-display text-base">Atelier Master Specification</span>
                </div>
                <p className="text-gray-700 text-xs leading-relaxed">
                  These are the measurements saved for this order. Editing the customer master record does not change this specification.
                </p>
                <div className="space-y-2 border-t pt-3">
                  <label htmlFor="order-due-date" className="text-xs font-semibold block">Order due date</label>
                  <input id="order-due-date" type="date" value={dueDraft} disabled={savingDue || order.stage === 'delivered'} onChange={(event) => setDueDraft(event.target.value)} className="rounded-lg border p-2 text-xs bg-white" />
                  {order.stage !== 'delivered' && <button disabled={savingDue} onClick={saveDueDate} className="text-xs underline ml-3">{savingDue ? 'Saving…' : 'Save due date'}</button>}
                  {order.dueDate && !normalizeDueDate(order.dueDate) && <p className="text-xs text-amber-800">Previous date “{order.dueDate}” could not be interpreted. Set a date to include this order in overdue reporting.</p>}
                </div>
                <p className="text-xs text-gray-600">Saved version {order.measurements.revision || 0} · {order.measurements.capturedAt ? new Date(order.measurements.capturedAt).toLocaleString() : 'Capture date unavailable'}</p>
                {order.measurements.source === 'legacy_migration' && <p className="text-xs text-amber-800">Captured during migration from the then-current master record. Original intake measurements could not be reconstructed.</p>}
                {order.clientId && order.stage !== 'delivered' && (confirmMeasurements ? <div className="space-y-2 border-t pt-3">
                  <p className="text-xs">Replace this active order's specification with the latest customer measurements?</p>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={applyingMeasurements} onClick={applyLatestMeasurements} className="rounded-lg px-3 py-2 bg-charcoal-950 text-white text-xs">{applyingMeasurements ? 'Applying…' : 'Confirm latest measurements'}</button>
                    <button disabled={applyingMeasurements} onClick={() => setConfirmMeasurements(false)} className="text-xs px-3 py-2">Cancel</button>
                  </div>
                </div> : <button onClick={() => setConfirmMeasurements(true)} className="text-xs underline pt-2">Apply latest master measurements</button>)}
              </div>
            </div>
          )}

          {/* TAB: Tasks */}
          {activeTab === 'payments' && <PaymentLedger key={order.id} order={order} onUpdated={onOrderUpdated} />}
          {activeTab === 'operations' && <WorkshopOperations key={order.id} order={order} onUpdated={onOrderUpdated} />}
          {order.attachmentWarning && <p className="text-xs text-amber-800">Some attachments could not be loaded. Refresh to renew access or check the stored file.</p>}
          {activeTab === 'tasks' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-accent-950 font-display">Workshop Task Checklist</h3>
                <span className="text-xs text-gray-500 font-sans">
                  Granular tracking for pattern drafting, cutting, boning, and hand-finishing.
                </span>
              </div>

              <div className="space-y-2.5">
                {currentTasks.length === 0 ? (
                  <div className="p-8 text-center glass rounded-2xl text-xs text-gray-500">
                    No tasks defined for this order yet. Add artisan sub-tasks below.
                  </div>
                ) : (
                  currentTasks.map((t) => (
                    <div
                      key={t.id}
                      className={`p-4 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition-all duration-150 ${
                        t.status === 'completed'
                          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                          : t.status === 'in_progress'
                          ? 'bg-gold-50/80 border-gold-300 text-gold-950 shadow-sm'
                          : t.status === 'blocked'
                          ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                          : 'bg-white/70 border-gray-200 text-gray-900'
                      }`}
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <button disabled={isFinalStage} aria-label={`Change status for ${t.title}`} onClick={() => handleToggleTaskStatus(t.id, t.status)} className="mt-0.5">
                          {t.status === 'completed' ? (
                            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                          ) : t.status === 'in_progress' ? (
                            <Clock size={18} className="text-gold-700 shrink-0" />
                          ) : t.status === 'blocked' ? (
                            <AlertOctagon size={18} className="text-rose-600 shrink-0" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-gray-300 hover:border-accent-600" />
                          )}
                        </button>
                        <div>
                          <span className={`text-sm font-semibold ${t.status === 'completed' ? 'line-through opacity-70' : ''}`}>
                            {t.title}
                          </span>
                          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                            <span>Artisan: {t.tailorName}</span>
                            {t.completedAt && (
                              <span className="text-emerald-700 font-medium font-mono">
                                Completed {new Date(t.completedAt).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        disabled={isFinalStage}
                        onClick={() => handleToggleTaskStatus(t.id, t.status)}
                        className="px-3 py-1 rounded-xl border border-gray-200 bg-white/80 text-[11px] font-semibold text-gray-700 capitalize shadow-sm"
                      >
                        {t.status.replace('_', ' ')}
                      </button>
                    </div>
                  ))
                )}
              </div>

              {isFinalStage ? <p className="text-xs text-gray-500">Delivered tasks are archived. An admin can reopen the order through Fittings & Quality.</p> : <form onSubmit={handleAddNewTask} className="p-5 glass rounded-2xl space-y-3 border border-gold-500/20">
                <span className="text-xs font-semibold text-accent-900 block uppercase tracking-wider">Add Artisan Sub-Task</span>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <input
                    type="text"
                    required
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="e.g. Cut interior silk lining & sew boning channels"
                    className="sm:col-span-7 bg-white/90 p-2.5 text-xs text-gray-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-gold-500/30 border border-gray-200"
                  />
                  <select
                    value={newTaskTailor}
                    onChange={(e) => setNewTaskTailor(e.target.value)}
                    className="sm:col-span-3 bg-white/90 p-2.5 text-xs text-gray-900 rounded-xl focus:outline-none border border-gray-200"
                  >
                    <option value="">Select staff member</option>
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.full_name || 'Staff'}</option>)}
                  </select>
                  <button
                    type="submit"
                    className="sm:col-span-2 bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white p-2.5 font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-1"
                  >
                    <Plus size={14} className="text-gold-300" />
                    <span>Add Task</span>
                  </button>
                </div>
              </form>}
            </div>
          )}

          {/* TAB: Fabric & References */}
          {activeTab === 'fabric' && (
            <div className="space-y-6">
              <button type="button" onClick={()=>void renewAttachments.current()} className="text-xs underline">Refresh attachment access</button>
              {order.referenceImages.length === 0 ? (
                <div className="p-8 text-center glass rounded-2xl border border-gray-200/80 text-xs text-gray-500 flex flex-col items-center gap-2">
                  <ImageIcon size={22} className="text-gray-300" />
                  <span>No reference sketches or photos were uploaded for this order.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {order.referenceImages.map((img, idx) => (
                    <a
                      key={idx}
                      href={img}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-64 rounded-2xl overflow-hidden border border-gray-200 bg-gray-100 shadow-sm block"
                    >
                      <img src={img} alt={`Reference ${idx + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              <div className="p-6 glass rounded-2xl space-y-3 text-sm border border-gold-500/20 shadow-sm">
                <div className="flex items-center gap-2 text-accent-800 font-semibold font-display text-base">
                  <Layers size={16} className="text-gold-700" />
                  <span>Textile Specification</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div>
                    <span className="text-gray-400 block text-xs uppercase tracking-wider">Fabric Weave</span>
                    <span className="font-semibold text-accent-950">{order.fabricType}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-xs uppercase tracking-wider">Color Palette</span>
                    <span className="font-semibold text-accent-950">{order.fabricColor}</span>
                  </div>
                </div>
                <div className="pt-3 border-t border-gray-200/80">
                  <span className="text-gray-400 block text-xs uppercase tracking-wider mb-1">Artisan Tailoring Notes</span>
                  <p className="text-gray-700 leading-relaxed text-xs">{order.fabricNotes}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && <OrderSmsHistory orderId={order.id} stage={order.stage} />}

          {/* TAB: History */}
          {activeTab === 'history' && (
            <div className="relative pl-6 border-l-2 border-gold-500/30 space-y-4">
              {order.stageHistory.map((item, idx) => (
                <div key={idx} className="relative">
                  <div className="absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full bg-accent-800 border-2 border-gold-400 shadow-sm" />
                  <div className="p-4 glass rounded-2xl space-y-1 border border-gray-200/80">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-accent-900 text-xs uppercase tracking-wider">{item.stage}</span>
                      <span className="text-gray-400 text-xs font-mono">
                        {item.completedAt ? new Date(item.completedAt).toLocaleTimeString() : 'In Progress'}
                      </span>
                    </div>
                    <p className="text-gray-700 text-xs">{item.notes}</p>
                    {item.completedBy && <span className="text-[11px] text-gray-400 block font-sans">By {item.completedBy}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Footer */}
        <div className="p-6 bg-white/90 border-t border-gray-200/80 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <span className="text-[10px] text-gray-400 uppercase tracking-widest block">Current Production Stage</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-lg font-bold capitalize text-accent-950 font-display">{order.stage}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {!isFinalStage ? (
              <button
                disabled={isAdvancing}
                onClick={handleMarkStageComplete}
                className={`w-full sm:w-auto px-6 py-3 rounded-2xl text-xs font-semibold transition-all flex items-center justify-center gap-2 shadow-md ${
                  isAdvancing
                    ? 'bg-gray-200 text-gray-400 cursor-wait'
                    : 'bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white shadow-accent-900/20'
                }`}
              >
                {isAdvancing ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-gold-300" />
                    <span>Updating Stage...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} className="text-gold-300" />
                    <span>Advance to {nextStage}</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            ) : (
              <div className="px-5 py-3 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-2xl text-xs font-semibold flex items-center gap-2 shadow-sm">
                <Sparkles size={16} className="text-emerald-600" />
                <span>Garment Delivered</span>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Record Payment Sub-Modal */}
      <RecordPaymentModal
        order={order}
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onPaymentRecorded={(updated) => {
          onOrderUpdated(updated);
        }}
      />
    </>
  );
};

export default DigitalJobCard;
