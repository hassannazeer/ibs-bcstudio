// ─────────────────────────────────────────────────────────────────────────────
// @bcstudio/metadata
//
// Runtime BC metadata discovery — no hardcoding, no compile-time schema.
//
// Features:
//  discoverEndpoints()  — reads BC OData service document → all EntitySets
//  getEntitySchema()    — parses $metadata XML → typed field list
//  inferSchema()        — fallback: $top=1 sample → type inference
//  discoverCompanies()  — lists all accessible companies
// ─────────────────────────────────────────────────────────────────────────────

import { BCClient } from '@ilmora/bc-client';
import type {
  BCConnectionConfig,
  BCEndpoint,
  BCEndpointType,
  BCFieldSchema,
  BCMappedType,
} from '@ilmora/bc-types';

// ── OData type → SDK type mapping ─────────────────────────────────────────────

function mapOdataType(odataType: string | null): { mappedType: BCMappedType; sqlType: string } {
  if (!odataType) return { mappedType: 'string', sqlType: 'NVARCHAR(MAX)' };
  const t = odataType.toLowerCase();

  if (t.includes('string'))      return { mappedType: 'string',   sqlType: 'NVARCHAR(MAX)' };
  if (t.includes('guid'))        return { mappedType: 'guid',     sqlType: 'UNIQUEIDENTIFIER' };
  if (t.includes('datetimeoffset') || t.includes('datetime'))
                                 return { mappedType: 'datetime', sqlType: 'DATETIMEOFFSET' };
  if (t.includes('date'))        return { mappedType: 'datetime', sqlType: 'DATE' };
  if (t.includes('time'))        return { mappedType: 'string',   sqlType: 'TIME' };
  if (t.includes('int16') || t.includes('int32') || t.includes('int64') || t.includes('byte'))
                                 return { mappedType: 'number',   sqlType: 'INT' };
  if (t.includes('decimal') || t.includes('single') || t.includes('double'))
                                 return { mappedType: 'number',   sqlType: 'DECIMAL(18,4)' };
  if (t.includes('boolean'))     return { mappedType: 'boolean',  sqlType: 'BIT' };
  if (t.includes('binary') || t.includes('stream'))
                                 return { mappedType: 'binary',   sqlType: 'VARBINARY(MAX)' };
  return { mappedType: 'string', sqlType: 'NVARCHAR(MAX)' };
}

function inferTypeFromValue(value: unknown): BCMappedType {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number')  return 'number';
  if (typeof value === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return 'guid';
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime';
  }
  return 'string';
}

// ── Endpoint type detection ────────────────────────────────────────────────────

function detectEndpointType(path: string): BCEndpointType {
  if (/\/api\/v\d/.test(path))           return 'standard';
  if (/\/api\/[a-z]+\/\d/.test(path))   return 'custom';
  if (/\/ODataV4\//.test(path))          return 'extension';
  if (/\/automation\//.test(path))       return 'automation';
  return 'unknown';
}

// ── Minimal XML parser for $metadata ─────────────────────────────────────────

interface ParsedMetadata {
  entitySets: Map<string, string>; // name → EntityType name
  entityTypes: Map<string, BCFieldSchema[]>; // EntityType name → fields
}

function parseMetadataXml(xml: string): ParsedMetadata {
  const entitySets  = new Map<string, string>();
  const entityTypes = new Map<string, BCFieldSchema[]>();

  // Parse EntitySets
  const setRe = /<EntitySet[^>]+Name="([^"]+)"[^>]+EntityType="([^"]+)"[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = setRe.exec(xml)) !== null) {
    const [, name, type] = m;
    // type is usually "Microsoft.NAV.customer" — take the last segment
    entitySets.set(name, type.split('.').pop() ?? type);
  }

  // Parse EntityTypes
  const typeRe = /<EntityType[^>]+Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g;
  while ((m = typeRe.exec(xml)) !== null) {
    const [, typeName, body] = m;
    const fields: BCFieldSchema[] = [];
    const keyFields = new Set<string>();

    // Key fields
    const keyRe = /<PropertyRef[^>]+Name="([^"]+)"/g;
    let km: RegExpExecArray | null;
    while ((km = keyRe.exec(body)) !== null) keyFields.add(km[1]);

    // Properties
    const propRe = /<Property[^>]+Name="([^"]+)"[^>]+Type="([^"]+)"([^>]*)\/>/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(body)) !== null) {
      const [, name, rawType, attrs] = pm;
      const nullable = !attrs.includes('Nullable="false"');
      const maxLenMatch = /MaxLength="(\d+)"/.exec(attrs);
      const maxLength = maxLenMatch ? parseInt(maxLenMatch[1]) : null;
      const { mappedType, sqlType } = mapOdataType(rawType);

      fields.push({
        name,
        odataType:   rawType,
        mappedType,
        sqlType,
        nullable,
        isPrimaryKey: keyFields.has(name),
        maxLength,
        isReadOnly:  attrs.includes('annotation') && attrs.toLowerCase().includes('readonly'),
      });
    }
    if (fields.length > 0) entityTypes.set(typeName, fields);
  }

  return { entitySets, entityTypes };
}

// ── BCMetadata ────────────────────────────────────────────────────────────────

export class BCMetadata {
  private client: BCClient;

  constructor(config: BCConnectionConfig) {
    this.client = new BCClient(config);
  }

