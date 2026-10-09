import { jsPDF } from 'jspdf';
import type { BespokeJobOrder } from '../types/workshop.types';
import type { AppSettings } from './settings';

const INK = '#1c1410';
const MUTED = '#6b6058';
const GOLD = '#a3781f';

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * Builds a one-page invoice PDF for a bespoke order. Kept to plain jsPDF
 * primitives (text/lines) rather than a table plugin — the layout is simple
 * enough not to need one, and it avoids an extra dependency.
 */
export function generateInvoicePdf(order: BespokeJobOrder, settings: AppSettings): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 48;
  let y = 64;

  // Letterhead
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(settings.business_name || "Awutorla", marginX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  y += 16;
  const contactLine = [settings.contact_phone, settings.contact_email].filter(Boolean).join('  |  ');
  if (contactLine) {
    doc.text(contactLine, marginX, y);
    y += 12;
  }

  // "INVOICE" heading, right-aligned
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(GOLD);
  doc.text('INVOICE', pageWidth - marginX, 64, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(`Order Ref: #${order.id}`, pageWidth - marginX, 82, { align: 'right' });
  doc.text(`Date: ${formatDate(order.createdAt)}`, pageWidth - marginX, 96, { align: 'right' });

  y = 130;
  doc.setDrawColor(GOLD);
  doc.setLineWidth(1);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 30;

  // Bill To
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text('BILL TO', marginX, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(order.clientName, marginX, y);
  y += 14;
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(order.clientPhone, marginX, y);

  // Garment summary, right column
  const rightX = pageWidth / 2 + 20;
  let ry = y - 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text('GARMENT', rightX, ry);
  ry += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(order.garmentTitle, rightX, ry, { maxWidth: pageWidth - marginX - rightX });
  ry += 14;
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(`${order.fabricType} — ${order.fabricColor}`, rightX, ry, { maxWidth: pageWidth - marginX - rightX });

  y += 50;
  doc.setDrawColor('#d8cfc3');
  doc.setLineWidth(0.75);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 30;

  // Pricing table
  const balance = Math.max(0, order.totalAmount - order.depositPaid);
  const rows: [string, string][] = [
    ['Total Price', formatMoney(order.totalAmount, 'GHS')],
    ['Total Paid', formatMoney(order.depositPaid, 'GHS')],
    ['Balance Due', formatMoney(balance, 'GHS')],
    ...(order.depositPaid > order.totalAmount ? [['Customer Credit', formatMoney(order.depositPaid - order.totalAmount, 'GHS')] as [string, string]] : []),
  ];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text('DESCRIPTION', marginX, y);
  doc.text('AMOUNT', pageWidth - marginX, y, { align: 'right' });
  y += 10;
  doc.setDrawColor('#d8cfc3');
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  rows.forEach(([label, value], idx) => {
    const isBalance = idx === rows.length - 1;
    doc.setFont('helvetica', isBalance ? 'bold' : 'normal');
    doc.setTextColor(isBalance ? INK : MUTED);
    doc.text(label, marginX, y);
    doc.setTextColor(isBalance ? GOLD : INK);
    doc.text(value, pageWidth - marginX, y, { align: 'right' });
    y += 22;
  });

  y += 20;
  doc.setDrawColor(GOLD);
  doc.setLineWidth(1);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 30;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(
    `Thank you for commissioning ${settings.business_name || "Awutorla"}.`,
    marginX,
    y,
    { maxWidth: pageWidth - marginX * 2 }
  );

  return doc;
}

export function downloadInvoicePdf(order: BespokeJobOrder, settings: AppSettings): void {
  const doc = generateInvoicePdf(order, settings);
  doc.save(`Invoice-${order.id}.pdf`);
}

export function invoicePdfBlob(order: BespokeJobOrder, settings: AppSettings): Blob {
  const doc = generateInvoicePdf(order, settings);
  return doc.output('blob');
}
