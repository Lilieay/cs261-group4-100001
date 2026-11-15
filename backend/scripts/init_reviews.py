"""Add only the U8 review table after U1/U3/U6 schema is installed."""
from sqlalchemy import inspect

from app.db import engine
from app.models.review import Review


def initialize_reviews(bind):
    with bind.begin() as connection:
        schema = inspect(connection)
        required = {"users": {"id"}, "guides": {"id", "publisher_id"},
                    "summaries": {"id", "owner_id"}}
        for table, columns in required.items():
            if not schema.has_table(table) or not columns <= {
                column["name"] for column in schema.get_columns(table)
            }:
                raise RuntimeError(f"Install the shared U1/U3/U6 schema first: missing {table} {sorted(columns)}")
        if schema.has_table("reviews"):
            raise RuntimeError("reviews already exists; verify its columns, FK and indexes before proceeding. No changes made.")
        Review.__table__.create(connection)


if __name__ == "__main__":
    initialize_reviews(engine)
    print("Created reviews and indexes. Existing tables and PDF storage were not modified.")
