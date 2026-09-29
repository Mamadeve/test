// ============================================================================
// Data model for the marketplace / OMS / WMS / fulfillment simulator.
// Internal architecture is English; all user-visible strings live in labels.ts
// ============================================================================

export type Category = 'SMARTPHONE' | 'LAPTOP' | 'HEADPHONES' | 'SMARTWATCH' | 'CONSOLE';

export interface Variant {
  id: string;            // VAR-00021-BLK-256
  productId: string;
  sku: string;           // PHX-BLK-256
  barcode: string;       // 8901234567890
  price: number;         // Toman
  attrs: Record<string, string>; // color / storage / warranty ...
}

export interface Product {
  id: string;            // PRD-00021
  nameFa: string;
  category: Category;
  brand: string;
  sellerId: string;      // owning / listing seller
  serialized: boolean;
  fragile: boolean;
  baseWeightKg: number;
  descriptionFa: string;
  initialQty: number;    // 100 units per product
  variants: Variant[];
}

// ---------------------------------------------------------------- inventory --

export type InvState =
  | 'AVAILABLE' | 'RECEIVED' | 'RESERVED' | 'ALLOCATED' | 'PICKING' | 'PICKED'
  | 'CONSOLIDATED' | 'PACKED' | 'READY_FOR_DISPATCH' | 'DISPATCHED'
  | 'DELIVERED' | 'RETURN_IN_TRANSIT' | 'RETURN_RECEIVED' | 'QUARANTINED'
  | 'DAMAGED' | 'RESTOCK_PENDING' | 'RESTOCKED';

export type InvCounts = Record<InvState, number>;

export interface InventoryLedgerEntry {
  id: string;            // INV-TX-000981
  sku: string;
  warehouseId: string;
  before: Partial<InvCounts>;
  after: Partial<InvCounts>;
  action: string;        // RESERVE / RELEASE / PICK ...
  delta: number;
  reason: string;
  actor: string;         // SYSTEM / employee id / OPS
  at: number;            // simulation timestamp
  orderId?: string;
}

export interface SerialUnit {
  serial: string;        // SN-2026-00018291
  sku: string;
  warehouseId: string;
  locationId: string;
  state: InvState;
  orderId?: string;
  receivedAt: number;
}

export interface Reservation {
  id: string;
  orderId: string;
  sku: string;
  warehouseId: string;
  qty: number;
  createdAt: number;
  expiresAt: number;     // TTL
  released?: boolean;
}

// ------------------------------------------------------------- warehouse ----

export interface Location {
  id: string;            // WH-TEH-01/Z-A/A03/R12/S04/B07
  warehouseId: string;
  zone: string;          // Z-A
  aisle: string;         // A03
  rack: string;          // R12
  shelf: string;         // S04
  bin: string;           // B07
  kind: 'STORAGE' | 'DOCK' | 'STAGING' | 'QC' | 'RETURNS';
  contents: Record<string, number>; // sku -> qty
  capacity: number;
}

export interface Zone {
  id: string;
  warehouseId: string;
  code: string;          // Z-A
  nameFa: string;
}

export type WarehouseCapacityState = 'NORMAL' | 'BUSY' | 'CONGESTED';

export interface Warehouse {
  id: string;            // WH-TEH-01
  nameFa: string;
  city: string;
  regions: string[];     // served delivery regions
  zones: Zone[];
  capacity: { receiving: number; picking: number; packing: number; dispatch: number };
  used: { receiving: number; picking: number; packing: number; dispatch: number };
  capacityState: WarehouseCapacityState;
}

export type EmployeeRole = 'PICKER' | 'PACKER' | 'QC_OPERATOR' | 'RECEIVING_OPERATOR' | 'DISPATCH_OPERATOR' | 'RETURN_INSPECTOR';

export interface Employee {
  id: string;            // EMP-TEH-014
  nameFa: string;
  role: EmployeeRole;
  warehouseId: string;
  busyUntil: number;
  tasksDone: number;
  errors: number;
}

// ------------------------------------------------------------- sellers ------

