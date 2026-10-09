import { supabase } from './supabase';

const ORDER_SKETCHES_BUCKET = 'order-sketches';

function sanitizeFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot >= 0 ? fileName.slice(lastDot) : '';
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
}

/**
 * Uploads one intake reference sketch/photo for an order and returns its
 * storage path for storage in `orders.reference_images`. Staff reads use short-lived signed URLs.
 */
export async function uploadOrderSketch(orderId: string, file: File): Promise<string> {
  const path = `${orderId}/${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(ORDER_SKETCHES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  return path;
}

export async function resolveOrderSketchUrl(value: string): Promise<string> {
  const publicMarker = '/storage/v1/object/public/order-sketches/';
  const signedMarker = '/storage/v1/object/sign/order-sketches/';
  const marker = value.includes(publicMarker) ? publicMarker : value.includes(signedMarker) ? signedMarker : null;
  const path = marker ? decodeURIComponent(value.split(marker)[1].split('?')[0]) : value;
  if (!marker && /^https?:\/\//.test(value)) return value;
  const { data, error } = await supabase.storage.from(ORDER_SKETCHES_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
