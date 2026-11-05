import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapt, onRequest } from '../functions/jms/[[path]].js';
import { load } from 'js-yaml';

const token = 'a'.repeat(48);
const env = { JMS_ACCESS_TOKEN: token, JMS_SUBSCRIPTION_URL: 'https://jmssub.net/members/getsub.php?service=0&id=fake&format=clash', JMS_BANDWIDTH_URL: 'https://justmysocks6.net/members/getbwcounter.php?service=0&id=fake' };
const raw = { 'proxy-providers': { test: { type: 'http', url: env.JMS_SUBSCRIPTION_URL } }, 'proxy-groups': [{ name: '🇭🇰 香港节点', type: 'select' }, { name: '🇺🇸 美国节点', type: 'select', proxies: ['🇭🇰 香港节点'] }, { name: 'manual', type: 'select', proxies: ['🇭🇰 香港节点', '🇺🇸 美国节点'] }] };

test('adapts groups and removes credentials from provider', () => {
  const cfg = adapt(structuredClone(raw), 'https://example.test/jms/token/provider');
  assert.equal(cfg['proxy-providers'].test.url, 'https://example.test/jms/token/provider');
  assert.equal(cfg['proxy-providers'].test.override.udp, true);
  assert.deepEqual(cfg['proxy-groups'].find(g => g.name === 'manual').proxies, ['🇺🇸 美国节点']);
  assert.equal(cfg['proxy-groups'].find(g => g.name === '🇯🇵 日本节点').filter, 's4[.]');
  assert.equal(cfg['proxy-groups'].some(g => g.name === '🇭🇰 香港节点'), false);
});

test('rejects unauthenticated requests and returns no sensitive details', async () => {
  const res = await onRequest({ request: new Request('https://example.test/jms/wrong'), env, params: { path: ['wrong'] } });
  assert.equal(res.status, 404);
});

test('adds usage and proxies upstream credentials safely', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.asailor.org') return new Response(JSON.stringify(raw));
    if (u.hostname === 'justmysocks6.net') return Response.json({ monthly_bw_limit_b: 1000, bw_counter_b: 100, bw_reset_day_of_month: 3 });
    throw new Error('unexpected host');
  };
  try {
    const res = await onRequest({ request: new Request(`https://example.test/jms/${token}`), env, params: { path: [token] } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('subscription-userinfo'), /^upload=0; download=100; total=1000; expire=\d+$/);
    const body = await res.text();
    assert.ok(!body.includes('jmssub.net'));
    assert.match(load(body)['proxy-providers'].test.url, /\/provider$/);
  } finally { globalThis.fetch = original; }
});
