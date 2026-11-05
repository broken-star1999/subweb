import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapt, onRequest } from '../functions/jms/[[path]].js';
import { load } from 'js-yaml';

const admin = 'a'.repeat(48);
const source = 'https://jmssub.net/members/getsub.php?service=0&id=fake&format=clash';
const bandwidth = 'https://justmysocks6.net/members/getbwcounter.php?service=0&id=fake';
const raw = { 'proxy-providers': { test: { type: 'http', url: source, override: { udp: true } } }, 'proxy-groups': [{ name: '🇭🇰 香港节点', type: 'select' }, { name: '🇺🇸 美国节点', type: 'select', proxies: ['🇭🇰 香港节点'] }, { name: 'manual', type: 'select', proxies: ['🇭🇰 香港节点', '🇺🇸 美国节点'] }] };
const kv = () => { const map = new Map(); return { map, async put(k,v){map.set(k,v)}, async get(k){return map.get(k) ?? null}, async delete(k){map.delete(k)} }; };
const make = (storage, key = admin, subscription = source, api = bandwidth) => onRequest({ request: new Request('https://example.test/jms/manage', { method: 'POST', headers: { Origin:'https://example.test', 'Content-Type':'application/json', 'X-JMS-Admin-Key':key }, body: JSON.stringify({ subscription, bandwidth:api }) }), env: { JMS_ADMIN_KEY:admin, JMS_CONFIGS:storage }, params: { path:['manage'] } });

test('adapts groups and does not expose original provider', () => {
  const cfg = adapt(structuredClone(raw), 'https://example.test/jms/token/provider');
  assert.equal(cfg['proxy-providers'].test.url, 'https://example.test/jms/token/provider');
  assert.deepEqual(cfg['proxy-groups'].find(g => g.name === 'manual').proxies, ['🇺🇸 美国节点']);
  assert.equal(cfg['proxy-groups'].find(g => g.name === '🇯🇵 日本节点').filter, 's4[.]');
});

test('requires admin and rejects arbitrary upstream hosts', async () => {
  const store = kv();
  assert.equal((await make(store, 'wrong')).status, 403);
  assert.equal((await make(store, admin, 'https://example.com/secret')).status, 400);
  assert.equal(store.map.size, 0);
});

test('rejects cross-origin management request', async () => {
  const store = kv();
  const req = new Request('https://example.test/jms/manage', { method:'POST', headers:{ Origin:'https://evil.test', 'Content-Type':'application/json', 'X-JMS-Admin-Key':admin }, body:JSON.stringify({ subscription:source, bandwidth }) });
  const res = await onRequest({ request:req, env:{ JMS_ADMIN_KEY:admin, JMS_CONFIGS:store }, params:{ path:['manage'] } });
  assert.equal(res.status, 403);
  assert.equal(store.map.size, 0);
});

test('usage failure still returns a configuration without invented usage', async () => {
  const store = kv();
  const { token } = await (await make(store)).json();
  const original = globalThis.fetch;
  globalThis.fetch = async url => new URL(url).hostname === 'api.asailor.org' ? new Response(JSON.stringify(raw)) : new Response('unavailable', { status:503 });
  try {
    const response = await onRequest({ request:new Request(`https://example.test/jms/${token}`), env:{JMS_ADMIN_KEY:admin,JMS_CONFIGS:store}, params:{path:[token]} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('subscription-userinfo'), null);
  } finally { globalThis.fetch = original; }
});

test('creates encrypted record, produces subscription and revokes access', async () => {
  const store = kv();
  const made = await make(store);
  assert.equal(made.status, 201);
  const { token } = await made.json();
  const stored = [...store.map.values()][0];
  assert.ok(!stored.includes('jmssub.net') && !stored.includes('fake'));
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = new URL(url);
    if (u.hostname === 'api.asailor.org') { assert.equal(u.searchParams.get('udp'), 'true'); return new Response(JSON.stringify(raw)); }
    if (u.hostname === 'justmysocks6.net') return Response.json({ monthly_bw_limit_b: 1000, bw_counter_b: 100, bw_reset_day_of_month: 3 });
    throw new Error('unexpected host');
  };
  const env = { JMS_ADMIN_KEY:admin, JMS_CONFIGS:store };
  const ctx = method => ({ request: new Request(`https://example.test/jms/${token}`, { method, headers: method === 'DELETE' ? { Origin:'https://example.test', 'X-JMS-Admin-Key':admin } : {} }), env, params: { path:[token] } });
  try {
    const res = await onRequest(ctx('GET'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('subscription-userinfo'), /^upload=0; download=100; total=1000; expire=\d+$/);
    const body = await res.text();
    assert.ok(!body.includes('jmssub.net'));
    assert.match(load(body)['proxy-providers'].test.url, /\/provider$/);
    assert.equal((await onRequest(ctx('DELETE'))).status, 204);
    assert.equal((await onRequest(ctx('GET'))).status, 404);
  } finally { globalThis.fetch = original; }
});
