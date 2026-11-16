# Task116 — U9 Backend: Save and Read Saved State

## Scope and approved design

Task116's original wording referred to saving a Course with `SavedCourse`. Task103 v0.4, merged into `sprint2`, records the later PO decision: U9 saves one Guide or Summary at a time, and Course is used only for grouping. This implementation follows Task103 and Task94 v0.4. It does not create `SavedCourse`, save an empty Course, or migrate/copy existing `saved_guides` rows.

## Implementation

- Added `SavedSummary` with composite primary key `(user_id, summary_id)` and foreign keys to `users.id` and `summaries.id`; deleting a Summary cascades only its saved-summary relation.
- Added DAO target/state/insert operations for Guide and Summary. Guide bookmarks use the existing `saved_guides` relation; Summary bookmarks use `saved_summaries`.
- Added `SavedItemsService` with a transaction started before target lookup. PUT is idempotent and returns the same state for first and repeated save. On a duplicate-key race, it rolls back and verifies the target and relation in a new transaction; target FK races are rechecked separately.
- Added `PUT /api/saved-items/{item_type}/{item_id}` and `GET /api/saved-items/{item_type}/{item_id}`. Both require the existing `current_user`, accept only `guide` or `summary`, derive `user_id` from the authenticated principal, reject body/query parameters, validate the raw path ID as ASCII decimal digits before integer conversion (so `1.0` and `+1` are rejected), and return `Cache-Control: no-store`.
- Integrity recovery accepts only a duplicate matching the actual bookmark primary/unique key name and columns. SQL Server metadata is checked after rollback; SQLite's exact reported relation columns are checked. A named target FK is checked against FK metadata; an unnamed SQLite FK is resolved by rechecking the target after rollback. Other constraints fail with `503 SAVED_ITEMS_UNAVAILABLE` without treating an existing relation as duplicate success.
- `backend/app/init_db.py` imports the new model before `Base.metadata.create_all`. Initialization adds the missing table without dropping or rewriting existing tables; no saved-guide conversion runs.

### API results

| Case | Result |
|---|---|
| Save Guide or Summary | `200 {"item_type":"guide|summary","item_id":N,"saved":true}` |
| Save same item again | Same `200` response; one relation per user and item |
| Read existing item not saved yet | `200` with `saved:false` |
| Missing target | `404 GUIDE_NOT_FOUND` or `404 SUMMARY_NOT_FOUND` |
| Invalid type/ID, body, or query | `422 INVALID_PARAMETERS` |
| Missing/invalid login | `401 AUTH_REQUIRED` with `WWW-Authenticate: Bearer` |
| Database read/write/commit failure | `503 SAVED_ITEMS_UNAVAILABLE`; no false success/state |

## Setup and test data

On Docker startup, the existing backend initialization runs `Base.metadata.create_all`; this creates `saved_summaries` when absent and preserves existing `saved_guides`. No file storage is needed for the save/state endpoints. The Summary fixture includes file metadata to represent a published Summary; the API does not read or write PDF bytes.

The SQLite API fixture creates two users, one CS course, one Guide, one Summary with file metadata, and a pre-existing `saved_guides` row. It verifies both target types can share the same numeric ID, saved state is separated by user, and the legacy row remains unchanged.

From `backend/`, set a dummy import-only SQL connection string for SQLite tests, then run:

```powershell
$env:DB_CONNECTION_STRING = 'DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=Task116Test;UID=sa;PWD=not-used-by-sqlite-tests'
.venv\Scripts\python.exe -m pytest -q test/test_saved_items_service.py test/test_saved_items_api.py test/test_saved_items_sqlserver_integration.py
```

Unit tests use fake Session/DAO objects to verify dispatch, transaction ordering, idempotency, and error handling. API tests use a real in-memory SQLite database and the FastAPI `current_user` dependency is overridden with test users; DAO methods are patched only in explicit failure tests. The SQL Server integration test uses the configured `DB_CONNECTION_STRING` and creates/drops a uniquely named temporary schema. Run it only against a disposable test database:

```powershell
$env:TASK116_TEST_SQLSERVER = '1'
.venv\Scripts\python.exe -m pytest -q test/test_saved_items_sqlserver_integration.py
```

## Test report

| Test level | Test data / coverage | Actual result | Evidence |
|---|---|---|---|
| Unit | Guide/Summary dispatch, begin-before-SELECT, repeated save, unsaved state, missing target, exact duplicate constraint matching, unrelated unique constraint, FK target deletion race, DB errors | 14 passed across service and constraint tests | `test_saved_items_service.py`, `test_saved_item_constraints.py` |
| API | Guide/Summary save/state, same numeric ID in separate relations, current-user isolation, raw path rejects `1.0`/`+1` for GET and PUT, invalid type/ID/body/query, target not found, login errors, read/write failures, preserving legacy `saved_guides` | 15 passed | `test_saved_items_api.py` |
| SQL Server integration | Real SQL Server schema, PUT/GET for both target types, duplicate save leaves one relation | Not run; skipped unless `TASK116_TEST_SQLSERVER=1` | `test_saved_items_sqlserver_integration.py` |

Latest focused run: **29 passed, 1 warning**. The warning is Starlette's TestClient/httpx deprecation warning. This focused command excluded the SQL Server integration test; no SQL Server integration result is claimed.

Latest full backend run: **424 passed, 4 skipped, 81 subtests passed, 1 warning**. The four skipped tests include SQL Server-only integration tests; no SQL Server integration result is claimed.

## Review and completion

- [x] Model, DAO, Service, API, and router/dependency registration implemented according to Task103.
- [x] Additive table initialization and preservation of legacy bookmarks covered by tests.
- [x] Unit and API tests run successfully; mocks and fixtures are documented above.
- [ ] SQL Server integration executed against a disposable database.
- [ ] Independent GitHub review approved and PR merged into `sprint2`.
