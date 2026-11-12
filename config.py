"""Static configuration - same values as the top of the old Code.gs."""
import os

import envload  # noqa: F401  (loads .env for local runs)

# ── PHOTO FOLDER CONFIG (Google Drive) ───────────────────────
# One Drive folder per tower per section. Photos are organised into
# sub-folders: FlatNo / Round.  Add more towers by following the same pattern.
PHOTO_FOLDERS = {
    "Prayag": {
        "snag": "1ybSJjwHp7pXZUyYnPlamz6BG-ZOli5dE",
        "asset": "1CwN0poh6FpOMJ_BNi-LC3VQZTkT6nqp9",
    },
    # ── Add more towers below ──
    "Veni": {
        "snag": "1_X_OSIxczX50r92TzpzPWmOyfb5P_GYV",
        "asset": "19v9kY984D1hLJc6baQsGG4YQ-6fzGU2Z",
    },
    # "TowerName": {"snag": "FOLDER_ID", "asset": "FOLDER_ID"},
}

# Fallback folder if tower/section not found in PHOTO_FOLDERS above
PHOTO_FOLDER_FALLBACK = "1UZWMiu4O_lVcW0mNyUP9L7qy8rbgPYcC"

# Spreadsheet that mirrors the data (used only by the debug endpoint / Apps Script)
SS_ID = "19tr2BC9ZRcdhzgOWOqK1c-xuDqhaSjYqXhZ1srvKXAQ"

CODE_VERSION = "v20260811"  # same marker as the old script

# Field label map used by the Activity Log (FIELD_LABEL_MAP in Code.gs)
FIELD_LABEL_MAP = {
    "status": "Status",
    "r1SnagRemark": "R1 Snag Remark",
    "r1DeSnagRemark": "R1 De-Snag Remark",
    "r2SnagRemark": "R2 Snag Remark",
    "r2DeSnagRemark": "R2 De-Snag Remark",
    "respContractor": "Resp. Contractor",
    "checkingArea": "Checking Area",
    "respName": "Resp. Name",
    "numbers": "Quantity",
    "respPerson": "Resp. Person",
}

# Columns (= sheet headers) that saveInspection / saveAssetInspection / updateAssetMaster accept
INSPECTION_FIELDS = ["rowId", "flatId", "snagId", "status", "r1SnagRemark",
                     "r1DeSnagRemark", "r2SnagRemark", "r2DeSnagRemark"]
ASSET_INSPECTION_FIELDS = ["rowId", "flatId", "assetId", "status", "r1SnagRemark",
                           "r1DeSnagRemark", "r2SnagRemark", "r2DeSnagRemark"]
ASSET_MASTER_FIELDS = ["assetId", "assetType", "location", "assetPoint", "numbers", "respPerson"]

# Apps Script web app that does the Google Drive work (Vercel cannot use DriveApp)
APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "")     # https://script.google.com/macros/s/.../exec
APPS_SCRIPT_TOKEN = os.environ.get("APPS_SCRIPT_TOKEN", "")
