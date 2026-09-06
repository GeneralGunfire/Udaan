"""Add a disease bulletin without hand-writing SQL.

`disease_bulletins` is deliberately not automated — outbreak reporting
is scattered across DALRRD notices, NICD releases and industry bodies,
with no feed worth trusting to a parser. So it stays manual, and this
is the fast way in.

Two modes:

    python add_bulletin.py                  # interactive prompts
    python add_bulletin.py --disease "Foot-and-mouth disease" \\
        --category livestock --province KwaZulu-Natal \\
        --url https://... --summary "..." --published 2026-09-02

Interactive mode is the default because the province and category fields
have fixed valid values, and picking from a numbered list is both faster
and less error-prone than remembering the exact spelling of
"KwaZulu-Natal".
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import date

from collector import connect, resolve_db_path

CATEGORIES = ("livestock", "crop")


def load_provinces(conn: sqlite3.Connection) -> list[str]:
    """Provinces as the seeder wrote them.

    Read from the database rather than hardcoded so a bulletin can never
    be filed against a province string the rest of the schema doesn't
    recognise — which would make it invisible to every join.
    """
    return [r["province"] for r in conn.execute("SELECT province FROM locations ORDER BY province")]


def choose(prompt: str, options: list[str], allow_other: bool = False) -> str | None:
    """Numbered picker. Returns None only when `allow_other` and the user skips."""
    print(f"\n{prompt}")
    for i, option in enumerate(options, 1):
        print(f"  {i}. {option}")
    if allow_other:
        print(f"  {len(options) + 1}. (none / national)")

    while True:
        raw = input("  > ").strip()
        if not raw:
            print("  Pick a number.")
            continue
        if raw.isdigit():
            index = int(raw)
            if 1 <= index <= len(options):
                return options[index - 1]
            if allow_other and index == len(options) + 1:
                return None
        # Accept a typed name too, for anyone who'd rather not count.
        for option in options:
            if option.lower() == raw.lower():
                return option
        print("  Not a valid choice.")


def ask(prompt: str, *, required: bool = True, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    while True:
        raw = input(f"{prompt}{suffix}: ").strip()
        if not raw and default is not None:
            return default
        if raw or not required:
            return raw
        print("  Required.")


def ask_date(prompt: str, default: date | None = None) -> str | None:
    """ISO date, or empty for none. Validated so a typo can't reach the DB."""
    default_str = default.isoformat() if default else None
    while True:
        raw = ask(prompt, required=False, default=default_str)
        if not raw:
            return None
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError:
            print("  Use YYYY-MM-DD (or leave blank).")


def interactive(conn: sqlite3.Connection) -> dict[str, str | None]:
    provinces = load_provinces(conn)
    print("Add a disease bulletin. Ctrl+C to abort.")

    disease_name = ask("\nDisease name")
    category = choose("Category:", list(CATEGORIES))
    province = choose("Province affected:", provinces, allow_other=True)
    date_published = ask_date("\nDate published (YYYY-MM-DD, blank if unknown)")
    source_url = ask("Source URL", required=False)
    summary = ask("Summary (one or two lines)", required=False)

    return {
        "date_found": date.today().isoformat(),
        "date_published": date_published,
        "category": category,
        "disease_name": disease_name,
        "province_affected": province,
        "source_url": source_url or None,
        "summary": summary or None,
    }


def from_args(args: argparse.Namespace, conn: sqlite3.Connection) -> dict[str, str | None]:
    if args.category and args.category not in CATEGORIES:
        raise SystemExit(f"--category must be one of {', '.join(CATEGORIES)}")

    province = args.province
    if province:
        valid = load_provinces(conn)
        # Case-insensitive match, then fail loudly. Silently storing an
        # unrecognised province would file the bulletin somewhere no
        # query will ever find it.
        match = next((p for p in valid if p.lower() == province.lower()), None)
        if match is None:
            raise SystemExit(f"--province must be one of: {', '.join(valid)}")
        province = match

    for field in ("published", "found"):
        value = getattr(args, field)
        if value:
            try:
                date.fromisoformat(value)
            except ValueError:
                raise SystemExit(f"--{field} must be YYYY-MM-DD") from None

    return {
        "date_found": args.found or date.today().isoformat(),
        "date_published": args.published,
        "category": args.category,
        "disease_name": args.disease,
        "province_affected": province,
        "source_url": args.url,
        "summary": args.summary,
    }


