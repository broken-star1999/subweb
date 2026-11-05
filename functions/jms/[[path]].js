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
  for (const p of Object.values(providers)) { p.url = providerUrl; p.override = { ...(p.override || {}), udp: true }; }
  config.proxies = (config.proxies || []).map(p => ['vless', 'ss'].includes(p.type) ? { ...p, udp: true } : p);
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
  if (!['GET', 'HEAD'].includes(request.method) || parts.length < 1 || parts.length > 2 || (parts[1] && parts[1] !== 'provider')) return new Response('Not found', { status: 404, headers: NO_STORE });
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(env.JMS_ACCESS_TOKEN || '') || !(await sameSecret(parts[0], env.JMS_ACCESS_TOKEN))) return new Response('Not found', { status: 404, headers: NO_STORE });
  try {
    const source = trusted(env.JMS_SUBSCRIPTION_URL, ['jmssub.net', 'jjsubmarines.com']);
    const api = trusted(env.JMS_BANDWIDTH_URL, ['justmysocks6.net']);
    const origin = new URL(request.url).origin;
    const providerUrl = `${origin}/jms/${encodeURIComponent(parts[0])}/provider`;
    if (parts[1] === 'provider') {
      const result = await fetch(source.toString(), { redirect: 'error', headers: { 'User-Agent': 'clash-verge/v2.4.5' } });
      const body = await readLimited(result);
      return new Response(request.method === 'HEAD' ? null : body, { headers: { ...NO_STORE, 'Content-Type': 'text/yaml; charset=utf-8' } });
    }
    const converter = new URL('https://api.asailor.org/sub');
    converter.search = new URLSearchParams({ target: 'clash', url: source.toString(), config: TEMPLATE }).toString();
    const [converted, usage] = await Promise.allSettled([
      fetch(converter.toString(), { redirect: 'error' }).then(r => readLimited(r)),
      fetch(api.toString(), { redirect: 'error' }).then(r => readLimited(r, 16384)).then(JSON.parse),
    ]);
    if (converted.status !== 'fulfilled') throw new Error('conversion failed');
    const config = adapt(load(converted.value), providerUrl);
    const headers = { ...NO_STORE, 'Content-Type': 'text/yaml; charset=utf-8' };
    if (usage.status === 'fulfilled') {
      const { monthly_bw_limit_b: total, bw_counter_b: used, bw_reset_day_of_month: day } = usage.value;
      if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(used) && used >= 0) {
        const reset = resetTime(day);
        headers['subscription-userinfo'] = `upload=0; download=${used}; total=${total}${reset ? `; expire=${reset}` : ''}`;
      }
    }
    return new Response(request.method === 'HEAD' ? null : dump(config, { noRefs: true, lineWidth: -1 }), { headers });
  } catch {
    return new Response('JMS subscription temporarily unavailable', { status: 502, headers: NO_STORE });
  }
}
