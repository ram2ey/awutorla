import React, { useState, useEffect, useRef } from 'react';
import {
  UserPlus,
  Phone,
  Loader2,
  AlertCircle,
  ImagePlus,
  X,
  Calculator,
} from 'lucide-react';
import type { BespokeJobOrder, MeasurementParameter } from '../../types/workshop.types';
import { sanitizeGhanaianPhoneNumber, detectGhanaNetwork } from '../../services/hubtel';
import { api } from '../../lib/api';
import { saveOfflineJobCard, cacheClientMeasurements } from '../../lib/offlineStore';
import { fetchMeasurementParameters } from '../../lib/measurementParameters';
import { uploadOrderSketch } from '../../lib/storage';
import { useAuth } from '../../lib/auth';
import { fetchStaffMembers } from '../../lib/clients';
import type { StaffMember } from '../../lib/clients';
import { Modal } from '../ui/Modal';
import { fetchOrder } from '../../lib/orders';
import { PAYMENT_METHODS } from '../../lib/payments';
import { todayGhana } from '../../lib/money';

const MAX_SKETCHES = 5;

interface QuickIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated: (newOrder: BespokeJobOrder) => void;
}

const inputClass =
  'w-full bg-white/90 border border-gray-200/90 rounded-xl p-2.5 text-xs sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 shadow-sm transition-all';
const labelClass = 'block text-xs font-semibold text-gray-700 mb-1 tracking-wide';

