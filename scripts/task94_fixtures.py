"""Validate Task94 contract examples and build PDF inputs without calling the API."""

import argparse
import json
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "docs/task94-fixtures/examples.json"
PDF_LIMIT = 15_000_000


def pdf_bytes(pages=1, padding=0):
    stream = b"BT /F1 16 Tf 72 740 Td (Task94 CS261 summary fixture) Tj ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        (b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>" if pages else
         b"<< /Type /Pages /Kids [] /Count 0 >>"),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
    ]
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    result += b" " * padding
    xref = len(result)
    result += b"xref\n0 6\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        result += f"{offset:010d} 00000 n \n".encode()
    result += b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"
    result += str(xref).encode() + b"\n%%EOF\n"
    return bytes(result)


def sized_pdf(size):
    padding = size - len(pdf_bytes())
    for _ in range(5):
        value = pdf_bytes(padding=padding)
        if len(value) == size:
            return value
        padding += size - len(value)
    raise ValueError(f"Could not construct a PDF of {size} bytes")


def build_pdfs(directory):
    directory.mkdir(parents=True, exist_ok=True)
    files = {
        "valid-summary.pdf": pdf_bytes(),
        "empty.pdf": b"",
        "disguised.pdf": b"\x89PNG\r\n\x1a\nThis is not a PDF.\n",
        "unreadable.pdf": b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog\n",
        "no-pages.pdf": pdf_bytes(pages=0),
        "at-limit.pdf": sized_pdf(PDF_LIMIT),
        "over-limit.pdf": sized_pdf(PDF_LIMIT + 1),
    }
    for name, content in files.items():
        (directory / name).write_bytes(content)
    return {name: len(content) for name, content in files.items()}


