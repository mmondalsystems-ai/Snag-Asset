import os, json, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", "host=/tmp port=5544 dbname=snag user=postgres")
from fastapi.testclient import TestClient
import app as appmod, drive
from db import session
drive.upload_file = lambda *a: "FILEHTTP"; drive.trash_file = lambda *a: None
c = TestClient(appmod.app)
# webhook ping: one ping per statement, not per row
with session() as k:
    k.execute("insert into snag_sync_settings values ('webhook_url','https://example.invalid/exec?token=t') on conflict (key) do update set value=excluded.value")
    k.execute("delete from net.calls")
r = c.post("/api/saveInspection", json={"args": [{"flatId": "F1", "snagId": "S1", "field": "status", "value": "Done", "changedBy": "http"}]})
print("saveInspection:", r.status_code, r.json())
with session() as k: print("webhook pings after 1 save (inspection + log statements):", k.execute("select count(*) n from net.calls").fetchone()["n"])
# page + API
home = c.get("/"); print("GET / :", home.status_code, "options injected:", home.text.count("<option value=\"admin\">"), "| scriptlet left:", "<?!=" in home.text, "| shim:", "/static/shim.js" in home.text)
print("shim.js:", c.get("/static/shim.js").status_code)
print("GET /?debug=1:", c.get("/?debug=1").json()["version"])
print("GET /?action=getTeam:", c.get("/?action=getTeam").json()["status"], "| login via GET:", c.get("/?action=login&params=" + json.dumps(["admin", "2003"])).json())
print("GET unknown action:", c.get("/?action=deleteFlat&params=[]").json())
print("POST /?action=getFlats:", c.post("/?action=getFlats").json()["status"])
print("POST /api/nope:", c.post("/api/nope", json={"args": []}).status_code)
print("POST /api/getFlats (no body):", c.post("/api/getFlats").json()["status"])
r = c.post("/api/uploadPhoto", json={"args": ["FLT_ghost", "S1", "R1S", "Zm9v", "image/jpeg", "a.jpg", "http", "snag"]}); print("uploadPhoto:", r.json()["status"], r.json()["data"]["fileId"])
big = "A" * 5_000_000
r = c.post("/api/getPhotos", json={"args": ["x", None, None]}); print("getPhotos:", r.json()["status"])
print("healthz:", c.get("/healthz").text)