export const QuickIntakeModal: React.FC<QuickIntakeModalProps> = ({
  isOpen,
  onClose,
  onOrderCreated,
}) => {
  const { user } = useAuth();

  // Form State
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('024');
  const [garmentTitle, setGarmentTitle] = useState('');
  const [garmentSubtitle, setGarmentSubtitle] = useState('');
  const [fabricType, setFabricType] = useState('');
  const [fabricColor, setFabricColor] = useState('');
  const [fabricNotes, setFabricNotes] = useState('');
  const [totalAmount, setTotalAmount] = useState<number | ''>('');
  const [depositPaid, setDepositPaid] = useState<number | ''>('');
  const [assignedTailor, setAssignedTailor] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [paymentDate, setPaymentDate] = useState(todayGhana());
  const [paymentReference, setPaymentReference] = useState('');
  const submission = useRef({ id: '', taskId: '', depositKey: '' });
  const uploads = useRef(new Map<File, string>());

  // Measurements State
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
  const [measurementParameters, setMeasurementParameters] = useState<MeasurementParameter[]>([]);
  const [measurementValues, setMeasurementValues] = useState<Record<string, number>>({});

  // Reference Sketch/Photo Upload State
  const [sketchFiles, setSketchFiles] = useState<File[]>([]);
  const [sketchPreviews, setSketchPreviews] = useState<string[]>([]);

  // Price Breakdown Calculator State (advisory only — not persisted with the order)
  const [showPriceCalculator, setShowPriceCalculator] = useState(false);
  const [calcFabricCost, setCalcFabricCost] = useState<number>(0);
  const [calcLaborCost, setCalcLaborCost] = useState<number>(0);
  const [calcExtrasCost, setCalcExtrasCost] = useState<number>(0);
  const [calcMarkupPercent, setCalcMarkupPercent] = useState<number>(0);

  // Status State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Reset the entire intake form each time the modal opens, since the parent keeps this
  // component mounted and only toggles `isOpen` — otherwise a second intake would start
  // from the previous client's data or show the previous success screen.
  useEffect(() => {
    if (isOpen) {
      setClientName('');
      setClientPhone('024');
      setGarmentTitle('');
      setGarmentSubtitle('');
      setFabricType('');
      setFabricColor('');
      setFabricNotes('');
      setTotalAmount('');
      setDepositPaid('');
      setAssignedTailor('');
      setDueDate('');
      setPaymentMethod(PAYMENT_METHODS[0]); setPaymentDate(todayGhana()); setPaymentReference('');
      submission.current = { id: `ORD-${crypto.randomUUID()}`, taskId: `tsk-${crypto.randomUUID()}`, depositKey: crypto.randomUUID() };
      uploads.current = new Map();
      setUnit('in');
      setMeasurementValues({});
      setSketchPreviews((prev) => {
        prev.forEach((url) => URL.revokeObjectURL(url));
        return [];
      });
      setSketchFiles([]);
      setShowPriceCalculator(false);
      setCalcFabricCost(0);
      setCalcLaborCost(0);
      setCalcExtrasCost(0);
      setCalcMarkupPercent(0);
      setIsSubmitting(false);
      setErrorMessage(null);
      fetchStaffMembers().then((members) => {
        setStaff(members);
        setAssignedTailor(members[0]?.id || '');
      }).catch(() => setErrorMessage('Could not load staff. Reopen intake to try again.'));

      fetchMeasurementParameters()
        .then(setMeasurementParameters)
        .catch((err) => console.error('[QuickIntakeModal] Failed to load measurement parameters:', err));
    }
    // Only reset when the modal transitions open — sketchPreviews is read via the
    // updater form above precisely so it doesn't need to be a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSketchSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    if (selected.length === 0) return;

    setSketchFiles((prev) => {
      const room = Math.max(0, MAX_SKETCHES - prev.length);
      const accepted = selected.slice(0, room);
      setSketchPreviews((prevPreviews) => [...prevPreviews, ...accepted.map((f) => URL.createObjectURL(f))]);
      return [...prev, ...accepted];
    });
  };

  const handleRemoveSketch = (idx: number) => {
    setSketchPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
    setSketchFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const calcSuggestedTotal =
    (calcFabricCost || 0) + (calcLaborCost || 0) + (calcExtrasCost || 0);
  const calcSuggestedTotalWithMarkup = calcSuggestedTotal * (1 + (calcMarkupPercent || 0) / 100);

  if (!isOpen) return null;

  // Real-time direct subtraction
  const remainingBalance = Math.max(0, (totalAmount || 0) - (depositPaid || 0));

  // Network Detection
  let detectedNet = 'unknown';
  try {
    if (clientPhone.length >= 3) {
      detectedNet = detectGhanaNetwork(clientPhone);
    }
  } catch {
    // Ignore invalid partial numbers
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    let persisted = false;
    try {
      if (!user) throw new Error('Staff sign-in required.');
      if (totalAmount === '' || depositPaid === '' || depositPaid > totalAmount) {
        throw new Error('Enter a total price and a deposit no greater than the total.');
      }
      const tailor = staff.find((member) => member.id === assignedTailor);
      if (!tailor) throw new Error('Select an active staff member.');
      const phone = sanitizeGhanaianPhoneNumber(clientPhone);
      const { id, taskId, depositKey } = submission.current;
      const imageUrls = await Promise.all(sketchFiles.map(async (file) => {
        const saved = uploads.current.get(file); if (saved) return saved;
        const path = await uploadOrderSketch(id, file); uploads.current.set(file, path); return path;
      }));
      const payload = {
        id, task_id: taskId, client_name: clientName.trim(), client_phone: phone,
        garment_title: garmentTitle.trim(), garment_subtitle: garmentSubtitle.trim(),
        fabric_type: fabricType.trim(), fabric_color: fabricColor.trim(), fabric_notes: fabricNotes.trim(),
        reference_images: imageUrls, swatch_image: imageUrls[0] || null,
        tailor_id: tailor.id, due_date: dueDate, deposit_paid: depositPaid,
        total_amount: totalAmount, currency: 'GHS', unit, measurement_values: measurementValues,
        deposit_submission_key: depositKey, payment_method: paymentMethod, payment_date: paymentDate, payment_reference: paymentReference.trim(),
      };
      const { error } = await (api as any).rpc('create_bespoke_intake', { p_payload: payload });
      if (error) throw new Error(error.message || 'Could not save intake. Please try again.');
      persisted = true;
      const newOrder = await fetchOrder(id);
      saveOfflineJobCard(newOrder);
      if (newOrder.clientId) cacheClientMeasurements(newOrder.clientId, newOrder.measurements);
      onOrderCreated(newOrder);
    } catch (err) {
      setErrorMessage(persisted ? 'Intake was saved, but could not be reloaded. Refresh the workshop to view it.' : err instanceof Error ? err.message : 'Could not confirm intake. Refresh the workshop before starting another submission.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeUnit = (next: 'in' | 'cm') => {
    if (next === unit) return;
    const factor = next === 'cm' ? 2.54 : 1 / 2.54;
    setMeasurementValues((values) => Object.fromEntries(Object.entries(values)
      .map(([key, value]) => [key, Number((value * factor).toFixed(2))])));
    setUnit(next);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {if (!isSubmitting) onClose();}}
      title="New Bespoke Order"
      subtitle="Staff intake — SMS progress updates"
      icon={<UserPlus size={17} />}
      maxWidth="max-w-4xl"
    >
      <form onSubmit={handleSubmit} className="p-6 sm:p-7 space-y-6">
            {/* SECTION 1: CLIENT CONTACT */}
            <div className="p-6 glass rounded-2xl border border-gold-500/20 space-y-4 shadow-sm">
              <span className="text-xs font-semibold text-accent-950 uppercase tracking-widest block">1. Client Dossier</span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Client Full Name *</label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Abena Poku"
                    className={inputClass}
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className={labelClass}>Ghana Phone (SMS) *</label>
                    {detectedNet !== 'unknown' && (
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 font-mono">
                        {detectedNet.replace('-gh', '').toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="tel"
                      required
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="024XXXXXXX"
                      className={`${inputClass} pl-9 font-mono`}
                    />
                    <Phone size={14} className="absolute left-3 top-3 text-gold-700" />
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 2: TAILORING PASSPORT */}
            <div className="p-6 glass rounded-2xl border border-gold-500/20 space-y-4 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-accent-950 uppercase tracking-widest">2. Measurement Passport</span>
                <div className="flex bg-gray-100/90 rounded-xl p-1 text-xs border border-gray-200/60">
                  <button
                    type="button"
                    onClick={() => changeUnit('in')}
                    className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                      unit === 'in' ? 'bg-gradient-to-r from-accent-800 to-accent-950 text-gold-300 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Inches
                  </button>
                  <button
                    type="button"
                    onClick={() => changeUnit('cm')}
                    className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                      unit === 'cm' ? 'bg-gradient-to-r from-accent-800 to-accent-950 text-gold-300 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Centimeters
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {measurementParameters.map((p) => (
                  <div key={p.id}>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1 truncate">
                      {p.label} ({unit})
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={measurementValues[p.key] ?? ''}
                      onChange={(e) =>
                        setMeasurementValues((prev) => {
                          const next = { ...prev };
                          if (e.target.value === '') delete next[p.key];
                          else next[p.key] = parseFloat(e.target.value);
                          return next;
                        })
                      }
                      className="w-full bg-white/90 border border-gray-200/90 rounded-xl p-2 text-xs sm:text-sm font-semibold text-accent-950 text-center font-mono focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500 shadow-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* SECTION 3: GARMENT & FINANCIAL DETAILS */}
            <div className="p-6 glass rounded-2xl border border-gold-500/20 space-y-4 shadow-sm">
              <span className="text-xs font-semibold text-accent-950 uppercase tracking-widest block">3. Garment Specification & Pricing</span>

              {/* Reference Sketch / Photo Upload */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className={labelClass}>Reference Sketches / Photos</label>
                  <span className="text-[10px] text-gray-400 font-mono">{sketchPreviews.length}/{MAX_SKETCHES}</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                  {sketchPreviews.map((url, idx) => (
                    <div key={url} className="relative h-20 rounded-xl overflow-hidden border border-gray-200 bg-gray-100 shadow-sm group">
                      <img src={url} alt={`Sketch ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveSketch(idx)}
                        aria-label="Remove image"
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}

                  {sketchPreviews.length < MAX_SKETCHES && (
                    <label className="h-20 rounded-xl border-2 border-dashed border-gold-500/30 bg-white/60 hover:bg-gold-50/50 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors text-gold-700">
                      <ImagePlus size={17} />
                      <span className="text-[10px] font-semibold">Add Image</span>
                      <input type="file" accept="image/*" multiple onChange={handleSketchSelect} className="hidden" />
                    </label>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5 font-sans">
                  Upload design sketches or fabric reference photos — these appear on the digital job card when the order is viewed.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Garment Title *</label>
                  <input
                    type="text"
                    required
                    value={garmentTitle}
                    onChange={(e) => setGarmentTitle(e.target.value)}
                    placeholder="e.g. Royal Kente Evening Ballgown"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Occasion / Subtitle</label>
                  <input
                    type="text"
                    value={garmentSubtitle}
                    onChange={(e) => setGarmentSubtitle(e.target.value)}
                    placeholder="e.g. State Banquet Evening Wear"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Fabric Weave</label>
                  <input
                    type="text"
                    value={fabricType}
                    onChange={(e) => setFabricType(e.target.value)}
                    placeholder="e.g. Handwoven Silk Kente"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Color Palette</label>
                  <input
                    type="text"
                    value={fabricColor}
                    onChange={(e) => setFabricColor(e.target.value)}
                    placeholder="e.g. Royal Gold & Midnight Indigo"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Artisan Textile & Pattern Notes</label>
                <input
                  type="text"
                  value={fabricNotes}
                  onChange={(e) => setFabricNotes(e.target.value)}
                  placeholder="e.g. Double-reinforced boning with gold thread embroidery along neckline"
                  className={inputClass}
                />
              </div>

              {/* Price Breakdown Calculator */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowPriceCalculator((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-accent-800 hover:text-accent-950 transition-colors"
                >
                  <Calculator size={13} className="text-gold-700" />
                  <span>{showPriceCalculator ? 'Hide' : 'Help me price this'} pricing calculator</span>
                </button>

                {showPriceCalculator && (
                  <div className="mt-3 p-4 bg-white/70 border border-gray-200/90 rounded-xl space-y-3 animate-in fade-in">
                    <p className="text-[11px] text-gray-500 font-sans">
                      Estimate a total from cost inputs — this is a helper only, it isn't saved with the order.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Fabric Cost</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={calcFabricCost || ''}
                          onChange={(e) => setCalcFabricCost(parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-gray-200 rounded-lg p-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold-500/30"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Labor Cost</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={calcLaborCost || ''}
                          onChange={(e) => setCalcLaborCost(parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-gray-200 rounded-lg p-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold-500/30"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Trims & Extras</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={calcExtrasCost || ''}
                          onChange={(e) => setCalcExtrasCost(parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-gray-200 rounded-lg p-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold-500/30"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1">Markup %</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={calcMarkupPercent || ''}
                          onChange={(e) => setCalcMarkupPercent(parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-gray-200 rounded-lg p-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold-500/30"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-gray-200/80">
                      <div className="text-xs font-sans">
                        <span className="text-gray-500">Cost subtotal: </span>
                        <span className="font-mono font-semibold text-gray-700">GHS {calcSuggestedTotal.toFixed(2)}</span>
                        <span className="text-gray-400"> · with markup: </span>
                        <span className="font-mono font-semibold text-accent-900">GHS {calcSuggestedTotalWithMarkup.toFixed(2)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTotalAmount(parseFloat(calcSuggestedTotalWithMarkup.toFixed(2)))}
                        disabled={calcSuggestedTotalWithMarkup <= 0}
                        className="px-3 py-1.5 bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 disabled:opacity-40 text-white rounded-lg text-[11px] font-semibold shadow-sm transition-all"
                      >
                        Apply to Total Price
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
                <div>
                  <label className={labelClass}>Total Price (GHS) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className={`${inputClass} font-semibold font-mono`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Deposit Paid (GHS) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={depositPaid}
                    onChange={(e) => setDepositPaid(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className={`${inputClass} font-semibold text-emerald-800 font-mono`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Assigned Tailor</label>
                  <select
                    value={assignedTailor}
                    onChange={(e) => setAssignedTailor(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select staff member</option>
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.full_name || 'Staff'}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Target Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              {Number(depositPaid) > 0 && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label htmlFor="intake-payment-method" className={labelClass}>Deposit method
                  <select id="intake-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className={inputClass}>
                    {PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}
                  </select></label>
                <label htmlFor="intake-payment-date" className={labelClass}>Receipt date (Ghana)
                  <input id="intake-payment-date" type="date" required value={paymentDate} max={todayGhana()} onChange={(event) => setPaymentDate(event.target.value)} className={inputClass} /></label>
                <label htmlFor="intake-payment-reference" className={labelClass}>Receipt reference
                  <input id="intake-payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className={inputClass} /></label>
              </div>}
              <div className="p-3.5 bg-gold-50/70 border border-gold-500/25 rounded-xl text-xs flex justify-between items-center font-mono">
                <span className="text-gray-600 font-sans">Remaining balance:</span>
                <span className={`font-semibold text-sm ${remainingBalance === 0 ? 'text-emerald-800 font-sans' : 'text-accent-900'}`}>
                  GHS {remainingBalance.toFixed(2)}
                  {remainingBalance === 0 && ' (Settled in Full)'}
                </span>
              </div>
            </div>

            {errorMessage && (
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-3 border-t border-gray-200/80">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-7 py-2.5 bg-gradient-to-r from-accent-800 to-accent-600 hover:from-accent-700 text-white font-semibold text-xs rounded-xl shadow-md shadow-accent-900/15 transition-all flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin text-gold-300" />
                    <span>Creating Order...</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={15} className="text-gold-300" />
                    <span>Create Bespoke Order</span>
                  </>
                )}
              </button>
            </div>
      </form>
    </Modal>
  );
};

export default QuickIntakeModal;
