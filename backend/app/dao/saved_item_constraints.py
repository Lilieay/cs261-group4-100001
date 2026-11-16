import re
from enum import Enum

from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


class IntegrityConflictKind(Enum):
    BOOKMARK_DUPLICATE = "bookmark_duplicate"
    TARGET_FOREIGN_KEY = "target_foreign_key"
    UNNAMED_FOREIGN_KEY = "unnamed_foreign_key"
    OTHER = "other"


def classify_saved_item_integrity_error(
    error: IntegrityError,
    *,
    session: Session,
    relation_table: str,
    bookmark_columns: tuple[str, str],
    target_column: str,
    target_table: str,
) -> IntegrityConflictKind:
    """Classify only the relation's expected unique key and target FK."""
    message = " ".join(str(part) for part in getattr(error.orig, "args", ()))
    lowered = message.lower()

    # SQLite reports the exact columns but does not name the FK constraint.
    if "unique constraint failed:" in lowered:
        match = re.search(r"unique constraint failed:\s*(.+)$", message, re.IGNORECASE)
        if match and _sqlite_unique_columns_match(
            match.group(1), relation_table, bookmark_columns
        ):
            return IntegrityConflictKind.BOOKMARK_DUPLICATE
        return IntegrityConflictKind.OTHER
    if "foreign key constraint failed" in lowered:
        return IntegrityConflictKind.UNNAMED_FOREIGN_KEY

    if _has_sqlserver_code(message, 2627, 2601):
        if _matches_expected_unique_index(
            message,
            session,
            relation_table,
            bookmark_columns,
        ):
            return IntegrityConflictKind.BOOKMARK_DUPLICATE
        return IntegrityConflictKind.OTHER

    if _has_sqlserver_code(message, 547):
        if _matches_expected_target_fk(
            message,
            session,
            relation_table,
            target_column,
            target_table,
        ):
            return IntegrityConflictKind.TARGET_FOREIGN_KEY
        return IntegrityConflictKind.OTHER

    return IntegrityConflictKind.OTHER


def _sqlite_unique_columns_match(
    reported: str,
    relation_table: str,
    expected_columns: tuple[str, str],
) -> bool:
    actual = tuple(
        ".".join(_identifier(bit).lower() for bit in part.strip().split(".")[-2:])
        for part in reported.split(",")
    )
    expected = tuple(f"{relation_table}.{column}".lower() for column in expected_columns)
    return actual == expected


def _inspection_scope(session: Session) -> dict[str, str]:
    schema_map = session.get_bind().get_execution_options().get("schema_translate_map")
    if isinstance(schema_map, dict) and schema_map.get(None):
        return {"schema": schema_map[None]}
    return {}


def _matches_expected_unique_index(
    message: str,
    session: Session,
    relation_table: str,
    expected_columns: tuple[str, str],
) -> bool:
    constraint_match = re.search(
        r"(?:constraint|index)\s+['\"]([^'\"]+)['\"]", message, re.IGNORECASE
    )
    object_match = re.search(r"object\s+['\"]([^'\"]+)['\"]", message, re.IGNORECASE)
    if not constraint_match or not object_match:
        return False
    if _identifier(object_match.group(1)).lower() != relation_table.lower():
        return False

    reported_name = constraint_match.group(1).split(".")[-1].strip("[]\"'")
    try:
        inspector = inspect(session.get_bind())
        scope = _inspection_scope(session)
        primary_key = inspector.get_pk_constraint(relation_table, **scope)
        if _matches_named_columns(primary_key, reported_name, expected_columns):
            return True
        unique_constraints = inspector.get_unique_constraints(relation_table, **scope)
        if any(
            _matches_named_columns(item, reported_name, expected_columns)
            for item in unique_constraints
        ):
            return True
        indexes = inspector.get_indexes(relation_table, **scope)
        return any(
            item.get("unique")
            and _matches_named_columns(item, reported_name, expected_columns)
            for item in indexes
        )
    except Exception:
        # If metadata cannot confirm the exact expected key, fail closed.
        return False


def _matches_named_columns(
    constraint: dict,
    expected_name: str,
    expected_columns: tuple[str, str],
) -> bool:
    name = constraint.get("name")
    columns = constraint.get("constrained_columns", constraint.get("column_names"))
    return (
        bool(name)
        and name.lower() == expected_name.lower()
        and tuple(columns or ()) == expected_columns
    )


def _matches_expected_target_fk(
    message: str,
    session: Session,
    relation_table: str,
    target_column: str,
    target_table: str,
) -> bool:
    constraint_match = re.search(
        r"foreign key constraint\s+['\"]([^'\"]+)['\"]", message, re.IGNORECASE
    )
    if not constraint_match:
        return False
    reported_name = constraint_match.group(1).split(".")[-1].strip("[]\"'")
    try:
        foreign_keys = inspect(session.get_bind()).get_foreign_keys(
            relation_table, **_inspection_scope(session)
        )
    except Exception:
        return False
    return any(
        item.get("name")
        and item["name"].lower() == reported_name.lower()
        and item.get("constrained_columns") == [target_column]
        and (item.get("referred_table") or "").lower() == target_table.lower()
        and item.get("referred_columns") == ["id"]
        for item in foreign_keys
    )


def _has_sqlserver_code(message: str, *codes: int) -> bool:
    return any(re.search(rf"(?<!\d){code}(?!\d)", message) for code in codes)


def _identifier(value: str) -> str:
    return value.strip().strip("[]\"'").split(".")[-1].strip().strip("[]\"'")
