# Task100: U6 PDF Backend Design

## Document information

| Field | Value |
|---|---|
| Task | Task100: U6 Design — ออกแบบข้อมูล DAO และลำดับการเผยแพร่และอ่าน PDF |
| User Story | U6: เผยแพร่สรุป PDF รายวิชา CS ให้ผู้ใช้อื่นเปิดอ่าน |
| Version | 0.1 — Draft for Review |
| Date prepared | 10 November 2026 |
| Status | รอทบทวน Backend, Frontend และ PO |
| API baseline | Task94 API Contract v0.1 |
| Requirement / test baseline | Task95 U6 Requirements and Test Cases v0.1 |
| Review evidence | รอกรอกชื่อผู้ทบทวน วันที่ มติ และลิงก์หลัง review จริง |

> **ขอบเขตขนาดไฟล์:** ใช้เกณฑ์ Task95 ที่ merge แล้ว: PDF สูงสุด 15,000,000 bytes พอดี; 15,000,001 bytes ต้องได้ `413 PDF_TOO_LARGE`. เสนอ multipart request body รวมไม่เกิน 16 MiB (16,777,216 bytes) เพื่อเผื่อ overhead. Task94 v0.1 snapshot ที่อ้างไว้ก่อนหน้านี้ระบุ 10 MiB/11 MiB; Task100 ใช้เพดาน PDF ตาม Task95 และต้องให้ implementation/Contract ที่ใช้กับ Story นี้สอดคล้องกัน

## 1. Scope and API contract

งานนี้ออกแบบข้อมูลและ backend flow สำหรับเผยแพร่ PDF, แสดงรายการสรุปของรายวิชา และเปิดอ่าน PDF เท่านั้น ไม่ออกแบบ UI เต็มรูปแบบและไม่ implement API. การแก้ไขและลบสรุปเป็นขอบเขต U7.

| Operation | Endpoint | Success |
|---|---|---|
| Publish summary | `POST /api/summaries` | `201 SummaryDTO` |
| List summaries for a course | `GET /api/courses/{course_id}/summaries` | `200 CourseSummaryListResponse` |
| Read summary details | `GET /api/summaries/{summary_id}` | `200 SummaryDTO` |
| Open PDF | `GET /api/summaries/{summary_id}/file` | `200 application/pdf` |

ทุก endpoint ต้องผ่านตัวตรวจ Login เดิมด้วย Bearer Token ที่ยังใช้ได้. `owner_id` มาจาก authenticated session เท่านั้น ห้ามเชื่อค่าจาก request. ผู้ใช้ที่ Login แล้วอ่านสรุปและ PDF ได้. `read_path` เป็น API path เท่านั้น ห้ามส่ง storage key หรือ public URL กลับ Client.

### DTO ที่เกี่ยวข้อง

- `SummaryCreateForm`: `course_id`, `title`, `description` และไฟล์ `file` ใน `multipart/form-data`.
- `SummaryDTO`: `id`, `course`, `title`, `description`, `owner`, `file`, `created_at`, `updated_at`.
- `SummaryFileDTO`: `original_name`, `content_type`, `size_bytes`, `read_path`.
- `CourseSummaryListResponse`: `{ course_id, items }`; ถ้ามีวิชาแต่ไม่มีสรุป ให้คืน `items: []`.

## 2. Data model and relationships

ER Diagram ต้นฉบับที่แก้ไขได้: [task100-u6-pdf-er.mmd](task100-u6-pdf-er.mmd).

ความสัมพันธ์: ผู้ใช้หนึ่งคนเผยแพร่ได้หลายสรุป, รายวิชาหนึ่งมีหลายสรุป, และหนึ่งสรุปมี PDF หนึ่งไฟล์. `SUMMARY_FILES` เก็บ file metadata และ private storage reference; bytes อยู่ใน private file storage. `USERS` และ `COURSES` ใช้ Entity/ตารางเดิมใน Backend; ใน ER แสดงคอลัมน์เดิมที่เกี่ยวข้องกับ FK และข้อมูลอ้างอิงเท่านั้น (`users.username` unique, `courses.course_code` unique).

### `summaries`

