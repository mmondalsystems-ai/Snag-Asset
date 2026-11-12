"""Turn the original Apps Script page into templates/index.html.

Usage:  python make_index.py SnagIndex.html
The page itself is NOT changed except for three mechanical swaps:
  * the GAS scriptlet  <?!= buildUsernameOptions(usernames) ?>  becomes a marker the server fills in
  * /static/shim.js is loaded first, so google.script.run keeps working (it calls /api/<function>)
"""
import re
import sys
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else "SnagIndex.html").read_text(encoding="utf-8")

SCRIPTLET = "<?!= buildUsernameOptions(usernames) ?>"
if SCRIPTLET not in src:
    sys.exit("Scriptlet not found - is this the original page?")
out = src.replace(SCRIPTLET, "<!--USERNAME_OPTIONS-->")

if "/static/shim.js" not in out:
    out = re.sub(r"(<head[^>]*>)", r'\1\n<script src="/static/shim.js"></script>', out, count=1)

Path("templates").mkdir(exist_ok=True)
Path("templates/index.html").write_text(out, encoding="utf-8")
print("templates/index.html written (%d bytes)" % len(out))
