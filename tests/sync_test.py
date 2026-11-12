"""Sheet mirror test: web changes -> Supabase -> (Apps Script pull) -> sheet ; sheet edits -> (Apps Script push) -> Supabase."""
import json, os, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DATABASE_URL", "host=/tmp port=5544 dbname=snag user=postgres")
XLSX = sys.argv[1]
import re

def run(steps):
    Path("/tmp/steps.json").write_text(json.dumps(steps))
    subprocess.run(["node", str(ROOT / "tests/sync_harness.js"), "/tmp/sheets_cur.json", str(ROOT / "apps_script/SnagSync.gs"),
                    "/tmp/steps.json", "/tmp/sync_out.json"], check=True)
    return json.loads(Path("/tmp/sync_out.json").read_text())

def norm(v):
    if v is None or v == "": return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v)

TABLES = {"Users": "app_users", "Flats": "flats", "SnagMaster": "snag_master", "AssetMaster": "asset_master",
          "Inspections": "inspections", "AssetInspections": "asset_inspections", "Photos": "photos",
          "ActivityLog": "activity_log", "SnagOverrides": "snag_overrides"}
from db import session
def compare(sheets, label):
    bad = 0
    with session() as c:
        for sheet, table in TABLES.items():
            hdr = sheets[sheet][0]
            g = [[norm(v) for h, v in zip(hdr, r) if h != "timestamp"] for r in sheets[sheet][1:]]
            cols = ",".join('"%s"' % h for h in hdr)
            p = [[norm(r[h]) for h in hdr if h != "timestamp"] for r in c.execute("select %s from %s order by _seq" % (cols, table)).fetchall()]
            same = g == p
            bad += 0 if same else 1
            print("  %-17s sheet=%5d db=%5d %s" % (sheet, len(g), len(p), "IDENTICAL" if same else "DIFFERENT"))
            if not same:
                gs, ps = set(map(tuple, g)), set(map(tuple, p))
                print("     only in sheet:", list(gs - ps)[:2]); print("     only in db   :", list(ps - gs)[:2])
    print(label, "->", "OK" if not bad else "FAILED"); return bad

# --- start: DB == sheet (fresh import), then web writes through logic.py
subprocess.run([sys.executable, str(ROOT / "import_data.py"), XLSX, "--replace"], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
S = json.loads(Path("/tmp/sheets.json").read_text()); Path("/tmp/sheets_cur.json").write_text(json.dumps(S))
import drive
drive.upload_file = lambda *a: "FILE777"; drive.trash_file = lambda *a: None
import logic
with session() as c: c.execute("select set_config('snag.skip_events','off',false)")
flats = S["Flats"][1:]; insp = S["Inspections"][1:]; used = {r[1] for r in insp}
empty_flat = next(r[0] for r in flats if r[0] not in used); snag = S["SnagMaster"][1][0]; asset = S["AssetMaster"][1][0]
ph = S["Photos"][5]
logic.saveInspection({"flatId": empty_flat, "snagId": snag, "field": "status", "value": "Done", "changedBy": "web"})
logic.saveInspection({"flatId": empty_flat, "snagId": snag, "field": "r1SnagRemark", "value": "crack", "changedBy": "web"})
logic.saveAssetInspection({"flatId": empty_flat, "assetId": asset, "field": "status", "value": "Done", "changedBy": "web"})
logic.saveOverride(empty_flat, snag, "snag", "respName", "X", "web")
logic.updateAssetMaster(asset, "numbers", 11, "web", empty_flat)
logic.uploadPhoto(empty_flat, snag, "R1S", "Zm9v", "image/jpeg", "a.jpg", "web", "snag")
logic.deletePhoto(ph[0], "web")
logic.saveFlat(None, "Veni", 14, "14A", "3BHK"); logic.deleteFlat(flats[7][0])
logic.saveTeam(None, "newbie", "1212", "Viewer"); logic.deleteTeam(S["Users"][-1][0])
with session() as c:
    n = c.execute("select count(*) n from snag_sync_events").fetchone()["n"]
    pings = c.execute("select count(*) n from net.calls").fetchone()["n"]
print("events recorded by web writes:", n, "| webhook pings:", pings)

# --- Apps Script pull (twice: second must be a no-op)
out = run([{"fn": "SnagSync_pull"}, {"fn": "SnagSync_pull"}])
print("pull results:", out["results"])
bad = compare(out["sheets"], "after pull")
Path("/tmp/sheets_cur.json").write_text(json.dumps(out["sheets"], default=str))

# --- a pull must not echo anything; now a doPost webhook with a wrong and a right token
out = run([{"fn": "doPost", "args": [{"parameter": {"token": "bad"}}]}, {"fn": "doPost", "args": [{"parameter": {"token": "tok"}}]},
           {"fn": "doPost", "args": [{"parameter": {"token": "tok", "action": "uploadPhoto"}, "postData": {"contents": json.dumps({"folderId": "f", "flatNo": "1A", "round": "R1S", "base64Data": "Zm9v", "mimeType": "image/jpeg", "fileName": "a.jpg"})}}]},
           {"fn": "doPost", "args": [{"parameter": {"token": "tok", "action": "deletePhoto"}, "postData": {"contents": "{\"fileId\":\"x\"}"}}]}])
print("doPost:", [r for r in out["results"]], out["driveCalls"])

# --- sheet edits -> manual overwrite push
H = S["Flats"][0]
steps = [{"edit": {"op": "active", "sheet": "Flats"}},
         {"edit": {"op": "set", "sheet": "Flats", "row": 1, "col": "flatNo", "value": "EDITED-1"}},
         {"edit": {"op": "delete", "sheet": "Flats", "row": 3}},
         {"edit": {"op": "append", "sheet": "Flats", "values": {"flatId": "FLT_manual_1", "tower": "Prayag", "floor": 13, "flatNo": "13Z", "flatType": "3BHK"}}},
         {"fn": "SnagSync_pushActiveTab"}]
with session() as c: ev_before = c.execute("select count(*) n from snag_sync_events").fetchone()["n"]
out = run(steps)
print("push alerts:", out["alerts"])
with session() as c: ev_after = c.execute("select count(*) n from snag_sync_events").fetchone()["n"]
print("events created by push (must be 0):", ev_after - ev_before)
bad += compare(out["sheets"], "after push (Flats overwrite)")
Path("/tmp/sheets_cur.json").write_text(json.dumps(out["sheets"], default=str))
# empty sheet must be refused, duplicate ids must be refused
out2 = run([{"edit": {"op": "active", "sheet": "AssetInspections"}}, {"edit": {"op": "delete", "sheet": "AssetInspections", "row": 1}}, {"fn": "SnagSync_pushActiveTab"}])
print("empty tab ->", out2["alerts"][-1][:80])
out3 = run([{"edit": {"op": "active", "sheet": "SnagOverrides"}}, {"edit": {"op": "append", "sheet": "SnagOverrides", "values": {"overrideId": S["SnagOverrides"][1][0], "flatId": "x"}}}, {"fn": "SnagSync_pushActiveTab"}])
print("duplicate id ->", out3["alerts"][-1][:90])
out4 = run([{"edit": {"op": "active", "sheet": "Inspections"}}, {"fn": "SnagSync_pushActiveTab"}])
print("big tab push (Inspections 9170 rows) ->", out4["alerts"][-1][:60].replace("\n"," "))
bad += compare(out4["sheets"], "after big push")
sys.exit(1 if bad else 0)
