"""
SNAG CHECK - business logic.
One-to-one port of the old Code.gs: same function names, same conditions,
same return shapes ({status:'ok', data} / {status:'error', msg}).
"""
import base64  # noqa: F401  (kept for parity with uploadPhoto payloads)
import random
import time
from datetime import datetime, timezone

import drive
from config import (ASSET_INSPECTION_FIELDS, ASSET_MASTER_FIELDS, FIELD_LABEL_MAP,
                    INSPECTION_FIELDS, PHOTO_FOLDER_FALLBACK, PHOTO_FOLDERS)
from db import session


# ── HELPERS ─────────────────────────────────────────────────
def ok(data):
    return {"status": "ok", "data": data}


def err(msg):
    return {"status": "error", "msg": msg}


def new_id(prefix: str) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    return "%s_%d_%s" % (prefix, int(time.time() * 1000), "".join(random.choice(chars) for _ in range(4)))


def _num(v):
    """6.0 -> 6 (the sheet returned plain JS numbers)."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def _s(v):
    """JS:  String(v || '')"""
    if not v:
        return ""
    return str(_num(v))


def _js(v):
    return "undefined" if v is None else str(v)


def _iso(ts):
    return ts.isoformat() if ts else ""


def _trim(v):
    return _s(v).strip()


def _clean_row(r, numeric=()):
    out = dict(r)
    for k in numeric:
        if k in out and out[k] is not None:
            out[k] = _num(out[k])
    return out


# ── PHOTO FOLDER ROUTING ─────────────────────────────────────
def getPhotoFolderId(tower, section):
    sec = (section or "snag").lower()
    if tower in PHOTO_FOLDERS and sec in PHOTO_FOLDERS[tower] and PHOTO_FOLDERS[tower][sec]:
        return PHOTO_FOLDERS[tower][sec]
    return PHOTO_FOLDER_FALLBACK


# ── ACTIVITY LOG HELPER ──────────────────────────────────────
def _add_log(conn, flatId, refId, fieldKey, oldVal, newVal, changedBy, section, ctx=None):
    """Never raises (like the old _addLog) - a log problem must not break a save."""
    try:
        with conn.transaction():  # savepoint
            ctx = dict(ctx or {})
            if not ctx.get("flatNo"):
                f = conn.execute(
                    'select "tower","floor","flatNo","flatType" from flats '
                    'where btrim("flatId") = %s order by "_seq" limit 1', (_trim(flatId),)).fetchone()
                if f:
                    ctx["tower"] = _s(f["tower"])
                    ctx["floor"] = _s(f["floor"])
                    ctx["flatNo"] = _s(f["flatNo"]) or flatId
                    ctx["flatType"] = _s(f["flatType"])
            if not ctx.get("pointLabel") and refId:
                if section == "asset":
                    m = conn.execute('select "location","assetPoint" as lb from asset_master '
                                     'where btrim("assetId") = %s order by "_seq" limit 1', (_trim(refId),)).fetchone()
                else:
                    m = conn.execute('select "location","snagPoint" as lb from snag_master '
                                     'where btrim("snagId") = %s order by "_seq" limit 1', (_trim(refId),)).fetchone()
                if m:
                    ctx["location"] = _s(m["location"])
                    ctx["pointLabel"] = _s(m["lb"]) or refId
            if isinstance(fieldKey, str) and fieldKey.startswith("photo_"):
                col_header = "Photo — " + fieldKey.replace("photo_", "", 1)
            else:
                col_header = FIELD_LABEL_MAP.get(fieldKey) or fieldKey
            conn.execute(
                'insert into activity_log ("logId","tower","floor","flatNo","flatType","section","location",'
                '"pointLabel","columnHeader","oldVal","newVal","changedBy","timestamp") '
                'values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())',
                (new_id("LOG"), ctx.get("tower") or "", ctx.get("floor") or "", ctx.get("flatNo") or flatId,
                 ctx.get("flatType") or "", section or "snag", ctx.get("location") or "",
                 ctx.get("pointLabel") or refId, col_header, _s(oldVal), _s(newVal), changedBy))
    except Exception:  # noqa: BLE001
        pass


# ── PER-FLAT OVERRIDES ───────────────────────────────────────
def getOverrides(flatId):
    try:
        fId = _trim(flatId)
        with session() as c:
            rows = c.execute('select "overrideId","flatId","refId","section","field","value" from snag_overrides '
                             'where btrim("flatId") = %s order by "_seq"', (fId,)).fetchall()
        return ok([{"overrideId": _s(r["overrideId"]), "flatId": fId, "refId": _s(r["refId"]),
                    "section": _s(r["section"]) or "snag", "field": _s(r["field"]),
                    "value": _s(r["value"])} for r in rows])
    except Exception as e:  # noqa: BLE001
        return err("getOverrides: " + str(e))


def saveOverride(flatId, refId, section, field, value, changedBy):
    try:
        fId, rId = _trim(flatId), _trim(refId)
        sec = _s(section or "snag").strip()
        fld = _trim(field)
        with session() as c:
            c.execute("select pg_advisory_xact_lock(hashtext(%s))", ("ovr|%s|%s|%s|%s" % (fId, rId, sec, fld),))
            row = c.execute('select "overrideId","value" from snag_overrides where btrim("flatId")=%s and '
                            'btrim("refId")=%s and btrim("section")=%s and btrim("field")=%s '
                            'order by "_seq" limit 1', (fId, rId, sec, fld)).fetchone()
            if row:
                c.execute('update snag_overrides set "value"=%s where "overrideId"=%s', (value, row["overrideId"]))
                _add_log(c, flatId, refId, field, row["value"], value, changedBy, section)
                return ok("Updated")
            c.execute('insert into snag_overrides ("overrideId","flatId","refId","section","field","value") '
                      "values (%s,%s,%s,%s,%s,%s)", (new_id("OVR"), fId, rId, sec, fld, value))
            _add_log(c, flatId, refId, field, "", value, changedBy, section)
            return ok("Created")
    except Exception as e:  # noqa: BLE001
        return err("saveOverride: " + str(e))


# ── AUTH ─────────────────────────────────────────────────────
def getUsernames():
    try:
        with session() as c:
            rows = c.execute('select "username" from app_users order by "_seq"').fetchall()
        return {"status": "ok", "data": [str(r["username"]) for r in rows if r["username"]]}
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "msg": str(e)}


def login(username, pin):
    try:
        u = _s(username).strip().lower()
        p = _s(pin).strip()
        with session() as c:
            rows = c.execute('select "username","pin","role" from app_users order by "_seq"').fetchall()
        for r in rows:
            if _s(r["username"]).strip().lower() == u and _s(r["pin"]).strip() == p:
                return {"status": "ok", "data": {"username": str(r["username"]), "role": _s(r["role"])}}
        return {"status": "error", "msg": "Invalid username or PIN"}
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "msg": str(e)}


# ── USERS / TEAM ─────────────────────────────────────────────
def getTeam():
    try:
        with session() as c:
            rows = c.execute('select "userId","username","role" from app_users order by "_seq"').fetchall()
        return ok([dict(r) for r in rows])
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def saveTeam(userId, username, pin, role):
    try:
        with session() as c:
            if userId:
                row = c.execute('select "pin" from app_users where "userId"=%s', (userId,)).fetchone()
                if not row:
                    return err("User not found")
                # If PIN is empty, keep existing PIN
                new_pin = _num(pin) if pin else row["pin"]
                c.execute('update app_users set "username"=%s,"pin"=%s,"role"=%s where "userId"=%s',
                          (username, None if new_pin is None else str(new_pin), role, userId))
                return ok("Updated")
            c.execute('insert into app_users ("userId","username","pin","role") values (%s,%s,%s,%s)',
                      (new_id("USR"), username, None if pin in (None, "") else str(_num(pin)), role))
            return ok("Created")
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def deleteTeam(userId):
    try:
        with session() as c:
            n = c.execute('delete from app_users where "userId"=%s', (userId,)).rowcount
        return ok("Deleted") if n else err("User not found")
    except Exception as e:  # noqa: BLE001
        return err(str(e))


# ── FLATS ────────────────────────────────────────────────────
def getFlats():
    try:
        with session() as c:
            rows = c.execute('select "flatId","tower","floor","flatNo","flatType" from flats order by "_seq"').fetchall()
        return ok([dict(r) for r in rows])
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def saveFlat(flatId, tower, floor, flatNo, flatType):
    try:
        with session() as c:
            if flatId:
                n = c.execute('update flats set "tower"=%s,"floor"=%s,"flatNo"=%s,"flatType"=%s where "flatId"=%s',
                              (tower, floor, flatNo, flatType, flatId)).rowcount
                return ok("Updated") if n else err("Flat not found")
            fid = new_id("FLT")
            c.execute('insert into flats ("flatId","tower","floor","flatNo","flatType") values (%s,%s,%s,%s,%s)',
                      (fid, tower, floor, flatNo, flatType))
            return ok({"flatId": fid})
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def deleteFlat(flatId):
    try:
        with session() as c:
            n = c.execute('delete from flats where "flatId"=%s', (flatId,)).rowcount
        return ok("Deleted") if n else err("Flat not found")
    except Exception as e:  # noqa: BLE001
        return err(str(e))


# ── SNAG MASTER ──────────────────────────────────────────────
def getSnagMaster():
    try:
        with session() as c:
            rows = c.execute('select "snagId","location","snagPoint","respContractor","checkingArea","respName" '
                             'from snag_master order by "_seq"').fetchall()
        return ok([dict(r) for r in rows])
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def updateSnagMaster(snagId, respContractor, checkingArea, respName):
    try:
        with session() as c:
            n = c.execute('update snag_master set "respContractor"=%s,"checkingArea"=%s,"respName"=%s '
                          'where "snagId"=%s', (respContractor, checkingArea, respName, snagId)).rowcount
        return ok("Updated") if n else err("Not found")
    except Exception as e:  # noqa: BLE001
        return err(str(e))


# ── ASSET MASTER ─────────────────────────────────────────────
# assetType: '2BHK_AH' | '2BHK_DE' | '3BHK'
def getAssetMaster(assetType=None):
    try:
        sql = 'select "assetId","assetType","location","assetPoint","numbers","respPerson" from asset_master'
        params = ()
        if assetType:
            sql += ' where "assetType" = %s'
            params = (assetType,)
        with session() as c:
            rows = c.execute(sql + ' order by "_seq"', params).fetchall()
        return ok([_clean_row(r, ("numbers",)) for r in rows])
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def updateAssetMaster(assetId, field, value, changedBy, flatId=None):
    try:
        with session() as c:
            row = c.execute('select * from asset_master where "assetId"=%s order by "_seq" limit 1',
                            (assetId,)).fetchone()
            if not row:
                return err("Asset not found")
            if field not in ASSET_MASTER_FIELDS:
                return err("Unknown field: " + _js(field))
            old_val = row[field]
            c.execute('update asset_master set "%s"=%%s where "assetId"=%%s' % field, (value, assetId))
            if flatId:
                _add_log(c, flatId, assetId, field, old_val, value, changedBy, "asset")
            return ok("Updated")
    except Exception as e:  # noqa: BLE001
        return err(str(e))


# ── SNAG / ASSET INSPECTIONS ─────────────────────────────────
def _get_insp(table, flatId):
    try:
        ref = "snagId" if table == "inspections" else "assetId"
        with session() as c:
            rows = c.execute('select "rowId","flatId","%s","status","r1SnagRemark","r1DeSnagRemark",'
                             '"r2SnagRemark","r2DeSnagRemark" from %s where "flatId"=%%s order by "_seq"'
                             % (ref, table), (flatId,)).fetchall()
        return ok([dict(r) for r in rows])
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def getInspections(flatId):
    return _get_insp("inspections", flatId)


def getAssetInspections(flatId):
    return _get_insp("asset_inspections", flatId)


def _save_insp(table, refcol, fields, prefix, section, payload):
    # payload: { flatId, <refcol>, field, value, changedBy }
    try:
        payload = payload or {}
        field = payload.get("field")
        if field not in fields:
            return err("Unknown field: " + _js(field))
        flatId, ref = payload.get("flatId"), payload.get(refcol)
        value, by = payload.get("value"), payload.get("changedBy")
        with session() as c:
            # two people saving the same first value must not create two rows
            c.execute("select pg_advisory_xact_lock(hashtext(%s))", ("%s|%s|%s" % (table, flatId, ref),))
            row = c.execute('select "rowId","%s" as oldv from %s where "flatId"=%%s and "%s"=%%s '
                            'order by "_seq" limit 1' % (field, table, refcol), (flatId, ref)).fetchone()
            if row:
                c.execute('update %s set "%s"=%%s where "rowId"=%%s' % (table, field), (value, row["rowId"]))
                _add_log(c, flatId, ref, field, row["oldv"], value, by, section)
                return ok("Updated")
            # New row
            rid = new_id(prefix)
            rec = {f: None for f in fields}
            rec["rowId"] = rid
            rec["flatId"] = flatId
            rec[refcol] = ref
            rec["status"] = value if field == "status" else "Pending"
            rec[field] = value
            cols = ",".join('"%s"' % f for f in fields)
            c.execute("insert into %s (%s) values (%s)" % (table, cols, ",".join(["%s"] * len(fields))),
                      [rec[f] for f in fields])
            _add_log(c, flatId, ref, field, "", value, by, section)
            return ok({"rowId": rid})
    except Exception as e:  # noqa: BLE001
        return err(str(e))


def saveInspection(payload):
    return _save_insp("inspections", "snagId", INSPECTION_FIELDS, "INS", "snag", payload)


def saveAssetInspection(payload):
    return _save_insp("asset_inspections", "assetId", ASSET_INSPECTION_FIELDS, "AIN", "asset", payload)


# ── PHOTOS ───────────────────────────────────────────────────
def uploadPhoto(flatId, refId, round, base64Data, mimeType, fileName, uploadedBy, section):  # noqa: A002
    try:
        # Multiple photos allowed - no auto-replace. Get flat info for folder routing
        tower, flat_no = "", flatId
        with session() as c:
            f = c.execute('select "tower","flatNo" from flats where btrim("flatId")=%s order by "_seq" limit 1',
                          (_trim(flatId),)).fetchone()
        if f:
            tower = _s(f["tower"])
            flat_no = _s(f["flatNo"]) or flatId
        # Upload to Drive (FlatNo / Round sub-folders, anyone-with-link view)
        folder_id = getPhotoFolderId(tower, section)
        file_id = drive.upload_file(folder_id, flat_no, round, base64Data, mimeType, fileName)
        view_url = "https://drive.google.com/file/d/" + file_id + "/view"
        thumb_url = "https://drive.google.com/thumbnail?id=" + file_id + "&sz=w400"
        photo_id = new_id("PHT")
        with session() as c:
            c.execute('insert into photos ("photoId","flatId","refId","round","section","fileId","viewUrl",'
                      '"thumbUrl","uploadedBy","timestamp") values (%s,%s,%s,%s,%s,%s,%s,%s,%s,now())',
                      (photo_id, flatId, refId, round, section or "snag", file_id, view_url, thumb_url, uploadedBy))
            _add_log(c, flatId, refId, "photo_" + str(round), "", view_url, uploadedBy, section or "snag")
        return ok({"photoId": photo_id, "viewUrl": view_url, "thumbUrl": thumb_url, "fileId": file_id})
    except Exception as e:  # noqa: BLE001
        return err("uploadPhoto: " + str(e))


def getPhotos(flatId, refId=None, section=None):
    try:
        fId = _trim(flatId)
        sql = ('select "photoId","flatId","refId","round","section","fileId","viewUrl","thumbUrl",'
               '"uploadedBy","timestamp" from photos where btrim("flatId")=%s')
        params = [fId]
        if refId:
            sql += ' and btrim("refId")=%s'
            params.append(str(refId).strip())
        if section:
            sql += ' and btrim("section")=%s'
            params.append(str(section).strip())
        with session() as c:
            rows = c.execute(sql + ' order by "_seq"', params).fetchall()
        return ok([{"photoId": _s(r["photoId"]), "flatId": _s(r["flatId"]), "refId": _s(r["refId"]),
                    "round": _s(r["round"]), "section": _s(r["section"]) or "snag", "fileId": _s(r["fileId"]),
                    "viewUrl": _s(r["viewUrl"]), "thumbUrl": _s(r["thumbUrl"]),
                    "uploadedBy": _s(r["uploadedBy"]), "timestamp": _iso(r["timestamp"])} for r in rows])
    except Exception as e:  # noqa: BLE001
        return err("getPhotos: " + str(e))


def deletePhoto(photoId, deletedBy=None):
    try:
        with session() as c:
            r = c.execute('select "photoId","flatId","refId","round","section","fileId","viewUrl" from photos '
                          'where btrim("photoId")=%s order by "_seq" limit 1', (_trim(photoId),)).fetchone()
            if not r:
                return err("Photo not found")
            section = _s(r["section"]) or "snag"
            # Log deletion before deleting row
            _add_log(c, _s(r["flatId"]), _s(r["refId"]), "photo_" + _s(r["round"]), _s(r["viewUrl"]),
                     "DELETED", deletedBy or "unknown", section)
            # Delete from Drive (failure is ignored, like the old script)
            try:
                drive.trash_file(_s(r["fileId"]))
            except Exception:  # noqa: BLE001
                pass
            c.execute('delete from photos where "photoId"=%s', (r["photoId"],))
            return ok("Deleted")
    except Exception as e:  # noqa: BLE001
        return err("deletePhoto: " + str(e))


# ── ACTIVITY LOG ─────────────────────────────────────────────
def getActivityLog(flatId=None, section=None):
    try:
        with session() as c:
            conds, params = [], []
            if flatId:
                f = c.execute('select "tower","flatNo" from flats where btrim("flatId")=%s order by "_seq" limit 1',
                              (str(flatId).strip(),)).fetchone()
                f_tower = _trim(f["tower"]) if f else ""
                f_flat = _trim(f["flatNo"]) if f else ""
                conds += ['btrim(coalesce("tower",\'\'))=%s', 'btrim(coalesce("flatNo",\'\'))=%s']
                params += [f_tower, f_flat]
            if section:
                conds.append('btrim(coalesce("section",\'\'))=%s')
                params.append(str(section).strip())
            sql = ('select "logId","tower","floor","flatNo","flatType","section","location","pointLabel",'
                   '"columnHeader","oldVal","newVal","changedBy","timestamp" from activity_log')
            if conds:
                sql += " where " + " and ".join(conds)
            rows = c.execute(sql + ' order by "_seq" desc limit 500', params).fetchall()  # newest first, max 500
        return ok([{"logId": _s(r["logId"]), "tower": _trim(r["tower"]), "floor": _s(r["floor"]),
                    "flatNo": _trim(r["flatNo"]), "flatType": _s(r["flatType"]),
                    "section": _trim(r["section"]) or "snag", "location": _s(r["location"]),
                    "pointLabel": _s(r["pointLabel"]), "columnHeader": _s(r["columnHeader"]),
                    "oldVal": _s(r["oldVal"]), "newVal": _s(r["newVal"]), "changedBy": _s(r["changedBy"]),
                    "timestamp": _iso(r["timestamp"])} for r in rows])
    except Exception as e:  # noqa: BLE001
        return err("getActivityLog: " + str(e))


# ── MAINTENANCE (was a run-once function in the Apps Script editor) ──
def addVeniFlats():
    """Same as addVeniFlats() in Code.gs: floors 1-12, units A-H, appended only if no Veni flats exist."""
    with session() as c:
        n = c.execute("select count(*) as n from flats").fetchone()["n"]
        if c.execute('select 1 from flats where btrim("tower")=%s limit 1', ("Veni",)).fetchone():
            return "Veni flats already exist (%d total rows). Aborting to prevent duplicates." % n
        count = 0
        for f in range(1, 13):
            for u in "ABCDEFGH":
                ft = "3BHK"
                if u in ("A", "H"):
                    ft = "2BHK_AH"
                elif u in ("D", "E"):
                    ft = "2BHK_DE"
                c.execute('insert into flats ("flatId","tower","floor","flatNo","flatType") values (%s,%s,%s,%s,%s)',
                          (new_id("FLT"), "Veni", f, "%d%s" % (f, u), ft))
                count += 1
    return "Done! Added %d Veni flats (floors 1-12, units A-H)." % count


# name -> function.  These are exactly the functions the page (google.script.run) can call.
API = {
    "login": login, "getUsernames": getUsernames,
    "getTeam": getTeam, "saveTeam": saveTeam, "deleteTeam": deleteTeam,
    "getFlats": getFlats, "saveFlat": saveFlat, "deleteFlat": deleteFlat,
    "getSnagMaster": getSnagMaster, "updateSnagMaster": updateSnagMaster,
    "getAssetMaster": getAssetMaster, "updateAssetMaster": updateAssetMaster,
    "getInspections": getInspections, "saveInspection": saveInspection,
    "getAssetInspections": getAssetInspections, "saveAssetInspection": saveAssetInspection,
    "uploadPhoto": uploadPhoto, "getPhotos": getPhotos, "deletePhoto": deletePhoto,
    "getActivityLog": getActivityLog,
    "getOverrides": getOverrides, "saveOverride": saveOverride,
}

# The old doGet/doPost ?action=...&params=[...] API accepted exactly this list
HANDLE_API_ACTIONS = [
    "login", "getFlats", "getSnagMaster", "getAssetMaster", "getInspections", "getAssetInspections",
    "saveInspection", "saveAssetInspection", "getPhotos", "uploadPhoto", "deletePhoto", "getActivityLog",
    "getTeam", "saveTeam", "deleteTeam", "updateSnagMaster", "updateAssetMaster", "saveFlat",
    "getOverrides", "saveOverride",
]
