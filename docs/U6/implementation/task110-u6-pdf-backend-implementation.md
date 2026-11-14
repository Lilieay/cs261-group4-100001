# Task110: U6 Backend PDF Implementation

## Version and status

| Field | Value |
|---|---|
| Task | Task110: U6 Implementation — พัฒนาและทดสอบ Backend เผยแพร่และอ่าน PDF |
| Version | 0.1 — Implementation for Review |
| Design source | Task100, branch `docs/task100-u6-pdf-design`, version 0.1 |
| Implementation branch | `feat/u6-pdf-backend` |
| Status | รอ Review; SQL Server integration ต้องรันใน environment ที่มี SQL Server |

## Implemented API

ทุก endpoint ใช้ `current_user`/Bearer Token ตัวตรวจ Login เดิม. เจ้าของสรุปมาจากผู้ใช้ที่ยืนยันตัวตน ไม่รับ `owner_id` จาก Client. ไฟล์อยู่ใน private storage และอ่านผ่าน API ที่ต้อง Login เท่านั้น.

| Method | Endpoint | Behavior |
|---|---|---|
| `POST` | `/api/summaries` | รับ `course_id`, `title`, optional `description` และ PDF แบบ multipart; คืน `201 SummaryDTO` |
| `GET` | `/api/courses/{course_id}/summaries` | คืนสรุปของวิชา CS ที่ระบุ; วิชาไม่มีสรุปคืน `items: []` |
| `GET` | `/api/summaries/{summary_id}` | คืนรายละเอียดสรุปและ `read_path` |
| `GET` | `/api/summaries/{summary_id}/file` | stream `application/pdf` หลังตรวจ Login |

ตรวจไฟล์จริงด้วย `pypdf`: ต้องเป็น PDF ที่ parse ได้ มีอย่างน้อยหนึ่งหน้า ไม่เข้ารหัส, ชื่อไฟล์ลงท้าย `.pdf`, MIME เป็น `application/pdf`, ขนาดไม่เกิน 15,000,000 ไบต์ตาม Task95; ขนาด 15,000,001 ไบต์คืน `413 PDF_TOO_LARGE`. จำกัด request multipart รวม 16 MiB. Publish ปฏิเสธ multipart part ที่ไม่อยู่ในสเปกหรือส่งซ้ำด้วย `422 INVALID_PARAMETERS`. Response ของ U6 ทุกกรณีรวม error ใช้ `Cache-Control: no-store`. Handler อ่าน multipart แบบ async แล้วย้าย PDF parsing, storage และ SQL ไป worker thread. Storage key สุ่มโดย Backend และไม่อยู่ใน DTO หรือ URL.

## Database and storage setup

- เพิ่ม SQLAlchemy models `Summary`/`SummaryFile`, DAOs, Service, DTOs และ router ตาม Task100.
- `app.init_db` import models ใหม่ก่อน `Base.metadata.create_all`. `create_all` สร้างตารางที่ยังไม่มีและไม่ drop/recreate ตารางเดิม; การ initialize ซ้ำต้องรักษาข้อมูลเดิม.
- ตารางใหม่: `summaries` และ `summary_files`; มี FK ไป `courses`, `users`, unique storage key, file-size/content-type checks และ indexes สำหรับรายการรายวิชา/เจ้าของ.
- ตั้ง `PDF_STORAGE_ROOT` เป็น `/app/data/pdfs` ใน Compose และ mount named volume `pdf_storage` แยกจาก volume ฐานข้อมูล `sqlserver_data`. ในการรัน Backend นอก Docker ค่าเริ่มต้นคือ `backend/data/pdfs`.
- `backend/data/pdfs/` อยู่ใน `.gitignore`. โฟลเดอร์นี้ไม่ถูก mount เป็น static/public route.
- เมื่อ file storage สำเร็จแต่ SQL ล้มเหลวแน่นอน: rollback, ลบ object; ถ้าลบไม่ได้ ให้เขียน cleanup marker แล้ว retry ตอน initialize.
- เมื่อผล SQL commit ไม่แน่ชัด: เก็บไฟล์เป็น private และเขียน reconciliation marker. ตอน `app.init_db` ตรวจ storage key กับ SQL ก่อนตัดสินใจเก็บหรือลบไฟล์.

## Local setup and test commands

### Start the application

1. คัดลอก `.env.example` เป็น `.env` และกำหนด `MSSQL_SA_PASSWORD` เฉพาะเครื่อง.
2. จาก root repository รัน `docker compose up -d --build`.
3. Backend initialize ตารางที่ขาดและ seed data ตาม entrypoint เดิม; PDF ใช้ named volume `pdf_storage`.

