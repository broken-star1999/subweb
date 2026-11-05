import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapt, onRequest } from '../functions/jms/[[path]].js';

const source='https://jmssub.net/members/getsub.php?service=0&id=fake&format=clash';
const bandwidth='https://justmysocks6.net/members/getbwcounter.php?service=0&id=fake';
const raw={ 'proxy-providers':{test:{type:'http',url:source,override:{udp:true}}}, 'proxy-groups':[{name:'🇭🇰 香港节点',type:'select'},{name:'🇺🇸 美国节点',type:'select',proxies:['🇭🇰 香港节点']},{name:'manual',type:'select',proxies:['🇭🇰 香港节点','🇺🇸 美国节点']}] };
function request(withApi=true, upstreamSource=source) {
  const converter=new URL('https://api.asailor.org/sub');
  converter.search=new URLSearchParams({target:'clash',url:upstreamSource,config:'https://example.test/template.ini',udp:'true'});
  const local=new URL('https://example.test/jms/convert');local.searchParams.set('converter',converter.href);
  if(withApi)local.searchParams.set('bandwidth',bandwidth);
  return onRequest({request:new Request(local),params:{path:['convert']}});
}
test('preserves source and adapts groups',()=>{const c=adapt(structuredClone(raw));assert.equal(c['proxy-providers'].test.url,source);assert.deepEqual(c['proxy-groups'].find(g=>g.name==='manual').proxies,['🇺🇸 美国节点']);assert.equal(c['proxy-groups'].find(g=>g.name==='🇯🇵 日本节点').filter,'s4[.]');});
test('rejects a source outside the approved JMS hosts',async()=>{assert.equal((await request(false,'https://example.com/private')).status,400);});
test('works with and without usage API',async()=>{const original=globalThis.fetch;let apiCalls=0;globalThis.fetch=async u=>{const url=new URL(u);if(url.hostname==='api.asailor.org'){assert.equal(url.searchParams.get('udp'),'true');return new Response(JSON.stringify(raw));} if(url.hostname==='justmysocks6.net'){apiCalls++;return Response.json({monthly_bw_limit_b:1000,bw_counter_b:100,bw_reset_day_of_month:3});}throw Error('unexpected');};try{let a=await request(false);assert.equal(a.status,200);assert.equal(a.headers.get('subscription-userinfo'),null);assert.equal(apiCalls,0);let b=await request(true);assert.equal(b.status,200);assert.match(b.headers.get('subscription-userinfo'),/^upload=0; download=100; total=1000; expire=\d+$/);}finally{globalThis.fetch=original;}});
test('usage failure never invents usage',async()=>{const original=globalThis.fetch;globalThis.fetch=async u=>new URL(u).hostname==='api.asailor.org'?new Response(JSON.stringify(raw)):new Response('',{status:503});try{const r=await request();assert.equal(r.status,200);assert.equal(r.headers.get('subscription-userinfo'),null);}finally{globalThis.fetch=original;}});
test('does not return configuration when backend omits requested UDP override',async()=>{const original=globalThis.fetch;const missing=structuredClone(raw);delete missing['proxy-providers'].test.override;globalThis.fetch=async()=>new Response(JSON.stringify(missing));try{assert.equal((await request(false)).status,502);}finally{globalThis.fetch=original;}});
