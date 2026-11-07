const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const START = Date.parse('2026-11-07T22:29:30Z');
const BOUNDARY = Date.parse('2026-11-07T22:30:00Z');

// Only browser facilities are simulated; the actual production script owns all
// rendering, request lifecycle, response validation and timer decisions.
function browser() {
  let wall = START, mono = 0, nextId = 0;
  const nodes = new Map(), handlers = new Map(), timers = new Map(), intervals = [], scripts = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: false, style: {}, dataset: {}, events: {}, classList: { add() {}, remove() {} }, setAttribute(k,v) { this[k] = v; }, removeAttribute(k) { delete this[k]; }, addEventListener(k,fn) { this.events[k] = fn; }, querySelector() { return node('button-label'); } });
    return nodes.get(id);
  }
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [wall])); } static now() { return wall; } }
  const document = { readyState: 'complete', visibilityState: 'visible', currentScript: null, body: node('body'), getElementById: node, querySelector: node, addEventListener(k,fn) { handlers.set(k,fn); }, createElement() { return { remove() { this.removed = true; } }; }, head: { appendChild(s) { scripts.push(s); } } };
  const ctx = { document, Date: FakeDate, performance: { now: () => mono }, navigator: { onLine: true }, location: { pathname: '/index.html' }, URL, Intl,
    NHA_TRO_CONFIG: { endpoint: 'https://script.google.com/macros/s/test/exec' },
    addEventListener(k,fn) { handlers.set(k,fn); },
    setTimeout(fn,ms) { timers.set(++nextId,{fn,ms}); return nextId; }, clearTimeout(id) { timers.delete(id); }, setInterval(fn) { intervals.push(fn); }
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx);
  return { node, scripts, timers, ctx,
    advance(wallMs, monoMs=wallMs) { wall += wallMs; mono += monoMs; },
    event(name, event={}) { handlers.get(name)(event); },
    tick() { intervals.forEach(fn=>fn()); },
    click() { node('refresh').events.click(); },
    runDelay(ms) { const entry = [...timers].find(([,v])=>v.ms===ms); assert.ok(entry, `timer ${ms} exists`); timers.delete(entry[0]); entry[1].fn(); },
    respond(data, script=scripts.at(-1)) { document.currentScript=script; ctx.NhaTro25.receive(data); document.currentScript=null; },
    data(now=wall, person='tam') { return { schemaVersion: 1, status: 'ok', serverNow: new Date(now).toISOString(), generatedAt: new Date(now).toISOString(), timezone: 'Asia/Ho_Chi_Minh', validUntil: new Date(Math.min(now+60000, now<BOUNDARY?BOUNDARY:BOUNDARY+86400000)).toISOString(), shift: { person, name: person==='tam'?'Mr. Tâm':'Mr. Diệu', start: new Date(now<BOUNDARY?BOUNDARY-86400000:BOUNDARY).toISOString(), end: new Date(now<BOUNDARY?BOUNDARY:BOUNDARY+86400000).toISOString() } }; }
  };
}
function noCurrentName(b) { assert.ok(!['Mr. Tâm','Mr. Diệu'].includes(b.node('person-name').textContent), 'obsolete person must not remain current'); }