export type FulfillmentModel = 'PLATFORM' | 'SELLER_FC' | 'SELLER_FULFILLED';

export interface Seller {
  id: string;            // SELL-001
  nameFa: string;
  fulfillment: FulfillmentModel;
  warehouseId?: string;  // for SELLER_FC (stock stored in FC)
  sla: {
    confirmMinutes: number;
    prepareMinutes: number;
    cancelRate: number;       // 0..1
    stockReliability: number; // 0..1
    onTimeRate: number;       // 0..1
  };
}

// ------------------------------------------------------------------ order ---

export type OrderState =
  | 'PAYMENT_PENDING' | 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED'
  | 'ORDER_CREATED' | 'ALLOCATION_PENDING' | 'INVENTORY_RESERVED'
  | 'SELLER_CONFIRMATION_PENDING' | 'SELLER_CONFIRMED' | 'SELLER_REJECTED'
  | 'PICKING_PENDING' | 'PICKING' | 'PICKED' | 'CONSOLIDATION'
  | 'QC_PENDING' | 'PACKING' | 'PACKED' | 'SORTATION'
  | 'READY_FOR_DISPATCH' | 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLATION_REQUESTED' | 'CANCELLED'
  | 'RETURN_REQUESTED' | 'RETURN_APPROVED' | 'RETURN_IN_TRANSIT'
  | 'RETURN_RECEIVED' | 'RETURN_INSPECTION' | 'REFUND_PENDING' | 'REFUNDED'
  | 'RESTOCK_PENDING' | 'RESTOCKED' | 'QUARANTINED' | 'DAMAGED';

export type ShipmentState =
  | 'ALLOCATED' | 'SELLER_CONFIRMATION_PENDING' | 'SELLER_CONFIRMED' | 'SELLER_REJECTED'
  | 'PICKING_PENDING' | 'PICKING' | 'PICKED' | 'CONSOLIDATION' | 'QC_PENDING'
  | 'PACKING' | 'PACKED' | 'SORTATION' | 'READY_FOR_DISPATCH'
  | 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED'
  | 'CANCELLED' | 'INTERCEPTED';

export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
export type RefundStatus = 'REFUND_PENDING' | 'REFUND_PROCESSING' | 'REFUNDED' | 'REFUND_FAILED';

export interface Payment {
  id: string;            // PAY-20260929-000123
  gatewayRef: string;
  orderId: string;
  amount: number;
  method: string;
  status: PaymentStatus;
  failureReason?: string;
  at: number;
}

export interface Refund {
  id: string;            // RFD-000012
  paymentId: string;
  orderId: string;
  amount: number;
  reason: string;
  status: RefundStatus;
  at: number;
  resolvedAt?: number;
}

export interface OrderItem {
  variantId: string;
  productId: string;
  sku: string;
  barcode: string;
  nameFa: string;
  qty: number;
  unitPrice: number;
  serials: string[];
}

export interface Shipment {
  id: string;            // SHP-000012
  orderId: string;
  warehouseId?: string;  // undefined for pure seller-fulfilled handover point
  sellerId: string;
  fulfillment: FulfillmentModel;
  state: ShipmentState;
  itemIdx: number[];     // indexes into order.items
  packageId?: string;
  toteId?: string;
  pickTaskIds: string[];
  carrierId?: string;
  trackingId?: string;
  manifestId?: string;
  lane?: string;
  deliveryEta: number;
  events: ShipmentEvent[];
  interceptable: boolean;
  staged?: boolean;         // inventory staged into READY_FOR_DISPATCH (done once)
}

export interface ShipmentEvent {
  type: string;
  at: number;
  locationFa: string;
  detailFa?: string;
}

export interface Order {
  id: string;            // ORD-20260929-004821
  createdAt: number;
  customerId: string;
  customerNameFa: string;
  phone: string;
  city: string;
  addressFa: string;
  paymentId?: string;
  items: OrderItem[];
  shipments: Shipment[];
  state: OrderState;
  fulfillmentSummary: FulfillmentModel[];
  sellerIds: string[];
  totalAmount: number;
  expectedDelivery: number;
  cancel?: { requestedAt: number; reasonFa: string; allowed: boolean; blockedReasonFa?: string };
  returnId?: string;
  history: OrderHistoryEntry[];
  customerNote?: string;
}

