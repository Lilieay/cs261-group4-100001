# Task103 U9 — Delivery package (v0.2)

## Repository placement

- `docs/U9/design/task103-u9-dao-design.md` + `.docx`
- `docs/U9/design/task103-u9-review-and-test-plan.md` + `.docx`
- `docs/U9/design/task103-u9-sequences.md` + `.docx`
- `docs/U9/design/diagrams/*.mmd` — editable Mermaid originals
- `docs/U9/assets/*.png` — rendered diagrams

## Key changes

1. PUT first-time and repeated saves both return HTTP 200 with the same `SavedItemState` (`item_type`, `item_id`, `saved: true`).
2. UI duplicate wording is derived from the saved state already known by the UI, not a response-only duplicate field.
3. Guide bookmarks use existing `saved_guides`; Summary PDF bookmarks use `saved_summaries`, sharing relations with U10 list/remove.
4. ER shows FK and composite primary/unique keys.
5. SQLAlchemy transaction begins before target SELECT; target check and insert share the transaction.
6. Saved-items DB read/write/commit failures map to `503 SAVED_ITEMS_UNAVAILABLE`.
7. Test plan includes TC06–TC12, with a traceability note because the original Task98 document was not included in this upload set; compare exact TC names/wording to Task98 before final review.

## Review status

Draft for Review. No implementation or tests are claimed as completed.