| Field | SQL Server type | Key / constraint |
|---|---|---|
| `id` | `INT IDENTITY` | Primary key |
| `course_id` | `INT NOT NULL` | FK → `courses.id`; ต้องเป็นรายวิชา CS ที่มีอยู่ |
| `owner_id` | `INT NOT NULL` | FK → `users.id`; จาก authenticated session เท่านั้น |
| `title` | `NVARCHAR(400) NOT NULL` | ไม่ว่าง; สูงสุด 200 Unicode code points หลัง trim |
| `description` | `NVARCHAR(4000) NULL` | เสริม; สูงสุด 2,000 Unicode code points; trim และค่าว่างเป็น `NULL` |
| `created_at` | `DATETIME2(3) NOT NULL` | เวลา UTC |
| `updated_at` | `DATETIME2(3) NOT NULL` | เวลา UTC; เริ่มต้นเท่ากับ `created_at` |

### `summary_files`

| Field | SQL Server type | Key / constraint |
|---|---|---|
| `summary_id` | `INT NOT NULL` | PK และ FK → `summaries.id`; บังคับหนึ่งไฟล์ต่อสรุป |
| `storage_key` | `NVARCHAR(512) NOT NULL` | Unique; backend สร้างและห้ามเปิดเผยแก่ Client |
| `original_name` | `NVARCHAR(255) NOT NULL` | ตัด path และอักขระควบคุมก่อนบันทึก; ยืนยันขนาดกับทีม |
| `content_type` | `VARCHAR(64) NOT NULL` | `application/pdf` |
| `size_bytes` | `BIGINT NOT NULL` | 1–15,000,000 bytes |

คอลัมน์ของ Entity เดิมที่แสดงใน ER: `users.id` เป็น PK, `username` เป็น `VARCHAR(50) UNIQUE NOT NULL`, ชื่อแสดงภาษาไทย/อังกฤษเป็น `NVARCHAR(255) NULL`; `courses.id` เป็น PK, `course_code` เป็น `VARCHAR(30) UNIQUE NOT NULL`, `course_name` เป็น `NVARCHAR(255) NOT NULL`, `instructor_name` เป็น `NVARCHAR(255) NULL`, และ `description` เป็น `NVARCHAR(MAX) NULL`.

### Indexes and ordering

- `summaries(course_id, created_at DESC, id DESC)` สำหรับรายการของรายวิชา.
- `summaries(owner_id, created_at DESC, id DESC)` เผื่อ API รายการของฉันใน U7.
- Unique index บน `summary_files.storage_key`.
- รายการเรียง `created_at` ใหม่ไปเก่า แล้ว `id` มากไปน้อย; การแก้ชื่อในอนาคตไม่เปลี่ยนลำดับ.
- ความยาว `NVARCHAR` เผื่อ Unicode ที่ใช้อักขระ UTF-16 สอง code units; Service ยังคงตรวจจำนวน code points ตาม Contract.

## 3. DAO and storage methods

Service เป็นเจ้าของ SQLAlchemy Session และควบคุม commit/rollback เพื่อจัดการ metadata ของสรุปและไฟล์ใน transaction เดียว.

| Component / method | Input | Result | Error handling |
|---|---|---|---|
| `SummaryDAO.create(course_id, owner_id, title, description)` | IDs และ metadata ที่ผ่าน validation | Summary ที่ flush แล้ว ยังไม่ commit | FK/SQL error: Service rollback |
| `SummaryDAO.list_by_course(course_id)` | Course ID | Summary พร้อม course, owner, file metadata เรียงตาม Contract | Course ไม่มี: Service คืน `404 COURSE_NOT_FOUND`; ไม่มี summary: list ว่าง |
| `SummaryDAO.get_by_id(summary_id)` | Summary ID | Summary พร้อม course, owner, file metadata หรือ `None` | ไม่พบ: `None`; SQL error ส่งให้ Service จัดการ |
| `SummaryDAO.get_course(course_id)` | Course ID | Course หรือ `None` | ไม่พบ/ไม่ใช่ CS: `404 COURSE_NOT_FOUND` |
| `SummaryFileDAO.create(summary_id, storage_key, original_name, content_type, size_bytes)` | Summary ID และ metadata หลังตรวจ PDF/storage | File metadata ที่ flush แล้ว ยังไม่ commit | FK/Unique/SQL error: rollback transaction เดียวกับ summary |
| `SummaryFileDAO.get_by_summary_id(summary_id)` | Summary ID | File metadata หรือ `None` | ไม่พบ summary/file: `404 SUMMARY_NOT_FOUND` |
| `SummaryFileDAO.list_storage_keys()` | ไม่มี | ชุด storage keys ที่ SQL Server อ้างถึงทั้งหมด | SQL error: ห้ามเริ่มลบ orphan; startup ต้องคงไฟล์และไม่ Ready |
| `SummaryStorage.put_private(key, file)` | Backend-generated private key และไฟล์ผ่าน validation | Storage metadata เช่น key, size, content type | เขียนไม่ได้: `503 STORAGE_UNAVAILABLE`; ห้ามสร้าง SQL row |
| `SummaryStorage.open_private(key)` | Private key จากฐานข้อมูล | PDF stream/handle | Object หาย/อ่านไม่ได้: `503 STORAGE_UNAVAILABLE`; ห้ามส่ง internal path |
| `SummaryStorage.delete_private(key)` | Private key ใช้ชดเชย SQL failure | ผลการลบ | ลบไม่ได้: log/queue cleanup retry; object ต้องคง private |
| `SummaryStorage.list_private_objects()` | Private storage root | Keys ของไฟล์ object ที่มีอยู่จริง; ไม่รวม temp/metadata directories | Storage error: ห้ามลบและห้ามรายงาน Ready |