export interface OrderHistoryEntry {
  state: OrderState;
  at: number;
  detailFa: string;
  actor: string;
}

// ---------------------------------------------------------------- customer --

export interface Customer {
  id: string;            // CUS-0001
  nameFa: string;
  phone: string;
  city: string;
  addressFa: string;
}

// ----------------------------------------------------------------- tasks ----

export type TaskType =
  | 'PAYMENT' | 'ALLOCATION' | 'SELLER_CONFIRM' | 'SELLER_PREPARE'
  | 'PICK' | 'CONSOLIDATION' | 'QC' | 'PACK' | 'SORTATION' | 'HANDOVER'
  | 'TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERY'
  | 'INBOUND_TRANSIT' | 'RECEIVING' | 'PUTAWAY'
  | 'RETURN_PICKUP' | 'RETURN_TRANSIT' | 'RETURN_RECEIVE' | 'RETURN_INSPECT'
  | 'DISPOSITION' | 'REFUND' | 'TTL_EXPIRY' | 'CYCLE_COUNT';

export type TaskStatus = 'QUEUED' | 'ACTIVE' | 'DONE' | 'FAILED' | 'CANCELLED';

export type PickStrategy = 'SINGLE' | 'BATCH' | 'WAVE' | 'ZONE';

export interface SimTask {
  id: string;            // PICK-000981 / PACK-000123 ...
  type: TaskType;
  status: TaskStatus;
  orderId?: string;
  shipmentId?: string;
  returnId?: string;
  warehouseId?: string;
  workerId?: string;
  startAt: number;
  endAt: number;
  payload: Record<string, any>;
  strategy?: PickStrategy;
  toteId?: string;
  errorType?: string;
  errorDetailFa?: string;
  blocking?: boolean;    // requires human resolution
}

export interface Tote {
  id: string;            // TOTE-000421
  warehouseId: string;
  state: 'EMPTY' | 'PICKING' | 'PARTIALLY_FILLED' | 'FULL' | 'IN_TRANSIT' | 'CONSOLIDATION' | 'COMPLETED';
  orderIds: string[];
  shipmentIds: string[];
  items: { sku: string; qty: number; serial?: string }[];
  locationId: string;
  updatedAt: number;
}

export interface PackageRec {
  id: string;            // PKG-20260929-009821
  orderId: string;
  shipmentId: string;
  warehouseId: string;
  stationId: string;     // PK-07
  packageType: string;   // SMALL / MEDIUM / LARGE / FRAGILE
  weightKg: number;
  dims: string;
  carrierId: string;
  serviceLevelFa: string;
  destinationFa: string;
  labelCode: string;     // barcode
  state: 'PACKING' | 'PACKED' | 'LABELED' | 'SORTED' | 'LOADED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURNED' | 'INTERCEPTED' | 'CLOSED';
  history: { state: string; at: number }[];
}

export interface Manifest {
  id: string;            // MAN-20260929-0042
  carrierId: string;
  warehouseId: string;
  destinationFa: string;
  packageIds: string[];
  status: 'READY' | 'HANDOVER' | 'DEPARTED';
  createdAt: number;
  handoverAt?: number;
}

export interface Carrier {
  id: string;
  nameFa: string;
  type: 'NATIONAL' | 'LOCAL';
}

// ------------------------------------------------------- inbound / returns --

export type InboundExceptionKind =
  | 'NONE' | 'SHORTAGE' | 'WRONG_SKU' | 'DAMAGED_PACKAGING' | 'BARCODE_UNREADABLE'
  | 'SERIAL_MISMATCH' | 'COUNTERFEIT_SUSPECT' | 'DOC_ISSUE';

