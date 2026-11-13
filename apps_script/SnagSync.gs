// ============================================================
//  SNAG CHECK - Supabase <-> Google Sheet sync + Drive proxy
//  Create this as a NEW Apps Script project bound to the Snag Check
//  spreadsheet (Extensions > Apps Script). Do NOT paste it into the old
//  Code.gs project (both define onOpen / doPost).
//
//  Script properties (Project Settings > Script properties):
//    SUPABASE_URL          project URL only, e.g. https://abcd1234.supabase.co
//    SUPABASE_SERVICE_KEY  sb_secret_... (or legacy service_role) key
//    SNAG_SYNC_TOKEN       created by the menu "Snag Sync > Create token"
//
//  What it does
//    1. Web app -> Supabase -> THIS SHEET   automatic (webhook, 3-5 s; 1 min trigger as safety net)
//    2. THIS SHEET -> Supabase              manual: menu "Overwrite Supabase from THIS tab"
//    3. Google Drive photo upload / delete  called by the Vercel app (Vercel cannot use DriveApp)
// ============================================================

const SnagSync_SS_ID = '19tr2BC9ZRcdhzgOWOqK1c-xuDqhaSjYqXhZ1srvKXAQ';

// Supabase table -> sheet tab
const SnagSync_TABLES = {
  app_users        : 'Users',
  flats            : 'Flats',
  snag_master      : 'SnagMaster',
  asset_master     : 'AssetMaster',
  inspections      : 'Inspections',
  asset_inspections: 'AssetInspections',
  photos           : 'Photos',
  activity_log     : 'ActivityLog',
  snag_overrides   : 'SnagOverrides'
};

// Supabase table -> primary key header
const SnagSync_PK = {
  app_users: 'userId', flats: 'flatId', snag_master: 'snagId', asset_master: 'assetId',
  inspections: 'rowId', asset_inspections: 'rowId', photos: 'photoId',
  activity_log: 'logId', snag_overrides: 'overrideId'
};

const SnagSync_CHUNK = 1000;      // rows per push request
const SnagSync_EVENT_PAGE = 500;  // events per pull request

// ── small helpers ───────────────────────────────────────────
function SnagSync_prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function SnagSync_tableOfSheet_(sheetName) {
  const keys = Object.keys(SnagSync_TABLES);
  for (let i = 0; i < keys.length; i++) if (SnagSync_TABLES[keys[i]] === sheetName) return keys[i];
  return null;
}

function SnagSync_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function SnagSync_rpc_(fn, body) {
  const base = SnagSync_prop_('SUPABASE_URL').replace(/\/+$/, '');
  const key  = SnagSync_prop_('SUPABASE_SERVICE_KEY');
  if (!base || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Script properties');
  const res = UrlFetchApp.fetch(base + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body || {}),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Supabase ' + fn + ' HTTP ' + code + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

// ── PULL: Supabase changes -> sheet ─────────────────────────
function SnagSync_cellValue_(header, v) {
  if (v === null || v === undefined) return '';
  if (header === 'timestamp') return new Date(v);
  return v;
}

function SnagSync_sameValue_(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return String(a) === String(b);
}

function SnagSync_applyTable_(ss, tbl, byPk) {
  const sheet = ss.getSheetByName(SnagSync_TABLES[tbl]);
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const pkIdx = headers.indexOf(SnagSync_PK[tbl]);
  if (pkIdx < 0) throw new Error(SnagSync_TABLES[tbl] + ': header "' + SnagSync_PK[tbl] + '" not found');

  // pk -> row number (one column read)
  const lastRow = sheet.getLastRow();
  const idx = {};
  if (lastRow > 1) {
    sheet.getRange(2, pkIdx + 1, lastRow - 1, 1).getValues().forEach(function (r, i) {
      const k = String(r[0]);
      if (k !== '' && idx[k] === undefined) idx[k] = i + 2;
    });
  }

  const appends = [];
  const deletes = [];
  Object.keys(byPk).forEach(function (pk) {
    const e = byPk[pk];
    if (e.op === 'D') { if (idx[pk]) deletes.push(idx[pk]); return; }
    if (!e.data) return;                       // row is already gone; a later D event removes it
    if (!idx[pk]) {                            // new row -> append (columns the app does not know stay empty)
      appends.push(headers.map(function (h) { return e.data[h] === undefined ? '' : SnagSync_cellValue_(h, e.data[h]); }));
      return;
    }
    // existing row -> change only the cells whose value differs; formulas and your own extra columns are untouched
    const range = sheet.getRange(idx[pk], 1, 1, lastCol);
    const cur = range.getValues()[0];
    const frm = range.getFormulas()[0];
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j] || e.data[headers[j]] === undefined || frm[j]) continue;
      const nv = SnagSync_cellValue_(headers[j], e.data[headers[j]]);
      if (!SnagSync_sameValue_(cur[j], nv)) sheet.getRange(idx[pk], j + 1).setValue(nv);
    }
  });

  if (appends.length) {
    const startRow = Math.max(sheet.getLastRow(), 1) + 1;
    const need = startRow + appends.length - 1 - sheet.getMaxRows();
    if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need);
    sheet.getRange(startRow, 1, appends.length, lastCol).setValues(appends);
  }
  deletes.sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); });
}