`storage_key` ไม่ได้มาจากชื่อไฟล์ของผู้ใช้และไม่อยู่ใน DTO. Mapper/Service สร้าง `read_path` จาก `summary_id`.

## 4. Publish transaction and compensation

จะเผยแพร่สรุปผ่าน API ได้เมื่อ file object และ SQL metadata พร้อมใช้งานแล้วเท่านั้น. Storage ต้องเป็น private และไม่มี static/public directory.

1. ตรวจ Login, request fields, CS course และ PDF จริง รวมขนาด.
2. Backend สร้าง storage key ที่ไม่เปิดเผยข้อมูลผู้ใช้ แล้วเขียนไฟล์ใน private storage.
3. ตรวจว่าไฟล์ที่จัดเก็บอ่านได้ จากนั้นเริ่ม SQL transaction.
4. เพิ่ม `summaries` และ `summary_files` ใน transaction เดียว แล้ว commit.
5. คืน `201 SummaryDTO` หลัง storage และ SQL พร้อมใช้งาน.
6. ถ้า SQL ล้มเหลวแน่นอน ให้ rollback และเรียก `delete_private(storage_key)`. ถ้าลบไม่ได้ ให้บันทึก cleanup work เพื่อ retry; object ยังคง private และไม่มี summary row ให้ API อ่าน.
7. ถ้าผล commit ไม่แน่ชัดเพราะ connection หลุด ห้ามลบไฟล์ทันที. ค้นหา record ด้วย storage key; ถ้าตรวจ SQL ไม่ได้ ให้เก็บ object เป็น private และส่งเข้า reconciliation เพื่อไม่ให้ record ที่ commit แล้วชี้ไปไฟล์ที่ถูกลบ.
8. ถ้า storage เขียนไม่สำเร็จ ให้ไม่เริ่มสร้าง SQL row และคืน `503 STORAGE_UNAVAILABLE`.
9. ถ้า response หายหลัง commit สำเร็จ Frontend ห้าม retry POST อัตโนมัติ; ให้ตรวจรายการก่อนให้ผู้ใช้ตัดสินใจส่งซ้ำ.

หาก process หยุดหลังเขียนไฟล์แต่ก่อน SQL commit จะเกิด private object ที่ไม่มี SQL row. ให้ใช้ startup orphan reconciliation ตามหัวข้อ 4.1 เพื่อเก็บกวาด โดยไม่พึ่ง marker.

### 4.1 Startup orphan cleanup and deployment safety

สำหรับ Docker ที่รัน Backend เพียง instance เดียว ให้ทำ reconciliation ในขั้นตอนเริ่มระบบหลัง SQL Server พร้อมใช้ และก่อน Backend เปิด readiness/รับ API requests:

1. Enumerate ไฟล์ object ทั้งหมดใน private storage โดยใช้ `list_private_objects()`; ห้ามพึ่ง cleanup marker เพราะ process อาจหยุดก่อนสร้าง marker. ข้าม temporary upload files, marker files และ directory ที่ไม่ใช่ object.
2. โหลดชุด `storage_key` ทั้งหมดจาก `summary_files` ด้วย `SummaryFileDAO.list_storage_keys()` ให้ query สำเร็จครบก่อนเริ่มลบไฟล์ใด ๆ.
3. เก็บไฟล์ที่มี `storage_key` อยู่ในฐานข้อมูล; ลบเฉพาะ object ที่ไม่อยู่ในชุดอ้างอิงจาก query ที่สำเร็จแล้ว.
4. หาก SQL Server ตอบไม่ได้หรือการ query ไม่สำเร็จ ห้ามลบไฟล์ใด ๆ, log สาเหตุ และไม่เปิด readiness/รับคำขอ; เมื่อ container เริ่มใหม่ให้ลอง reconciliation ซ้ำ.
5. หากลบ orphan ไม่สำเร็จ ให้เก็บไฟล์ไว้แบบ private, log key ที่ลบไม่ได้ และลองใหม่เมื่อเริ่มระบบครั้งถัดไป.

วิธีนี้เก็บกวาด orphan ที่ไม่มี marker ได้ และเก็บไฟล์ที่มีแถว SQL อ้างถึงไว้เสมอ. สำหรับหลาย Backend instances ที่ใช้ storage ร่วมกัน ห้ามให้ startup scan ลบไฟล์ขณะที่อีก instance กำลัง upload: ทุก instance ต้องใช้ distributed lock/lease ร่วมกัน โดย publish ถือ lease ตั้งแต่ก่อนเขียนไฟล์จน SQL commit หรือ compensation เสร็จ และ startup cleanup ต้องถือ exclusive lease ตลอดช่วง scan/delete. หาก lock/lease ใช้ไม่ได้ ให้ไม่ลบและไม่ Ready; หาก deployment ไม่มีการประสาน lock/lease ให้ปิด automatic orphan cleanup สำหรับ multi-instance mode.

แผนภาพ startup reconciliation ที่แก้ไขได้: [task100-u6-pdf-reconcile.mmd](task100-u6-pdf-reconcile.mmd).

## 5. Error paths

| Situation | Expected result |
|---|---|
| ไม่มี Token, Token ผิด/หมดอายุ | `401 AUTH_REQUIRED`; ไม่ส่งข้อมูลหรือ PDF |
| Course ไม่มีหรือไม่ใช่ CS | `404 COURSE_NOT_FOUND` |
| Summary/file metadata ไม่มีหรือถูกลบ | `404 SUMMARY_NOT_FOUND` |
| ไฟล์ว่าง, ไม่ใช่ PDF หรือเนื้อหาไม่ใช่ PDF | `422 PDF_INVALID` |
| PDF เปิด parse ไม่ได้, ไม่มีหน้า หรือเข้ารหัส | `422 PDF_UNREADABLE` |
| ฟิลด์บังคับไม่ครบ, title ว่าง/เกิน 200 code points หรือ description เกิน 2,000 code points | `422` validation response ตาม schema ใน Task94; ยืนยัน code ที่แน่นอนตอน Contract Review |
| Client ส่ง `owner_id` ของผู้อื่น | ห้ามใช้ค่าจาก request; ใช้ owner จาก authenticated session ตาม Contract |
| PDF เกิน 15,000,000 bytes | `413 PDF_TOO_LARGE` |
| Multipart request เกิน 16 MiB ที่เสนอ | `413 REQUEST_TOO_LARGE` |
| SQL หรือ storage ใช้งานไม่ได้ | `503 STORAGE_UNAVAILABLE`; ห้ามแจ้งสำเร็จหรือเปลี่ยน error เป็นรายการว่าง |
| Frontend proxy ติดต่อ Backend ไม่ได้/timeout | `502 UPSTREAM_UNAVAILABLE`; ห้าม retry POST อัตโนมัติ |
| Metadata มีแต่ object อ่านไม่ได้ | `503 STORAGE_UNAVAILABLE`; ห้ามคืน internal path หรือส่ง bytes ที่ไม่สมบูรณ์เป็น PDF |

เพดาน PDF ของแบบนี้เป็น 15,000,000 bytes ตาม Task95 ที่ merge แล้ว; request body รวมยังเสนอไว้ไม่เกิน 16 MiB.

## 6. Sequence diagrams

- Publish: [task100-u6-pdf-publish.mmd](task100-u6-pdf-publish.mmd)
- List by course: [task100-u6-pdf-list.mmd](task100-u6-pdf-list.mmd)
- Open PDF: [task100-u6-pdf-open.mmd](task100-u6-pdf-open.mmd)
- Startup orphan reconciliation: [task100-u6-pdf-reconcile.mmd](task100-u6-pdf-reconcile.mmd)

