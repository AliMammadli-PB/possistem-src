#!/usr/bin/env python3
"""Preview or repair a verified branch duplicate while the POS is stopped."""
import argparse
import json
import sqlite3
from pathlib import Path


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def inspect(db, args):
    records = db.execute(
        """SELECT o.id, o.name, o.active, w.id AS warehouse, w.active AS warehouse_active
           FROM cash_objects o JOIN warehouses w ON w.id=o.warehouse_id
           WHERE o.id IN (?, ?) ORDER BY o.id""",
        (args.keep, args.duplicate),
    ).fetchall()
    by_id = {row["id"]: dict(row) for row in records}
    keep, duplicate = by_id.get(args.keep), by_id.get(args.duplicate)
    if not keep or not duplicate or not keep["active"] or keep["warehouse"] == duplicate["warehouse"]:
        raise ValueError("Obyekt və anbar ID-lərini dəqiqləşdirin")
    if duplicate["name"] != args.name and duplicate["active"]:
        raise ValueError("Nüsxənin adı gözlənilən filial adına uyğun gəlmir")
    if db.execute(
        "SELECT 1 FROM app_settings WHERE key=? AND value<>?",
        ("restaurant.cloudObject." + args.branch, args.keep),
    ).fetchone():
        raise ValueError("Filial başqa yerli obyektə bağlıdır")

    references = {}
    for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        quoted = identifier(table)
        for column in db.execute(f"PRAGMA table_info({quoted})"):
            key = column["name"]
            if key == "id" and table in ("cash_objects", "warehouses"):
                continue
            if key == "warehouse_id" and table == "cash_objects":
                condition, params = " AND id<>?", (args.duplicate,)
            elif key == "warehouse_id" and table == "stock_levels":
                condition, params = " AND qty_milli<>0", ()
            else:
                condition, params = "", ()
            # This includes operational references stored as plain TEXT without a foreign key.
            count = db.execute(
                f"SELECT COUNT(*) FROM {quoted} WHERE {identifier(key)} IN (?, ?){condition}",
                (args.duplicate, duplicate["warehouse"], *params),
            ).fetchone()[0]
            if count:
                references[table + "." + key] = count
    return keep, duplicate, references


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--keep", required=True)
    parser.add_argument("--duplicate", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    if args.apply and (not args.backup or args.backup.exists()):
        parser.error("--apply requires a new --backup file")
    uri = args.database.resolve().as_uri() + ("?mode=rw" if args.apply else "?mode=ro")
    with sqlite3.connect(uri, uri=True) as db:
        db.row_factory = sqlite3.Row
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("SQLite bütövlüyü yoxlanmadı")
        keep, duplicate, references = inspect(db, args)
        print(json.dumps({"keep": keep, "duplicate": duplicate, "references": references}, ensure_ascii=False))
        if not args.apply:
            return
        if references:
            raise ValueError("Nüsxəyə bağlı qeydlər var. Dəyişiklik edilmədi.")
        args.backup.touch(mode=0o600, exist_ok=False)
        with sqlite3.connect(args.backup) as backup:
            db.backup(backup)
            if backup.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("Yedəyin bütövlüyü yoxlanmadı")
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        current = inspect(db, args)
        if current != (keep, duplicate, references):
            raise ValueError("Yedəkdən sonra əlaqələr dəyişdi. Dəyişiklik edilmədi.")
        archived = f"{args.name} [arxiv {args.duplicate}]"
        db.execute("UPDATE cash_objects SET name=?,active=0 WHERE id=?", (archived, args.duplicate))
        db.execute("UPDATE warehouses SET name=?,active=0 WHERE id=?", (archived, duplicate["warehouse"]))
        db.execute("UPDATE cash_objects SET name=? WHERE id=?", (args.name, args.keep))
        db.execute("UPDATE warehouses SET name=? WHERE id=?", (args.name, keep["warehouse"]))
        db.execute(
            """INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,strftime('%s','now')*1000)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""",
            ("restaurant.cloudObject." + args.branch, args.keep),
        )
        print(json.dumps({"applied": True, "kept": args.keep, "warehouse": keep["warehouse"]}))


if __name__ == "__main__":
    main()
