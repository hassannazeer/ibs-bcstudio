import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BCClient } from '../dist/index.js';

function jsonResponse(status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      },
    },
    async text() {
      return text;
    },
    async json() {
      return body;
    },
  };
}

describe('@ilmora/bc-client smoke', () => {
  it('getAll follows @odata.nextLink across pages', async () => {
    const calls = [];
    const fetchMock = mock.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('login.microsoftonline.com')) {
        return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
      }
      if (String(url).includes('page=2')) {
        return jsonResponse(200, { value: [{ id: 'b' }] });
      }
      return jsonResponse(200, {
        value: [{ id: 'a' }],
        '@odata.nextLink': 'https://api.businesscentral.dynamics.com/v2.0/t/e/api/v2.0/companies(c)/items?page=2',
      });
    });
    globalThis.fetch = fetchMock;

    const client = new BCClient({
      tenantId: 't',
      environment: 'e',
      clientId: 'id',
      clientSecret: 'secret',
      companyId: 'c',
    });

    const rows = await client.getAll('api/v2.0/companies({companyId})/items', {
      rateLimitDelay: 0,
    });

    assert.deepEqual(rows, [{ id: 'a' }, { id: 'b' }]);
    assert.equal(calls.filter(u => !u.includes('login.microsoftonline.com')).length, 2);
  });

  it('callAction resolves 204 without JSON parse', async () => {
    let parsed = false;
    const fetchMock = mock.fn(async (url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
      }
      return {
        ok: true,
        status: 204,
        headers: { get: () => null },
        async text() {
          throw new Error('204 responses must not read a body');
        },
        async json() {
          parsed = true;
          throw new Error('204 responses must not JSON.parse');
        },
      };
    });
    globalThis.fetch = fetchMock;

    const client = new BCClient({
      tenantId: 't',
      environment: 'e',
      clientId: 'id',
      clientSecret: 'secret',
      companyId: 'c',
    });

    const result = await client.callAction(
      'api/v2.0/companies({companyId})/salesOrders',
      'ORDER-GUID',
      'Microsoft.NAV.shipAndInvoice',
    );

    assert.equal(result.success, true);
    assert.equal(result.status, 204);
    assert.equal(result.data, undefined);
    assert.equal(parsed, false);
  });
});