def insert(conn: sqlite3.Connection, row: dict[str, str | None]) -> int:
    cursor = conn.execute(
        """INSERT INTO disease_bulletins
             (date_found, date_published, category, disease_name,
              province_affected, source_url, summary)
           VALUES (:date_found, :date_published, :category, :disease_name,
                   :province_affected, :source_url, :summary)""",
        row,
    )
    conn.commit()
    return int(cursor.lastrowid or 0)


def find_duplicate(conn: sqlite3.Connection, row: dict[str, str | None]) -> sqlite3.Row | None:
    """Same disease, same province, already on file.

    Outbreaks get reported repeatedly as they develop, so this warns
    rather than blocks — a genuine second bulletin about the same
    outbreak is worth recording.
    """
    return conn.execute(
        """SELECT id, date_found, date_published FROM disease_bulletins
           WHERE lower(disease_name) = lower(?)
             AND ifnull(lower(province_affected), '') = ifnull(lower(?), '')
           ORDER BY id DESC LIMIT 1""",
        (row["disease_name"], row["province_affected"]),
    ).fetchone()


def show_recent(conn: sqlite3.Connection, limit: int = 10) -> None:
    rows = conn.execute(
        """SELECT id, date_found, date_published, category, disease_name,
                  province_affected, summary
           FROM disease_bulletins ORDER BY id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    if not rows:
        print("No bulletins on file.")
        return
    print(f"\n{len(rows)} most recent bulletin(s):\n")
    for r in rows:
        province = r["province_affected"] or "national"
        published = r["date_published"] or "date unknown"
        print(f"  [{r['id']}] {r['disease_name']} — {province} ({r['category'] or '?'})")
        print(f"       found {r['date_found']} · published {published}")
        if r["summary"]:
            print(f"       {r['summary'][:100]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Add a disease bulletin to AgriTrack")
    parser.add_argument("--disease", help="Disease name (non-interactive mode)")
    parser.add_argument("--category", help=f"One of: {', '.join(CATEGORIES)}")
    parser.add_argument("--province", help="Province affected; omit for national")
    parser.add_argument("--url", help="Source URL")
    parser.add_argument("--summary", help="Short summary")
    parser.add_argument("--published", help="Date published (YYYY-MM-DD)")
    parser.add_argument("--found", help="Date found (YYYY-MM-DD); defaults to today")
    parser.add_argument("--force", action="store_true", help="Add even if a matching bulletin exists")
    parser.add_argument("--list", action="store_true", help="List recent bulletins and exit")
    parser.add_argument("--delete", type=int, metavar="ID", help="Delete a bulletin by id")
    parser.add_argument("--db", help="Override the SQLite path")
    args = parser.parse_args()

    conn = connect(args.db or resolve_db_path())
    try:
        if args.list:
            show_recent(conn)
            return 0

        if args.delete is not None:
            existing = conn.execute(
                "SELECT disease_name, province_affected FROM disease_bulletins WHERE id = ?",
                (args.delete,),
            ).fetchone()
            if existing is None:
                print(f"No bulletin with id {args.delete}.")
                return 1
            # Confirm before deleting: ids are easy to mistype and the
            # row is hand-entered work that isn't recoverable.
            print(f"Delete [{args.delete}] {existing['disease_name']} — {existing['province_affected'] or 'national'}?")
            if input("  type 'yes' to confirm: ").strip().lower() != "yes":
                print("Cancelled.")
                return 1
            conn.execute("DELETE FROM disease_bulletins WHERE id = ?", (args.delete,))
            conn.commit()
            print("Deleted.")
            return 0

        row = from_args(args, conn) if args.disease else interactive(conn)

        if not row["disease_name"]:
            raise SystemExit("A disease name is required.")

        duplicate = find_duplicate(conn, row)
        if duplicate is not None:
            print(
                f"\nNote: [{duplicate['id']}] already records "
                f"{row['disease_name']} in {row['province_affected'] or 'national'} "
                f"(found {duplicate['date_found']})."
            )
            if sys.stdin.isatty():
                if input("  Add another anyway? [y/N]: ").strip().lower() not in ("y", "yes"):
                    print("Cancelled.")
                    return 1
            elif not args.force:
                # Non-interactive: refuse rather than silently duplicating.
                # A scripted re-run is far more likely to be an accident
                # than a deliberate second report.
                print("  Refusing to duplicate non-interactively; pass --force to override.")
                return 1

        new_id = insert(conn, row)
        print(f"\nAdded bulletin [{new_id}]: {row['disease_name']} — {row['province_affected'] or 'national'}")
        return 0
    except KeyboardInterrupt:
        print("\nAborted.")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
