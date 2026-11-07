const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../apps-script/Code.gs');
function provider(overrides = {}) {
  const context = vm.createContext({ console, ...overrides });
  if (fs.existsSync(sourcePath)) vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
  return context;
}
const headers = ['', '', 'Anh Tâm', 'Chú Diệu'];
const rows = [headers,
  ['06/11/2026', '5:30am 06/11 - 5:30am 07/11', 'x', ''],
  ['07/11/2026', '5:30am 07/11 - 5:30am 08/11', '', 'x'],
  ['08/11/2026', '5:30am 08/11 - 5:30am 09/11', 'x', '']
];
const read = (data, when) => {
  const api = provider();
  assert.equal(typeof api.getShiftForRows, 'function', 'provider must expose its actual shift resolver');
  return JSON.parse(JSON.stringify(api.getShiftForRows(data, new Date(when))));
};

test('05:29:59 Vietnam still belongs to the preceding date', () => {
  const result = read(rows, '2026-11-07T05:29:59+07:00');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.shift, {person:'tam', name:'Mr. Tâm', start:'2026-11-05T22:30:00.000Z', end:'2026-11-06T22:30:00.000Z'});
});
test('exactly 05:30 changes duty to the x assignment for the new day', () => {
  const result = read(rows, '2026-11-07T05:30:00+07:00');
  assert.deepEqual(result.shift, {person:'dieu', name:'Mr. Diệu', start:'2026-11-06T22:30:00.000Z', end:'2026-11-07T22:30:00.000Z'});
});
test('the end of a shift is excluded and the following shift takes over', () => {
  assert.equal(read(rows, '2026-11-08T05:30:00+07:00').shift.person, 'tam');
});
test('assignments are read from the sheet rather than inferred by alternation', () => {
  const changed = rows.map(row => [...row]);
  changed[2][2] = ' X '; changed[2][3] = '';
  assert.equal(read(changed, '2026-11-07T19:00:00+07:00').shift.name, 'Mr. Tâm');
});
test('month/year rollover is based on real dates', () => {
  const data = [headers, ['31/12/2026','5:30am 31/12 - 5:30am 01/01','','x'], ['01/01/2027','5:30am 01/01 - 5:30am 02/01','x','']];
  const result = read(data, '2027-01-01T04:00:00+07:00');
  assert.equal(result.shift.person, 'dieu');
  assert.equal(result.shift.end, '2026-12-31T22:30:00.000Z');
});
test('leap day works without 28-day or 30-day assumptions', () => {
  const result = read([headers, ['29/02/2028','5:30am 29/02 - 5:30am 01/03','x','']], '2028-03-01T04:00:00+07:00');
  assert.equal(result.status, 'ok');
  assert.equal(result.shift.end, '2028-02-29T22:30:00.000Z');
});
test('a missing day never borrows an old or future duty assignment', () => {
  assert.equal(read(rows, '2026-11-12T12:00:00+07:00').status, 'no_shift');
});
for (const [label, tam, dieu] of [['no x','',''],['two x','x','x'],['unrecognized mark','?','']]) {
  test(label + ' never returns a current person', () => {
    const result = read([headers, ['07/11/2026','5:30am 07/11 - 5:30am 08/11',tam,dieu]], '2026-11-07T10:00:00+07:00');
    assert.equal(result.status, 'invalid_roster');
    assert.equal(result.shift, undefined);
  });
}
test('duplicate rows for the same day are ambiguous even when names match', () => {
  assert.equal(read([...rows, [...rows[2]]], '2026-11-07T10:00:00+07:00').status, 'invalid_roster');
});
test('unknown header does not silently attach an approved name to an unknown person', () => {
  assert.equal(read([['','','Người khác','Chú Diệu'], ...rows.slice(1)], '2026-11-07T10:00:00+07:00').status, 'invalid_roster');
});
test('a changed shift time in column B is flagged instead of silently showing 05:30', () => {
  assert.equal(read([headers, ['07/11/2026','6:00am 07/11 - 6:00am 08/11','','x']], '2026-11-07T10:00:00+07:00').status, 'invalid_roster');
});
test('invalid calendar dates are not normalized into a different day', () => {
  assert.equal(read([headers, ['31/11/2026','5:30am 31/11 - 5:30am 01/12','','x']], '2026-12-01T10:00:00+07:00').status, 'invalid_roster');
});
test('swapping the two person columns preserves the meaning of the actual headers', () => {
  const data = [['','','Chú Diệu','Anh Tâm'], ['07/11/2026','5:30am 07/11 - 5:30am 08/11','x','']];
  assert.equal(read(data, '2026-11-07T19:00:00+07:00').shift.name, 'Mr. Diệu');
});
test('response freshness is capped by the shift boundary', () => {
  const api = provider();
  assert.equal(typeof api.buildResponse, 'function');
  const result = api.buildResponse(rows, new Date('2026-11-08T05:29:50+07:00'));
  assert.equal(result.validUntil, '2026-11-07T22:30:00.000Z');
  assert.equal(result.serverNow, '2026-11-07T22:29:50.000Z');
  assert.equal(result.schemaVersion, 1);
});
function outputService() {
  return {MimeType:{JSON:'json',JAVASCRIPT:'javascript'}, createTextOutput(body){return {body,setMimeType(mime){this.mime=mime;return this;}};}};
}
test('a source read failure returns an unavailable state without leaking internals', () => {
  const api = provider({ContentService:outputService(), PropertiesService:{getScriptProperties(){return {getProperty(){return 'test-sheet';}};}}, SpreadsheetApp:{openById(){throw new Error('private server details');}}});
  assert.equal(typeof api.doGet, 'function');
  const result = api.doGet({parameter:{}});
  const payload = JSON.parse(result.body);
  assert.equal(payload.status, 'unavailable');
  assert.equal(payload.shift, undefined);
  assert.equal(result.body.includes('private server details'), false);
});
test('Google adapter reads the configured source using read-only Sheets API and publishes no raw rows', () => {
  const api = provider({
    ContentService:outputService(),
    PropertiesService:{getScriptProperties(){return {getProperty(key){assert.equal(key,'ROSTER_SPREADSHEET_ID');return 'allowed-sheet';}};}},
    Sheets:{Spreadsheets:{
      get(id, options){assert.equal(id,'allowed-sheet');assert.equal(options.fields,'sheets.properties');return {sheets:[{properties:{sheetId:0,title:"Lịch 'trực'"}}]};},
      Values:{get(id, range, options){assert.equal(id,'allowed-sheet');assert.equal(range,"'Lịch ''trực'''!A:D");assert.equal(options.valueRenderOption,'FORMATTED_VALUE');return {values:rows};}}
    }}
  });
  const result = JSON.parse(api.doGet({parameter:{spreadsheetId:'untrusted-other-sheet'}}).body);
  assert.notEqual(result.status,'unavailable');
  assert.equal(result.rows,undefined);
  assert.equal(result.spreadsheetId,undefined);
  assert.equal(result.source,undefined);
});
test('caller-selected JSONP functions cannot turn provider output into executable input', () => {
  const api = provider({ContentService:outputService()});
  assert.equal(typeof api.encodeResponse, 'function');
  const result = api.encodeResponse({status:'unavailable'}, 'alert(1)//');
  assert.equal(result.mime, 'json');
  assert.doesNotMatch(result.body, /alert/);
});
test('the one supported JSONP callback produces executable fixed-name data only', () => {
  const api = provider({ContentService:outputService()});
  assert.equal(typeof api.encodeResponse, 'function');
  const output = api.encodeResponse({status:'unavailable',test:'</script>\u2028'}, 'NhaTro25.receive');
  assert.equal(output.mime, 'javascript');
  assert.doesNotMatch(output.body, /<\/script>/);
  let received;
  vm.runInNewContext(output.body, {NhaTro25:{receive(data){received=data;}}});
  assert.equal(received.test, '</script>\u2028');
});
