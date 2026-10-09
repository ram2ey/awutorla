import { workshopOperation } from './workshopOperations';
import { fetchAllOrders } from './orders';
import { mapPaymentRow } from './payments';
import type { OrderView } from './analytics';
import type { WorkshopStage } from '../types/workshop.types';
export interface WorkshopSummary {
  views: Record<OrderView,number>; statuses: Partial<Record<WorkshopStage,number>>;
  loads: {assigned_tailor_id:string;name:string;active:number;delivered:number}[];
  outstanding:number|null;receipts:number|null;newCustomers:number|null;opening:number|null;
  fittings?: {id:string;starts_at:string;duration_minutes:number;client_name:string;garment_title:string;order_id:string}[];
}
export async function fetchOrderPage(view:OrderView,search:string,page:number) {
  const data=await workshopOperation('workshop_order_page',{p_view:view,p_search:search.trim(),p_page:page});
  const orders=await fetchAllOrders(undefined,data.ids);
  const byId=new Map(orders.map(order=>[order.id,order]));
  return {orders:(data.ids as string[]).map(id=>byId.get(id)).filter(order=>!!order),total:Number(data.total)};
}
export async function fetchReceiptPage(page:number) {
  const data=await workshopOperation('workshop_receipt_page',{p_page:page});
  return {records:(data.records as any[]).map(row=>({...mapPaymentRow(row),clientName:row.client_name})),total:Number(data.total)};
}
export async function fetchWorkshopSummary():Promise<WorkshopSummary> {return workshopOperation('workshop_summary',{});}
