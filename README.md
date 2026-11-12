# Orchard Amritaya - Snag Check (FastAPI + Supabase + Vercel)

Same app, same page, same business logic as the Apps Script version (`legacy/Code.gs`),
now running on Vercel with Supabase (PostgreSQL) as the database and the Google Sheet kept as a live mirror.

```
Browser (original page, SnagIndex.html)
   |  static/shim.js turns google.script.run.fn(a,b) into POST /api/fn
   v
FastAPI on Vercel (bom1)  --psycopg-->  Supabase Postgres (Transaction pooler :6543)
   |                                         |  row triggers -> snag_sync_events -> pg_net ping
   |  photos (Drive)                         v
   +--> Apps Script web app  <---------- webhook (empty body, ?token=...)
        (DriveApp upload/delete,           |
         pull Supabase -> Sheet)           v
                                      Google Sheet (mirror)
```

* Web app -> Supabase -> Sheet: automatic (3-5 s with the webhook, 1 minute at worst via the safety trigger).
* Sheet -> Supabase: manual. Select a tab, menu **Snag Sync > Overwrite Supabase from THIS tab**.
  It shows how many rows will be updated / added / deleted and asks for confirmation.
* Photos stay in Google Drive, in the same folders (Prayag / Veni, FlatNo / Round). Vercel cannot use DriveApp,
  so uploads and deletes go through the same Apps Script web app.

## Files

| File | Purpose |
|---|---|
| `SnagIndex.html` | The original page, untouched. `python make_index.py SnagIndex.html` creates `templates/index.html` |
| `logic.py` | Every Code.gs function, same names, same conditions, same return values |
| `app.py` | Routes: `/` (page and the old `?action=` API), `/api/<fn>` (google.script.run), `/healthz` |
| `config.py` | Photo folder IDs, field label map, allowed fields (from the top of Code.gs) |
| `db.py`, `drive.py` | DB pool, Drive proxy client |
| `schema.sql`, `schema_sync.sql` | Tables; change events, webhook, pull and push functions |
| `import_data.py` | One-time load of the downloaded `.xlsx` into Supabase |
| `maintenance.py` | `add-veni-flats` (was `addVeniFlats()` in the editor) |
| `apps_script/SnagSync.gs` | Sheet mirror, overwrite menu, webhook, Drive proxy |
| `tests/` | Parity test against the ORIGINAL Code.gs, Apps Script sync test, HTTP and shim tests |

## Setup (in this order)

1. **Supabase**: new project (region Mumbai, `ap-south-1`). Use an alphanumeric database password.
   SQL Editor: run `schema.sql`, then `schema_sync.sql`.
2. **Local**: `python -m venv .venv`, activate, `pip install -r requirements.txt`, copy `.env.example` to `.env`
   and fill `DATABASE_URL` (Connect > Transaction pooler, port 6543).
3. **Import**: download the sheet as `.xlsx`, then
   `python import_data.py "Snag_and_Asset_Check_App_Backend.xlsx" --replace`
   (inserts in sheet order; does not create sync events).
4. **Try it**: `python make_index.py SnagIndex.html`, then `uvicorn app:app --reload` and open http://localhost:8000
   (photo upload needs step 5 first).
5. **Apps Script**: open the Snag Check spreadsheet > Extensions > Apps Script. Make a NEW project (do not use the
   old Code.gs project, both define `onOpen`/`doPost`). Paste `apps_script/SnagSync.gs`.
   * Project Settings > Script properties: `SUPABASE_URL` (project URL only), `SUPABASE_SERVICE_KEY` (Project Settings > API Keys).
   * Reload the sheet. Menu **Snag Sync**: `1. Create token`, `2. Start pulling from now`, `3. Install 1-minute safety trigger`.
   * Copy `SNAG_SYNC_TOKEN` from Script properties.
   * Deploy > New deployment > Web app: Execute as **Me**, Who has access **Anyone**. Copy the `/exec` URL.
6. **Webhook**: Supabase SQL Editor:
   ```sql
   insert into snag_sync_settings (key, value)
   values ('webhook_url', 'https://script.google.com/macros/s/XXXX/exec?token=YOUR_TOKEN')
   on conflict (key) do update set value = excluded.value;
   ```
7. **Vercel**: import the GitHub repo (FastAPI preset). Environment variables: `DATABASE_URL`, `DB_POOL_MAX=1`,
   `APPS_SCRIPT_URL` (the `/exec` URL without `?token`), `APPS_SCRIPT_TOKEN`.
   `vercel.json` pins the region to `bom1` (next to Supabase Mumbai).
8. Never commit `.env`, the token, or the service key. Rotate any key that has been pasted in a chat.

## Things to know

* **Photo size**: Vercel accepts request bodies up to 4.5 MB. `static/shim.js` shrinks large JPEG/PNG photos in the browser
  before upload (the 10 MB check in the page still applies first). A video or a photo that still exceeds the limit fails
  with "file too large". If videos matter, host on AWS instead (no such limit).
* **No sign-in on the API**: like the old Apps Script app, anyone who can open the URL can call the API; the username + PIN
  screen is enforced by the page only. PINs are plain text, as before.
* **Duplicate inspection rows**: the sheet already had 166 duplicate flat + snag pairs. They were imported as they are,
  and saves update the first matching row, exactly like Code.gs. Clean them in the sheet and use the overwrite menu if you want.
* **Row order** in the page follows insertion order. Reordering rows in the sheet and pushing does not reorder the page.
* An unpushed sheet edit is replaced when the same row changes in the web app. Push (overwrite) before editing the web data.
* Sheet columns you add yourself, and formula cells, are left alone by the pull.

## Not ported on purpose (editor-only helpers of Code.gs)

`debug*`, `testScript`, `CODE_VERSION` check page (kept as `/?debug=1`), `setupSheets` + `_seedSnagMaster` + `_seedAssetMaster`
(the data now comes from the sheet via `import_data.py`), `fixActivityLogHeaders` (the table has fixed columns).
`addVeniFlats` is `python maintenance.py add-veni-flats`.

## Tests (local Postgres)

* `tests/parity.py <xlsx>`: runs 66 calls through the original `Code.gs` (Node + mock sheet) and through `logic.py`; compares every
  result and all 9 tables afterwards.
* `tests/sync_test.py <xlsx>`: web writes -> Apps Script pull -> sheet; sheet edit -> overwrite push; no echo events.
* `tests/http_test.py`, `tests/shim_test.js`: routes, old `?action=` API, webhook ping, `google.script.run` shim.
