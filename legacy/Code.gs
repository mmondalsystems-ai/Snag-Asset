// ============================================================
//  SNAG CHECK APP — Code.gs
//  Backend: Google Apps Script
// ============================================================

const SS_ID = '19tr2BC9ZRcdhzgOWOqK1c-xuDqhaSjYqXhZ1srvKXAQ';

// ── PHOTO FOLDER CONFIG ──────────────────────────────────────
// Create one Drive folder per tower per section, paste the IDs below.
// Photos will be auto-organized into subfolders: FlatNo / Round
// Add more towers by following the same pattern.
const PHOTO_FOLDERS = {
  Prayag: {
    snag  : '1ybSJjwHp7pXZUyYnPlamz6BG-ZOli5dE',
    asset : '1CwN0poh6FpOMJ_BNi-LC3VQZTkT6nqp9'
  },
  // ── Add more towers below ──
  Veni: {
    snag : '1_X_OSIxczX50r92TzpzPWmOyfb5P_GYV',
    asset: '19v9kY984D1hLJc6baQsGG4YQ-6fzGU2Z',
  },
  // TowerName: {
  //   snag  : 'FOLDER_ID',
  //   asset : 'FOLDER_ID'
  // },
};

// Fallback folder if tower/section not found in PHOTO_FOLDERS above
const PHOTO_FOLDER_FALLBACK = '1UZWMiu4O_lVcW0mNyUP9L7qy8rbgPYcC';

// Helper: get folder ID for a flat's tower + section
function getPhotoFolderId(tower, section) {
  const sec = (section || 'snag').toLowerCase();
  if (PHOTO_FOLDERS[tower] && PHOTO_FOLDERS[tower][sec]) {
    return PHOTO_FOLDERS[tower][sec];
  }
  return PHOTO_FOLDER_FALLBACK;
}

const SHEET = {
  USERS   : 'Users',
  FLATS   : 'Flats',
  SNAG    : 'SnagMaster',
  ASSET   : 'AssetMaster',
  INSPECT : 'Inspections',
  AINSPECT: 'AssetInspections',
  PHOTOS  : 'Photos',
  LOG     : 'ActivityLog',
  OVERRIDES: 'SnagOverrides'
};

// ── PER-FLAT OVERRIDES ───────────────────────────────────────
// Stores flat-specific overrides for respContractor, checkingArea, respName, respPerson
// Sheet: SnagOverrides — columns: overrideId, flatId, refId, section, field, value

function getOverrides(flatId) {
  try {
    var sh = getSheet(SHEET.OVERRIDES);
    if (!sh) return ok([]);
    var rows = sh.getDataRange().getValues();
    if (rows.length < 2) return ok([]);
    var h = rows[0]; var ci = {};
    for (var x = 0; x < h.length; x++) ci[String(h[x]).trim()] = x;
    var results = [];
    var fId = String(flatId || '').trim();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][ci['flatId']] || '').trim() === fId) {
        results.push({
          overrideId: String(rows[i][ci['overrideId']] || ''),
          flatId    : fId,
          refId     : String(rows[i][ci['refId']]   || ''),
          section   : String(rows[i][ci['section']]  || 'snag'),
          field     : String(rows[i][ci['field']]    || ''),
          value     : String(rows[i][ci['value']]    || '')
        });
      }
    }
    return ok(results);
  } catch(e) { return err('getOverrides: ' + e.message); }
}

function saveOverride(flatId, refId, section, field, value, changedBy) {
  try {
    var sh   = getSheet(SHEET.OVERRIDES);
    var rows = sh.getDataRange().getValues();
    var h    = rows[0]; var ci = {};
    for (var x = 0; x < h.length; x++) ci[String(h[x]).trim()] = x;
    var fId = String(flatId || '').trim();
    var rId = String(refId  || '').trim();
    var sec = String(section|| 'snag').trim();
    var fld = String(field  || '').trim();
    // Update existing override if found
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][ci['flatId']]  || '').trim() === fId &&
          String(rows[i][ci['refId']]   || '').trim() === rId &&
          String(rows[i][ci['section']] || '').trim() === sec &&
          String(rows[i][ci['field']]   || '').trim() === fld) {
        sh.getRange(i + 1, ci['value'] + 1).setValue(value);
        _addLog(flatId, refId, field, rows[i][ci['value']], value, changedBy, section);
        return ok('Updated');
      }
    }
    // Insert new override
    var id = newId('OVR');
    sh.appendRow([id, fId, rId, sec, fld, value]);
    _addLog(flatId, refId, field, '', value, changedBy, section);
    return ok('Created');
  } catch(e) { return err('saveOverride: ' + e.message); }
}

// ── ACTIVITY LOG HELPER (defined early so all functions can use it) ──
var FIELD_LABEL_MAP = {
  status         : 'Status',
  r1SnagRemark   : 'R1 Snag Remark',
  r1DeSnagRemark : 'R1 De-Snag Remark',
  r2SnagRemark   : 'R2 Snag Remark',
  r2DeSnagRemark : 'R2 De-Snag Remark',
  respContractor : 'Resp. Contractor',
  checkingArea   : 'Checking Area',
  respName       : 'Resp. Name',
  numbers        : 'Quantity',
  respPerson     : 'Resp. Person'
};

function _addLog(flatId, refId, fieldKey, oldVal, newVal, changedBy, section, ctx) {
  try {
    ctx = ctx || {};
    if (!ctx.flatNo) {
      var fsh = getSheet(SHEET.FLATS);
      var frows = fsh.getDataRange().getValues();
      var fh = frows[0]; var fci = {};
      for (var x = 0; x < fh.length; x++) fci[String(fh[x]).trim()] = x;
      for (var i = 1; i < frows.length; i++) {
        if (String(frows[i][fci['flatId']]||'').trim()===String(flatId||'').trim()){
          ctx.tower    = String(frows[i][fci['tower']]   ||'');
          ctx.floor    = String(frows[i][fci['floor']]   ||'');
          ctx.flatNo   = String(frows[i][fci['flatNo']]  ||flatId);
          ctx.flatType = String(frows[i][fci['flatType']]||'');
          break;
        }
      }
    }
    if (!ctx.pointLabel && refId) {
      var mSheet = section==='asset' ? SHEET.ASSET : SHEET.SNAG;
      var idCol  = section==='asset' ? 'assetId'   : 'snagId';
      var lbCol  = section==='asset' ? 'assetPoint': 'snagPoint';
      var msh = getSheet(mSheet);
      var mrows = msh.getDataRange().getValues();
      var mh = mrows[0]; var mci = {};
      for (var x = 0; x < mh.length; x++) mci[String(mh[x]).trim()] = x;
      for (var i = 1; i < mrows.length; i++) {
        if (String(mrows[i][mci[idCol]]||'').trim()===String(refId||'').trim()){
          ctx.location   = String(mrows[i][mci['location']]||'');
          ctx.pointLabel = String(mrows[i][mci[lbCol]]     ||refId);
          break;
        }
      }
    }
    var colHeader = (typeof fieldKey==='string' && fieldKey.startsWith('photo_'))
      ? 'Photo — '+fieldKey.replace('photo_','')
      : (FIELD_LABEL_MAP[fieldKey]||fieldKey);
    getSheet(SHEET.LOG).appendRow([
      newId('LOG'), ctx.tower||'', ctx.floor||'', ctx.flatNo||flatId,
      ctx.flatType||'', section||'snag', ctx.location||'', ctx.pointLabel||refId,
      colHeader, oldVal||'', newVal||'', changedBy, new Date()
    ]);
  } catch(e) { Logger.log('_addLog error: '+e.message); }
}

// ── DEBUG / TEST FUNCTIONS ──────────────────────────────────
// Run these from Apps Script editor to diagnose issues

function debugPhotos() {
  const sh = getSheet(SHEET.PHOTOS);
  const rows = sh.getDataRange().getValues();
  Logger.log('Total rows in Photos sheet (incl header): ' + rows.length);
  Logger.log('Headers: ' + JSON.stringify(rows[0]));
  if (rows.length > 1) Logger.log('First data row: ' + JSON.stringify(rows[1]));
  if (rows.length > 2) Logger.log('Second data row: ' + JSON.stringify(rows[2]));
}

function debugLog() {
  const sh = getSheet(SHEET.LOG);
  const rows = sh.getDataRange().getValues();
  Logger.log('Total rows in ActivityLog sheet (incl header): ' + rows.length);
  Logger.log('Headers: ' + JSON.stringify(rows[0]));
  if (rows.length > 1) Logger.log('First data row: ' + JSON.stringify(rows[1]));
}