### Unit/API tests

จาก `backend/` ใช้ virtualenv และกำหนด `DB_CONNECTION_STRING` เพื่อให้โมดูลสร้าง SQLAlchemy engine ได้. ชุด Unit/API ใช้ SQLite test database; API Test ใช้ MemoryPdfStorage mock และไม่เชื่อม SQL Server จริง.

```powershell
$env:DB_CONNECTION_STRING = 'DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=CS261Group4Dev;UID=sa;PWD=not-used-by-sqlite-tests'
.venv\Scripts\python.exe -m pytest -q test
```

Fixtures ใช้วิชา CS261, CS104 (ไม่มีสรุป), MA111 (นอกขอบเขต CS), PDF ที่สร้างใน test และ AuthService/TU verifier แบบทดสอบ. API ใช้ SQLite จริงและ `MemoryPdfStorage` mock; ไม่ใช้ Token หรือบัญชี TU จริง. Storage/reconciliation unit tests ใช้ temporary directory จริงและ SQLite.

### SQL Server + real filesystem integration test

`test/test_summary_integration.py` ใช้ SQL Server ที่ระบุผ่าน `DB_CONNECTION_STRING`, สร้าง schema ชั่วคราว, ใช้ LocalPdfStorage จริง และเรียก API publish/list/open ทั้งเส้นทาง. ตรวจด้วยว่าการเรียก `create_all` ซ้ำยังคงข้อมูลเดิม.

```powershell
$env:TASK110_TEST_SQLSERVER = '1'
$env:DB_CONNECTION_STRING = '<SQL Server connection string สำหรับฐานทดสอบที่ลบ schema ชั่วคราวได้>'
.venv\Scripts\python.exe -m pytest -q test/test_summary_integration.py
```

ใช้ connection string ของฐานทดสอบเท่านั้น; Integration test จะสร้างและลบ schema ชื่อ `task110_<random>`.
Integration fixture สร้างผู้ใช้ `task110_integration_owner`, วิชา CS110 และ PDF ชั่วคราวใน schema/storage ทดสอบ; AuthService ถูกแทนด้วย test double เพื่อไม่เรียก TU API.

## Test report

### Unit/API cases

