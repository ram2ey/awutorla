import type { BespokeJobOrder, ClientBodyMeasurements } from '../types/workshop.types';

const OFFLINE_ORDERS_KEY = 'maison_offline_job_cards_v1';
const OFFLINE_MEASUREMENTS_KEY = 'maison_offline_measurements_v1';
const OFFLINE_OWNER_KEY = 'maison_offline_owner_v1';
const OFFLINE_DRAFTS_KEY = 'maison_offline_measurement_drafts_v1';
let memoryDrafts: MeasurementDraft[] = [];
export interface MeasurementDraft {
  id: string; clientId: string; clientName: string; expectedRevision: number;
  unit: 'in'|'cm'; values: Record<string,number>; notes: string; createdAt: string;
}
export function getMeasurementDrafts(): MeasurementDraft[] {
  if (!currentOwner) return [];
  if (isStorageAvailable()) {
    try {memoryDrafts=JSON.parse(localStorage.getItem(OFFLINE_DRAFTS_KEY) || '[]');} catch { /* memory fallback */ }
  }
  return [...memoryDrafts];
}
export function saveMeasurementDraft(draft: MeasurementDraft): void {
  if (!currentOwner) throw new Error('Staff sign-in required to retain an offline draft.');
  const drafts=getMeasurementDrafts().filter(entry=>entry.clientId!==draft.clientId);drafts.push(draft);
  if (isStorageAvailable()) localStorage.setItem(OFFLINE_DRAFTS_KEY,JSON.stringify(drafts));
  memoryDrafts=drafts;
  if(typeof window!=='undefined')window.dispatchEvent(new Event('workshop-drafts-changed'));
}
export function removeMeasurementDraft(id:string):void {
  const drafts=getMeasurementDrafts().filter(entry=>entry.id!==id);
  if(isStorageAvailable())localStorage.setItem(OFFLINE_DRAFTS_KEY,JSON.stringify(drafts));
  memoryDrafts=drafts;
  if(typeof window!=='undefined')window.dispatchEvent(new Event('workshop-drafts-changed'));
}
let currentOwner: string | null = null;

/** Keeps shared-tablet caches tied to one staff identity, including external sign-outs. */
export function setOfflineStoreOwner(userId: string | null): void {
  let previousOwner = currentOwner;
  if (isStorageAvailable()) {
    try { previousOwner = localStorage.getItem(OFFLINE_OWNER_KEY); } catch { /* use memory */ }
  }
  if (!userId || previousOwner !== userId) clearOfflineStore();
  currentOwner = userId;
  if (isStorageAvailable()) {
    try {
      if (userId) localStorage.setItem(OFFLINE_OWNER_KEY, userId);
      else localStorage.removeItem(OFFLINE_OWNER_KEY);
    } catch { /* storage may be disabled */ }
  }
}

// In-memory fallback if localStorage is disabled or in non-browser environment
const inMemoryOrders = new Map<string, BespokeJobOrder>();
const inMemoryMeasurements = new Map<string, ClientBodyMeasurements>();

function isStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Saves a job card to offline local storage for shop-floor tablet access.
 */
export function saveOfflineJobCard(order: BespokeJobOrder): void {
  inMemoryOrders.set(order.id, order);

  if (isStorageAvailable()) {
    try {
      const existing = getAllOfflineJobCards();
      const index = existing.findIndex((o) => o.id === order.id);
      if (index >= 0) {
        existing[index] = order;
      } else {
        existing.push(order);
      }
      localStorage.setItem(OFFLINE_ORDERS_KEY, JSON.stringify(existing));
    } catch (err) {
      console.warn('[OfflineStore] Failed to write order to localStorage:', err);
    }
  }
  // Reading existing storage above can populate an older in-memory copy.
  inMemoryOrders.set(order.id, order);
}

/**
 * Retrieves a single job card by order ID from offline storage.
 */
export function getOfflineJobCard(orderId: string): BespokeJobOrder | null {
  if (inMemoryOrders.has(orderId)) {
    return inMemoryOrders.get(orderId)!;
  }

  if (isStorageAvailable()) {
    try {
      const list = getAllOfflineJobCards();
      const found = list.find((o) => o.id === orderId);
      if (found) {
        inMemoryOrders.set(orderId, found);
        return found;
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Retrieves all offline cached job cards.
 */
export function getAllOfflineJobCards(): BespokeJobOrder[] {
  if (isStorageAvailable()) {
    try {
      const raw = localStorage.getItem(OFFLINE_ORDERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BespokeJobOrder[];
        parsed.forEach((item) => inMemoryOrders.set(item.id, item));
        return parsed;
      }
    } catch (err) {
      console.warn('[OfflineStore] Failed to read orders from localStorage:', err);
    }
  }

  return Array.from(inMemoryOrders.values());
}

/**
 * Caches client measurements for offline access.
 */
export function cacheClientMeasurements(
  clientId: string,
  measurements: ClientBodyMeasurements
): void {
  inMemoryMeasurements.set(clientId, measurements);

  if (isStorageAvailable()) {
    try {
      const raw = localStorage.getItem(OFFLINE_MEASUREMENTS_KEY) || '{}';
      const store = JSON.parse(raw);
      store[clientId] = measurements;
      localStorage.setItem(OFFLINE_MEASUREMENTS_KEY, JSON.stringify(store));
    } catch (err) {
      console.warn('[OfflineStore] Failed to cache measurements:', err);
    }
  }
}

/**
 * Retrieves client measurements from offline storage.
 */
export function getOfflineMeasurements(
  clientId: string
): ClientBodyMeasurements | null {
  if (inMemoryMeasurements.has(clientId)) {
    return inMemoryMeasurements.get(clientId)!;
  }

  if (isStorageAvailable()) {
    try {
      const raw = localStorage.getItem(OFFLINE_MEASUREMENTS_KEY);
      if (raw) {
        const store = JSON.parse(raw);
        if (store[clientId]) {
          inMemoryMeasurements.set(clientId, store[clientId]);
          return store[clientId];
        }
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Clears every cached job card and measurement — call on sign-out so the next
 * person to use a shared shop-floor tablet doesn't inherit the previous
 * staff member's client data from localStorage.
 */
export function clearOfflineStore(): void {
  memoryDrafts=[];
  inMemoryOrders.clear();
  inMemoryMeasurements.clear();

  if (isStorageAvailable()) {
    try {
      localStorage.removeItem(OFFLINE_ORDERS_KEY);
      localStorage.removeItem(OFFLINE_MEASUREMENTS_KEY);
      localStorage.removeItem(OFFLINE_DRAFTS_KEY);
    } catch (err) {
      console.warn('[OfflineStore] Failed to clear localStorage:', err);
    }
  }
}

/**
 * Checks if device currently has active network connection.
 */
export function isOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

/**
 * Listens for online/offline events and returns an unsubscribe function.
 */
export function listenNetworkStatus(callback: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
