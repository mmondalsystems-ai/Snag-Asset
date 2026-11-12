// Runs the ORIGINAL Code.gs against a mock SpreadsheetApp filled from sheets.json
const vm = require('vm'), fs = require('fs');
const [,, sheetsFile, codeFile, scenarioFile, outFile] = process.argv;
const raw = JSON.parse(fs.readFileSync(sheetsFile, 'utf8'));
const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));

const sheets = {};
Object.keys(raw).forEach(name => {
  const hdr = raw[name][0];
  sheets[name] = raw[name].map((r, ri) => {
    const row = hdr.map((h, i) => {
      let v = r[i];
      if (v === null || v === undefined) return '';
      if (ri > 0 && h === 'timestamp') return new Date(v);
      return v;
    });
    return row;
  });
});

class Sheet {
  constructor(name) { this.name = name; }
  get rows() { return sheets[this.name]; }
  getDataRange() { const s = this; return { getValues() { return s.rows.map(r => r.slice()); } }; }
  getRange(r, c, nr, nc) {
    const s = this; nr = nr || 1; nc = nc || 1;
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) o.push(s.rows[r - 1 + i].slice(c - 1, c - 1 + nc)); return o; },
      setValue(v) { s.rows[r - 1][c - 1] = v; },
      setValues(vv) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.rows[r - 1 + i][c - 1 + j] = vv[i][j]; }
    };
  }
  appendRow(arr) { this.rows.push(arr.slice()); }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
}
const driveCalls = [];
const folder = (id, path) => ({
  getFoldersByName() { return { hasNext() { return false; } }; },
  createFolder(n) { return folder(id, path.concat(n)); },
  createFile() { driveCalls.push({ folderId: id, path: path.join('/') }); return { setSharing() {}, getId() { return 'FILE123'; } }; }
});
const ctx = vm.createContext({
  SpreadsheetApp: { openById() { return { getSheetByName(n) { return sheets[n] ? new Sheet(n) : null; } }; }, flush() {} },
  DriveApp: { getFolderById(id) { return folder(id, []); }, getFileById() { return { setTrashed() { driveCalls.push({ trashed: true }); } }; },
              Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 } },
  Utilities: { newBlob() { return {}; }, base64Decode() { return []; } },
  Logger: { log() {} }, console, Date, Math, JSON, String, Number, Array, Object
});
vm.runInContext(fs.readFileSync(codeFile, 'utf8'), ctx);
const results = scenario.map(step => {
  try { return JSON.parse(JSON.stringify(ctx[step.fn].apply(null, step.args))); }
  catch (e) { return { thrown: String(e.message) }; }
});
fs.writeFileSync(outFile, JSON.stringify({ results, driveCalls, sheets }));
