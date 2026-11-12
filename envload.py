"""Load .env into os.environ for local runs. On Vercel there is no .env file, so this does nothing."""
import os
from pathlib import Path


def load() -> None:
    p = Path(__file__).resolve().parent / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


load()
