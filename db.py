"""Database pool (Supabase Transaction pooler, port 6543)."""
import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

import envload  # noqa: F401  (loads .env for local runs)

_pool = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = os.environ["DATABASE_URL"]
        _pool = ConnectionPool(
            url,
            min_size=0,
            max_size=int(os.environ.get("DB_POOL_MAX", "1")),
            kwargs={"row_factory": dict_row, "prepare_threshold": None},  # pooler: no prepared statements
            open=True,
        )
    return _pool


@contextmanager
def session():
    """One DB transaction: commit on success, roll back on error."""
    with get_pool().connection() as conn:
        yield conn


def q(conn: psycopg.Connection, sql: str, params=None):
    return conn.execute(sql, params)