## 7. Test points by level

| Level | Test data / scenario | Expected result |
|---|---|---|
| Unit — DTO/Validator | title empty/space, 200/201 code points; description empty/space, 2,000/2,001 code points | trim/normalize correctly; over-limit rejected |
| Unit — PDF Validator | 0 bytes, valid PDF, fake extension/MIME, corrupt/encrypted/zero-page PDF, valid PDF exactly 15,000,000 bytes, valid PDF 15,000,001 bytes | exact boundary is accepted; 15,000,001 bytes returns `413 PDF_TOO_LARGE`; other invalid files are rejected |
| Unit — DAO | course filter, order, empty result, owner/file joins | correct course and Contract ordering; no rows returns empty list |
| Unit — Compensation | storage put failure, SQL failure after put, compensation delete failure, uncertain commit | no partial public summary; delete or queue cleanup; never delete a possibly referenced file |
| API | missing/invalid/expired Token on each endpoint | `401 AUTH_REQUIRED`, no protected metadata/bytes |
| API | POST valid, unknown/non-CS course, required fields missing, invalid PDF, too large | `201` or specified error; no orphan SQL row when publish fails |
| API | GET course list with rows/empty list/invalid course | `200 items`, `200 items: []`, or `404 COURSE_NOT_FOUND` |
| API | GET file valid/missing summary/storage unavailable | `200 application/pdf` with headers, `404`, or `503 application/json` |
| Integration | publish using SQL Server and private storage, reload list and read file | record persists and correct PDF opens after reload |
| Integration | storage fails before SQL; SQL fails after file put | no exposed partial summary; cleanup succeeds or evidence is recorded |
| Integration | multipart upload boundary with overhead below 16 MiB | valid 15,000,000-byte PDF is accepted; valid 15,000,001-byte PDF returns `413 PDF_TOO_LARGE`; total request over 16 MiB returns `413 REQUEST_TOO_LARGE` |
| Integration | timeout after commit | UI checks list before offering retry; no automatic retry/duplicate |
| Integration — crash/restart | write a valid PDF object, stop Backend before SQL insert/commit, then restart with the same storage root | startup scan finds and deletes the unreferenced object even without a marker; an object with committed SQL metadata is retained and its PDF still opens after restart |
| Integration — SQL unavailable at startup | leave private objects in place and make SQL Server unavailable during startup scan | no object is deleted and Backend stays not Ready; next startup retries the scan |
| Integration — multiple Backend instances | pause one instance after it writes an object but before SQL commit; start reconciliation on another instance sharing storage | shared lease/lock prevents the scanner from deleting the active upload; if lock is unavailable, scanner deletes nothing and stays not Ready |

## 8. Review record and DoD tracking

| Review item | Actual result |
|---|---|
| Backend reviewer / feedback | รอ Review จริง |
| Frontend reviewer / feedback | รอ Review จริง |
| PO reviewer / decision | รอ Review จริง |
| Review date | รอระบุวันที่จริง |
| Reviewed document version | รอระบุรุ่น |
| Meeting / PR / evidence link | รอเพิ่มลิงก์ |
| Task94/Task95 alignment | ใช้เพดาน PDF 15,000,000 bytes ตาม Task95 ที่ merge แล้ว; ตรวจให้ Contract/implementation ที่ใช้งานตรงกัน |
| Changes after review / owner | รอ Review และบันทึกมติ |

### DoD status at draft

- [x] กำหนดโครงสร้างตาราง, keys, constraints, relationships และ ER Diagram
- [x] กำหนด DAO/storage methods พร้อม input, result และ error behavior
- [x] เขียน Sequence Diagram สำหรับ publish, list และ open PDF พร้อมเส้นทางผิดพลาดหลัก
- [x] ระบุจุดทดสอบ Unit/API/Integration
- [ ] ทบทวนกับ Backend, Frontend และ PO, ปรับแก้ตามข้อพบ และบันทึกผลจริง
- [ ] เก็บเอกสารและ editable diagram files ใน Repository ผ่าน PR เข้า `sprint2`

> DoD ของการ Review และการ merge เข้าสู่ Repository จะติ๊กเมื่อมีหลักฐานจริงแล้วเท่านั้น. ไฟล์ใน branch นี้เป็นเอกสาร Draft สำหรับให้ทีม Review.
