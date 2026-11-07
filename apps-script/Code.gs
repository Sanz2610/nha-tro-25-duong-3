/*
 * Nhà trọ 25 đường 3 — chỉ xuất người đang trực.
 * Gắn vào chính bảng lịch. Thêm Script Property ROSTER_SPREADSHEET_ID.
 * Bật dịch vụ Google Sheets v4. Chỉ yêu cầu quyền spreadsheets.readonly.
 * Không công khai bảng gốc. Không ghi dữ liệu vào bảng.
 */

function normalizePerson_(value) {
  const name = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').trim().toLowerCase();
  if (['anh tam', 'mr. tam', 'tam'].indexOf(name) !== -1) return 'tam';
  if (['chu dieu', 'mr. dieu', 'dieu'].indexOf(name) !== -1) return 'dieu';
  return null;
}

function parseRosterDate_(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  if (year < 2000 || year > 2100) return null;
  const midnight = Date.UTC(year, month - 1, day);
  const check = new Date(midnight);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  // Vietnam has a fixed UTC+7 offset for this roster's supported years.
  return {midnight:midnight, start:midnight - 90 * 60000};
}

function validShiftLabel_(label, midnight) {
  const match = String(label || '').trim().match(/^0?5:30\s*am\s*(\d{1,2})\/(\d{1,2})\s*-\s*0?5:30\s*am\s*(\d{1,2})\/(\d{1,2})$/i);
  if (!match) return false;
  const start = new Date(midnight), end = new Date(midnight + 86400000);
  return Number(match[1]) === start.getUTCDate() && Number(match[2]) === start.getUTCMonth() + 1 &&
    Number(match[3]) === end.getUTCDate() && Number(match[4]) === end.getUTCMonth() + 1;
}

function getShiftForRows(rows, now) {
  const invalid = {status:'invalid_roster'};
  const nowMs = Number(now);
  if (!Array.isArray(rows) || rows.length < 1 || !Number.isFinite(nowMs)) return invalid;
  const people = [normalizePerson_(rows[0][2]), normalizePerson_(rows[0][3])];
  if (!people[0] || !people[1] || people[0] === people[1]) return invalid;
  const candidates = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row || row.slice(0, 4).every(function(cell) { return String(cell || '').trim() === ''; })) continue;
    const date = parseRosterDate_(row[0]);
    if (!date) return invalid;
    if (date.start <= nowMs && nowMs < date.start + 86400000) candidates.push({row:row, date:date});
  }
  if (candidates.length === 0) return {status:'no_shift'};
  if (candidates.length !== 1) return invalid;
  const active = candidates[0];
  if (!validShiftLabel_(active.row[1], active.date.midnight)) return invalid;
  const marks = [String(active.row[2] || '').trim().toLowerCase(), String(active.row[3] || '').trim().toLowerCase()];
  if (marks.some(function(mark) { return mark !== '' && mark !== 'x'; })) return invalid;
  if (marks.filter(function(mark) { return mark === 'x'; }).length !== 1) return invalid;
  const person = people[marks.indexOf('x')];
  return {status:'ok', shift:{
    person:person,
    name:person === 'tam' ? 'Mr. Tâm' : 'Mr. Diệu',
    start:new Date(active.date.start).toISOString(),
    end:new Date(active.date.start + 86400000).toISOString()
  }};
}

function buildResponse(rows, now) {
  const result = getShiftForRows(rows, now);
  const nowMs = Number(now);
  const expires = result.status === 'ok' ? Math.min(nowMs + 90000, Date.parse(result.shift.end)) : nowMs + 30000;
  const response = {
    schemaVersion:1, status:result.status,
    serverNow:now.toISOString(), generatedAt:now.toISOString(),
    timezone:'Asia/Ho_Chi_Minh', validUntil:new Date(expires).toISOString()
  };
  if (result.shift) response.shift = result.shift;
  return response;
}

function encodeResponse(payload, callback) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  // A single fixed callback prevents arbitrary executable expressions in public input.
  if (callback === 'NhaTro25.receive') {
    return ContentService.createTextOutput('NhaTro25.receive(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function doGet(event) {
  let payload;
  try {
    const id = PropertiesService.getScriptProperties().getProperty('ROSTER_SPREADSHEET_ID');
    if (!id) throw new Error('Roster has not been configured.');
    const metadata = Sheets.Spreadsheets.get(id, {fields:'sheets.properties'});
    const sheet = metadata.sheets.filter(function(tab) { return tab.properties.sheetId === 0; })[0];
    if (!sheet) throw new Error('Roster tab is unavailable.');
    const range = "'" + sheet.properties.title.replace(/'/g, "''") + "'!A:D";
    const rows = Sheets.Spreadsheets.Values.get(id, range, {valueRenderOption:'FORMATTED_VALUE'}).values || [];
    payload = buildResponse(rows, new Date());
  } catch (error) {
    const now = new Date();
    payload = {schemaVersion:1, status:'unavailable', serverNow:now.toISOString(), generatedAt:now.toISOString(), timezone:'Asia/Ho_Chi_Minh', validUntil:new Date(Number(now) + 30000).toISOString()};
  }
  return encodeResponse(payload, event && event.parameter && event.parameter.callback);
}
