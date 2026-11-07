/* No dependencies. Live data comes only from the configured Apps Script. */
(function () {
  'use strict';
  var NAMES = Object.freeze({ tam: 'Mr. Tâm', dieu: 'Mr. Diệu' });
  var TIMEZONE = 'Asia/Ho_Chi_Minh';
  var TIMEOUT_MS = 12000;
  var POLL_MS = 60000;
  var CLOCK_DRIFT_MS = 1000;
  var allowedStatuses = ['ok', 'no_shift', 'invalid_roster', 'unavailable'];

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function exactKeys(value, keys) {
    return Object.keys(value).length === keys.length && keys.every(function (key) {
      return Object.prototype.hasOwnProperty.call(value, key);
    });
  }
  function isoTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    var year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
    if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return NaN;
    return Date.parse(value);
  }
  // Return parsed timestamps only after validating the whole public contract.
  function validatePayload(data) {
    if (!isRecord(data) || data.schemaVersion !== 1 || data.timezone !== TIMEZONE || allowedStatuses.indexOf(data.status) < 0) return null;
    var keys = ['schemaVersion', 'status', 'serverNow', 'generatedAt', 'timezone', 'validUntil'];
    if (data.status === 'ok') keys.push('shift');
    if (!exactKeys(data, keys)) return null;
    var serverNow = isoTime(data.serverNow), generatedAt = isoTime(data.generatedAt), validUntil = isoTime(data.validUntil);
    if (![serverNow, generatedAt, validUntil].every(Number.isFinite)) return null;
    if (generatedAt > serverNow || serverNow - generatedAt > 120000 || validUntil <= serverNow) return null;
    var parsed = { status: data.status, serverNow: serverNow, generatedAt: generatedAt, validUntil: validUntil };
    if (data.status === 'ok') {
      var shift = data.shift;
      if (!isRecord(shift) || !exactKeys(shift, ['person', 'name', 'start', 'end'])) return null;
      if (!Object.prototype.hasOwnProperty.call(NAMES, shift.person) || NAMES[shift.person] !== shift.name) return null;
      var start = isoTime(shift.start), end = isoTime(shift.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start > serverNow || serverNow >= end || validUntil > end) return null;
      parsed.shift = { person: shift.person, name: shift.name, start: start, end: end };
    }
    return parsed;
  }
  function endpointURL(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) return null;
      return url;
    } catch (_) { return null; }
  }

  var ui = {};
  var payload = null;
  var clockAnchor = null;
  var clockNeedsSync = false;
  var active = null;
  var scheduled = null;
  var failures = 0;
  var lastSuccessful = null;
  var started = false;
  var preview = false;
  var endpoint = null;
  var serial = 0;
  var dateFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
  var timeFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  var shortTimeFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });

  function now() {
    if (clockAnchor) return clockAnchor.server + Math.max(0, performance.now() - clockAnchor.monotonic);
    return Date.now();
  }
  function clockDiverged(anchor) {
    if (!anchor) return false;
    var monotonicElapsed = performance.now() - anchor.monotonic;
    var wallElapsed = Date.now() - anchor.wall;
    return monotonicElapsed < 0 || Math.abs(wallElapsed - monotonicElapsed) > CLOCK_DRIFT_MS;
  }
  function invalidateClock() {
    clearTimeout(scheduled);
    dispose();
    clockAnchor = null;
    clockNeedsSync = true;
    emptyState('expired');
    ui.clock.textContent = '--:--:--';
    ui.clock.dateTime = '';
  }
  function setStatus(text, kind) {
    ui.status.className = 'status' + (kind ? ' is-' + kind : '');
    ui.statusText.textContent = text;
  }
  function emptyState(kind) {
    payload = null;
    var states = {
      loading: ['Đang kết nối', 'Đang tải thông tin', 'Chờ một chút để cập nhật ca trực hiện tại.'],
      unconfigured: ['Chưa kết nối', 'Chưa kết nối lịch trực', 'Thông tin sẽ xuất hiện khi lịch trực được kết nối.'],
      offline: ['Mất kết nối', 'Chưa thể cập nhật', 'Kiểm tra kết nối mạng. Thông tin sẽ tự cập nhật khi có mạng trở lại.'],
      expired: ['Đang cập nhật', 'Đang cập nhật ca trực', 'Thông tin trước đã hết hiệu lực. Đang kiểm tra ca trực hiện tại.'],
      no_shift: ['Chưa có thông tin', 'Chưa có ca trực', 'Lịch hiện tại chưa có ca trực cho thời điểm này.'],
      invalid_roster: ['Cần kiểm tra lịch', 'Chưa xác định ca trực', 'Lịch trực chưa rõ ràng. Vui lòng kiểm tra lại sau.'],
      unavailable: ['Chưa thể cập nhật', 'Tạm thời chưa có thông tin', 'Chưa đọc được lịch trực. Hệ thống sẽ tự thử lại.'],
      invalid: ['Chưa thể cập nhật', 'Đang kiểm tra thông tin', 'Chưa nhận được thông tin ca trực hợp lệ. Hệ thống sẽ tự thử lại.'],
      timeout: ['Kết nối gián đoạn', 'Chưa thể cập nhật', 'Kết nối đang mất nhiều thời gian. Hệ thống sẽ tự thử lại.']
    };
    var state = states[kind] || states.unavailable;
    setStatus(state[0], ['loading', 'unconfigured', 'expired', 'no_shift'].indexOf(kind) >= 0 ? '' : 'error');
    ui.identity.classList.add('is-empty');
    ui.personName.textContent = state[1];
    ui.stateMessage.textContent = state[2];
    ui.stateMessage.hidden = false;
    ui.shiftDetails.hidden = true;
    ui.emptyDecoration.hidden = false;
    ui.startDate.textContent = ui.endDate.textContent = ui.startTime.textContent = ui.endTime.textContent = ui.remaining.textContent = '';
    ui.progressFill.style.width = '0%';
    ui.shiftProgress.setAttribute('aria-valuenow', '0');
  }
  function paintShift() {
    var shift = payload.shift;
    ui.identity.classList.remove('is-empty');
    ui.personName.textContent = shift.name;
    ui.stateMessage.hidden = true;
    ui.shiftDetails.hidden = false;
    ui.emptyDecoration.hidden = true;
    ui.startDate.textContent = dateFormat.format(shift.start);
    ui.endDate.textContent = dateFormat.format(shift.end);
    ui.startTime.textContent = shortTimeFormat.format(shift.start);
    ui.endTime.textContent = shortTimeFormat.format(shift.end);
    setStatus(preview ? 'Ca trực minh họa' : 'Đang trực', 'live');
    tick();
  }
  function tick() {
    // Some browsers pause performance.now() during device sleep. Wall time is
    // only a drift detector: a changed device clock never becomes server time.
    if (!preview && (clockDiverged(clockAnchor) || clockDiverged(active))) {
      invalidateClock();
      schedule(0);
      return;
    }
    var current = now();
    if (!clockNeedsSync) {
      ui.clock.textContent = timeFormat.format(current);
      ui.clock.dateTime = new Date(current).toISOString();
    }
    if (!payload) return;
    if (current >= payload.validUntil || (payload.shift && current >= payload.shift.end)) {
      if (preview) { previewData(); return; }
      emptyState('expired');
      if (!active && !preview) schedule(0);
      return;
    }
    if (!payload.shift) return;
    var shift = payload.shift;
    var percent = Math.max(0, Math.min(100, (current - shift.start) / (shift.end - shift.start) * 100));
    ui.progressFill.style.width = percent.toFixed(3) + '%';
    ui.shiftProgress.setAttribute('aria-valuenow', String(Math.round(percent)));
    var minutes = Math.max(1, Math.ceil((shift.end - current) / 60000));
    var days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
    ui.remaining.textContent = (days ? days + ' ngày ' : '') + (hours ? hours + ' giờ ' : '') + (mins ? mins + ' phút' : '').trim();
  }
  function busy(value) {
    ui.card.setAttribute('aria-busy', String(value));
    ui.refresh.disabled = value;
    ui.refreshLabel.textContent = value ? 'Đang cập nhật' : 'Làm mới';
  }
  function dispose() {
    if (!active) return;
    clearTimeout(active.timeout);
    active.script.onerror = null;
    active.script.onload = null;
    active.script.remove();
    active = null;
    busy(false);
  }
  function schedule(delay) {
    clearTimeout(scheduled);
    scheduled = setTimeout(function () { request(false); }, delay);
  }
  function fail(kind) {
    dispose();
    emptyState(kind);
    failures += 1;
    ui.footerNote.textContent = navigator.onLine === false ? 'Tự động kết nối lại khi có mạng' : 'Sẽ tự thử lại · Bạn cũng có thể làm mới';
    if (navigator.onLine !== false) schedule([5000, 15000, 30000, POLL_MS][Math.min(failures - 1, 3)]);
  }
  function receive(data) {
    // A removed/late script must never satisfy a subsequent request with this
    // fixed callback. currentScript identifies the exact requesting element.
    if (!active || document.currentScript !== active.script) return;
    if (clockDiverged(active) || clockDiverged(clockAnchor)) {
      invalidateClock();
      schedule(0);
      return;
    }
    var elapsed = performance.now() - active.monotonic;
    var parsed = validatePayload(data);
    if (!parsed || elapsed < 0 || elapsed > TIMEOUT_MS || parsed.serverNow + elapsed / 2 >= parsed.validUntil) { fail('invalid'); return; }
    clockAnchor = { server: parsed.serverNow + elapsed / 2, monotonic: performance.now(), wall: Date.now() };
    clockNeedsSync = false;
    dispose();
    failures = 0;
    lastSuccessful = now();
    ui.lastSync.textContent = 'Đồng bộ lúc ' + timeFormat.format(lastSuccessful);
    ui.footerNote.textContent = 'Tự động cập nhật mỗi phút';
    if (parsed.status !== 'ok') {
      emptyState(parsed.status);
      schedule(POLL_MS);
      return;
    }
    payload = parsed;
    paintShift();
    schedule(Math.min(POLL_MS, Math.max(250, parsed.validUntil - now())));
  }
  function previewData() {
    var local = new Date(Date.now() + 7 * 3600000);
    var start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), -2, 30);
    if (start > Date.now()) start -= 86400000;
    var time = Date.now();
    payload = validatePayload({ schemaVersion: 1, status: 'ok', serverNow: new Date(time).toISOString(), generatedAt: new Date(time).toISOString(), timezone: TIMEZONE, validUntil: new Date(start + 86400000).toISOString(), shift: { person: 'tam', name: NAMES.tam, start: new Date(start).toISOString(), end: new Date(start + 86400000).toISOString() } });
    ui.lastSync.textContent = 'Dữ liệu minh họa';
    ui.footerNote.textContent = 'Bản xem trước · Không phải lịch trực thực tế';
    busy(false);
    paintShift();
  }
  function request(manual) {
    if (preview) { previewData(); return; }
    if (active) return;
    clearTimeout(scheduled);
    if (navigator.onLine === false) { emptyState('offline'); busy(false); return; }
    if (!endpoint) { emptyState('unconfigured'); busy(false); ui.footerNote.textContent = 'Đang chờ kết nối nguồn lịch trực'; return; }
    tick();
    if (manual) failures = 0;
    if (!payload) emptyState('loading');
    busy(true);
    var script = document.createElement('script');
    var url = new URL(endpoint.href);
    url.searchParams.set('callback', 'NhaTro25.receive');
    url.searchParams.set('_', Date.now() + '-' + (++serial));
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = url.href;
    active = { script: script, monotonic: performance.now(), wall: Date.now(), timeout: setTimeout(function () { fail('timeout'); }, TIMEOUT_MS) };
    script.onerror = function () { if (active && active.script === script) fail('unavailable'); };
    script.onload = function () { if (active && active.script === script) fail('invalid'); };
    document.head.appendChild(script);
  }
  function init() {
    if (started) return;
    started = true;
    ['status', 'status-text', 'person-name', 'state-message', 'shift-details', 'empty-decoration', 'start-date', 'end-date', 'start-time', 'end-time', 'remaining', 'progress-fill', 'shift-progress', 'clock', 'last-sync', 'refresh', 'footer-note'].forEach(function (id) {
      ui[id.replace(/-([a-z])/g, function (_, letter) { return letter.toUpperCase(); })] = document.getElementById(id);
    });
    ui.card = document.querySelector('.duty-card');
    ui.identity = document.querySelector('.identity');
    ui.refreshLabel = ui.refresh.querySelector('span');
    preview = document.body.dataset.mode === 'preview' && /(?:^|\/)preview\.html$/.test(location.pathname);
    endpoint = endpointURL((window.NHA_TRO_CONFIG || {}).endpoint);
    if (preview) ui.refreshLabel.textContent = 'Làm mới';
    ui.refresh.addEventListener('click', function () { request(true); });
    window.addEventListener('offline', function () { if (preview) return; clearTimeout(scheduled); dispose(); emptyState('offline'); ui.footerNote.textContent = 'Tự động kết nối lại khi có mạng'; });
    window.addEventListener('online', function () { request(true); });
    function resume() {
      if (document.visibilityState === 'hidden') return;
      if (!preview) invalidateClock();
      request(false);
    }
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', function (event) { if (event.persisted) resume(); });
    window.addEventListener('pagehide', function () { clearTimeout(scheduled); dispose(); });
    setInterval(tick, 1000);
    request(false);
    tick();
  }
  window.NhaTro25 = Object.freeze({ receive: receive, validatePayload: validatePayload, validateEndpoint: endpointURL });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
