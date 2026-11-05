import { load, dump } from 'js-yaml';

const REMOVED = new Set(['🇭🇰 香港节点','🇸🇬 新加坡节点','🇼🇸 台湾节点','🇹🇼 台湾节点','🇰🇷 韩国节点','🇨🇦 加拿大节点','🇬🇧 英国节点','🇫🇷 法国节点','🇩🇪 德国节点','🇹🇷 土耳其节点','🇷🇺 俄罗斯节点','🌐 其他地区','🏠 家宽节点']);
const GROUPS = [['🇺🇸 美国节点','s[23][.]'],['🇯🇵 日本节点','s4[.]'],['🇳🇱 荷兰节点','s5[.]'],['🐢 低倍率节点','s801[.]']];
const NO_STORE = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };

function trusted(raw, hosts) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname) || u.username || u.password || u.port) throw new Error('invalid configuration');
  return u;
}

async function readLimited(response, max = 1024 * 1024) {
  if (!response.ok) throw new Error(`upstream-http-${response.status}`);
  if (!response.body) throw new Error('upstream-empty');
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

export function adapt(config) {
  if (!config || typeof config !== 'object' || !config['proxy-providers'] || !Array.isArray(config['proxy-groups'])) throw new Error('unexpected configuration');
  const providers = config['proxy-providers'];
  const keys = Object.keys(providers);
  if (keys.length !== 1) throw new Error('unexpected provider count');
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
  const { request, params } = context;
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  if (!['GET', 'HEAD'].includes(request.method) || parts.length !== 1 || parts[0] !== 'convert') return new Response('Not found', { status: 404, headers: NO_STORE });
  let converter, source, api;
  try {
    const incoming = new URL(request.url);
    converter = trusted(incoming.searchParams.get('converter'), ['api.asailor.org']);
    const sourceArg = converter.searchParams.get('url') || '';
    const sourceIndex = sourceArg.indexOf('https://');
    const prefix = sourceArg.slice(0, sourceIndex);
    if (sourceIndex < 0 || sourceArg.includes('|') || !/^(?:(?:tag|provider|interval|proxy_direct):[^,\r\n]+,)*$/.test(prefix)) return new Response('Invalid JMS source', { status: 400, headers: NO_STORE });
    source = trusted(sourceArg.slice(sourceIndex), ['jmssub.net', 'jjsubmarines.com']);
    const bandwidth = incoming.searchParams.get('bandwidth');
    api = bandwidth ? trusted(bandwidth, ['justmysocks6.net']) : null;
    if (converter.pathname !== '/sub' || converter.searchParams.get('target') !== 'clash' || source.pathname !== '/members/getsub.php' || source.searchParams.get('format') !== 'clash' || (api && api.pathname !== '/members/getbwcounter.php')) return new Response('Invalid JMS addresses', { status: 400, headers: NO_STORE });
    converter.searchParams.set('udp', 'true');
  } catch {
    return new Response('Invalid JMS addresses', { status: 400, headers: NO_STORE });
  }
  try {
    const [converted, usage] = await Promise.allSettled([
      fetch(converter.toString(), { redirect: 'manual' }).then(r => readLimited(r)),
      api ? fetch(api.toString(), { redirect: 'manual' }).then(r => readLimited(r, 16384)).then(JSON.parse) : Promise.resolve(null),
    ]);
    if (converted.status !== 'fulfilled') throw new Error('conversion failed');
    const config = adapt(load(converted.value));
    if (!Object.values(config['proxy-providers']).every(p => p.override?.udp === true)) throw new Error('UDP override missing');
    const headers = { ...NO_STORE, 'Content-Type': 'text/yaml; charset=utf-8' };
    if (usage.status === 'fulfilled' && usage.value && typeof usage.value === 'object') {
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