function debugGetPhotos(testFlatId) {
  // Pass a real flatId to test, e.g. debugGetPhotos('FLT_123_abc')
  const result = getPhotos(testFlatId || '', null, null);
  Logger.log('getPhotos result: ' + JSON.stringify(result));
}

function debugTestLog() {
  // Writes a test row directly to ActivityLog to verify sheet write works
  const sh = getSheet(SHEET.LOG);
  sh.appendRow(['TEST_LOG', 'Prayag', '1', '1A', '3BHK', 'snag', 'Test Location', 'Test Point', 'Status', 'Pending', 'Done', 'admin', new Date()]);
  Logger.log('Test log row written. Check ActivityLog sheet.');
}

function debugAddLog() {
  // Tests full _addLog pipeline — run this and check Logger + ActivityLog sheet
  try {
    // Get first flat from sheet
    const flats = sheetData(SHEET.FLATS);
    if (!flats.length) { Logger.log('No flats found'); return; }
    const flat = flats[0];
    Logger.log('Testing _addLog with flat: ' + JSON.stringify(flat));

    // Get first snag
    const snags = sheetData(SHEET.SNAG);
    if (!snags.length) { Logger.log('No snags found'); return; }
    const snag = snags[0];
    Logger.log('Using snag: ' + JSON.stringify(snag));

    _addLog(flat.flatId, snag.snagId, 'status', 'Pending', 'Done', 'admin_test', 'snag');
    Logger.log('_addLog completed without error');
  } catch(e) {
    Logger.log('ERROR in debugAddLog: ' + e.message + ' | ' + e.stack);
  }
}

function debugGetActivityLog() {
  // Run this to test getActivityLog directly
  const result = getActivityLog(null, null);
  Logger.log('getActivityLog status: ' + result.status);
  Logger.log('Total log records returned: ' + (result.data ? result.data.length : 0));
  if (result.data && result.data.length > 0) {
    Logger.log('First record: ' + JSON.stringify(result.data[0]));
  }
  if (result.msg) Logger.log('Error msg: ' + result.msg);
}

function debugGetPhotosForFlat() {
  // Run this to test getPhotos with the real flatId from your sheet
  const flatId = 'FLT_1786443118505_nh89'; // 1A flat
  const result = getPhotos(flatId, null, null);
  Logger.log('getPhotos status: ' + result.status);
  Logger.log('Photos returned: ' + (result.data ? result.data.length : 0));
  if (result.data && result.data.length > 0) {
    Logger.log('First photo: ' + JSON.stringify(result.data[0]));
  }
  if (result.msg) Logger.log('Error: ' + result.msg);
}

function debugFlatIds() {
  // Shows all flatIds stored in Flats sheet
  const sh = getSheet(SHEET.FLATS);
  const rows = sh.getDataRange().getValues();
  Logger.log('Flats headers: ' + JSON.stringify(rows[0]));
  Logger.log('First 3 flat rows:');
  for (let i = 1; i <= Math.min(3, rows.length-1); i++) {
    Logger.log(JSON.stringify(rows[i]));
  }
}

// ── SIMPLE TEST — run this in editor to verify script loads ──
function debugGetUsernames() {
  var result = getUsernames();
  Logger.log('getUsernames result: ' + JSON.stringify(result));
}

function testScript() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sh = ss.getSheetByName('Users');
    if (!sh) { Logger.log('Users sheet NOT FOUND'); return; }
    var rows = sh.getDataRange().getValues();
    Logger.log('Users sheet rows: ' + rows.length);
    Logger.log('Headers: ' + JSON.stringify(rows[0]));
    if (rows.length > 1) Logger.log('First user: ' + JSON.stringify(rows[1]));
    Logger.log('testScript PASSED');
  } catch(e) {
    Logger.log('testScript FAILED: ' + e.message);
  }
}

// ── ENTRY POINT ─────────────────────────────────────────────
var CODE_VERSION = 'v20260811';  // update this to confirm deployment

// Helper for HtmlTemplate — builds <option> tags server-side
function buildUsernameOptions(usernamesJson) {
  try {
    var names = JSON.parse(usernamesJson || '[]');
    return names.map(function(n) {
      return '<option value="' + n + '">' + n + '</option>';
    }).join('');
  } catch(e) { return ''; }
}

// ── API HANDLER via GET ?action=...&params=... ──────────────
function handleApi(e) {
  try {
    var action = e.parameter.action || '';
    var params = e.parameter.params ? JSON.parse(e.parameter.params) : [];
    var result;
    if      (action === 'login')               result = login.apply(null, params);
    else if (action === 'getFlats')            result = getFlats();
    else if (action === 'getSnagMaster')       result = getSnagMaster();
    else if (action === 'getAssetMaster')      result = getAssetMaster.apply(null, params);
    else if (action === 'getInspections')      result = getInspections.apply(null, params);
    else if (action === 'getAssetInspections') result = getAssetInspections.apply(null, params);
    else if (action === 'saveInspection')      result = saveInspection.apply(null, params);
    else if (action === 'saveAssetInspection') result = saveAssetInspection.apply(null, params);
    else if (action === 'getPhotos')           result = getPhotos.apply(null, params);
    else if (action === 'uploadPhoto')         result = uploadPhoto.apply(null, params);
    else if (action === 'deletePhoto')         result = deletePhoto.apply(null, params);
    else if (action === 'getActivityLog')      result = getActivityLog.apply(null, params);
    else if (action === 'getTeam')             result = getTeam();
    else if (action === 'saveTeam')            result = saveTeam.apply(null, params);
    else if (action === 'deleteTeam')          result = deleteTeam.apply(null, params);
    else if (action === 'updateSnagMaster')    result = updateSnagMaster.apply(null, params);
    else if (action === 'updateAssetMaster')   result = updateAssetMaster.apply(null, params);
    else if (action === 'saveFlat')            result = saveFlat.apply(null, params);
    else if (action === 'getOverrides')         result = getOverrides.apply(null, params);
    else if (action === 'saveOverride')          result = saveOverride.apply(null, params);
    else result = { status: 'error', msg: 'Unknown action: ' + action };
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(e2) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', msg: e2.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) { return handleApi(e.parameter ? e : {parameter:{}}); }

function doGet(e) {
  // API call via GET (action param present)
  if (e && e.parameter && e.parameter.action) {
    return handleApi(e);
  }
  // Debug
  if (e && e.parameter && e.parameter.debug === '1') {
    return ContentService.createTextOutput(JSON.stringify({
      version: CODE_VERSION, ss_id: SS_ID.substring(0,8)+'...',
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
  // Serve app — inject usernames server-side
  var usernames = [];
  try {
    var ss   = SpreadsheetApp.openById(SS_ID);
    var sh   = ss.getSheetByName(SHEET.USERS);
    if (sh) {
      var rows = sh.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][1]) usernames.push(String(rows[i][1]));
      }
    }
  } catch(e2) {
    // Not yet authorized — page will load, user authenticates via API calls
    usernames = [];
  }
  var template = HtmlService.createTemplateFromFile('Index');
  template.usernames = JSON.stringify(usernames);
  var output = template.evaluate();
  output.setTitle('Orchard Amritaya — Snag Check');
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  output.addMetaTag('viewport','width=device-width, initial-scale=1.0');
  return output;
}

// ── HELPERS ─────────────────────────────────────────────────
function getSheet(name) {
  return SpreadsheetApp.openById(SS_ID).getSheetByName(name);
}

function sheetData(name) {
  const sh = getSheet(name);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = (r[i] === '' || r[i] === null || r[i] === undefined) ? null : r[i]);
    return obj;
  });
}

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function ok(data) { return { status: 'ok',    data: data }; }
function err(msg)  { return { status: 'error', msg: msg  }; }

// ── AUTH ─────────────────────────────────────────────────────
function getUsernames() {
  // Deliberately simple — no helper functions, direct API only
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sh    = ss.getSheetByName(SHEET.USERS);
    var rows  = sh.getDataRange().getValues();
    var names = [];
    // Row 0 is header, username is column index 1
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][1]) names.push(String(rows[i][1]));
    }
    return { status: 'ok', data: names };
  } catch(e) {
    return { status: 'error', msg: e.message };
  }
}

function login(username, pin) {
  // Deliberately simple — no helper functions, direct API only
  try {
    var ss   = SpreadsheetApp.openById(SS_ID);
    var sh   = ss.getSheetByName(SHEET.USERS);
    var rows = sh.getDataRange().getValues();
    var u    = String(username || '').trim().toLowerCase();
    var p    = String(pin      || '').trim();
    // Headers: userId=0, username=1, pin=2, role=3
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][1] || '').trim().toLowerCase() === u &&
          String(rows[i][2] || '').trim()               === p) {
        return { status: 'ok', data: { username: String(rows[i][1]), role: String(rows[i][3]) } };
      }
    }
    return { status: 'error', msg: 'Invalid username or PIN' };
  } catch(e) {
    return { status: 'error', msg: e.message };
  }
}