export interface InboundShipment {
  id: string;            // INB-20260929-0012
  supplierFa: string;
  sellerId?: string;
  warehouseId: string;
  appointmentAt: number;
  gateAt?: number;
  state: 'EXPECTED' | 'ARRIVED' | 'RECEIVING' | 'RECEIVED' | 'PUTAWAY_DONE' | 'EXCEPTION';
  lines: { sku: string; expectedQty: number; receivedQty?: number }[];
  exceptionKind: InboundExceptionKind;
  exceptionDetailFa?: string;
  receivingTaskId?: string;
  putawayTaskId?: string;
  dockLocationId: string;
  createdAt: number;
}

export type ReturnEligibility = 'APPROVED' | 'REQUIRES_REVIEW' | 'REJECTED';
export type Disposition = 'RESTOCK' | 'OPEN_BOX' | 'QUARANTINE' | 'DAMAGED' | 'REPAIR' | 'SELLER_RETURN' | 'DISPOSAL' | 'MANUAL_REVIEW';

export interface ReturnRequest {
  id: string;            // RET-000042
  rma: string;           // RMA-2026-000042
  orderId: string;
  itemIdx: number[];
  reasonFa: string;
  qty: number;
  createdAt: number;
  eligibility: ReturnEligibility | 'PENDING';
  eligibilityReasonFa?: string;
  state: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'IN_TRANSIT' | 'RECEIVED'
       | 'INSPECTION' | 'DISPOSITIONED' | 'CLOSED';
  inspection?: {
    identityOk: boolean; serialOk: boolean; conditionFa: string;
    accessoriesOk: boolean; misuse: boolean; fraudSuspect: boolean;
    notesFa: string; inspectorId: string; at: number;
  };
  disposition?: Disposition;
  dispositionNoteFa?: string;
  refundId?: string;
  carrierId?: string;
  trackingId?: string;
  events: { type: string; at: number; detailFa: string }[];
}

// -------------------------------------------------------------- exceptions --

export type ExceptionType =
  | 'INVENTORY_MISMATCH' | 'SELLER_TIMEOUT' | 'SELLER_REJECT' | 'PICK_ERROR'
  | 'PACK_ERROR' | 'SERIAL_MISMATCH' | 'DAMAGED_PRODUCT' | 'CARRIER_FAILURE'
  | 'RETURN_ANOMALY' | 'REFUND_FAILURE' | 'PAYMENT_FAILURE' | 'CAPACITY_CONGESTION'
  | 'RECEIVING_EXCEPTION' | 'ALLOCATION_FAILURE' | 'CYCLE_COUNT_DISCREPANCY';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ExceptionRec {
  id: string;            // EXC-000031
  type: ExceptionType;
  severity: Severity;
  messageFa: string;
  orderId?: string;
  taskId?: string;
  sku?: string;
  ownerFa: string;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
  createdAt: number;
  resolvedAt?: number;
  resolutionFa?: string;
  actionKey?: string;      // key for the ops resolution action
  payload?: Record<string, any>;
  steps: { at: number; textFa: string }[];
  links?: { kind: 'order' | 'return' | 'inbound' | 'sku'; id: string };
}

// ----------------------------------------------------------- notifications --

