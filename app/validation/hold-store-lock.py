"""Hold only a real SQLite write lock for external desktop fault injection.

Never reads or changes application facts. Closing the connection rolls back the
empty transaction. Every fixture path is passed by the isolated desktop runner.
"""
import pathlib
import sqlite3
import sys
import time

database, ready, stop = map(pathlib.Path, sys.argv[1:])
connection = sqlite3.connect(database, timeout=3)
try:
    connection.execute("BEGIN IMMEDIATE")
    ready.write_text("LOCKED", encoding="utf-8")
    deadline = time.monotonic() + 300
    while not stop.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
finally:
    connection.rollback()
    connection.close()