test('resume clears pre-sleep current person before fresh request completes', () => {
  const b=browser(); b.respond(b.data()); assert.equal(b.node('person-name').textContent,'Mr. Tâm');
  b.advance(120000,0); b.event('visibilitychange'); noCurrentName(b);
  assert.equal(b.scripts.length,2); assert.equal(b.node('refresh').disabled,true);
  b.respond(b.data(START+120000,'dieu')); assert.equal(b.node('person-name').textContent,'Mr. Diệu');
});
test('resume cancels a pending pre-sleep script and rejects its late callback', () => {
  const b=browser(), old=b.scripts[0], stale=b.data();
  b.advance(120000,0); b.event('visibilitychange');
  assert.equal(old.removed,true); assert.equal(b.scripts.length,2);
  b.respond(stale,old); noCurrentName(b);
  b.respond(b.data(START+120000,'dieu')); assert.equal(b.node('person-name').textContent,'Mr. Diệu');
});
test('visibility resume requires a fresh server anchor even when both clocks agree', () => {
  const b=browser(); b.respond(b.data()); b.advance(1000);
  b.ctx.document.visibilityState='hidden'; b.event('visibilitychange'); assert.equal(b.scripts.length,1);
  b.ctx.document.visibilityState='visible'; b.event('visibilitychange'); noCurrentName(b); assert.equal(b.scripts.length,2);
});
test('BFCache pageshow clears current identity before resynchronizing', () => {
  const b=browser(); b.respond(b.data()); b.event('pagehide'); b.advance(120000,0);
  b.event('pageshow',{persisted:true}); noCurrentName(b); assert.equal(b.scripts.length,2);
});
test('timer detects sleep with a paused monotonic clock even without visibility event', () => {
  const b=browser(); b.respond(b.data()); b.advance(120000,0); b.tick(); noCurrentName(b);
  assert.equal(b.node('clock').textContent,'--:--:--', 'changed wall clock is not treated as authoritative server time');
  b.runDelay(0); assert.equal(b.scripts.length,2);
});
test('response from a request spanning sleep is rejected even without resume or tick', () => {
  const b=browser(), old=b.scripts[0], stale=b.data(); b.advance(120000,0); b.respond(stale);
  noCurrentName(b); assert.equal(old.removed,true); b.runDelay(0); assert.equal(b.scripts.length,2);
});
test('backward device-clock change fails closed then accepts a new server anchor', () => {
  const b=browser(); b.respond(b.data()); b.advance(-3600000,1000); b.tick(); noCurrentName(b);
  b.runDelay(0); b.respond(b.data(START+1000)); assert.equal(b.node('person-name').textContent,'Mr. Tâm');
  assert.equal(b.node('clock').dateTime,'2026-11-07T22:29:31.000Z');
});
test('ordinary server-clock expiry removes name before new data arrives', () => {
  const b=browser(); b.respond(b.data()); b.advance(30000); b.tick(); noCurrentName(b); b.runDelay(0);
  assert.equal(b.scripts.length,2);
});
test('expired and stale generated responses never show a current person', () => {
  const b=browser(); const expired=b.data(); expired.validUntil=expired.serverNow; b.respond(expired); noCurrentName(b);
  b.click(); const stale=b.data(); stale.generatedAt=new Date(START-120001).toISOString(); b.respond(stale); noCurrentName(b);
});
test('response which expires during request transit is rejected', () => {
  const b=browser(), data=b.data(); data.validUntil=new Date(START+1000).toISOString(); b.advance(3000); b.respond(data); noCurrentName(b);
});
test('manual refresh suppresses overlaps and late scripts cannot satisfy it', () => {
  const b=browser(), old=b.scripts[0]; b.click(); assert.equal(b.scripts.length,1);
  b.respond(b.data()); assert.equal(b.node('refresh').disabled,false); assert.equal(old.removed,true);
  b.click(); b.click(); assert.equal(b.scripts.length,2); assert.equal(b.node('refresh').disabled,true);
  b.respond(b.data(),old); assert.equal(b.node('refresh').disabled,true);
  b.respond(b.data()); assert.equal(b.node('refresh').disabled,false);
});
test('offline clears name, cancels transport, and online starts fresh', () => {
  const b=browser(); b.respond(b.data()); b.click(); const old=b.scripts.at(-1);
  b.ctx.navigator.onLine=false; b.event('offline'); noCurrentName(b); assert.equal(old.removed,true);
  b.respond(b.data(),old); noCurrentName(b); b.click(); assert.equal(b.scripts.length,2);
  b.ctx.navigator.onLine=true; b.event('online'); assert.equal(b.scripts.length,3);
  b.respond(b.data()); assert.equal(b.node('person-name').textContent,'Mr. Tâm');
});
test('timeout and script transport errors clear name and retain retry', () => {
  const b=browser(); b.respond(b.data()); b.click(); const old=b.scripts.at(-1);
  b.runDelay(12000); noCurrentName(b); assert.equal(old.removed,true); b.runDelay(5000);
  const retry=b.scripts.at(-1); retry.onerror(); noCurrentName(b); assert.equal(retry.removed,true); b.runDelay(15000);
  assert.equal(b.scripts.length,4);
});
