import assert from 'node:assert/strict';
import { canRecordManualSms } from '../src/lib/manualSms';
import { computeRevenueThisMonth, computeOutstandingBalance, ordersForView } from '../src/lib/analytics';
import { orderBalance } from '../src/lib/money';
import { normalizeDueDate } from '../src/lib/dates';
import { readAllRows } from '../src/lib/queryRows';
import { applyOrderRecord, orderMeasurements } from '../src/lib/orders';
import { SEED_WORKSHOP_ORDERS } from '../src/components/workshop/__tests__/fixtures';
import type { PaymentEntry } from '../src/types/workshop.types';

let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS: ${name}`); }
const notice = { status: 'pending', stage: 'ready', orders: { id: 'test', status: 'ready', client_name: 'Customer', garment_title: 'Dress' } };
test('Only the current pending or failed SMS can be recorded manually', () => {
  assert.equal(canRecordManualSms(notice), true);
  assert.equal(canRecordManualSms({ ...notice, status: 'failed' }), true);
  assert.equal(canRecordManualSms({ ...notice, stage: 'cutting' }), false);
});
test('Previously sent, uncertain or superseded SMS cannot be sent again through the manual control', () => {
  for (const status of ['sending', 'submitted', 'sent_manually', 'superseded']) assert.equal(canRecordManualSms({ ...notice, status }), false);
});
const payment = (amount: number, date: string | null, kind: PaymentEntry['kind'] = 'receipt'): PaymentEntry => ({
  id: String(amount), orderId: 'older-order', amount, occurredOn: date, kind, currency: 'GHS', method: 'Cash in Atelier',
  reference: '', notes: '', recordedBy: 'staff', recordedByName: 'Staff', recordedAt: '2026-10-09T00:00:00Z', reversesPaymentId: null,
});
test('Monthly receipts use receipt dates, include corrections and exclude unknown opening balances', () => {
  const records = [payment(100, '2026-10-03'), payment(50, '2026-10-04'), payment(-100, '2026-10-03', 'reversal'),
    payment(300, '2026-09-30'), payment(1000, null, 'opening_balance'), payment(-500, null, 'reversal')];
  assert.equal(computeRevenueThisMonth(records, new Date('2026-10-09T00:00:00Z')), 50);
});
test('Receipt totals use integer pesewas to avoid decimal rounding drift', () => {
  assert.equal(computeRevenueThisMonth([payment(0.1, '2026-10-01'), payment(0.2, '2026-10-01')], new Date('2026-10-09T00:00:00Z')), 0.3);
});
const base = SEED_WORKSHOP_ORDERS[0];
test('Delivered unpaid orders remain in debt and credits do not cancel another customer debt', () => {
  const delivered = { ...base, stage: 'delivered' as const, totalAmount: 1000, depositPaid: 500 };
  const credit = { ...base, id: 'credit', totalAmount: 100, depositPaid: 200 };
  assert.equal(computeOutstandingBalance([delivered, credit]), 500);
  assert.equal(ordersForView([delivered, credit], 'delivered_unpaid').length, 1);
  assert.equal(ordersForView([delivered, credit], 'credit').length, 1);
  assert.deepEqual(orderBalance(credit), { due: 0, credit: 100 });
});
test('Overdue view excludes delivered orders and dates that cannot be compared reliably', () => {
  const orders = [{ ...base, id: 'past', dueDate: '2026-10-01' }, { ...base, id: 'today', dueDate: '2026-10-09' },
    { ...base, id: 'delivered', dueDate: '2026-10-01', stage: 'delivered' as const }, { ...base, id: 'unknown', dueDate: 'Next week' }];
  assert.deepEqual(ordersForView(orders, 'overdue', '2026-10-09').map((order) => order.id), ['past']);
});
test('Legacy dates remain reportable while invalid calendar dates are rejected', () => {
  assert.equal(normalizeDueDate('AUG 24, 2026'), '2026-08-24');
  assert.equal(normalizeDueDate('2026-02-30'), null); assert.equal(normalizeDueDate('FEB 30, 2026'), null);
  assert.equal(ordersForView([{ ...base, dueDate: 'AUG 24, 2026' }], 'overdue', '2026-10-09').length, 1);
});
test('Order specification comes from its saved snapshot with historical labels', () => {
  const row = { client_id: 'customer', client_name: 'Customer', client_phone: '233241234567', created_at: '2026-01-01',
    measurement_snapshot: { unit: 'in', values: { bust: 36 }, labels: { bust: 'Original bust label' }, source: 'intake', revision: 1 } };
  const measurements = orderMeasurements(row);
  assert.equal(measurements.values.bust, 36); assert.equal(measurements.labels?.bust, 'Original bust label');
  assert.deepEqual(orderMeasurements({ ...row, measurement_snapshot: null }).values, {});
});
test('Server-confirmed updates retain attachments and replace stale financial/history data', () => {
  const row = { status: 'fitting', deposit_paid: 500, total_amount: 1000, stage_history: [{ stage: 'fitting' }],
    client_id: base.clientId, client_name: base.clientName, client_phone: base.clientPhone, measurement_snapshot: { values: { bust: 40 }, unit: 'cm' } };
  const result = applyOrderRecord(base, row);
  assert.equal(result.depositPaid, 500); assert.equal(result.stage, 'fitting'); assert.deepEqual(result.stageHistory, row.stage_history);
  assert.equal(result.referenceImages, base.referenceImages); assert.equal(result.measurements.values.bust, 40);
});
const records = Array.from({ length: 1250 }, (_, id) => ({ id }));
const pages: [number, number][] = [];
const all = await readAllRows({ range: async (from: number, to: number) => {
  pages.push([from, to]); return { data: records.slice(from, to + 1), error: null };
} });
assert.equal(all.length, 1250); assert.equal(all[1249].id, 1249); assert.equal(pages.length, 3);
await assert.rejects(readAllRows({ range: async () => ({ data: null, error: { message: 'Offline' } }) }));
passed++; console.log('PASS: Reports load beyond PostgREST page limits and do not accept incomplete failed reads');
const offline = await import('../src/lib/offlineStore');
test('Offline measurement drafts are retained only for their staff owner and cleared on sign-out',()=>{
  offline.setOfflineStoreOwner('staff-a');
  const draft={id:'draft-1',clientId:'customer',clientName:'Customer',expectedRevision:1,unit:'in' as const,values:{bust:36},notes:'Fit',createdAt:'2026-10-09'};
  offline.saveMeasurementDraft(draft);assert.deepEqual(offline.getMeasurementDrafts(),[draft]);
  offline.saveMeasurementDraft({...draft,id:'draft-2',values:{bust:37}});assert.equal(offline.getMeasurementDrafts().length,1);
  offline.setOfflineStoreOwner('staff-b');assert.equal(offline.getMeasurementDrafts().length,0);
  offline.saveMeasurementDraft(draft);offline.setOfflineStoreOwner(null);assert.equal(offline.getMeasurementDrafts().length,0);
  assert.throws(()=>offline.saveMeasurementDraft(draft));
});
test('Discarding one offline draft preserves other customer drafts',()=>{
  offline.setOfflineStoreOwner('staff-a');
  const draft={id:'draft-1',clientId:'customer-1',clientName:'Customer',expectedRevision:1,unit:'in' as const,values:{bust:36},notes:'',createdAt:'2026-10-09'};
  offline.saveMeasurementDraft(draft);offline.saveMeasurementDraft({...draft,id:'draft-2',clientId:'customer-2'});
  offline.removeMeasurementDraft('draft-1');assert.equal(offline.getMeasurementDrafts()[0].id,'draft-2');offline.setOfflineStoreOwner(null);
});
console.log(`${passed} manual workflow and reporting checks passed.`);