// ── USERS / TEAM ─────────────────────────────────────────────
function getTeam() {
  try {
    return ok(sheetData(SHEET.USERS).map(u => ({
      userId: u.userId, username: u.username, role: u.role
    })));
  } catch(e) { return err(e.message); }
}

function saveTeam(userId, username, pin, role) {
  try {
    const sh    = getSheet(SHEET.USERS);
    const rows  = sh.getDataRange().getValues();
    if (userId) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === userId) {
          // If PIN is empty, keep existing PIN
          const newPin = pin ? pin : rows[i][2];
          sh.getRange(i + 1, 1, 1, 4).setValues([[userId, username, newPin, role]]);
          return ok('Updated');
        }
      }
      return err('User not found');
    } else {
      sh.appendRow([newId('USR'), username, pin, role]);
      return ok('Created');
    }
  } catch(e) { return err(e.message); }
}

function deleteTeam(userId) {
  try {
    const sh   = getSheet(SHEET.USERS);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === userId) { sh.deleteRow(i + 1); return ok('Deleted'); }
    }
    return err('User not found');
  } catch(e) { return err(e.message); }
}

// ── FLATS ────────────────────────────────────────────────────
function getFlats() {
  try { return ok(sheetData(SHEET.FLATS)); }
  catch(e) { return err(e.message); }
}

function saveFlat(flatId, tower, floor, flatNo, flatType) {
  try {
    const sh   = getSheet(SHEET.FLATS);
    const rows = sh.getDataRange().getValues();
    if (flatId) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === flatId) {
          sh.getRange(i+1,1,1,5).setValues([[flatId,tower,floor,flatNo,flatType]]);
          return ok('Updated');
        }
      }
      return err('Flat not found');
    }
    const id = newId('FLT');
    sh.appendRow([id, tower, floor, flatNo, flatType]);
    return ok({ flatId: id });
  } catch(e) { return err(e.message); }
}

function deleteFlat(flatId) {
  try {
    const sh   = getSheet(SHEET.FLATS);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === flatId) { sh.deleteRow(i+1); return ok('Deleted'); }
    }
    return err('Flat not found');
  } catch(e) { return err(e.message); }
}

// ── SNAG MASTER ──────────────────────────────────────────────
function getSnagMaster() {
  try { return ok(sheetData(SHEET.SNAG)); }
  catch(e) { return err(e.message); }
}

function updateSnagMaster(snagId, respContractor, checkingArea, respName) {
  try {
    const sh   = getSheet(SHEET.SNAG);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === snagId) {
        sh.getRange(i+1,4,1,3).setValues([[respContractor,checkingArea,respName]]);
        return ok('Updated');
      }
    }
    return err('Not found');
  } catch(e) { return err(e.message); }
}

// ── ASSET MASTER ─────────────────────────────────────────────
// assetType: '2BHK_AH' | '2BHK_DE' | '3BHK'
function getAssetMaster(assetType) {
  try {
    const all = sheetData(SHEET.ASSET);
    if (assetType) return ok(all.filter(r => r.assetType === assetType));
    return ok(all);
  } catch(e) { return err(e.message); }
}

function updateAssetMaster(assetId, field, value, changedBy, flatId) {
  try {
    const sh   = getSheet(SHEET.ASSET);
    const rows = sh.getDataRange().getValues();
    const headers = rows[0];
    const colMap = {};
    headers.forEach((h,i) => colMap[h]=i);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === assetId) {
        const colIdx = colMap[field];
        if (colIdx === undefined) return err('Unknown field: ' + field);
        const oldVal = rows[i][colIdx];
        sh.getRange(i+1, colIdx+1).setValue(value);
        if (flatId) _addLog(flatId, assetId, field, oldVal, value, changedBy, 'asset');
        return ok('Updated');
      }
    }
    return err('Asset not found');
  } catch(e) { return err(e.message); }
}

// ── SNAG INSPECTIONS ─────────────────────────────────────────
function getInspections(flatId) {
  try {
    return ok(sheetData(SHEET.INSPECT).filter(r => r.flatId === flatId));
  } catch(e) { return err(e.message); }
}

function saveInspection(payload) {
  // payload: { flatId, snagId, field, value, changedBy }
  try {
    const sh      = getSheet(SHEET.INSPECT);
    const rows    = sh.getDataRange().getValues();
    const headers = rows[0];
    const colMap  = {};
    headers.forEach((h,i) => colMap[h]=i);
    const fieldCol = colMap[payload.field];
    if (fieldCol === undefined) return err('Unknown field: ' + payload.field);

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][colMap['flatId']] === payload.flatId &&
          rows[i][colMap['snagId']] === payload.snagId) {
        const oldVal = rows[i][fieldCol];
        sh.getRange(i+1, fieldCol+1).setValue(payload.value);
        _addLog(payload.flatId, payload.snagId, payload.field, oldVal, payload.value, payload.changedBy, 'snag');
        return ok('Updated');
      }
    }
    // New row
    const id  = newId('INS');
    const row = new Array(headers.length).fill('');
    row[colMap['rowId']]       = id;
    row[colMap['flatId']]      = payload.flatId;
    row[colMap['snagId']]      = payload.snagId;
    row[colMap['status']]      = payload.field === 'status' ? payload.value : 'Pending';
    row[colMap[payload.field]] = payload.value;
    sh.appendRow(row);
    _addLog(payload.flatId, payload.snagId, payload.field, '', payload.value, payload.changedBy, 'snag');
    return ok({ rowId: id });
  } catch(e) { return err(e.message); }
}

// ── ASSET INSPECTIONS ────────────────────────────────────────
function getAssetInspections(flatId) {
  try {
    return ok(sheetData(SHEET.AINSPECT).filter(r => r.flatId === flatId));
  } catch(e) { return err(e.message); }
}

function saveAssetInspection(payload) {
  // payload: { flatId, assetId, field, value, changedBy }
  try {
    const sh      = getSheet(SHEET.AINSPECT);
    const rows    = sh.getDataRange().getValues();
    const headers = rows[0];
    const colMap  = {};
    headers.forEach((h,i) => colMap[h]=i);
    const fieldCol = colMap[payload.field];
    if (fieldCol === undefined) return err('Unknown field: ' + payload.field);

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][colMap['flatId']]  === payload.flatId &&
          rows[i][colMap['assetId']] === payload.assetId) {
        const oldVal = rows[i][fieldCol];
        sh.getRange(i+1, fieldCol+1).setValue(payload.value);
        _addLog(payload.flatId, payload.assetId, payload.field, oldVal, payload.value, payload.changedBy, 'asset');
        return ok('Updated');
      }
    }
    const id  = newId('AIN');
    const row = new Array(headers.length).fill('');
    row[colMap['rowId']]       = id;
    row[colMap['flatId']]      = payload.flatId;
    row[colMap['assetId']]     = payload.assetId;
    row[colMap['status']]      = payload.field === 'status' ? payload.value : 'Pending';
    row[colMap[payload.field]] = payload.value;
    sh.appendRow(row);
    _addLog(payload.flatId, payload.assetId, payload.field, '', payload.value, payload.changedBy, 'asset');
    return ok({ rowId: id });
  } catch(e) { return err(e.message); }
}

