"""Run the same scenario through the ORIGINAL Code.gs (Node + mock sheet) and through logic.py (Postgres); compare."""
import json, os, re, subprocess, sys
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
XLSX = sys.argv[1]
os.environ.setdefault("DATABASE_URL", "host=/tmp port=5544 dbname=snag user=postgres")

# 1. xlsx -> sheets.json
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
sheets = {}
for ws in wb.worksheets:
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    hdr = [h for h in rows[0] if h]
    out = [hdr]
    for r in rows[1:]:
        r = list(r) + [None] * (len(hdr) - len(r))
        if any(c not in (None, "") for c in r[:len(hdr)]):
            out.append([c.isoformat() if hasattr(c, "isoformat") else c for c in r[:len(hdr)]])
    sheets[ws.title] = out
Path("/tmp/sheets.json").write_text(json.dumps(sheets))

def col(name, h): return sheets[name][0].index(h)
def rows(name): return sheets[name][1:]

# 2. scenario with real ids
insp = rows("Inspections"); ci_f, ci_s = col("Inspections", "flatId"), col("Inspections", "snagId")
from collections import Counter
cnt = Counter((r[ci_f], r[ci_s]) for r in insp)
dup_flat, dup_snag = next(k for k, v in cnt.items() if v > 1)
flats = rows("Flats"); flat_ids = [r[0] for r in flats]
used = {r[ci_f] for r in insp}
empty_flat = next(f for f in flat_ids if f not in used)
veni_flat = next(r[0] for r in flats if r[1] == "Veni")
prayag_flat = next(r[0] for r in flats if r[1] == "Prayag")
snag_ids = [r[0] for r in rows("SnagMaster")]
asset_rows = rows("AssetMaster"); asset_id = asset_rows[0][0]
photo = rows("Photos")[3]; photo_id, photo_flat = photo[0], photo[1]
ov = rows("SnagOverrides")[0]  # overrideId, flatId, refId, section, field, value
users = rows("Users"); del_user = users[-1][0]; edit_user = users[1]
insp_with_remark = next(r for r in insp if r[4])  # rowId, flatId, snagId, status, r1SnagRemark
S = []
def step(fn, *args): S.append({"fn": fn, "args": list(args)})
step("getUsernames"); step("login", "ADMIN ", " 2003"); step("login", "admin", "bad"); step("login", "nobody", "1")
step("getTeam"); step("getFlats"); step("getSnagMaster"); step("getAssetMaster"); step("getAssetMaster", "3BHK")
step("getAssetMaster", "nope")
step("getInspections", dup_flat); step("getInspections", empty_flat); step("getAssetInspections", dup_flat)
step("getPhotos", photo_flat, None, None); step("getPhotos", photo_flat, photo[2], "snag"); step("getPhotos", photo_flat, "x", "asset")
step("getOverrides", ov[1]); step("getOverrides", "none")
step("getActivityLog", None, None); step("getActivityLog", photo_flat, "snag"); step("getActivityLog", "ghost-flat", None); step("getActivityLog", None, "asset")
# writes
step("saveInspection", {"flatId": dup_flat, "snagId": dup_snag, "field": "status", "value": "Done", "changedBy": "tester"})   # duplicate pair -> FIRST row
step("saveInspection", {"flatId": insp_with_remark[1], "snagId": insp_with_remark[2], "field": "r1SnagRemark", "value": "new remark", "changedBy": "tester"})
step("saveInspection", {"flatId": empty_flat, "snagId": snag_ids[2], "field": "status", "value": "InProgress", "changedBy": "tester"})  # new row
step("saveInspection", {"flatId": empty_flat, "snagId": snag_ids[3], "field": "r2DeSnagRemark", "value": "late fix", "changedBy": "tester"})  # new row, remark first
step("saveInspection", {"flatId": empty_flat, "snagId": snag_ids[2], "field": "bogus", "value": "x", "changedBy": "tester"})
step("saveInspection", {"flatId": empty_flat, "snagId": snag_ids[2], "field": "status", "value": "Done", "changedBy": "tester"})
step("getInspections", empty_flat)
step("saveAssetInspection", {"flatId": empty_flat, "assetId": asset_id, "field": "status", "value": "Done", "changedBy": "tester"})
step("saveAssetInspection", {"flatId": empty_flat, "assetId": asset_id, "field": "r1SnagRemark", "value": "dented", "changedBy": "tester"})
step("saveAssetInspection", {"flatId": empty_flat, "assetId": asset_id, "field": "nope", "value": "x", "changedBy": "tester"})
step("getAssetInspections", empty_flat)
step("updateAssetMaster", asset_id, "numbers", 9, "tester", empty_flat); step("updateAssetMaster", asset_id, "numbers", 7, "tester", None)
step("updateAssetMaster", asset_id, "bogus", 1, "tester", empty_flat); step("updateAssetMaster", "AST_none", "numbers", 1, "tester", empty_flat)
step("updateSnagMaster", snag_ids[0], "RC", "CA", "RN"); step("updateSnagMaster", "SNG_none", "a", "b", "c")
step("saveOverride", ov[1], ov[2], ov[3], ov[4], "CHANGED", "tester")      # update
step("saveOverride", empty_flat, snag_ids[5], "snag", "respName", "NEW PERSON", "tester")  # create
step("saveOverride", empty_flat, asset_id, "asset", "respPerson", "AP", "tester")
step("getOverrides", empty_flat)
step("saveFlat", None, "Veni", 13, "13A", "2BHK_AH"); step("saveFlat", flat_ids[0], "Prayag", 1, "1A", "3BHK"); step("saveFlat", "FLT_none", "x", 1, "1", "x")
step("deleteFlat", flat_ids[5]); step("deleteFlat", "FLT_none")
step("saveTeam", None, "zz", "9999", "Viewer"); step("login", "ZZ", "9999")
step("saveTeam", edit_user[0], "SumitraX", "", "Admin"); step("login", "sumitrax", str(int(edit_user[2])))
step("saveTeam", "USR_none", "a", "b", "c"); step("deleteTeam", del_user); step("deleteTeam", "USR_none"); step("getTeam")
step("uploadPhoto", veni_flat, snag_ids[1], "R1S", "Zm9v", "image/jpeg", "a.jpg", "tester", "snag")
step("uploadPhoto", prayag_flat, asset_id, "R2D", "Zm9v", "image/jpeg", "b.jpg", "tester", "asset")
step("uploadPhoto", "FLT_ghost", snag_ids[1], "R1S", "Zm9v", "image/jpeg", "c.jpg", "tester", None)
step("getPhotos", veni_flat, None, None)
step("deletePhoto", photo_id, "tester"); step("deletePhoto", "PHT_none", "tester"); step("deletePhoto", photo_id, "tester")
step("getActivityLog", None, None); step("getActivityLog", empty_flat, None); step("getActivityLog", empty_flat, "asset")
Path("/tmp/scenario.json").write_text(json.dumps(S))

