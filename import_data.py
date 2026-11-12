"""One-time import of the Google Sheet (downloaded as .xlsx) into Supabase.

    python import_data.py "Snag_and_Asset_Check_App_Backend.xlsx"            # upsert, keeps existing rows
    python import_data.py "Snag_and_Asset_Check_App_Backend.xlsx" --replace  # empty the tables first

Rows are inserted in sheet order (that order is what the page shows).
Nothing is sent back to the sheet while importing (change events are switched off).
Timestamps in the xlsx have no time zone; they are read as Asia/Kolkata.
"""
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import openpyxl
import psycopg

IST = ZoneInfo("Asia/Kolkata")

# sheet name -> (table, primary key, column types)
SHEETS = {
    "Users":            ("app_users",         "userId",     {"pin": "str"}),
    "Flats":            ("flats",             "flatId",     {"floor": "int"}),
    "SnagMaster":       ("snag_master",       "snagId",     {}),
    "AssetMaster":      ("asset_master",      "assetId",    {"numbers": "float"}),
    "Inspections":      ("inspections",       "rowId",      {}),
    "AssetInspections": ("asset_inspections", "rowId",      {}),
    "Photos":           ("photos",            "photoId",    {"timestamp": "ts"}),
    "ActivityLog":      ("activity_log",      "logId",      {"floor": "str", "timestamp": "ts"}),
    "SnagOverrides":    ("snag_overrides",    "overrideId", {}),
}


def load_env():
    p = Path(".env")
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def conv(v, kind):
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return None
    if kind == "int":
        return int(float(v))
    if kind == "float":
        return float(v)
    if kind == "str":
        return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
    if kind == "ts":
        if isinstance(v, datetime):
            return v.replace(tzinfo=IST) if v.tzinfo is None else v
        return v
    return v


def main():
    load_env()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    replace = "--replace" in sys.argv
    if not args:
        sys.exit(__doc__)
    wb = openpyxl.load_workbook(args[0], read_only=True, data_only=True)
    with psycopg.connect(os.environ["DATABASE_URL"], prepare_threshold=None) as conn:
        for sheet, (table, pk, types) in SHEETS.items():
            if sheet not in wb.sheetnames:
                print("  - %-17s not in workbook, skipped" % sheet)
                continue
            it = wb[sheet].iter_rows(values_only=True)
            headers = [h for h in next(it) if h]
            rows = []
            for r in it:
                if not any(c not in (None, "") for c in r):
                    continue
                d = {h: conv(r[i] if i < len(r) else None, types.get(h)) for i, h in enumerate(headers)}
                if d.get(pk) in (None, ""):
                    continue
                rows.append(d)
            with conn.transaction():
                conn.execute("select set_config('snag.skip_events','on',true)")
                if replace:
                    conn.execute("truncate table %s restart identity" % table)
                    # a replaced table starts a new history: old change events no longer apply
                    conn.execute("delete from snag_sync_events where tbl = %s", (table,))
                cols = ",".join('"%s"' % h for h in headers)
                sets = ",".join('"%s"=excluded."%s"' % (h, h) for h in headers if h != pk)
                sql = 'insert into %s (%s) values (%s) on conflict ("%s") do update set %s' % (
                    table, cols, ",".join(["%s"] * len(headers)), pk, sets)
                with conn.cursor() as cur:
                    cur.executemany(sql, [[d[h] for h in headers] for d in rows])
            print("  + %-17s -> %-18s %6d rows" % (sheet, table, len(rows)))
    print("Done.")


if __name__ == "__main__":
    main()