// ── PHOTOS ───────────────────────────────────────────────────
function uploadPhoto(flatId, refId, round, base64Data, mimeType, fileName, uploadedBy, section) {
  try {
    // Multiple photos allowed — no auto-replace
    // Get flat info for folder routing
    var tower = '', flatNo = flatId;
    var fsh   = getSheet(SHEET.FLATS);
    var frows = fsh.getDataRange().getValues();
    var fh    = frows[0]; var fci = {};
    for (var x = 0; x < fh.length; x++) fci[String(fh[x]).trim()] = x;
    for (var i = 1; i < frows.length; i++) {
      if (String(frows[i][fci['flatId']] || '').trim() === String(flatId || '').trim()) {
        tower  = String(frows[i][fci['tower']]  || '');
        flatNo = String(frows[i][fci['flatNo']] || flatId);
        break;
      }
    }
    // Upload to Drive
    var folderId = getPhotoFolderId(tower, section);
    var folder   = DriveApp.getFolderById(folderId);
    function getOrCreate(parent, name) {
      var it = parent.getFoldersByName(name);
      return it.hasNext() ? it.next() : parent.createFolder(name);
    }
    var flatFolder  = getOrCreate(folder, flatNo);
    var roundFolder = getOrCreate(flatFolder, round);
    var blob   = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    var file   = roundFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId   = file.getId();
    var viewUrl  = 'https://drive.google.com/file/d/' + fileId + '/view';
    var thumbUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
    var photoId  = newId('PHT');
    getSheet(SHEET.PHOTOS).appendRow([photoId, flatId, refId, round, section || 'snag', fileId, viewUrl, thumbUrl, uploadedBy, new Date()]);
    _addLog(flatId, refId, 'photo_' + round, '', viewUrl, uploadedBy, section || 'snag');
    return ok({ photoId: photoId, viewUrl: viewUrl, thumbUrl: thumbUrl, fileId: fileId });
  } catch(e) { return err('uploadPhoto: ' + e.message); }
}
function getPhotos(flatId, refId, section) {
  try {
    var sh = getSheet(SHEET.PHOTOS);
    if (!sh) return ok([]);
    var rows = sh.getDataRange().getValues();
    if (rows.length < 2) return ok([]);
    // Map headers
    var h = rows[0];
    var ci = {};
    for (var x = 0; x < h.length; x++) ci[String(h[x]).trim()] = x;
    var results = [];
    var fId = String(flatId || '').trim();
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (String(r[ci['flatId']] || '').trim() !== fId) continue;
      if (refId && String(r[ci['refId']] || '').trim() !== String(refId).trim()) continue;
      if (section && String(r[ci['section']] || '').trim() !== String(section).trim()) continue;
      results.push({
        photoId   : String(r[ci['photoId']]   || ''),
        flatId    : String(r[ci['flatId']]    || ''),
        refId     : String(r[ci['refId']]     || ''),
        round     : String(r[ci['round']]     || ''),
        section   : String(r[ci['section']]   || 'snag'),
        fileId    : String(r[ci['fileId']]    || ''),
        viewUrl   : String(r[ci['viewUrl']]   || ''),
        thumbUrl  : String(r[ci['thumbUrl']]  || ''),
        uploadedBy: String(r[ci['uploadedBy']]|| ''),
        timestamp : r[ci['timestamp']] ? String(r[ci['timestamp']]) : ''
      });
    }
    return ok(results);
  } catch(e) { return err('getPhotos: ' + e.message); }
}


function deletePhoto(photoId, deletedBy) {
  try {
    var sh   = getSheet(SHEET.PHOTOS);
    var rows = sh.getDataRange().getValues();
    var h    = rows[0]; var ci = {};
    for (var x = 0; x < h.length; x++) ci[String(h[x]).trim()] = x;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][ci['photoId']] || '').trim() === String(photoId || '').trim()) {
        var flatId  = String(rows[i][ci['flatId']]  || '');
        var refId   = String(rows[i][ci['refId']]   || '');
        var round   = String(rows[i][ci['round']]   || '');
        var section = String(rows[i][ci['section']] || 'snag');
        var viewUrl = String(rows[i][ci['viewUrl']] || '');
        // Log deletion before deleting row
        _addLog(flatId, refId, 'photo_' + round, viewUrl, 'DELETED', deletedBy || 'unknown', section);
        // Delete from Drive
        try { DriveApp.getFileById(String(rows[i][ci['fileId']] || '')).setTrashed(true); } catch(e2) {}
        sh.deleteRow(i + 1);
        return ok('Deleted');
      }
    }
    return err('Photo not found');
  } catch(e) { return err('deletePhoto: ' + e.message); }
}

function getActivityLog(flatId, section) {
  try {
    var sh = getSheet(SHEET.LOG);
    if (!sh) return ok([]);
    var rows = sh.getDataRange().getValues();
    if (rows.length < 2) return ok([]);
    // Map headers
    var h = rows[0];
    var ci = {};
    for (var x = 0; x < h.length; x++) ci[String(h[x]).trim()] = x;
    // Check structure
    if (ci['tower'] === undefined) return err('ActivityLog sheet has old headers. Run fixActivityLogHeaders() first.');
    // Resolve flat filter
    var filterTower = '', filterFlatNo = '';
    if (flatId) {
      var fsh = getSheet(SHEET.FLATS);
      var frows = fsh.getDataRange().getValues();
      var fh = frows[0];
      var fci = {};
      for (var x = 0; x < fh.length; x++) fci[String(fh[x]).trim()] = x;
      for (var i = 1; i < frows.length; i++) {
        if (String(frows[i][fci['flatId']] || '').trim() === String(flatId).trim()) {
          filterTower  = String(frows[i][fci['tower']]  || '').trim();
          filterFlatNo = String(frows[i][fci['flatNo']] || '').trim();
          break;
        }
      }
    }
    var results = [];
    var secFilter = section ? String(section).trim() : '';
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var rTower  = String(r[ci['tower']]   || '').trim();
      var rFlatNo = String(r[ci['flatNo']]  || '').trim();
      var rSec    = String(r[ci['section']] || '').trim();
      if (flatId  && (rTower !== filterTower || rFlatNo !== filterFlatNo)) continue;
      if (secFilter && rSec !== secFilter) continue;
      results.push({
        logId       : String(r[ci['logId']]        || ''),
        tower       : rTower,
        floor       : String(r[ci['floor']]        || ''),
        flatNo      : rFlatNo,
        flatType    : String(r[ci['flatType']]     || ''),
        section     : rSec || 'snag',
        location    : String(r[ci['location']]     || ''),
        pointLabel  : String(r[ci['pointLabel']]   || ''),
        columnHeader: String(r[ci['columnHeader']] || ''),
        oldVal      : String(r[ci['oldVal']]       || ''),
        newVal      : String(r[ci['newVal']]       || ''),
        changedBy   : String(r[ci['changedBy']]    || ''),
        timestamp   : r[ci['timestamp']] ? String(r[ci['timestamp']]) : ''
      });
    }
    results.reverse();
    return ok(results.slice(0, 500));
  } catch(e) { return err('getActivityLog: ' + e.message); }
}


// ── SETUP ─────────────────────────────────────────────────────
// Run ONCE manually from Apps Script editor
function setupSheets() {
  const ss = SpreadsheetApp.openById(SS_ID);

  function ensureSheet(name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name); else sh.clearContents();
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.getRange(1,1,1,headers.length).setBackground('#0f2744').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }

  ensureSheet(SHEET.USERS,    ['userId','username','pin','role']);
  ensureSheet(SHEET.FLATS,    ['flatId','tower','floor','flatNo','flatType']);
  ensureSheet(SHEET.SNAG,     ['snagId','location','snagPoint','respContractor','checkingArea','respName']);
  ensureSheet(SHEET.ASSET,    ['assetId','assetType','location','assetPoint','numbers','respPerson']);
  ensureSheet(SHEET.INSPECT,  ['rowId','flatId','snagId','status','r1SnagRemark','r1DeSnagRemark','r2SnagRemark','r2DeSnagRemark']);
  ensureSheet(SHEET.AINSPECT, ['rowId','flatId','assetId','status','r1SnagRemark','r1DeSnagRemark','r2SnagRemark','r2DeSnagRemark']);
  ensureSheet(SHEET.PHOTOS,   ['photoId','flatId','refId','round','section','fileId','viewUrl','thumbUrl','uploadedBy','timestamp']);
  ensureSheet(SHEET.OVERRIDES, ['overrideId','flatId','refId','section','field','value']);
  ensureSheet(SHEET.LOG,      ['logId','tower','floor','flatNo','flatType','section','location','pointLabel','columnHeader','oldVal','newVal','changedBy','timestamp']);

  // Seed admin
  ss.getSheetByName(SHEET.USERS).appendRow([newId('USR'),'admin','1234','Admin']);

  // Seed flats — flatType only matters for asset loading, snag is same for all
  const flatSh = ss.getSheetByName(SHEET.FLATS);
  const floors = [1,2,3,4,5,6,7,8,9,10,11,12];
  const units  = ['A','B','C','D','E','F','G','H'];
  floors.forEach(f => units.forEach(u => {
    let ft = '3BHK';
    if (u==='A'||u==='H') ft='2BHK_AH';
    else if (u==='D'||u==='E') ft='2BHK_DE';
    flatSh.appendRow([newId('FLT'),'Prayag',f,f+u,ft]);
  }));

  _seedSnagMaster(ss.getSheetByName(SHEET.SNAG));
  _seedAssetMaster(ss.getSheetByName(SHEET.ASSET));

  SpreadsheetApp.flush();
  return 'Setup complete!';
}

