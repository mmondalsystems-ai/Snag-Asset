// Runs SnagSync.gs with a mock Sheet + a Postgres-backed UrlFetchApp
const vm = require('vm'), fs = require('fs'), cp = require('child_process');
const [,, sheetsFile, codeFile, stepsFile, outFile] = process.argv;
const raw = JSON.parse(fs.readFileSync(sheetsFile, 'utf8'));
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const sheets = {}, maxRows = {};
Object.keys(raw).forEach(name => {
  const hdr = raw[name][0];
  sheets[name] = raw[name].map((r, ri) => hdr.map((h, i) => {
    let v = r[i]; if (v === null || v === undefined) return '';
    if (ri > 0 && h === 'timestamp') return new Date(v); return v; }));
  maxRows[name] = sheets[name].length;            // strict grid: forces insertRowsAfter to be used
});
let activeName = 'Flats';
class Sheet {
  constructor(n) { this.n = n; }
  get rows() { return sheets[this.n]; }
  getName() { return this.n; }
  getLastColumn() { return this.rows[0].length; }
  getLastRow() { return this.rows.length; }
  getMaxRows() { return maxRows[this.n]; }
  insertRowsAfter(after, n) { maxRows[this.n] += n; }
  getDataRange() { const s = this; return { getValues() { return s.rows.map(r => r.slice()); } }; }
  getRange(r, c, nr, nc) {
    const s = this; nr = nr || 1; nc = nc || 1;
    if (r + nr - 1 > maxRows[s.n]) throw new Error('range outside sheet dimensions');
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) o.push((s.rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; },
      getFormulas() { const o = []; for (let i = 0; i < nr; i++) o.push(new Array(nc).fill('')); return o; },
      setValue(v) { s.rows[r - 1][c - 1] = v; },
      setValues(vv) { for (let i = 0; i < nr; i++) { while (s.rows.length < r + i) s.rows.push(new Array(s.rows[0].length).fill(''));
                       for (let j = 0; j < nc; j++) s.rows[r - 1 + i][c - 1 + j] = vv[i][j]; } }
    };
  }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
}
const props = { SUPABASE_URL: 'http://local', SUPABASE_SERVICE_KEY: 'k', SNAG_SYNC_TOKEN: 'tok' };
const alerts = [];
const ui = { alert() { alerts.push(Array.prototype.slice.call(arguments).join(' | ').slice(0, 300)); return 'YES'; },
             prompt() { alerts.push('PROMPT'); return { getSelectedButton() { return 'OK'; }, getResponseText() { return 'OVERWRITE'; } }; },
             ButtonSet: { YES_NO: 1, OK_CANCEL: 2 }, Button: { YES: 'YES', OK: 'OK' } };
const ssObj = { getSheetByName(n) { return sheets[n] ? new Sheet(n) : null; }, getActiveSheet() { return new Sheet(activeName); }, toast() {} };
const driveCalls = [];
const ctx = vm.createContext({
  PropertiesService: { getScriptProperties() { return { getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = String(v); } }; } },
  LockService: { getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; } },
  SpreadsheetApp: { openById() { return ssObj; }, getActiveSpreadsheet() { return ssObj; }, getUi() { return ui; } },
  ContentService: { createTextOutput(s) { return { s, setMimeType() { return this; } }; }, MimeType: { JSON: 1 } },
  UrlFetchApp: { fetch(url, opts) {
    const fn = url.split('/rpc/')[1];
    try {
      const out = cp.execFileSync('python3', [__dirname + '/rpc.py', fn], { input: opts.payload, encoding: 'utf8', env: process.env });
      return { getResponseCode: () => 200, getContentText: () => out };
    } catch (e) { return { getResponseCode: () => 400, getContentText: () => String(e.stderr || e.message) }; } } },
  DriveApp: { getFolderById() { return { getFoldersByName() { return { hasNext: () => false }; }, createFolder() { return this; },
              createFile() { driveCalls.push('create'); return { setSharing() {}, getId: () => 'FILE999' }; } }; },
              getFileById() { return { setTrashed() { driveCalls.push('trash'); } }; }, Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 } },
  Utilities: { newBlob() { return {}; }, base64Decode() { return []; }, getUuid: () => 'abcd-efgh' },
  Logger: { log() {} }, console, Date, Math, JSON, String, Number, Array, Object
});
vm.runInContext(fs.readFileSync(codeFile, 'utf8'), ctx);
const results = [];
steps.forEach(s => {
  if (s.edit) {                                        // simulate a user editing the sheet
    const sh = sheets[s.edit.sheet];
    if (s.edit.op === 'set') sh[s.edit.row][sh[0].indexOf(s.edit.col)] = s.edit.value;
    if (s.edit.op === 'delete') sh.splice(s.edit.row, 1);
    if (s.edit.op === 'append') { sh.push(sh[0].map(h => s.edit.values[h] === undefined ? '' : s.edit.values[h])); maxRows[s.edit.sheet] = Math.max(maxRows[s.edit.sheet], sh.length); }
    if (s.edit.op === 'active') activeName = s.edit.sheet;
    results.push('edited'); return;
  }
  try { const r = ctx[s.fn].apply(null, s.args || []); results.push(r && r.s ? JSON.parse(r.s) : (r === undefined ? null : r)); }
  catch (e) { results.push({ thrown: String(e.message) }); }
});
fs.writeFileSync(outFile, JSON.stringify({ results, sheets, alerts, driveCalls, props }));