function SnagSync_pull() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { status: 'busy' };      // a pull is already running; it will pick up the new events
  try {
    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.openById(SnagSync_SS_ID);
    let last = Number(props.getProperty('SNAG_LAST_EVENT') || 0);
    let total = 0;
    for (let guard = 0; guard < 60; guard++) {
      const ev = SnagSync_rpc_('snag_events_since', { p_after: last, p_limit: SnagSync_EVENT_PAGE });
      if (!ev || !ev.length) break;
      const byTable = {};
      ev.forEach(function (e) {                              // later events of the same row win
        if (!SnagSync_TABLES[e.tbl]) return;
        (byTable[e.tbl] = byTable[e.tbl] || {})[e.pk] = e;
      });
      Object.keys(byTable).forEach(function (tbl) { SnagSync_applyTable_(ss, tbl, byTable[tbl]); });
      last = ev[ev.length - 1].id;
      props.setProperty('SNAG_LAST_EVENT', String(last));
      total += ev.length;
      if (ev.length < SnagSync_EVENT_PAGE) break;
    }
    return { status: 'ok', events: total, last: last };
  } finally {
    lock.releaseLock();
  }
}

// ── PUSH: this sheet tab -> Supabase (overwrite) ────────────
function SnagSync_readTab_(sheet, tbl) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const idx = [];
  for (let i = 1; i < values.length; i++) idx.push(i);
  return SnagSync_buildRows_(headers, values, idx, tbl, sheet.getName());
}

// Rows the user has selected (one or several ranges), header row excluded
function SnagSync_readSelected_(sheet, tbl) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const list = sheet.getActiveRangeList();
  const ranges = list ? list.getRanges() : [sheet.getActiveRange()];
  const want = {};
  ranges.forEach(function (r) {
    if (!r) return;
    const first = r.getRow();
    for (let k = 0; k < r.getNumRows(); k++) {
      const rowNo = first + k;                                // 1-based sheet row
      if (rowNo >= 2 && rowNo <= values.length) want[rowNo - 1] = true;   // 0-based index in values
    }
  });
  const idx = Object.keys(want).map(Number).sort(function (a, b) { return a - b; });
  return SnagSync_buildRows_(headers, values, idx, tbl, sheet.getName());
}

function SnagSync_buildRows_(headers, values, idx, tbl, sheetName) {
  const pkIdx = headers.indexOf(SnagSync_PK[tbl]);
  if (pkIdx < 0) throw new Error('Header "' + SnagSync_PK[tbl] + '" not found in tab ' + sheetName);
  const rows = [];
  const keys = [];
  const seen = {};
  let dups = 0;
  let blanks = 0;
  for (let n = 0; n < idx.length; n++) {
    const i = idx[n];
    const pk = values[i][pkIdx];
    if (pk === '' || pk === null) { blanks++; continue; }    // blank rows are ignored
    const k = String(pk);
    if (seen[k]) { dups++; continue; }
    seen[k] = true;
    const o = {};
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      let v = values[i][j];
      if (v === '') v = null;
      if (v instanceof Date) v = v.toISOString();
      o[headers[j]] = v;
    }
    o[SnagSync_PK[tbl]] = k;
    rows.push(o);
    keys.push(k);
  }
  return { rows: rows, keys: keys, dups: dups, blanks: blanks };
}