export interface Coupon {
  id: string;            // CPN-000007
  code: string;          // DISCOUNT-COMP-0007
  customerId: string;
  orderId?: string;
  amount: number;
  reasonFa: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export interface Notification {
  id: string;
  at: number;
  titleFa: string;
  bodyFa: string;
  kind: 'ORDER' | 'PAYMENT' | 'RETURN' | 'WAREHOUSE' | 'SELLER' | 'SYSTEM' | 'EXCEPTION';
  orderId?: string;
  read: boolean;
  audience: 'CUSTOMER' | 'OPS';
}

// ------------------------------------------------------------ events/audit --

export interface SimEvent {
  id: string;            // EVENT-000981
  type: string;          // INVENTORY_RESERVED ...
  actor: string;         // SYSTEM / EMP-... / CUSTOMER / SELL-001
  orderId?: string;
  sku?: string;
  prev?: string;
  next?: string;
  at: number;
  detailFa: string;
}

// -------------------------------------------------------------- KPI / misc --

export interface KpiSnapshot {
  ordersProcessed: number;
  ordersPending: number;
  pickRate: number;
  packRate: number;
  onTimeDispatch: number;
  onTimeDelivery: number;
  sellerConfirmRate: number;
  cancellationRate: number;
  returnRate: number;
  inventoryAccuracy: number;
  pickErrors: number;
  packErrors: number;
  avgProcessMinutes: number;
  utilization: number;
}

export interface CycleCount {
  id: string;
  sku: string;
  warehouseId: string;
  systemQty: number;
  physicalQty?: number;
  state: 'COUNTING' | 'DISCREPANCY' | 'INVESTIGATING' | 'APPROVED' | 'ADJUSTED' | 'MATCHED';
  createdAt: number;
  resolvedAt?: number;
  noteFa?: string;
}

export type ScenarioId =
  | 'SC-01' | 'SC-02' | 'SC-03' | 'SC-04' | 'SC-05' | 'SC-06' | 'SC-07' | 'SC-08'
  | 'SC-09' | 'SC-10' | 'SC-11' | 'SC-12' | 'SC-13' | 'SC-14' | 'SC-15' | 'SC-16'
  | 'SC-17' | 'SC-18' | 'SC-19' | 'SC-20' | 'SC-21' | 'SC-22' | 'SC-23' | 'SC-24'
  | 'SC-25' | 'SC-26' | 'SC-27';

export interface Forces {
  paymentFail: boolean;
  paymentTimeout: boolean;
  sellerReject: boolean;
  sellerDelay: boolean;
  stockShortage: boolean;
  wrongScan: boolean;       // next pick fails with wrong SKU
  wrongLocation: boolean;
  serialMismatchPick: boolean;
  damagedPick: boolean;
  invMismatch: boolean;     // picked qty != system qty
  returnReject: boolean;
  serialMismatchReturn: boolean;
  damagedReturn: boolean;
  quarantineReturn: boolean;
  refundFail: boolean;
  inboundException: InboundExceptionKind;
  randomMode: boolean;
  autoOrders: boolean;
}

export interface ScriptStep {
  when: OrderState;
  action: 'CANCEL' | 'RETURN' | 'NONE';
  targetSuffix?: string;   // match order id suffix for multi-order scenarios
  done?: boolean;
}

export interface SimState {
  simTime: number;
  scenarioId: ScenarioId | null;
  scenarioNameFa: string;
  products: Product[];
  sellers: Seller[];
  customers: Customer[];
  carriers: Carrier[];
  warehouses: Warehouse[];
  locations: Record<string, Location>;
  employees: Employee[];
  inv: Record<string, Record<string, InvCounts>>;   // sku -> whId -> counts
  serials: SerialUnit[];
  reservations: Reservation[];
  ledger: InventoryLedgerEntry[];
  orders: Order[];
  payments: Payment[];
  refunds: Refund[];
  coupons: Coupon[];
  tasks: SimTask[];
  totes: Tote[];
  packages: PackageRec[];
  manifests: Manifest[];
  inbound: InboundShipment[];
  returns: ReturnRequest[];
  exceptions: ExceptionRec[];
  events: SimEvent[];
  notifications: Notification[];
  cycleCounts: CycleCount[];
  counters: Record<string, number>;
  pickStats: { picks: number; errors: number; packs: number; packErrors: number };
  sellerStats: { asked: number; accepted: number; rejected: number; timeout: number };
  deliveryStats: { dispatched: number; onTime: number; delivered: number; totalMinutes: number };
  cancelStats: { requested: number; allowed: number };
  returnStats: { requested: number; approved: number; rejected: number };
  inventoryAdjustments: number;
  inventoryCounts: number;
  congestionNotifiedAt: number;
  seededAt: number;
  script: ScriptStep[];
  splitPolicy: 'CONSOLIDATE_FIRST' | 'ALWAYS_SPLIT';
  rngSeed: number;
  version: number;
  forces: Forces;
}
