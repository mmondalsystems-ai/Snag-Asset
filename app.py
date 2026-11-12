"""SNAG CHECK - FastAPI app (replaces the Apps Script web app)."""
import html
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import logic
from config import CODE_VERSION, SS_ID

BASE_DIR = Path(__file__).resolve().parent
app = FastAPI(title="Orchard Amritaya - Snag Check", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

_TEMPLATE = (BASE_DIR / "templates" / "index.html").read_text(encoding="utf-8")


def _default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    return str(o)


class PJSON(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(content, default=_default, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def build_username_options() -> str:
    """buildUsernameOptions() of the old script: <option> tags built server-side."""
    res = logic.getUsernames()
    names = res["data"] if res.get("status") == "ok" else []   # not reachable -> empty, like the old catch
    return "".join('<option value="%s">%s</option>' % (html.escape(n, quote=True), html.escape(n)) for n in names)


def handle_api(params: dict):
    """The old ?action=...&params=[...] handler (handleApi in Code.gs)."""
    try:
        action = params.get("action") or ""
        args = json.loads(params["params"]) if params.get("params") else []
        if action in logic.HANDLE_API_ACTIONS:
            result = logic.API[action](*args)
        else:
            result = {"status": "error", "msg": "Unknown action: " + action}
        return PJSON(result)
    except Exception as e:  # noqa: BLE001
        return PJSON({"status": "error", "msg": str(e)})


@app.get("/")
def home(request: Request):
    p = dict(request.query_params)
    if p.get("action"):                       # API call via GET
        return handle_api(p)
    if p.get("debug") == "1":
        return PJSON({"version": CODE_VERSION, "ss_id": SS_ID[:8] + "...",
                      "timestamp": datetime.now(timezone.utc).isoformat()})
    page = _TEMPLATE.replace("<!--USERNAME_OPTIONS-->", build_username_options())
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


@app.post("/")
def home_post(request: Request):              # doPost(e) -> handleApi(e)
    return handle_api(dict(request.query_params))


@app.post("/api/{fn}")
async def api(fn: str, request: Request):
    """google.script.run.<fn>(...args) from static/shim.js"""
    func = logic.API.get(fn)
    if func is None:
        return PJSON({"status": "error", "msg": "Unknown function: " + fn}, status_code=404)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    args = body.get("args") or []
    from fastapi.concurrency import run_in_threadpool
    result = await run_in_threadpool(func, *args)
    return PJSON(result)


@app.get("/healthz")
def healthz():
    return Response("ok", media_type="text/plain")
