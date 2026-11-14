// ─────────────────────────────────────────────────────────────────────────────
// @bcstudio/types
// Complete shared type system for Business Central SDK
// ─────────────────────────────────────────────────────────────────────────────

// ── Connection & Auth ─────────────────────────────────────────────────────────

export interface BCConnectionConfig {
  /** Azure AD Tenant ID (GUID) — found in Entra → Overview */
  tenantId: string;
  /** BC Environment name: 'production', 'sandbox', 'MySandbox', etc. */
  environment: string;
  /** Azure AD App Registration Client ID */
  clientId: string;
  /** Azure AD App Registration Client Secret */
  clientSecret: string;
  /**
   * BC Company ID (GUID).
   * When provided, it is injected into paths that contain the {companyId} placeholder.
   * Example: `api/v2.0/companies({companyId})/customers`
   */
  companyId?: string;
  /**
   * Override the BC base URL.
   * Default: `https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}`
   */
  baseUrl?: string;
  /**
   * BC API version segment.
   * Default: `v2.0`
   */
  apiVersion?: string;
}

export interface BCTokenCache {
  token: string;
  expiresAt: number;
}

// ── HTTP Response ─────────────────────────────────────────────────────────────

export interface BCResponse<T = unknown> {
  success: boolean;
  data?: T;
  /** HTTP status code */
  status: number;
  /** @odata.etag from response header or body — required for PATCH/DELETE */
  etag?: string | null;
  /** Round-trip time in milliseconds */
  durationMs: number;
  /** Error message on failure */
  error?: string;
  /** Raw BC error body on failure */
  errorData?: unknown;
}

export interface BCListResponse<T = unknown> {
  value: T[];
  '@odata.context'?: string;
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

// ── OData Query Builder types ─────────────────────────────────────────────────

export type ODataComparatorOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le';
export type ODataLogicalOp   = 'and' | 'or' | 'not';
export type ODataStringFn    = 'contains' | 'startswith' | 'endswith';
export type ODataOrderDir    = 'asc' | 'desc';

export interface ODataFilter {
  field: string;
  op: ODataComparatorOp;
  value: string | number | boolean | null;
}

export interface ODataOptions {
  /** $top — max records per page (BC max varies, typically 100–1000) */
  top?: number;
  /** $skip — offset records */
  skip?: number;
  /** $select — comma-separated field names */
  select?: string | string[];
  /** $filter — raw string OR structured filter array */
  filter?: string | ODataFilter[];
  /** $orderby — e.g. 'lastModifiedDateTime desc' */
  orderby?: string;
  /** $expand — navigation properties to expand (not all BC endpoints support) */
  expand?: string | string[];
  /** $count=true — include count in response */
  count?: boolean;
  /** $search — full-text search (limited BC support) */
  search?: string;
  /** Raw extra query string appended as-is */
  raw?: string;
}

// ── Standard BC API v2.0 Entities ─────────────────────────────────────────────
// These are the official entity paths for api/v2.0 — reference for path building

export type BCStandardEndpoint =
  // Finance
  | 'companies'
  | 'companies({companyId})/accounts'
  | 'companies({companyId})/balanceSheet'
  | 'companies({companyId})/cashFlowStatement'
  | 'companies({companyId})/incomeStatement'
  | 'companies({companyId})/retainedEarningsStatement'
  | 'companies({companyId})/trialBalance'
  // Customers
  | 'companies({companyId})/customers'
  | 'companies({companyId})/customerPaymentJournals'
  | 'companies({companyId})/customerPayments'
  | 'companies({companyId})/customerSales'
  // Vendors
  | 'companies({companyId})/vendors'
  | 'companies({companyId})/vendorPaymentJournals'
  | 'companies({companyId})/vendorPayments'
  | 'companies({companyId})/purchaseInvoices'
  | 'companies({companyId})/purchaseInvoiceLines'
  // Items
  | 'companies({companyId})/items'
  | 'companies({companyId})/itemCategories'
  | 'companies({companyId})/unitsOfMeasure'
  | 'companies({companyId})/pictures'
  // Sales
  | 'companies({companyId})/salesInvoices'
  | 'companies({companyId})/salesInvoiceLines'
  | 'companies({companyId})/salesOrders'
  | 'companies({companyId})/salesOrderLines'
  | 'companies({companyId})/salesQuotes'
  | 'companies({companyId})/salesQuoteLines'
  | 'companies({companyId})/salesCreditMemos'
  | 'companies({companyId})/salesCreditMemoLines'
  // Journals
  | 'companies({companyId})/journals'
  | 'companies({companyId})/journalLines'
  | 'companies({companyId})/generalLedgerEntries'
  // Inventory
  | 'companies({companyId})/locations'
  | 'companies({companyId})/shipmentMethods'
  | 'companies({companyId})/paymentMethods'
  | 'companies({companyId})/paymentTerms'
  // Employees
  | 'companies({companyId})/employees'
  | 'companies({companyId})/timeRegistrationEntries'
  // Setup
  | 'companies({companyId})/countriesRegions'
  | 'companies({companyId})/currencies'
  | 'companies({companyId})/taxAreas'
  | 'companies({companyId})/taxGroups'
  | 'companies({companyId})/dimensionValues'
  | 'companies({companyId})/dimensions'
  // Documents
  | 'companies({companyId})/attachments'
  | string; // Allow custom paths

// ── BC Bound Actions ──────────────────────────────────────────────────────────

export type BCSalesOrderAction =
  | 'Microsoft.NAV.makeInvoice'
  | 'Microsoft.NAV.makeQuote'
  | 'Microsoft.NAV.post'
  | 'Microsoft.NAV.reopen'
  | 'Microsoft.NAV.releaseOrder'
  | 'Microsoft.NAV.copyDocument'
  | string;

export type BCSalesInvoiceAction =
  | 'Microsoft.NAV.post'
  | 'Microsoft.NAV.send'
  | 'Microsoft.NAV.cancel'
  | 'Microsoft.NAV.cancelAndCreateCreditMemo'
  | 'Microsoft.NAV.getRecurringLines'
  | string;

export type BCPurchaseOrderAction =
  | 'Microsoft.NAV.post'
  | 'Microsoft.NAV.reopen'
  | 'Microsoft.NAV.copyDocument'
  | string;

export interface BCActionRequest {
  /** The BC action name, e.g. 'Microsoft.NAV.makeInvoice' */
  action: string;
  /** Entity GUID the action is being called on */
  entityId: string;
  /** Action body / parameters (action-specific) */
  body?: Record<string, unknown>;
}

export interface BCActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  status: number;
  durationMs: number;
  error?: string;
}