def check_fixtures():
    examples = json.loads(FIXTURES.read_text(encoding="utf-8"))
    contract = (ROOT / "docs/task94-api-contract.md").read_text(encoding="utf-8")
    cases = examples["cases"]
    ids = [case["id"] for case in cases]
    assert len(ids) == len(set(ids)), "Duplicate case IDs"
    expected_tcs = {f"U{story}-TC{n:02d}" for story, count in
                    [(6, 8), (7, 9), (8, 9), (9, 5), (10, 7)] for n in range(1, count + 1)}
    targets = {
        "guide": {row["id"]: row for row in examples["data"]["guides"].values()},
        "summary": {row["id"]: row for row in examples["data"]["summaries"].values()},
    }
    users = {row["id"] for row in examples["data"]["users"].values()}
    for bookmark in examples["data"]["saved_items"].values():
        assert bookmark["user_id"] in users, bookmark
        assert bookmark["item_id"] in targets[bookmark["item_type"]], bookmark
    covered = set()
    endpoints = examples["endpoints"]
    used_endpoints = set()
    for case in cases:
        covered.update(case["test_cases"])
        assert case["test_cases"], case["id"]
        for group, names in case["setup"].items():
            assert set(names) <= set(examples["data"][group]), (case["id"], group)
        steps = case.get("steps", []) + case.get("parallel_steps", [])
        assert steps or "ui_expectation" in case, case["id"]
        for step in steps:
            endpoint = endpoints[step["endpoint"]]
            used_endpoints.add(step["endpoint"])
            assert step["method"] == endpoint["method"], case["id"]
            template = re.escape(endpoint["path"])
            pattern = re.sub(r"\\\{[^}]+\\\}", r"[^/?]+", template)
            assert re.fullmatch(pattern, step["path"].split("?")[0]), case["id"]
            actor = step["actor"]
            assert actor in examples["data"]["users"] or actor in ["anonymous", "expired"], case["id"]
            if step["endpoint"] == "summary_update":
                request = step["request"]
                assert request["content_type"] == "multipart/form-data", case["id"]
                assert {"course_id", "title"} <= set(request["form"]), case["id"]
            response = step["response"]
            status = response["status"]
            assert status in endpoint["statuses"], (case["id"], status)
            if status == 204:
                assert "body" not in response, case["id"]
            elif status >= 400:
                error = response["body"]["error"]
                assert set(error) == {"code", "message", "fields"}, case["id"]
                assert error["code"] in contract, (case["id"], error["code"])
                assert isinstance(error["fields"], list), case["id"]
            elif response.get("content_type") == "application/pdf":
                assert response["file"] in {"valid-summary.pdf", "at-limit.pdf"}, case["id"]
            elif endpoint["response"] == "SummaryDTO":
                body = response["body"]
                assert set(body) == {"id", "course", "title", "description", "owner", "file", "created_at", "updated_at"}, case["id"]
                assert body["file"]["read_path"] == f'/api/summaries/{body["id"]}/file', case["id"]
                file_sizes = {"valid-summary.pdf": len(pdf_bytes()), "at-limit.pdf": PDF_LIMIT}
                file = body["file"]
                assert file["size_bytes"] == file_sizes[file["original_name"]], case["id"]
            elif endpoint["response"] == "ReviewDTO":
                body = response["body"]
                assert set(body) == {"id", "target_type", "target_id", "rating", "comment", "author", "created_at", "updated_at"}, case["id"]
                assert type(body["rating"]) is int and 1 <= body["rating"] <= 5, case["id"]
            elif endpoint["response"] == "SavedItemState":
                body = response["body"]
                assert set(body) == {"item_type", "item_id", "saved"}, case["id"]
                assert body["item_type"] in targets, case["id"]
                assert type(body["item_id"]) is int and 1 <= body["item_id"] <= 2_147_483_647, case["id"]
                assert type(body["saved"]) is bool, case["id"]
                assert step["path"] == endpoint["path"].format(**body), case["id"]
                if step["method"] != "GET":
                    assert body["saved"] == (step["method"] == "PUT"), case["id"]
            elif endpoint["response"] == "SavedItemListResponse":
                body = response["body"]
                assert set(body) == {"items"}, case["id"]
                items = body["items"]
                identities = {(item["item_type"], item["item_id"]) for item in items}
                assert len(identities) == len(items), case["id"]
                expected_order = sorted(
                    items,
                    key=lambda item: (item["course"]["course_code"], item["item_type"], -item["item_id"]),
                )
                assert items == expected_order, case["id"]
                for item in items:
                    assert set(item) == {"item_type", "item_id", "course", "title", "open_path"}, case["id"]
                    kind, item_id = item["item_type"], item["item_id"]
                    target = targets[kind][item_id]
                    collection = {"guide": "guides", "summary": "summaries"}[kind]
                    assert item["open_path"] == f"/api/{collection}/{item_id}", case["id"]
                    assert item["title"] == target["title"], case["id"]
                    course_id = target["course_id"] if kind == "guide" else target["course"]["id"]
                    assert item["course"]["id"] == course_id, case["id"]
    assert covered == expected_tcs, ("TC coverage mismatch", expected_tcs - covered, covered - expected_tcs)
    assert used_endpoints == set(endpoints), ("Unused endpoint examples", set(endpoints) - used_endpoints)
    open_item = next(case for case in cases if case["id"] == "u10-open-item")
    items = open_item["steps"][0]["response"]["body"]["items"]
    assert len({item["course"]["id"] for item in items}) == 1, "U10-TC02 needs a single course group"
    assert any(
        guide["item_id"] == summary["item_id"]
        for guide in items if guide["item_type"] == "guide"
        for summary in items if summary["item_type"] == "summary"
    ), "U10-TC02 needs two target types with the same ID"
    for endpoint in endpoints.values():
        assert endpoint["path"] in contract, endpoint["path"]
    with tempfile.TemporaryDirectory(prefix="task94-pdf-check-") as tmp:
        sizes = build_pdfs(Path(tmp))
        assert sizes["at-limit.pdf"] == PDF_LIMIT
        assert sizes["over-limit.pdf"] == PDF_LIMIT + 1
        assert sizes["empty.pdf"] == 0
        assert (Path(tmp) / "valid-summary.pdf").read_bytes().startswith(b"%PDF-")
        assert (Path(tmp) / "disguised.pdf").read_bytes().startswith(b"\x89PNG")
        assert b"/Count 0" in (Path(tmp) / "no-pages.pdf").read_bytes()
        names = set(sizes)
        for case in cases:
            for step in case.get("steps", []) + case.get("parallel_steps", []):
                if "file" in step.get("request", {}):
                    assert step["request"]["file"] in names, case["id"]
    print(f"PASS: {len(cases)} examples, {len(endpoints)} endpoints, {len(covered)} test cases, {len(sizes)} PDF inputs")
    print("Checked fixture structure and PDF input sizes. No live API or database was called.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build = sub.add_parser("build-pdfs")
    build.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "check":
        check_fixtures()
    else:
        for name, size in build_pdfs(args.output_dir).items():
            print(f"{name}: {size} bytes")


if __name__ == "__main__":
    main()
