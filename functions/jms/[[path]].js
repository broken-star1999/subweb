import { load, dump } from 'js-yaml';

const TEMPLATE = 'https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/Custom_Clash_Full.ini';
const REMOVED = new Set(['🇭🇰 香港节点','🇸🇬 新加坡节点','🇼🇸 台湾节点','🇹🇼 台湾节点','🇰🇷 韩国节点','🇨🇦 加拿大节点','🇬🇧 英国节点','🇫🇷 法国节点','🇩🇪 德国节点','🇹🇷 土耳其节点','🇷🇺 俄罗斯节点','🌐 其他地区','🏠 家宽节点']);
const GROUPS = [['🇺🇸 美国节点','s[23][.]'],['🇯🇵 日本节点','s4[.]'],['🇳🇱 荷兰节点','s5[.]'],['🐢 低倍率节点','s801[.]']];
const NO_STORE = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };

async function sameSecret(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const left = new Uint8Array(x), right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array((s.match(/../g) || []).map(x => parseInt(x, 16)));
async function tokenId(token) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))); }
async function cipherKey(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('jms-encryption-v1:' + token));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(token, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cipherKey(token), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ version: 1, iv: hex(iv), data: hex(new Uint8Array(ciphertext)) });
}
async function unseal(token, value) {
  const record = JSON.parse(value);
  if (record.version !== 1 || !/^[0-9a-f]{24}$/.test(record.iv) || !/^[0-9a-f]+$/.test(record.data)) throw new Error('invalid record');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(record.iv) }, await cipherKey(token), unhex(record.data));
  return JSON.parse(decoder.decode(plain));
}

function trusted(raw, hosts) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname) || u.username || u.password || u.port) throw new Error('invalid configuration');
  return u;
}

async function readLimited(response, max = 1024 * 1024) {
  if (!response.ok || !response.body) throw new Error('upstream failed');
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); throw new Error('upstream too large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder().decode(bytes);
}

function resetTime(day, now = new Date()) {
  if (!Number.isInteger(day) || day < 1 || day > 28) return null;
  const tz = 'America/Los_Angeles';
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
  const fields = (d) => Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const current = fields(now);
  let year = Number(current.year), month = Number(current.month);
  if (Number(current.day) >= day) { if (++month === 13) { month = 1; year++; } }
  const localMidnight = Date.UTC(year, month - 1, day);
  let candidate = localMidnight;
  for (let i = 0; i < 3; i++) {
    const f = fields(new Date(candidate));
    const represented = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second);
    candidate += localMidnight - represented;
  }
  return Math.floor(candidate / 1000);
}