// ── Schema ─────────────────────────────────────────────────────────────────────

export type BCMappedType = 'string' | 'number' | 'boolean' | 'datetime' | 'guid' | 'binary' | 'unknown';

export interface BCFieldSchema {
  name: string;
  odataType: string | null;
  mappedType: BCMappedType;
  sqlType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  maxLength: number | null;
  isReadOnly?: boolean;
}

export type BCEndpointType = 'standard' | 'custom' | 'extension' | 'automation' | 'unknown';

export interface BCEndpoint {
  name: string;
  path: string;
  type: BCEndpointType;
  kind: string;
  url: string;
}

// ── Sync Engine ───────────────────────────────────────────────────────────────

export type SyncMode         = 'full' | 'incremental';
export type DestinationType  = 'supabase' | 'sqlserver' | 'convex' | 'custom';
export type ConflictStrategy = 'upsert' | 'insert_only' | 'update_only' | 'skip';

export interface SyncFieldMapping {
  /** Field name in BC OData response */
  sourceField: string;
  /** Column/key name in destination */
  destinationField: string;
  /** Type coercion hint */
  dataType?: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'guid';
  /** If true, this field is used as the deduplication key */
  isPrimaryKey?: boolean;
}

export interface SyncJobConfig {
  /** Full BC endpoint path, e.g. `api/v2.0/companies({companyId})/customers` */
  sourceEndpoint: string;
  /** Destination table or collection name */
  destinationTable: string;
  /** Field name to use as the PK for upsert / deduplication */
  primaryKeyField?: string;
  /** Field→column mapping definitions */
  fieldMappings: SyncFieldMapping[];
  /** 'full' syncs everything. 'incremental' uses lastIncrementalValue + incrementalField */
  syncMode: SyncMode;
  /**
   * BC field that holds the last-modified timestamp.
   * Most BC entities expose `lastModifiedDateTime`.
   * Custom pages may expose a different field name.
   */
  incrementalField?: string;
  /**
   * ISO timestamp from the previous sync run (returned as `nextIncrementalValue`).
   * Pass undefined or null to trigger a full sync regardless of syncMode.
   * ⚠️ Must NOT contain milliseconds — use BCClient.normalizeFilterDate() to strip them.
   */
  lastIncrementalValue?: string;
  /** Force full resync even if lastIncrementalValue is set */
  forceFullResync?: boolean;
  /** Delay in ms between paginated requests (default 100ms) */
  rateLimitDelay?: number;
  /** Records per page (BC default varies; we recommend 1000) */
  batchSize?: number;
  /** How to handle records that already exist in destination (default: upsert) */
  conflictStrategy?: ConflictStrategy;
  /** If true, validate required fields before writing */
  schemaValidationEnabled?: boolean;
}

export interface SyncResult {
  status: 'success' | 'warning' | 'error' | 'skipped' | 'cancelled';
  recordsRead: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsFailed: number;
  recordsSkipped: number;
  durationSeconds: number;
  /**
   * MAX incrementalField value seen in this sync run, with milliseconds stripped.
   * ✅ Persist this and pass back as `lastIncrementalValue` on the next run.
   */
  nextIncrementalValue?: string;
  warnings: string[];
  error?: string;
  /** Debugging metadata */
  meta?: {
    pagesFetched: number;
    filterApplied: boolean;
    filterHonoured: boolean;
    filterCutoff?: string;
  };
}

export interface SyncAdapterOptions {
  batchSize?: number;
  concurrency?: number;
}

// ── Request Options ────────────────────────────────────────────────────────────

export interface BCRequestOptions {
  odataQuery?: string;
  odataOptions?: ODataOptions;
  rateLimitDelay?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
}
