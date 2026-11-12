"""Stand-in for Supabase PostgREST /rpc/<fn> (used by the Apps Script test harness)."""
import json, os, sys
import psycopg
from psycopg.rows import dict_row
fn = sys.argv[1]; body = json.loads(sys.stdin.read() or "{}")
conn = psycopg.connect(os.environ.get("DATABASE_URL", "host=/tmp port=5544 dbname=snag user=postgres"), row_factory=dict_row, autocommit=False)
cols = ", ".join("%s => %%(%s)s" % (k, k) for k in body)
params = {k: (json.dumps(v) if isinstance(v, (list, dict)) and k == "p_rows" else v) for k, v in body.items()}
sql = "select * from %s(%s)" % (fn, ", ".join("%s := %%(%s)s%s" % (k, k, "::jsonb" if k == "p_rows" else "") for k in body))
rows = conn.execute(sql, params).fetchall()
conn.commit()
tablefns = {"snag_events_since"}
if fn in tablefns:
    out = [dict(r) for r in rows]
else:
    out = list(rows[0].values())[0] if rows else None
print(json.dumps(out, default=str))