export function adapt(config, providerUrl) {
  if (!config || typeof config !== 'object' || !config['proxy-providers'] || !Array.isArray(config['proxy-groups'])) throw new Error('unexpected configuration');
  const providers = config['proxy-providers'];
  const keys = Object.keys(providers);
  if (keys.length !== 1) throw new Error('unexpected provider count');
  for (const p of Object.values(providers)) p.url = providerUrl;
  let groups = config['proxy-groups'].filter(g => !REMOVED.has(g.name)).map(g => Array.isArray(g.proxies) ? { ...g, proxies: g.proxies.filter(n => !REMOVED.has(n)) } : g);
  for (const [name, filter] of GROUPS) {
    let group = groups.find(g => g.name === name);
    if (!group) { group = { name }; groups.push(group); }
    delete group.proxies;
    Object.assign(group, { type: 'url-test', filter, 'disable-udp': false, url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 50, 'include-all-proxies': true, use: keys });
  }
  config['proxy-groups'] = groups;
  return config;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  if (parts.length === 1 && parts[0] === 'manage' && request.method === 'POST') {
    if (!env.JMS_CONFIGS || !/^[A-Za-z0-9_-]{32,128}$/.test(env.JMS_ADMIN_KEY || '')) return new Response('Service not configured', { status: 503, headers: NO_STORE });
    if (request.headers.get('Origin') !== new URL(request.url).origin || !(await sameSecret(request.headers.get('X-JMS-Admin-Key'), env.JMS_ADMIN_KEY))) return new Response('Forbidden', { status: 403, headers: NO_STORE });
    try {
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('invalid content type');
      const body = await readLimited(new Response(request.body), 8192);
      const input = JSON.parse(body);
      const source = trusted(input.subscription, ['jmssub.net', 'jjsubmarines.com']);
      const api = trusted(input.bandwidth, ['justmysocks6.net']);
      if (source.pathname !== '/members/getsub.php' || api.pathname !== '/members/getbwcounter.php' || source.searchParams.get('format') !== 'clash') throw new Error('invalid input');
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      await env.JMS_CONFIGS.put(await tokenId(token), await seal(token, { subscription: source.toString(), bandwidth: api.toString() }));
      return Response.json({ token }, { status: 201, headers: NO_STORE });
    } catch { return new Response('Unable to save configuration', { status: 400, headers: NO_STORE }); }
  }
  if (!['GET', 'HEAD', 'DELETE'].includes(request.method) || parts.length < 1 || parts.length > 2 || (parts[1] && parts[1] !== 'provider')) return new Response('Not found', { status: 404, headers: NO_STORE });
  if (!/^[a-f0-9]{64}$/.test(parts[0]) || !env.JMS_CONFIGS) return new Response('Not found', { status: 404, headers: NO_STORE });
  let stage = 'configuration';
  try {
    const id = await tokenId(parts[0]);
    if (request.method === 'DELETE') {
      if (parts.length !== 1 || request.headers.get('Origin') !== new URL(request.url).origin || !(await sameSecret(request.headers.get('X-JMS-Admin-Key'), env.JMS_ADMIN_KEY))) return new Response('Forbidden', { status: 403, headers: NO_STORE });
      await env.JMS_CONFIGS.delete(id);
      return new Response(null, { status: 204, headers: NO_STORE });
    }
    stage = 'storage';
    const stored = await env.JMS_CONFIGS.get(id);
    if (!stored) return new Response('Not found', { status: 404, headers: NO_STORE });
    stage = 'decrypt';
    const saved = await unseal(parts[0], stored);
    const source = trusted(saved.subscription, ['jmssub.net', 'jjsubmarines.com']);
    const api = trusted(saved.bandwidth, ['justmysocks6.net']);
    const origin = new URL(request.url).origin;
    const providerUrl = `${origin}/jms/${encodeURIComponent(parts[0])}/provider`;
    if (parts[1] === 'provider') {
      const result = await fetch(source.toString(), { redirect: 'error', headers: { 'User-Agent': 'clash-verge/v2.4.5' } });
      const body = await readLimited(result);
      return new Response(request.method === 'HEAD' ? null : body, { headers: { ...NO_STORE, 'Content-Type': 'text/yaml; charset=utf-8' } });
    }
    const converter = new URL('https://api.asailor.org/sub');
    converter.search = new URLSearchParams({ target: 'clash', url: source.toString(), config: TEMPLATE, udp: 'true' }).toString();
    stage = 'upstream';
    const [converted, usage] = await Promise.allSettled([
      fetch(converter.toString(), { redirect: 'error' }).then(r => readLimited(r)),
      fetch(api.toString(), { redirect: 'error' }).then(r => readLimited(r, 16384)).then(JSON.parse),
    ]);
    if (converted.status !== 'fulfilled') throw new Error('conversion failed');
    stage = 'adapt';
    const config = adapt(load(converted.value), providerUrl);
    if (!Object.values(config['proxy-providers']).every(p => p.override?.udp === true)) throw new Error('UDP override missing');
    const headers = { ...NO_STORE, 'Content-Type': 'text/yaml; charset=utf-8' };
    if (usage.status === 'fulfilled') {
      const { monthly_bw_limit_b: total, bw_counter_b: used, bw_reset_day_of_month: day } = usage.value;
      if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(used) && used >= 0) {
        const reset = resetTime(day);
        headers['subscription-userinfo'] = `upload=0; download=${used}; total=${total}${reset ? `; expire=${reset}` : ''}`;
      }
    }
    stage = 'serialize';
    return new Response(request.method === 'HEAD' ? null : dump(config, { noRefs: true, lineWidth: -1 }), { headers });
  } catch {
    return new Response('JMS subscription temporarily unavailable', { status: 502, headers: env.JMS_PREVIEW_DIAGNOSTICS === 'true' ? { ...NO_STORE, 'X-JMS-Stage': stage } : NO_STORE });
  }
}
