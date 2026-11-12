"""Replacement for the run-once functions of the old Apps Script editor.

    python maintenance.py add-veni-flats     # same as addVeniFlats()
"""
import os
import sys
from pathlib import Path

p = Path(".env")
if p.exists():
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import logic  # noqa: E402

if sys.argv[1:] == ["add-veni-flats"]:
    print(logic.addVeniFlats())
else:
    sys.exit(__doc__)
