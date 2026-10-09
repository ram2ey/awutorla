export type WorkshopStage =
  | 'pending' // Received
  | 'cutting' // In Cutting
  | 'fitting' // In Fitting
  | 'finishing' // In Finishing
  | 'ready' // Ready for Pickup/Delivery
  | 'delivered'; // Completed

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface OrderTaskItem {
  id: string;
  orderId: string;
  tailorName: string;
  title: string;
  taskDescription?: string;
  status: TaskStatus;
  dueDate?: string;
  assignedAt: string;
  completedAt?: string;
}

export interface MeasurementParameter {
  id: string;
  key: string;
  label: string;
  displayOrder: number;
  isActive: boolean;
}

export interface ClientBodyMeasurements {
  id?: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  unit: 'in' | 'cm';
  // Keyed by the measurement_parameters.key of each active admin-defined
  // parameter — replaces the old fixed bust/waist/hips/... fields so admins
  // can add parameters without a schema change.
  values: Record<string, number>;
  notes?: string;
  updatedAt: string;
  revision?: number;
  labels?: Record<string, string>;
  capturedAt?: string;
  source?: 'master' | 'intake' | 'applied' | 'legacy_migration';
}

export interface PaymentEntry {
  id: string;
  orderId: string;
  kind: 'receipt' | 'reversal' | 'opening_balance';
  amount: number;
  currency: 'GHS';
  method: string;
  occurredOn: string | null;
  reference: string;
  notes: string;
  recordedBy: string | null;
  recordedByName: string;
  recordedAt: string;
  reversesPaymentId: string | null;
}

export interface BespokeJobOrder {
  id: string; // Order reference e.g. ORD-BESPOKE-884
  clientId?: string | null; // Independent customer record in clients.
  clientName: string;
  clientPhone: string;
  stage: WorkshopStage;
  garmentTitle: string;
  garmentSubtitle: string;
  fabricType: string;
  fabricColor: string;
  fabricNotes: string;
  referenceImages: string[];
  swatchImage?: string;
  measurements: ClientBodyMeasurements;
  depositPaid: number;
  currency?: 'GHS';
  payments?: PaymentEntry[];
  attachmentWarning?: boolean;
  totalAmount: number;
  assignedTailor: string;
  assignedTailorId?: string;
  dueDate: string;
  createdAt: string;
  updatedAt?: string;
  workRevision?: number;
  productionCycle?: number;
  tasks?: OrderTaskItem[];
  stageHistory: {
    stage: WorkshopStage;
    completedAt?: string;
    completedBy?: string;
    notes?: string;
  }[];
}

export interface StageTransitionResult {
  previousStage: WorkshopStage;
  newStage: WorkshopStage;
  smsSent: boolean;
  smsMessage?: string;
  order: BespokeJobOrder;
}