  /**
   * Inject a pre-constructed BCClient.
   * Useful when you already have a BCClient instance with a cached token.
   */
  static fromClient(client: BCClient): BCMetadata {
    const meta = new BCMetadata({ tenantId: '', environment: '', clientId: '', clientSecret: '' });
    meta.client = client;
    return meta;
  }

  /**
   * Discover all API endpoints available on this BC environment.
   *
   * Reads the OData service document at `{baseUrl}/{apiPath}`.
   * Returns typed BCEndpoint objects including path, type (standard/custom/extension), and name.
   *
   * @example
   *   const endpoints = await meta.discoverEndpoints('api/v2.0');
   *   // Also works with custom publisher paths:
   *   const custom = await meta.discoverEndpoints('api/myPublisher/myGroup/1.0');
   */
  async discoverEndpoints(apiVersionPath = 'api/v2.0'): Promise<BCEndpoint[]> {
    const token = await this.client.getAccessToken();
    const url = this.client.buildUrl(apiVersionPath);
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch service document: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as { value?: { name: string; kind: string; url: string }[] };
    const entries = data.value ?? [];

    return entries.map(e => {
      const pathFromUrl = new URL(e.url).pathname;
      return {
        name: e.name,
        path: pathFromUrl,
        type: detectEndpointType(e.url),
        kind: e.kind,
        url:  e.url,
      };
    });
  }

  /**
   * Parse the $metadata document for a given endpoint path and return
   * the full typed field schema.
   *
   * Falls back to $top=1 data-sampling if the metadata XML cannot be parsed
   * (e.g. for endpoints that don't publish full metadata).
   *
   * @example
   *   const schema = await meta.getEntitySchema('api/v2.0/companies({companyId})/customers');
   *   schema.forEach(f => console.log(f.name, f.mappedType, f.isPrimaryKey));
   */
  async getEntitySchema(endpointPath: string): Promise<BCFieldSchema[]> {
    const token = await this.client.getAccessToken();

    // Build the $metadata URL for the endpoint's API path prefix
    // e.g. /api/v2.0 → /api/v2.0/$metadata
    const segments = endpointPath.replace(/^\//, '').split('/');
    // Find API version prefix — typically api/v2.0 or api/publisher/group/version
    let metadataPrefix = '';
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === 'api') {
        // Standard: api/v2.0 (2 segments) | Custom: api/publisher/group/version (4 segments)
        const isCustom = i + 4 <= segments.length && /^\d+\.\d+/.test(segments[i + 3] ?? '');
        metadataPrefix = isCustom
          ? segments.slice(0, i + 4).join('/')
          : segments.slice(0, i + 2).join('/');
        break;
      }
    }

    if (!metadataPrefix) {
      return this.inferSchemaFromSample(endpointPath, token);
    }

    const metaUrl = this.client.buildUrl(`${metadataPrefix}/$metadata`);
    const metaResp = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml,text/xml,*/*' },
    });

    if (!metaResp.ok) {
      return this.inferSchemaFromSample(endpointPath, token);
    }

    const xml = await metaResp.text();
    const { entitySets, entityTypes } = parseMetadataXml(xml);

    // Find EntitySet name from path
    const entitySetName = segments[segments.length - 1]?.split('(')[0] ?? '';
    const typeName = entitySets.get(entitySetName);
    const fields   = typeName ? entityTypes.get(typeName) : undefined;

    if (fields && fields.length > 0) return fields;

    // Also try case-insensitive match
    for (const [setName, tName] of entitySets.entries()) {
      if (setName.toLowerCase() === entitySetName.toLowerCase()) {
        const f = entityTypes.get(tName);
        if (f && f.length > 0) return f;
      }
    }

    return this.inferSchemaFromSample(endpointPath, token);
  }

  /**
   * Infer schema from a live $top=1 sample.
   * Used when $metadata XML cannot be parsed.
   * Type mapping is best-effort based on actual values.
   */
  async inferSchemaFromSample(endpointPath: string, token?: string): Promise<BCFieldSchema[]> {
    const t = token ?? await this.client.getAccessToken();
    const url = this.client.buildUrl(endpointPath, undefined, '$top=1');
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { value?: Record<string, unknown>[] };
    const sample = data.value?.[0];
    if (!sample) return [];

    return Object.entries(sample)
      .filter(([k]) => !k.startsWith('@'))
      .map(([name, value]) => {
        const mappedType = inferTypeFromValue(value);
        const { sqlType } = mapOdataType(null);
        return {
          name,
          odataType:   null,
          mappedType,
          sqlType:     mappedType === 'number' ? 'DECIMAL(18,4)'
                     : mappedType === 'boolean' ? 'BIT'
                     : mappedType === 'datetime' ? 'DATETIMEOFFSET'
                     : mappedType === 'guid' ? 'UNIQUEIDENTIFIER'
                     : 'NVARCHAR(MAX)',
          nullable:    value === null,
          isPrimaryKey: name.toLowerCase() === 'id',
          maxLength:   null,
        };
      });
  }

  /**
   * Discover all companies visible to these credentials, with their IDs.
   */
  async discoverCompanies(): Promise<{ id: string; name: string; displayName: string }[]> {
    return this.client.getAll<{ id: string; name: string; displayName: string }>('api/v2.0/companies');
  }
}

export { BCClient } from '@ilmora/bc-client';
export type { BCEndpoint, BCFieldSchema, BCConnectionConfig } from '@ilmora/bc-types';