# 3. original GAS
subprocess.run(["node", str(ROOT / "tests/gas_harness.js"), "/tmp/sheets.json", str(ROOT / "legacy/Code.gs"),
                "/tmp/scenario.json", "/tmp/gas_out.json"], check=True)
gas = json.loads(Path("/tmp/gas_out.json").read_text())

# 4. reset DB, run logic.py
subprocess.run([sys.executable, str(ROOT / "import_data.py"), XLSX, "--replace"], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
import drive
py_drive = []
drive.upload_file = lambda folder_id, flat_no, rnd, *a: (py_drive.append({"folderId": folder_id, "path": "%s/%s" % (flat_no, rnd)}), "FILE123")[1]
drive.trash_file = lambda *a: py_drive.append({"trashed": True})
import logic
from db import session
py = []
for s in S:
    try:
        py.append(json.loads(json.dumps(logic.API[s["fn"]](*s["args"]), default=str)))
    except Exception as e:
        py.append({"thrown": str(e)})

# 5. compare
IDRE = re.compile(r"\b[A-Z]{3}_\d{13}_[a-z0-9]{4}\b")
def norm(v):
    if v is None or v == "": return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    if isinstance(v, bool): return str(v)
    return IDRE.sub("<ID>", str(v))
def nrm(o, drop=("timestamp",)):
    if isinstance(o, dict): return {k: nrm(v, drop) for k, v in o.items() if k not in drop}
    if isinstance(o, list): return [nrm(v, drop) for v in o]
    return norm(o) if not isinstance(o, str) or True else o
bad = 0
for i, s in enumerate(S):
    a, b = nrm(gas["results"][i]), nrm(py[i])
    if a != b:
        bad += 1
        print("MISMATCH step %d %s %s" % (i, s["fn"], json.dumps(s["args"])[:150]))
        print("   GAS:", json.dumps(a)[:400]); print("   PY :", json.dumps(b)[:400])
print("steps compared:", len(S), "mismatches:", bad)
if nrm(gas["driveCalls"]) != nrm(py_drive):
    bad += 1; print("DRIVE CALLS differ", gas["driveCalls"], py_drive)
else:
    print("drive calls identical:", len(py_drive))

TABLES = {"Users": "app_users", "Flats": "flats", "SnagMaster": "snag_master", "AssetMaster": "asset_master",
          "Inspections": "inspections", "AssetInspections": "asset_inspections", "Photos": "photos",
          "ActivityLog": "activity_log", "SnagOverrides": "snag_overrides"}
with session() as c:
    for sheet, table in TABLES.items():
        hdr = gas["sheets"][sheet][0]
        g = [[norm(v) for h, v in zip(hdr, r) if h != "timestamp"] for r in gas["sheets"][sheet][1:]]
        cols = ",".join('"%s"' % h for h in hdr)
        p = [[norm(r[h]) for h in hdr if h != "timestamp"] for r in c.execute("select %s from %s order by _seq" % (cols, table)).fetchall()]
        # activity-log floor: sheet keeps number/str mix; both normalised via str()
        ok = g == p
        print("%-17s sheet=%5d db=%5d  %s" % (sheet, len(g), len(p), "IDENTICAL" if ok else "DIFFERENT"))
        if not ok:
            bad += 1
            for k, (x, y) in enumerate(zip(g, p)):
                if x != y: print("   first diff row", k, x, y); break
sys.exit(1 if bad else 0)