// ── Run this ONCE if your ActivityLog sheet has old headers ──
// Updates only header row 1 without deleting existing log data
// ── Run this ONCE to add Veni tower flats ──
// Same floor/unit structure as Prayag: floors 1-12, units A-H
// Does NOT touch any existing data — only appends new rows to Flats sheet
function addVeniFlats() {
  var ss      = SpreadsheetApp.openById(SS_ID);
  var flatSh  = ss.getSheetByName(SHEET.FLATS);
  var rows    = flatSh.getDataRange().getValues();
  // Check if Veni already exists
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]||'').trim() === 'Veni') {
      return 'Veni flats already exist (' + (rows.length-1) + ' total rows). Aborting to prevent duplicates.';
    }
  }
  var floors = [1,2,3,4,5,6,7,8,9,10,11,12];
  var units  = ['A','B','C','D','E','F','G','H'];
  var count  = 0;
  floors.forEach(function(f) {
    units.forEach(function(u) {
      var ft = '3BHK';
      if (u==='A'||u==='H') ft='2BHK_AH';
      else if (u==='D'||u==='E') ft='2BHK_DE';
      flatSh.appendRow([newId('FLT'), 'Veni', f, f+u, ft]);
      count++;
    });
  });
  SpreadsheetApp.flush();
  return 'Done! Added ' + count + ' Veni flats (floors 1-12, units A-H).';
}

function fixActivityLogHeaders() {
  const ss = SpreadsheetApp.openById(SS_ID);
  let sh = ss.getSheetByName(SHEET.LOG);
  if (!sh) sh = ss.insertSheet(SHEET.LOG);
  const headers = ['logId','tower','floor','flatNo','flatType','section','location','pointLabel','columnHeader','oldVal','newVal','changedBy','timestamp'];
  if (sh.getLastColumn() < headers.length) {
    sh.insertColumnsAfter(sh.getLastColumn(), headers.length - sh.getLastColumn());
  }
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.getRange(1,1,1,headers.length).setBackground('#0f2744').setFontColor('#ffffff').setFontWeight('bold');
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();
  return 'ActivityLog headers fixed! Existing log data preserved.';
}