| Case | Data / action | Expected | Actual | Result / evidence |
|---|---|---|---|---|
| U6-BE-UNIT-01 | PDF เปิดได้, ชื่อมี path | รับไฟล์และตัด path จากชื่อ | ผ่าน | PASS — `test_pdf_validator.py` |
| U6-BE-UNIT-02 | ไฟล์ว่าง, เนื้อหาไม่ใช่ PDF, นามสกุล/MIME ไม่ตรง | ปฏิเสธด้วย validation error | ผ่านทุก subcase | PASS — `test_pdf_validator.py` |
| U6-BE-UNIT-03 | PDF ขนาด 15,000,001 ไบต์ | `413 PDF_TOO_LARGE` | ผ่าน | PASS — `test_pdf_validator.py` |
| U6-BE-UNIT-04 | PDF ขนาดเท่ากับ 15,000,000 ไบต์ | รับได้ | ผ่าน | PASS — `test_pdf_validator.py` |
| U6-BE-UNIT-05 | PDF เข้ารหัส | `422 PDF_UNREADABLE` | ผ่าน | PASS — `test_pdf_validator.py` |
| U6-BE-UNIT-06 | put/open/delete, key traversal, cleanup retry | เก็บ private, กัน path traversal, cleanup ได้ | ผ่าน | PASS — `test_summary_storage.py` |
| U6-BE-UNIT-07 | reconciliation มี key ที่ SQL อ้างถึงและ orphan | เก็บไฟล์ที่มี row; ลบ orphan เมื่อ SQL ตรวจได้ | ผ่าน | PASS — `test_summary_reconciliation.py` |
| U6-BE-UNIT-09 | title ว่าง/เกิน 200, description เกิน 2,000 code points | ปฏิเสธก่อนเรียก DAO หรือ storage | ผ่านทุก subcase | PASS — `test_summaries_service.py` |
| U6-BE-UNIT-10 | course นอกขอบเขต CS | ปฏิเสธก่อนเขียน storage | ผ่าน | PASS — `test_summaries_service.py` |
| U6-BE-API-01 | publish ด้วยข้อมูลถูกต้องและเปิดรายการ/detail/PDF | `201`, `200`, เปิด PDF ได้หลัง Login | ผ่าน | PASS — API ใช้ SQLite จริงและ mock storage |
| U6-BE-API-02 | ไม่มี Token กับ publish/list/detail/file | `401 AUTH_REQUIRED` ทุกเส้นทาง | ผ่าน | PASS — `test_summaries_api.py` |
| U6-BE-API-03 | course ไม่มี/ไม่ใช่วิชา CS | `404 COURSE_NOT_FOUND`, ไม่มี summary row | ผ่าน | PASS — API SQLite; storage mock |
| U6-BE-API-04 | title ว่าง/เกิน, PDF ปลอม, นามสกุลผิด, field ขาด | `422` validation error; ไม่มีรายการผิด | ผ่าน | PASS — API SQLite; storage mock |
| U6-BE-API-05 | ส่ง multipart part `owner_id` นอกสเปก | `422 INVALID_PARAMETERS`; ไม่สร้าง summary | ผ่าน | PASS — API SQLite; storage mock |
| U6-BE-API-06 | storage put ล้มเหลว | `503 STORAGE_UNAVAILABLE`; ไม่มี summary row | ผ่าน | PASS — storage mock |
| U6-BE-API-07 | SQL insert ล้มเหลวหลังเก็บไฟล์ | rollback, ชดเชยลบไฟล์, `503` | ผ่าน | PASS — SQL write mock; storage mock |
| U6-BE-API-08 | SQL ล้มเหลวและลบไฟล์ชดเชยไม่ได้ | queue cleanup; object ยังคง private; `503` | ผ่าน | PASS — SQL/storage mock |
| U6-BE-API-09 | ผล commit และการตรวจ SQL ไม่แน่ชัด | เก็บไฟล์ไว้, queue reconciliation, `503` | ผ่าน | PASS — SQL/storage mock |
| U6-BE-API-10 | summary/detail/file ไม่พบ | `404 SUMMARY_NOT_FOUND` | ผ่าน | PASS — API SQLite; storage mock |
| U6-BE-API-11 | request รวมเกิน 16 MiB | `413 REQUEST_TOO_LARGE` | ผ่าน | PASS — middleware API test |
| U6-BE-API-14 | multipart มี part นอกสเปก หรือส่ง `course_id`, `title` หรือ `file` ซ้ำ | `422 INVALID_PARAMETERS`; ไม่มี summary และไม่มีไฟล์ใหม่ | ผ่าน | PASS — API SQLite; storage mock |
| U6-BE-API-15 | response สำเร็จและ error ของ list/detail/file/publish รวมถึง 413 จาก middleware | ทุก response มี `Cache-Control: no-store` | ผ่าน | PASS — API/middleware tests |
| U6-BE-API-16 | PDF ถูกต้องขนาด 15,000,000 และ 15,000,001 ไบต์ | ขนาดแรก `201`; ขนาดหลัง `413 PDF_TOO_LARGE`; ไม่มี row จากคำขอที่เกิน | ผ่าน | PASS — API SQLite; storage mock |
| U6-BE-API-12 | DB มี file metadata แต่ private object หาย | `503 STORAGE_UNAVAILABLE`, ไม่ส่ง PDF bytes | ผ่าน | PASS — API SQLite; storage mock |
| U6-BE-API-13 | unexpected error ระหว่าง SQL write | rollback, ลบไฟล์ที่เขียนแล้ว, `500 INTERNAL_ERROR` | ผ่าน | PASS — API SQLite; SQL/storage behavior mocked |
| U6-BE-UNIT-08 | chunked request ไม่มี `Content-Length` และ body เกิน configured cap | `413 REQUEST_TOO_LARGE` ก่อนส่งให้ route | ผ่าน | PASS — middleware ASGI test |

### Actual test run

รันจาก `backend/` ด้วย `DB_CONNECTION_STRING` dummy สำหรับ import เท่านั้น; test ใช้ SQLite/mocks ตามที่ระบุ:

```text
python -m pytest -q test
172 passed, 3 skipped, 1 warning, 77 subtests passed
```

Warning หนึ่งรายการเป็น Starlette แจ้งว่า TestClient ที่ใช้ `httpx` จะเลิกสนับสนุนรูปแบบนี้ในอนาคต ไม่ใช่ test failure. สามรายการที่ skip เป็น SQL Server-specific tests และ U6 integration test; environment นี้ยังไม่มีการยืนยัน SQL Server + filesystem จริง.

API tests ใช้ SQLite และ mock file storage; ผลนี้ไม่ใช้แทนการ Integration กับ SQL Server และ filesystem จริง.

## Review status

- Backend/Frontend/PO review: รอผู้ตรวจจริงและบันทึกผล.
- SQL Server + real private storage integration: มี test พร้อม แต่ยังรันไม่ได้ใน environment นี้.
- PR review/merge: รอผู้ตรวจต่างคน; branch นี้ยังไม่ merge เข้า `develop`.