function SnagSync_pushActiveTab() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const tbl = SnagSync_tableOfSheet_(sheet.getName());
  if (!tbl) {
    ui.alert('Tab "' + sheet.getName() + '" is not synced.\n\nSynced tabs: ' +
             Object.keys(SnagSync_TABLES).map(function (t) { return SnagSync_TABLES[t]; }).join(', '));
    return;
  }
  try {
    const data = SnagSync_readTab_(sheet, tbl);
    if (!data.keys.length) { ui.alert('The tab has no data rows - nothing was changed.'); return; }
    if (data.dups) {
      ui.alert('The tab has ' + data.dups + ' duplicate ID(s) in column "' + SnagSync_PK[tbl] +
               '". Fix them first - nothing was changed.');
      return;
    }
    const pv = SnagSync_rpc_('snag_push_preview', { p_table: tbl, p_keys: data.keys });
    const msg = 'OVERWRITE Supabase table "' + tbl + '" with tab "' + sheet.getName() + '"?\n\n' +
      'Rows in sheet      : ' + pv.sheet_rows + '\n' +
      'Rows in Supabase   : ' + pv.db_rows + '\n' +
      'Will be updated    : ' + pv.to_update + '\n' +
      'Will be added      : ' + pv.to_insert + '\n' +
      'Will be DELETED    : ' + pv.to_delete + '\n\n' +
      'Changes made in the web app that are not yet in this sheet will be lost.';
    if (ui.alert('Snag Sync', msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    if (pv.to_delete > 0) {
      const r = ui.prompt('Snag Sync', pv.to_delete + ' row(s) will be deleted from Supabase.\nType OVERWRITE to continue:', ui.ButtonSet.OK_CANCEL);
      if (r.getSelectedButton() !== ui.Button.OK || r.getResponseText().trim() !== 'OVERWRITE') {
        ui.alert('Cancelled - nothing was changed.');
        return;
      }
    }
    let done = 0;
    for (let i = 0; i < data.rows.length; i += SnagSync_CHUNK) {
      done += SnagSync_rpc_('snag_push_rows', { p_table: tbl, p_rows: data.rows.slice(i, i + SnagSync_CHUNK) });
    }
    const deleted = SnagSync_rpc_('snag_push_finish', { p_table: tbl, p_keys: data.keys });
    ui.alert('Done.\n\nUpserted: ' + done + '\nDeleted: ' + deleted);
  } catch (err) {
    ui.alert('Push failed: ' + err.message);
  }
}

// ── PUSH: selected rows of this tab -> Supabase (overwrite those rows only, nothing is deleted) ──
function SnagSync_pushSelectedRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const tbl = SnagSync_tableOfSheet_(sheet.getName());
  if (!tbl) {
    ui.alert('Tab "' + sheet.getName() + '" is not synced.\n\nSynced tabs: ' +
             Object.keys(SnagSync_TABLES).map(function (t) { return SnagSync_TABLES[t]; }).join(', '));
    return;
  }
  try {
    const data = SnagSync_readSelected_(sheet, tbl);
    if (!data.keys.length) {
      ui.alert('Select one or more data rows (not only the header row) that have an ID in column "' +
               SnagSync_PK[tbl] + '", then run this again. Nothing was changed.');
      return;
    }
    if (data.dups) {
      ui.alert('The selection has ' + data.dups + ' duplicate ID(s) in column "' + SnagSync_PK[tbl] +
               '". Fix them first - nothing was changed.');
      return;
    }
    const pv = SnagSync_rpc_('snag_push_preview', { p_table: tbl, p_keys: data.keys });
    const msg = 'OVERWRITE the selected rows in Supabase table "' + tbl + '" (tab "' + sheet.getName() + '")?\n\n' +
      'Selected rows with an ID : ' + data.keys.length + '\n' +
      'Will be updated          : ' + pv.to_update + '\n' +
      'Will be added            : ' + pv.to_insert + '\n' +
      'Rows without an ID (skipped): ' + data.blanks + '\n\n' +
      'Other rows in Supabase are not touched and nothing is deleted.\n' +
      'Changes made to these rows in the web app that are not yet in this sheet will be lost.';
    if (ui.alert('Snag Sync', msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    let done = 0;
    for (let i = 0; i < data.rows.length; i += SnagSync_CHUNK) {
      done += SnagSync_rpc_('snag_push_rows', { p_table: tbl, p_rows: data.rows.slice(i, i + SnagSync_CHUNK) });
    }
    ui.alert('Done.\n\nRows written to Supabase: ' + done);
  } catch (err) {
    ui.alert('Push failed: ' + err.message);
  }
}

// ── WEB APP: webhook ping + Drive proxy (called by Supabase / Vercel) ──
function doPost(e) {
  const params = (e && e.parameter) || {};
  const token = SnagSync_prop_('SNAG_SYNC_TOKEN');
  if (!token || params.token !== token) return SnagSync_json_({ status: 'error', msg: 'Forbidden' });
  try {
    const action = params.action || 'pull';                  // Supabase pings with an empty body = pull
    if (action === 'pull') return SnagSync_json_(SnagSync_pull());
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (action === 'uploadPhoto') return SnagSync_json_(SnagSync_driveUpload_(body));
    if (action === 'deletePhoto') return SnagSync_json_(SnagSync_driveDelete_(body));
    return SnagSync_json_({ status: 'error', msg: 'Unknown action: ' + action });
  } catch (err) {
    return SnagSync_json_({ status: 'error', msg: String(err && err.message || err) });
  }
}

function SnagSync_driveUpload_(b) {
  // Same folder logic as the old uploadPhoto: <tower folder> / <flatNo> / <round>
  function getOrCreate(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }
  const folder = DriveApp.getFolderById(b.folderId);
  const flatFolder = getOrCreate(folder, String(b.flatNo));
  const roundFolder = getOrCreate(flatFolder, String(b.round));
  const blob = Utilities.newBlob(Utilities.base64Decode(b.base64Data), b.mimeType, b.fileName);
  const file = roundFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { status: 'ok', fileId: file.getId() };
}

function SnagSync_driveDelete_(b) {
  try { DriveApp.getFileById(String(b.fileId || '')).setTrashed(true); } catch (e2) { /* ignored, like before */ }
  return { status: 'ok' };
}

// ── MENU + SETUP ────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Snag Sync')
    .addItem('Overwrite Supabase from SELECTED rows...', 'SnagSync_pushSelectedRows')
    .addItem('Overwrite Supabase from THIS tab...', 'SnagSync_pushActiveTab')
    .addItem('Pull changes from Supabase now', 'SnagSync_pullNow')
    .addSeparator()
    .addItem('1. Create token (once)', 'SnagSync_createToken')
    .addItem('2. Start pulling from now', 'SnagSync_markCurrent')
    .addItem('3. Install 1-minute safety trigger', 'SnagSync_installTrigger')
    .addToUi();
}

function SnagSync_pullNow() {
  const r = SnagSync_pull();
  SpreadsheetApp.getActiveSpreadsheet().toast(r.status === 'ok' ? ('Pulled ' + r.events + ' change(s)') : r.status, 'Snag Sync', 5);
}

function SnagSync_createToken() {
  const props = PropertiesService.getScriptProperties();
  const ui = SpreadsheetApp.getUi();
  if (props.getProperty('SNAG_SYNC_TOKEN')) {
    ui.alert('A token already exists. To rotate it, delete the SNAG_SYNC_TOKEN script property and run this again.');
    return;
  }
  props.setProperty('SNAG_SYNC_TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  ui.alert('Token created. Copy it from Project Settings > Script properties (SNAG_SYNC_TOKEN). ' +
           'Use the same value as APPS_SCRIPT_TOKEN in Vercel and in the webhook URL.');
}

// After the one-time import, skip everything that is already in the sheet
function SnagSync_markCurrent() {
  const last = SnagSync_rpc_('snag_events_max', {});
  PropertiesService.getScriptProperties().setProperty('SNAG_LAST_EVENT', String(last));
  SpreadsheetApp.getUi().alert('Pull will start after event ' + last + '.');
}

function SnagSync_installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'SnagSync_timer') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('SnagSync_timer').timeBased().everyMinutes(1).create();
  SpreadsheetApp.getUi().alert('1-minute safety trigger installed.');
}

function SnagSync_timer() {
  SnagSync_pull();
  if (new Date().getMinutes() === 0) {                       // once an hour: drop events older than 7 days
    try { SnagSync_rpc_('snag_prune_events', { p_days: 7 }); } catch (e) { /* ignore */ }
  }
}
