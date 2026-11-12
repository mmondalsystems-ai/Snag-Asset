"""Google Drive access through the Apps Script web app (runs as the sheet owner)."""
import httpx

from config import APPS_SCRIPT_TOKEN, APPS_SCRIPT_URL


def _call(action: str, payload: dict) -> dict:
    if not APPS_SCRIPT_URL or not APPS_SCRIPT_TOKEN:
        raise RuntimeError("APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN are not set")
    # Apps Script answers a POST with a 302 to the result URL -> must be followed with GET
    r = httpx.post(APPS_SCRIPT_URL, params={"token": APPS_SCRIPT_TOKEN, "action": action},
                   json=payload, timeout=55, follow_redirects=True)
    try:
        data = r.json()
    except Exception:
        raise RuntimeError("Drive proxy returned a non-JSON answer (HTTP %s)" % r.status_code)
    if data.get("status") != "ok":
        raise RuntimeError(data.get("msg") or "Drive proxy error")
    return data


def upload_file(folder_id, flat_no, round_name, base64_data, mime_type, file_name) -> str:
    data = _call("uploadPhoto", {"folderId": folder_id, "flatNo": flat_no, "round": round_name,
                                 "base64Data": base64_data, "mimeType": mime_type, "fileName": file_name})
    return data["fileId"]


def trash_file(file_id) -> None:
    _call("deletePhoto", {"fileId": file_id})