function _seedSnagMaster(sh) {
  const data = [
    ['Main Door & Entrance','Door frame and shutter polish / lamination status (Outside)','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door hinge cutting / fitting checking required','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door shutter alignment required','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door shutter corner chipped','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door shutter scratched / damaged status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door bit and door frame crack / damaged status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door bit to door frame gap filling required','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door frame to wall gap filling required','ARCHETIVE SOLUTION OR AMIRUL ISLAM','DOOR FRAME & FINISHING CIVIL WORK','LALAN THAKUR'],
    ['Main Door & Entrance','Door base tiles properly finishing required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Main Door & Entrance','Door magic eye fitting status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Cylindrical lock alignment / not working properly','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Door latch not properly fitting checking status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Main door shutter size status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Main door shutter stickiness','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Main door lock working condition','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Main Door & Entrance','Corners / edges finished properly in line and level','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Living Room & Dining Area','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Floor tile broken / crack status checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Floor tile proper grouting required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Floor tile up / down checking status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Floor tile to skirting gap filling required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Skirting tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Skirting tile hollow','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Living Room & Dining Area','Wall surface free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Living Room & Dining Area','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Living Room & Dining Area','Putty surface not chalking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Living Room & Dining Area','Putty surface — no undulations throughout walls and ceiling','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','LALAN THAKUR'],
    ['Living Room & Dining Area','Putty overall finishing uniform — no colour variation','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Living Room & Dining Area','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','Main DB box — all MCB correct locations & working','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','Flow chart available in DB box','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','DB box lock status','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','All switch boards fittings in line and level','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','All sockets have power — working properly','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','No exposed wiring','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','Blank plate fixing status in JB box','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','Broadband and DTH installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','Light / Fan / calling bell / regulator / AC starter installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Living Room & Dining Area','Sliding door glass scratched (Right / Middle / Left)','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Living Room & Dining Area','Sliding door locks status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','LALAN THAKUR'],
    ['Living Room & Dining Area','Sliding door shutter alignment checking','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','LALAN THAKUR'],
    ['Living Room & Dining Area','Sliding door frame to wall gap filling required','ARCHETIVE SOLUTION OR AMIRUL ISLAM','DOOR FRAME & FINISHING CIVIL WORK','LALAN THAKUR'],
    ['Living Room & Dining Area','AC outdoor unit brackets installed rigid and not rusted','UNITED ENGINEERING','ALL TYPES OF FABRICATION WORK','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Living Room & Dining Area','AC drain line correct slope','BICHITRA KUMAR NAYAK','PHE','SWARNENDU PATRA'],
    ['Living Room & Dining Area','AC piping — core cut hole proper finishing required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Living Room & Dining Area','Cobla soffit sill of window & Door Undulation Checking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Living Room & Dining Area','Putty finishing status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Living Room & Dining Area','Skirting tiles up/down level','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Skirting tiles hollow checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Living Room & Dining Area','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Living Room & Dining Area','Wall misalignment/bend Checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','Fittings — locks and all screws fixed in all fittings','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['LR Balcony','Wall and balcony frame gap filling required','ARCHETIVE SOLUTION OR AMIRUL ISLAM','DOOR FRAME & FINISHING CIVIL WORK','LALAN THAKUR'],
    ['LR Balcony','Floor and balcony frame gap filling required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Floor tile broken / crack status checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Floor tile proper grouting required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Floor tile up / down checking status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Floor sloping status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','Wall surface free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','Putty surface not chalking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['LR Balcony','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['LR Balcony','Trap jam checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['LR Balcony','Grating jali installation checking','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['LR Balcony','Railing MS post rusted','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['LR Balcony','Railing base plate fitting status checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','Railing base plate lower portion grouting required','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','AC piping — core cut hole proper finishing required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['LR Balcony','Balcony chajja bottom outside drip mould finish properly','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','LALAN THAKUR'],
    ['LR Balcony','Shaft not finishing properly checking status','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['LR Balcony','Cobla soffit sill of window & Door Undulation Checking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','Putty finishing status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['LR Balcony','Skirting tiles up/down level','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Skirting tiles hollow checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Skirting tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['LR Balcony','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['LR Balcony','Wall misalignment/bend Checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Floor tile broken / crack status checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Wall tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Wall tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Wall tile broken / crack checking status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen','Wall surface free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Kitchen','All sockets have power — working properly','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Kitchen','Light / Fan / exhaust fan installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Kitchen','Kitchen sink and tap installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Kitchen','Bib cock installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Kitchen','Kitchen platform granite checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Kitchen platform granite joint filling required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Water supply checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Kitchen','Drain pipe checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Kitchen','Exhaust hole checking required','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY'],
    ['Kitchen','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen','Wall misalignment/bend Checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen','Window checking status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY'],
    ['Kitchen','Skirting tiles up/down level','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Skirting tiles hollow checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Skirting tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Floor tiles up/down level checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen','Putty finishing status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Kitchen','Cobla soffit sill of window & Door Undulation Checking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Common Toilet','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Common Toilet','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Common Toilet','Wall tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Common Toilet','Wall tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Common Toilet','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Common Toilet','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Common Toilet','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Common Toilet','Basin installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Basin tap installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Commode installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Shower installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Hand shower installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Bib cock installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Deviator installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Door frame and shutter proper polish / lamination status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Common Toilet','Water supply checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Drain pipe checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Common Toilet','Door Lock Status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Common Toilet','Floor Sloping Status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Common Toilet','Floor Tiles up/down Checking Status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Common Toilet','Window frame to wall tiles joint gap filling','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','ARITRA KUMAR ROY'],
    ['Common Toilet','Wall tiles proper Grouting Required','AMIR SOYEL','TILES','ARITRA KUMAR ROY'],
    ['Common Toilet','Floor Tiles Proper Grouting Required','AMIR SOYEL','TILES','ARITRA KUMAR ROY'],
    ['Common Toilet','False Ceiling Checking Required','C.T.ENTERPRISE','FALSE CEILING','ARITRA KUMAR ROY'],
    ['BR-1','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-1','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-1','Wall ceiling free from cracks — checking required','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-1','Wall surface free from cracks — checking required','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-1','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-1','Putty surface not chalking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['BR-1','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ARITRA KUMAR ROY'],
    ['BR-1','All sockets have power — working properly','R.B.ELECTRIC','ELECTRICAL WORK','ARITRA KUMAR ROY'],
    ['BR-1','Light / Fan / AC starter installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ARITRA KUMAR ROY'],
    ['BR-1','Sliding door glass scratched','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['BR-1','Sliding door locks status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','LALAN THAKUR'],
    ['BR-1','AC outdoor unit brackets installed rigid and not rusted','UNITED ENGINEERING','ALL TYPES OF FABRICATION WORK','LALAN THAKUR'],
    ['BR-1','AC piping — core cut hole proper finishing required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['BR-1','Door frame and shutter checking','ARCHETIVE SOLUTION & A.R.ENTERPRISE','DOOR FRAME & DOOR SHUTTER','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['BR-1','Door Lock status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['BR-1','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-1','Wall misalignment/bend checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-1','Window checking status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY'],
    ['BR-1','Skirting tiles up/down level checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-1','Skirting tiles hollow checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-1','Skirting tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-1','Floor tiles up/down level checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-1','Putty finishing status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['BR-1','Door frame to wall gap filling required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['BR-1','Cobla soffit sill of window & Door Undulation Checking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom (MBR)','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom (MBR)','Wall surface free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom (MBR)','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom (MBR)','Putty surface not chalking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Master Bedroom (MBR)','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Master Bedroom (MBR)','All sockets have power — working properly','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Master Bedroom (MBR)','Light / Fan / AC starter installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Master Bedroom (MBR)','Sliding door glass scratched','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Master Bedroom (MBR)','Sliding door locks status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','LALAN THAKUR'],
    ['Master Bedroom (MBR)','AC outdoor unit brackets installed rigid and not rusted','UNITED ENGINEERING','ALL TYPES OF FABRICATION WORK','LALAN THAKUR'],
    ['Master Bedroom (MBR)','AC drain line correct slope','BICHITRA KUMAR NAYAK','PHE','SWARNENDU PATRA'],
    ['Master Bedroom (MBR)','Door frame and shutter checking','ARCHETIVE SOLUTION & A.R.ENTERPRISE','DOOR FRAME & DOOR SHUTTER','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Master Bedroom (MBR)','Door Lock status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Master Bedroom (MBR)','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom (MBR)','Wall misalignment/bend checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom (MBR)','Window checking status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY'],
    ['Master Bedroom (MBR)','Skirting tiles up/down level checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Skirting tiles hollow checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Skirting tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Floor tiles up/down level checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Putty finishing status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Master Bedroom (MBR)','AC piping — core cut hole proper finishing required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Door frame to wall gap filling required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['Master Bedroom (MBR)','Cobla soffit sill of window & Door Undulation Checking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom Toilet (MBRT)','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom Toilet (MBRT)','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom Toilet (MBRT)','Wall tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom Toilet (MBRT)','Wall tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom Toilet (MBRT)','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom Toilet (MBRT)','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Master Bedroom Toilet (MBRT)','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Basin installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Basin tap installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Commode installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Shower installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Hand shower installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Bib cock installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Deviator installation checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Water supply checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Drain pipe checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Master Bedroom Toilet (MBRT)','Door Lock Status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Master Bedroom Toilet (MBRT)','Floor Sloping Status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom Toilet (MBRT)','Floor Tiles up/down Checking Status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom Toilet (MBRT)','Window frame to wall tiles joint gap filling','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Master Bedroom Toilet (MBRT)','Wall tiles proper Grouting Required','AMIR SOYEL','TILES','ARITRA KUMAR ROY'],
    ['Master Bedroom Toilet (MBRT)','Floor Tiles Proper Grouting Required','AMIR SOYEL','TILES','ARITRA KUMAR ROY'],
    ['Master Bedroom Toilet (MBRT)','False Ceiling Checking Required','C.T.ENTERPRISE','FALSE CEILING','ARITRA KUMAR ROY'],
    ['BR-2','Floor tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-2','Floor tile hollow checking required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-2','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-2','Wall surface free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-2','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-2','Putty surface not chalking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['BR-2','Electrical switch board and switch installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['BR-2','Light / Fan / AC starter installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['BR-2','Sliding door glass scratched','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['BR-2','AC piping — core cut hole proper finishing required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['BR-2','Door frame and shutter checking','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['BR-2','Door Lock status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY'],
    ['BR-2','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-2','Wall misalignment/bend checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['BR-2','Window checking status','ANNEX','ALUMINIUM WINDOW FRAME AND WINDOW SHUTTER','ARITRA KUMAR ROY'],
    ['BR-2','Skirting tiles up/down level checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-2','Skirting tiles hollow checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-2','Skirting tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-2','Floor tiles up/down level checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['BR-2','Putty finishing status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['BR-2','Door frame to wall gap filling required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['BR-2','Cobla soffit sill of window & Door Undulation Checking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Bedroom Attached Balcony','Wall to Door frame gap filling Required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Floor Tiles Chipped Need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Floor tiles Hollow Checking Required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Floor tiles Broken/crack status checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Floor tiles proper grouting required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Floor tiles up/down level checking status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Floor sloping status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Bedroom Attached Balcony','Wall surface free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Bedroom Attached Balcony','Putty surface — no undulation through wall & ceiling','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Bedroom Attached Balcony','Door Lock Status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Bedroom Attached Balcony','Wall Misalignment/bend checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Bedroom Attached Balcony','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Bedroom Attached Balcony','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Bedroom Attached Balcony','Putty surface not chalking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Bedroom Attached Balcony','Electrical switchboard and switch Installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Bedroom Attached Balcony','Trap jam checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Bedroom Attached Balcony','Gratings Jali Installation checking','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Bedroom Attached Balcony','Railing MS Post Rusted','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Bedroom Attached Balcony','Railing base plate fitting status checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Bedroom Attached Balcony','AC piping — core cut proper finishing required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Bedroom Attached Balcony','Shaft Not finishing properly checking status','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Bedroom Attached Balcony','Putty Finishing Checking Required','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Bedroom Attached Balcony','Skirting Tiles Chipped Need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Skirting tiles Hollow Checking Required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Skirting tiles Broken/crack status checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Skirting tiles proper grouting required','AMIR SOYEL','TILES','ARITRA KUMAR ROY'],
    ['Bedroom Attached Balcony','Skirting tiles up/down level checking status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Bedroom Attached Balcony','Cobla soffit sill Window & door Checking Required','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen Utility Balcony','Wall to Door frame gap filling Required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Floor Tiles Chipped Need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Floor tiles Hollow Checking Required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Floor tiles Broken/crack status checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Floor tiles proper grouting required','AMIR SOYEL','TILES','ARITRA KUMAR ROY'],
    ['Kitchen Utility Balcony','Floor tiles up/down level checking status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Floor sloping status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Wall ceiling free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen Utility Balcony','Wall surface free from cracks — checking required','TAHU WATERPROOFING','CRACK REPAIRING','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen Utility Balcony','Putty surface — no undulation through wall & ceiling','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Kitchen Utility Balcony','Door Lock Status','A.R.ENTERPRISE','DOOR SHUTTER & MOULDING BID FIXING','ARITRA KUMAR ROY'],
    ['Kitchen Utility Balcony','Wall Misalignment/bend checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen Utility Balcony','Wall surface undulation checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen Utility Balcony','Damp on wall checking status','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen Utility Balcony','Putty surface not chalking','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','ARITRA KUMAR ROY'],
    ['Kitchen Utility Balcony','Electrical switchboard and switch Installation checking','R.B.ELECTRIC','ELECTRICAL WORK','ABHISEKH JAISWAL'],
    ['Kitchen Utility Balcony','Trap jam checking required','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Kitchen Utility Balcony','Gratings Jali Installation checking','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Kitchen Utility Balcony','Railing MS Post Rusted','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Railing base plate fitting status checking','STRUCTURAL CONTRACTOR','STRUCTURAL WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
    ['Kitchen Utility Balcony','AC piping — core cut proper finishing required','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Shaft Not finishing properly checking status','AMIRUL ISLAM','FINISHING CIVIL REPAIRING WORK','ARITRA KUMAR ROY AND LALAN THAKUR'],
    ['Kitchen Utility Balcony','Angle Stop cock Checking','BICHITRA KUMAR NAYAK','PHE','ABHISEKH JAISWAL'],
    ['Kitchen Utility Balcony','Skirting Tiles Chipped Need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Skirting tiles Hollow Checking Required','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Skirting tiles Broken/crack status checking','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Skirting tiles proper grouting required','AMIR SOYEL','TILES','ARITRA KUMAR ROY'],
    ['Kitchen Utility Balcony','Skirting tiles up/down level checking status','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Skirting tile chipped need to be finished','AMIR SOYEL','TILES','LALAN THAKUR'],
    ['Kitchen Utility Balcony','Cobla soffit sill Window & door Checking Required','PAPPU PUTTY','PUTTY & PATTA PARIS WORK','GOURANGA DAS, KARTICK METE, SAIKAT SAMANTA, DIGANTA KATHI'],
  ];
  sh.getRange(2,1,data.length,6).setValues(data.map(d => [newId('SNG'),d[0],d[1],d[2],d[3],d[4]]));
}

function _seedAssetMaster(sh) {
  // [assetType, location, assetPoint, numbers, respPerson]
  const data = [
    // ── 2BHK_AH ─────────────────────────────────────
    ['2BHK_AH','Master Bedroom (MBR)','Circular Cover',6,''],
    ['2BHK_AH','Master Bedroom (MBR)','12 Modular Board',1,''],
    ['2BHK_AH','Master Bedroom (MBR)','6 Modular Board',1,''],
    ['2BHK_AH','Master Bedroom (MBR)','4 Modular Board',2,''],
    ['2BHK_AH','Master Bedroom (MBR)','3 Modular Board',1,''],
    ['2BHK_AH','Master Bedroom (MBR)','2 Modular Board',3,''],
    ['2BHK_AH','Master Bedroom (MBR)','1 Modular Board',1,''],
    ['2BHK_AH','Master Bedroom (MBR)','AC Starter',1,''],
    ['2BHK_AH','Master Bedroom (MBR)','Foot Light',1,''],
    ['2BHK_AH','Master Bedroom (MBR)','Mortise Handle Lock With Rose',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Circular Cover',4,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','8 Modular Board',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','2 Modular Board',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','1 Modular Board',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Basin',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Commode',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Shower Head',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Shower Arm',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Hand Shower',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Bip Cock',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Deviator',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Bath Spout',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Angular Cock',6,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Mortise Handle Lock Without Rose',1,''],
    ['2BHK_AH','Master Bedroom Toilet (MBRT)','Baby Latch',1,''],
    ['2BHK_AH','Living Room & Dining Area','Circular Cover',8,''],
    ['2BHK_AH','Living Room & Dining Area','8 Modular Board',2,''],
    ['2BHK_AH','Living Room & Dining Area','6 Modular Board',2,''],
    ['2BHK_AH','Living Room & Dining Area','4 Modular Board',1,''],
    ['2BHK_AH','Living Room & Dining Area','3 Modular Board',2,''],
    ['2BHK_AH','Living Room & Dining Area','2 Modular Board',4,''],
    ['2BHK_AH','Living Room & Dining Area','AC Starter',1,''],
    ['2BHK_AH','Living Room & Dining Area','DB',1,''],
    ['2BHK_AH','Living Room & Dining Area','Joint Box with Cover',1,''],
    ['2BHK_AH','Living Room & Dining Area','Night Latch Key with Knob',1,''],
    ['2BHK_AH','Living Room & Dining Area','Main Door Handle',1,''],
    ['2BHK_AH','Living Room & Dining Area','Magic Eye',1,''],
    ['2BHK_AH','Living Room & Dining Area Balcony','3 Modular Board',1,''],
    ['2BHK_AH','Living Room & Dining Area Balcony','Circular Cover',1,''],
    ['2BHK_AH','Living Room & Dining Area Balcony','Angular Cock',1,''],
    ['2BHK_AH','Bedroom With Attached Balcony','Circular Cover',5,''],
    ['2BHK_AH','Bedroom With Attached Balcony','8 Modular Board',1,''],
    ['2BHK_AH','Bedroom With Attached Balcony','6 Modular Board',1,''],
    ['2BHK_AH','Bedroom With Attached Balcony','4 Modular Board',1,''],
    ['2BHK_AH','Bedroom With Attached Balcony','3 Modular Board',1,''],
    ['2BHK_AH','Bedroom With Attached Balcony','2 Modular Board',3,''],
    ['2BHK_AH','Bedroom With Attached Balcony','Foot Light',1,''],
    ['2BHK_AH','Bedroom With Attached Balcony','AC Starter',1,''],
    ['2BHK_AH','Bedroom With Attached Balcony','Mortise Handle Lock With Rose',1,''],
    ['2BHK_AH','Attached Balcony','Circular Cover',1,''],
    ['2BHK_AH','Attached Balcony','Mortise Handle Lock Without Rose',1,''],
    ['2BHK_AH','Common Toilet','Circular Cover',4,''],
    ['2BHK_AH','Common Toilet','4 Modular Board',1,''],
    ['2BHK_AH','Common Toilet','3 Modular Board',1,''],
    ['2BHK_AH','Common Toilet','2 Modular Board',1,''],
    ['2BHK_AH','Common Toilet','1 Modular Board',1,''],
    ['2BHK_AH','Common Toilet','Basin',1,''],
    ['2BHK_AH','Common Toilet','Commode',1,''],
    ['2BHK_AH','Common Toilet','Shower Head',1,''],
    ['2BHK_AH','Common Toilet','Shower Arm',1,''],
    ['2BHK_AH','Common Toilet','Hand Shower',1,''],
    ['2BHK_AH','Common Toilet','Bip Cock',1,''],
    ['2BHK_AH','Common Toilet','Deviator',1,''],
    ['2BHK_AH','Common Toilet','Bath Spout',1,''],
    ['2BHK_AH','Common Toilet','Angular Cock',6,''],
    ['2BHK_AH','Common Toilet','Mortise Handle Lock Without Rose',1,''],
    ['2BHK_AH','Common Toilet','Baby Latch',1,''],
    ['2BHK_AH','Kitchen','Circular Cover',3,''],
    ['2BHK_AH','Kitchen','8 Modular Board',1,''],
    ['2BHK_AH','Kitchen','3 Modular Board',3,''],
    ['2BHK_AH','Kitchen','2 Modular Board',1,''],
    ['2BHK_AH','Kitchen','Sink Cock',1,''],
    ['2BHK_AH','Kitchen','Sink',1,''],
    ['2BHK_AH','Kitchen','Bip Cock',1,''],
    ['2BHK_AH','Kitchen','Angular Cock',2,''],
    // ── 2BHK_DE ─────────────────────────────────────
    ['2BHK_DE','Master Bedroom (MBR)','Circular Cover',6,''],
    ['2BHK_DE','Master Bedroom (MBR)','12 Modular Board',1,''],
    ['2BHK_DE','Master Bedroom (MBR)','6 Modular Board',1,''],
    ['2BHK_DE','Master Bedroom (MBR)','4 Modular Board',2,''],
    ['2BHK_DE','Master Bedroom (MBR)','3 Modular Board',1,''],
    ['2BHK_DE','Master Bedroom (MBR)','2 Modular Board',3,''],
    ['2BHK_DE','Master Bedroom (MBR)','1 Modular Board',1,''],
    ['2BHK_DE','Master Bedroom (MBR)','AC Starter',1,''],
    ['2BHK_DE','Master Bedroom (MBR)','Foot Light',1,''],
    ['2BHK_DE','Master Bedroom (MBR)','Mortise Handle Lock With Rose',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Circular Cover',4,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','8 Modular Board',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','2 Modular Board',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','1 Modular Board',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Basin',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Commode',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Shower Head',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Shower Arm',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Hand Shower',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Bip Cock',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Deviator',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Bath Spout',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Angular Cock',6,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Mortise Handle Lock Without Rose',1,''],
    ['2BHK_DE','Master Bedroom Toilet (MBRT)','Baby Latch',1,''],
    ['2BHK_DE','Living Room & Dining Area','Circular Cover',8,''],
    ['2BHK_DE','Living Room & Dining Area','8 Modular Board',2,''],
    ['2BHK_DE','Living Room & Dining Area','6 Modular Board',2,''],
    ['2BHK_DE','Living Room & Dining Area','4 Modular Board',1,''],
    ['2BHK_DE','Living Room & Dining Area','3 Modular Board',2,''],
    ['2BHK_DE','Living Room & Dining Area','2 Modular Board',4,''],
    ['2BHK_DE','Living Room & Dining Area','AC Starter',1,''],
    ['2BHK_DE','Living Room & Dining Area','DB',1,''],
    ['2BHK_DE','Living Room & Dining Area','Joint Box with Cover',1,''],
    ['2BHK_DE','Living Room & Dining Area','Night Latch Key with Knob',1,''],
    ['2BHK_DE','Living Room & Dining Area','Main Door Handle',1,''],
    ['2BHK_DE','Living Room & Dining Area','Magic Eye',1,''],
    ['2BHK_DE','Living Room & Dining Area Balcony','3 Modular Board',1,''],
    ['2BHK_DE','Living Room & Dining Area Balcony','Circular Cover',1,''],
    ['2BHK_DE','Living Room & Dining Area Balcony','Angular Cock',1,''],
    ['2BHK_DE','Bedroom With Attached Balcony','Circular Cover',5,''],
    ['2BHK_DE','Bedroom With Attached Balcony','8 Modular Board',1,''],
    ['2BHK_DE','Bedroom With Attached Balcony','6 Modular Board',1,''],
    ['2BHK_DE','Bedroom With Attached Balcony','4 Modular Board',1,''],
    ['2BHK_DE','Bedroom With Attached Balcony','3 Modular Board',1,''],
    ['2BHK_DE','Bedroom With Attached Balcony','2 Modular Board',3,''],
    ['2BHK_DE','Bedroom With Attached Balcony','Foot Light',1,''],
    ['2BHK_DE','Bedroom With Attached Balcony','AC Starter',1,''],
    ['2BHK_DE','Bedroom With Attached Balcony','Mortise Handle Lock With Rose',1,''],
    ['2BHK_DE','Attached Balcony','Circular Cover',1,''],
    ['2BHK_DE','Attached Balcony','Mortise Handle Lock With Rose',1,''],
    ['2BHK_DE','Common Toilet','Circular Cover',4,''],
    ['2BHK_DE','Common Toilet','4 Modular Board',1,''],
    ['2BHK_DE','Common Toilet','3 Modular Board',1,''],
    ['2BHK_DE','Common Toilet','2 Modular Board',1,''],
    ['2BHK_DE','Common Toilet','1 Modular Board',1,''],
    ['2BHK_DE','Common Toilet','Basin',1,''],
    ['2BHK_DE','Common Toilet','Commode',1,''],
    ['2BHK_DE','Common Toilet','Shower Head',1,''],
    ['2BHK_DE','Common Toilet','Shower Arm',1,''],
    ['2BHK_DE','Common Toilet','Hand Shower',1,''],
    ['2BHK_DE','Common Toilet','Bip Cock',1,''],
    ['2BHK_DE','Common Toilet','Deviator',1,''],
    ['2BHK_DE','Common Toilet','Bath Spout',1,''],
    ['2BHK_DE','Common Toilet','Angular Cock',6,''],
    ['2BHK_DE','Common Toilet','Mortise Handle Lock Without Rose',1,''],
    ['2BHK_DE','Common Toilet','Baby Latch',1,''],
    ['2BHK_DE','Kitchen','Circular Cover',3,''],
    ['2BHK_DE','Kitchen','8 Modular Board',1,''],
    ['2BHK_DE','Kitchen','3 Modular Board',3,''],
    ['2BHK_DE','Kitchen','2 Modular Board',1,''],
    ['2BHK_DE','Kitchen','Sink Cock',1,''],
    ['2BHK_DE','Kitchen','Sink',1,''],
    ['2BHK_DE','Kitchen','Bip Cock',1,''],
    ['2BHK_DE','Kitchen','Angular Cock',2,''],
    // ── 3BHK ─────────────────────────────────────────
    ['3BHK','Master Bedroom (MBR)','Circular Cover',5,''],
    ['3BHK','Master Bedroom (MBR)','8 Modular Board',1,''],
    ['3BHK','Master Bedroom (MBR)','6 Modular Board',1,''],
    ['3BHK','Master Bedroom (MBR)','4 Modular Board',2,''],
    ['3BHK','Master Bedroom (MBR)','3 Modular Board',1,''],
    ['3BHK','Master Bedroom (MBR)','2 Modular Board',3,''],
    ['3BHK','Master Bedroom (MBR)','1 Modular Board',1,''],
    ['3BHK','Master Bedroom (MBR)','AC Starter',1,''],
    ['3BHK','Master Bedroom (MBR)','Foot Light',1,''],
    ['3BHK','Master Bedroom (MBR)','Mortise Handle Lock With Rose',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Circular Cover',4,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','4 Modular Board',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','3 Modular Board',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','2 Modular Board',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','1 Modular Board',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Basin',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Commode',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Shower Head',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Shower Arm',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Hand Shower',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Bip Cock',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Deviator',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Bath Spout',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Angular Cock',6,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Mortise Handle Lock Without Rose',1,''],
    ['3BHK','Master Bedroom Toilet (MBRT)','Baby Latch',1,''],
    ['3BHK','Living Room & Dining Area','Circular Cover',10,''],
    ['3BHK','Living Room & Dining Area','8 Modular Board',2,''],
    ['3BHK','Living Room & Dining Area','6 Modular Board',2,''],
    ['3BHK','Living Room & Dining Area','4 Modular Board',1,''],
    ['3BHK','Living Room & Dining Area','3 Modular Board',2,''],
    ['3BHK','Living Room & Dining Area','2 Modular Board',4,''],
    ['3BHK','Living Room & Dining Area','AC Starter',1,''],
    ['3BHK','Living Room & Dining Area','DB',1,''],
    ['3BHK','Living Room & Dining Area','Joint Box with Cover',1,''],
    ['3BHK','Living Room & Dining Area','Night Latch Key with Knob',1,''],
    ['3BHK','Living Room & Dining Area','Main Door Handle',1,''],
    ['3BHK','Living Room & Dining Area','Magic Eye',1,''],
    ['3BHK','Common Bedroom','Circular Cover',5,''],
    ['3BHK','Common Bedroom','8 Modular Board',1,''],
    ['3BHK','Common Bedroom','6 Modular Board',1,''],
    ['3BHK','Common Bedroom','4 Modular Board',1,''],
    ['3BHK','Common Bedroom','2 Modular Board',3,''],
    ['3BHK','Common Bedroom','Foot Light',1,''],
    ['3BHK','Common Bedroom','AC Starter',1,''],
    ['3BHK','Common Bedroom','Mortise Handle Lock With Rose',1,''],
    ['3BHK','Bedroom With Attached Balcony','Circular Cover',5,''],
    ['3BHK','Bedroom With Attached Balcony','8 Modular Board',1,''],
    ['3BHK','Bedroom With Attached Balcony','6 Modular Board',1,''],
    ['3BHK','Bedroom With Attached Balcony','4 Modular Board',1,''],
    ['3BHK','Bedroom With Attached Balcony','3 Modular Board',1,''],
    ['3BHK','Bedroom With Attached Balcony','2 Modular Board',3,''],
    ['3BHK','Bedroom With Attached Balcony','Foot Light',1,''],
    ['3BHK','Bedroom With Attached Balcony','AC Starter',1,''],
    ['3BHK','Bedroom With Attached Balcony','Mortise Handle Lock With Rose',1,''],
    ['3BHK','Attached Balcony','Circular Cover',1,''],
    ['3BHK','Attached Balcony','Mortise Handle Lock With Rose',1,''],
    ['3BHK','Common Toilet','Circular Cover',4,''],
    ['3BHK','Common Toilet','8 Modular Board',1,''],
    ['3BHK','Common Toilet','2 Modular Board',1,''],
    ['3BHK','Common Toilet','1 Modular Board',1,''],
    ['3BHK','Common Toilet','Basin',1,''],
    ['3BHK','Common Toilet','Commode',1,''],
    ['3BHK','Common Toilet','Shower Head',1,''],
    ['3BHK','Common Toilet','Shower Arm',1,''],
    ['3BHK','Common Toilet','Hand Shower',1,''],
    ['3BHK','Common Toilet','Bip Cock',1,''],
    ['3BHK','Common Toilet','Deviator',1,''],
    ['3BHK','Common Toilet','Bath Spout',1,''],
    ['3BHK','Common Toilet','Angular Cock',6,''],
    ['3BHK','Common Toilet','Mortise Handle Lock Without Rose',1,''],
    ['3BHK','Common Toilet','Baby Latch',1,''],
    ['3BHK','Kitchen Wash Zone','3 Modular Board',1,''],
    ['3BHK','Kitchen Wash Zone','Angular Cock',1,''],
    ['3BHK','Kitchen Wash Zone','Mortise Handle Lock Without Rose',1,''],
    ['3BHK','Kitchen Wash Zone','Tower Bolt',1,''],
    ['3BHK','Kitchen','Circular Cover',2,''],
    ['3BHK','Kitchen','4 Modular Board',2,''],
    ['3BHK','Kitchen','3 Modular Board',3,''],
    ['3BHK','Kitchen','2 Modular Board',1,''],
    ['3BHK','Kitchen','Sink Cock',1,''],
    ['3BHK','Kitchen','Sink',1,''],
    ['3BHK','Kitchen','Bip Cock',1,''],
    ['3BHK','Kitchen','Angular Cock',2,''],
  ];
  sh.getRange(2,1,data.length,6).setValues(data.map(d => [newId('AST'),d[0],d[1],d[2],d[3],d[4]]));
}