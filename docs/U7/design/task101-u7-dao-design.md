# Task101 U7 ออกแบบ DAO และการจัดการสรุปของเจ้าของ

รุ่น 0.2 | วันที่ 10 พฤศจิกายน 2569 | สถานะ: พร้อมส่งตรวจแบบ ยังไม่ผ่านการยอมรับร่วมของทีม

เอกสารนี้เป็นแบบ Backend สำหรับ [Task101](https://trello.com/c/3NyDfcB6) ครอบคลุมรายการสรุปของฉัน เปิดอ่าน แก้ไข และลบสรุป โดยมี [Sequence Diagram](task101-u7-sequences.md) และ [แผนทดสอบกับบันทึก review](task101-u7-review-and-test-plan.md) ประกอบ ยังไม่มีการ implement หรือรัน API ตามแบบนี้

## 1 แหล่งอ้างอิงและข้อจำกัดของฐานงาน

| แหล่งข้อมูล | รุ่นที่ตรวจและสิ่งที่ใช้ |
| --- | --- |
| Trello export `o61hTRJw - group4section-100001 (4).json` | snapshot ที่ผู้ใช้ส่ง วันที่ 10 พฤศจิกายน 2569 ใช้รายละเอียด Task101, checklist, U7-TC01 ถึง U7-TC08 |
| [Task94 API contract](https://github.com/Lilieay/cs261-group4-100001/pull/103) | local branch `docs/task94-api-contract`, commit `de3e669`, เอกสารรุ่น 0.2 ใช้ route, response DTO, error envelope และสิทธิ์เป็นฐาน |
| [Task96 U7 requirements](https://trello.com/c/au8TkTnc) | attachment รุ่น reviewed วันที่ 4 พฤศจิกายน 2569 ที่อ่านจาก `Task96.docx` เอกสารยังระบุ Pending PO and Contract Review |
| [Task100 แบบข้อมูลสรุปและ storage](https://trello.com/c/1mUZijCc) | เป็นเจ้าของตาราง Summary และ ER ใน export ไม่มี attachment และไม่พบแบบใน working tree จึงยังเทียบชื่อคอลัมน์หรือ FK จริงไม่ได้ |
| มติผู้ใช้ที่ยืนยันวันที่ 10 พฤศจิกายน 2569 | เปลี่ยนวิชาและแทนที่ PDF ได้, ไม่ส่งไฟล์ใหม่ให้คงไฟล์เดิม, PDF ไม่เกิน 15,000,000 bytes, ต้อง Login เพื่ออ่าน, ไม่มี type/category, description เว้นว่างหรือล้างได้ |

อ่าน contract เดิมได้ด้วย `git show docs/task94-api-contract:docs/task94-api-contract.md` แม้ไฟล์ไม่อยู่ใน branch ปัจจุบัน Task94 และ Task96 ยังไม่มีหลักฐานผ่าน DoD ในข้อมูลที่ตรวจ งานฉบับนี้จึงเป็นแบบสำหรับ review และประสาน dependency ก่อนเริ่ม implementation ไม่ใช่หลักฐานว่าการ์ดต้นทางผ่านแล้ว

มติล่าสุดเปลี่ยนเงื่อนไข TC03 เฉพาะเมื่อเลือกแทนที่ PDF หรือย้ายวิชา กรณีแก้ metadata โดยไม่ส่งไฟล์ยังต้องคง PDF เดิม ไม่ย้อนกลับไปใช้ข้อห้ามเปลี่ยนไฟล์ใน Task96 ฉบับเก่า ต้องปรับ Task94, Task96 และ fixtures ให้ตรงกันก่อนทีมยืนยัน contract ฉบับถัดไป

## 2 โครงสร้างที่อ้างใช้และขอบเขตความรับผิดชอบ

โค้ดปัจจุบันใช้ SQLAlchemy กับ SQL Server ที่ [db.py](../../../backend/app/db.py), มี [User](../../../backend/app/models/user.py) และ [Course](../../../backend/app/models/course.py) แล้ว แต่ยังไม่มี Summary model ห้ามนำ `guides` มาเก็บ PDF หรือคัดลอกตาราง User และ Course ใหม่

Task100 เป็นแหล่งเดียวของตาราง Summary และความสัมพันธ์กับ User, Course และไฟล์ เอกสารนี้ใช้ชื่อเชิงตรรกะต่อไปนี้เพื่ออธิบาย DAO และ SQL เท่านั้น ไม่ใช่ DDL หรือชื่อคอลัมน์ที่อนุมัติแล้ว

| ข้อมูลที่ U7 ต้องใช้จาก Task100 | หน้าที่และข้อคงเดิม |
| --- | --- |
| `id`, `owner_id`, `created_at` | ตัวตนและเจ้าของของ Summary คงเดิมทุกการแก้ไข |
| `course_id` | FK ไป `courses.id` เปลี่ยนได้เมื่อวิชาปลายทางผ่าน validation |
| `title`, `description`, `updated_at` | metadata ตาม SummaryDTO โดย `description` nullable |
| `file_key`, `original_name`, `content_type`, `size_bytes` | อ้างไฟล์ private ที่พร้อมอ่าน เปลี่ยนเป็นชุดเดียวกันเมื่อแทนที่ PDF สำเร็จ |

ไม่ต้องเพิ่มตารางของ U7 แยกจาก Summary ของ Task100 งานนี้ไม่กำหนด DDL, ER ใหม่ หรือ migration ประเด็นที่ต้องตกลงกับ Task100 คือชื่อ field จริง การ lock แถว และกลไกเก็บกวาดไฟล์ที่ปลอดภัยกับคำขอที่ยังทำงานอยู่ ดัชนีสำหรับค้นตามเจ้าของและเรียง `created_at DESC, id DESC` ให้ Task100 พิจารณาจากแผน query โดยไม่ประกาศว่าสร้างแล้ว

| ชั้น | หน้าที่ตามแบบ |
| --- | --- |
| UI และ API client | โหลดข้อมูล, เก็บฟอร์ม, ยืนยันลบ, ส่ง Bearer token, ตรวจผลและโหลดใหม่เมื่อผลไม่แน่ชัด |
| Router และ DTO | ตรวจ auth, path, form, unknown fields และแปลง error เป็น contract |
| `MySummariesService` | ตรวจเจ้าของและวิชา, เรียก storage, คุม transaction, สร้าง DTO ก่อน commit และตัดสินผลหลัง commit |
| `MySummaryDAO`, `UpdateOwnedSummaryDAO`, `DeleteOwnedSummaryDAO` | query และแก้ข้อมูลผ่าน Session ที่ service ส่งให้ ไม่ commit และไม่เรียก storage |
| DAO อ่านของ Task100 | อ่าน Summary และ file reference สำหรับหน้าอ่านร่วมของ U6 และ U7 |
| Private PDF storage | stage, ตรวจ PDF, เตรียม immutable object, เปิดอ่าน และเก็บกวาดไฟล์ที่ไม่มี reference |

ใช้แนวทาง owner predicate จาก [UpdateOwnedGuideDAO](../../../backend/app/dao/update_owned_guide_dao.py) และ [DeleteOwnedGuideDAO](../../../backend/app/dao/delete_owned_guide_dao.py) เป็นตัวอย่างรูปแบบ แต่ U7 ต้องแยก 403 จาก 404 ตาม contract และคุม transaction ร่วมกับ storage จึงไม่อ้างว่า DAO เดิมรองรับ Summary แล้ว

## 3 API และ DTO ที่ใช้ในแบบ

ทุก route ต้อง Login ระบุตัวผู้ใช้จาก session หลังยืนยัน token เท่านั้น ไม่รับ `owner_id`, `user_id` หรือ `owner` จาก client ทุก response รวม error ใช้ `Cache-Control: no-store`

| Method และ path | Request | ผลสำเร็จ |
| --- | --- | --- |
| `GET /api/my-summaries` | ไม่มี body หรือ query | `200 {"items": [SummaryDTO]}` เฉพาะเจ้าของ เรียง `created_at DESC, id DESC` |
| `GET /api/summaries/{summary_id}` | ไม่มี body | `200 SummaryDTO` ใช้ API อ่านของ Task100 |
| `GET /api/summaries/{summary_id}/file` | ไม่มี body | `200 application/pdf` ใช้ API อ่านของ Task100 |
| `PUT /api/summaries/{summary_id}` | `multipart/form-data` ตามข้อเสนอด้านล่าง | `200 SummaryDTO` หลัง commit สำเร็จ |
| `DELETE /api/summaries/{summary_id}` | ไม่มี body หรือ query | `204` ไม่มี body หลัง commit สำเร็จ |

การอ่านสรุปของผู้อื่นที่ยังเผยแพร่อยู่อนุญาตให้ผู้ใช้ที่ Login ตาม U6 ส่วน my-list ต้องมีเฉพาะของตน และการแก้ไขกับลบต้องเป็นเจ้าของ

### 3.1 ข้อเสนอ SummaryUpdateForm สำหรับส่ง review contract

PUT เปลี่ยนจาก JSON ของ Task94 v0.2 เป็น multipart เพื่อรองรับ PDF และการย้ายวิชา นี่เป็นข้อเสนอที่ครบพอให้พัฒนาต่อหลังทีม review ไม่อ้างว่าเป็น contract กลางที่อนุมัติแล้ว ไม่รองรับ JSON และ multipart สองแบบในข้อเสนอนี้

| ช่อง | ข้อกำหนด |
| --- | --- |
| `course_id` | บังคับ form text เลขฐานสิบจำนวนเต็มบวก 1 ถึง 2,147,483,647 วิชาต้องมีจริงและ `course_code` ขึ้นต้น CS แบบไม่สนตัวพิมพ์ |
| `title` | บังคับ string trim แล้วยาว 1 ถึง 200 Unicode code points |
| `description` | ไม่บังคับ trim แล้วไม่เกิน 2,000 code points ไม่ส่งหรือช่องว่างล้วนให้เก็บ `null` เพื่อล้างค่า ไม่ใช้ string `"null"` แทน null |
| `file` | ไม่บังคับ ส่งได้หนึ่ง file part ถ้าไม่ส่งให้คง PDF ปัจจุบัน ถ้าส่งไฟล์ว่างถือว่าผิด ไม่ใช้เป็นคำสั่งลบไฟล์ |

ไม่มีช่อง type/category ห้ามส่งฟิลด์เกินหรือ part ซ้ำ รวมทั้ง `id`, `owner`, `owner_id`, `user_id`, `created_at`, `updated_at` และ `file_key` ตอบ 422 โดยไม่เขียนข้อมูล ต้องส่ง `description` ปัจจุบันหากไม่ต้องการล้างตาม semantics การแทนที่ metadata ทั้งชุดของ PUT

ไฟล์ใหม่ต้องนามสกุล `.pdf` แบบไม่สนตัวพิมพ์ มี MIME `application/pdf` และขนาดจริง 1 ถึง 15,000,000 bytes ตรวจ signature และ parse PDF จริง ต้องมีอย่างน้อยหนึ่งหน้า ไม่เข้ารหัสหรือมี password ห้ามเชื่อ MIME หรือนามสกุลเพียงอย่างเดียว ไม่เพิ่ม PDF editor

ค่าที่ต้องแก้ร่วมใน Task94 คือ upload limit และ multipart body limit ของ proxy และ Backend ให้รองรับทั้ง POST และ PUT แบบเสนอใช้เพดาน request รวม 16,000,000 bytes และ metadata field รวมไม่เกิน 32,768 bytes โดยยังนับ file limit แยกที่ 15,000,000 bytes ต้องตรวจทั้ง stream ที่ไม่มี Content-Length และ request ปกติ ห้ามยังใช้เพดานเก่า 11 MiB ข้อเสนอนี้ต้องทบทวนร่วมกับ Task100 และงาน API

ตัวอย่าง request ในรูปช่อง multipart ไม่แสดง boundary ที่ Browser ต้องสร้างเอง:

```text
PUT /api/summaries/101
Authorization: Bearer <access_token>
course_id = 2
title = สรุป CS104 ฉบับแก้ไข
description =
file = <PDF ใหม่ หรือไม่ส่ง part นี้เพื่อคงไฟล์เดิม>
```

`SummaryDTO` คงรูปจาก Task94 ได้แก่ `id`, `course: {id, course_code, course_name}`, `title`, `description`, `owner: {id, display_name}`, `file: {original_name, content_type, size_bytes, read_path}`, `created_at`, `updated_at` วันที่เป็น RFC 3339 UTC ไม่ส่ง storage key หรือข้อมูล Login ส่วน `read_path` คง `/api/summaries/{summary_id}/file` แม้แทนที่ PDF

### 3.2 Error และผลที่ต้องคงไว้

ใช้ envelope `{"error":{"code":"...","message":"...","fields":[]}}` โดย fields ระบุ `field` และ `message` เมื่อเจาะจงช่อง ตรวจ auth ก่อนเปิดเผยการมีอยู่ของสรุป จากนั้นตรวจรูปแบบคำขอ แล้วตรวจการมีอยู่และเจ้าของก่อนดำเนินการเขียนหรือ parse PDF

| HTTP และ code | กรณีและผล |
| --- | --- |
| `401 AUTH_REQUIRED` | token หาย ผิด หมดอายุ ส่ง `WWW-Authenticate: Bearer` ไม่มีข้อมูลหรือไฟล์รั่ว |
| `403 SUMMARY_FORBIDDEN` | Summary มีอยู่แต่ผู้ขอแก้หรือลบไม่ใช่เจ้าของ ไม่มีการเปลี่ยนแปลง |
| `404 SUMMARY_NOT_FOUND` | อ่าน แก้ หรือลบ ID ที่ไม่มีหรือถูกลบแล้ว PUT ห้าม upsert |
| `404 COURSE_NOT_FOUND` | วิชาปลายทางไม่มีหรือไม่ใช่ CS คงสรุปเดิม |
| `422 INVALID_PARAMETERS` | ID ผิดรูปแบบ, title ว่าง, metadata เกินขนาด, part ซ้ำ หรือฟิลด์ต้องห้าม |
| `422 PDF_INVALID` | file ว่างหรือชนิดไฟล์ไม่ใช่ PDF |
| `422 PDF_UNREADABLE` | PDF เสีย ไม่มีหน้า หรือเข้ารหัส |
| `413 PDF_TOO_LARGE` | ไฟล์เกิน 15,000,000 bytes |
| `413 REQUEST_TOO_LARGE` | request ทั้งก้อนเกินเพดานก่อนตรวจไฟล์ ระบุเป็นข้อเสนอปรับ contract |
| `503 STORAGE_UNAVAILABLE` | ยืนยันว่า DB หรือ storage ล้มเหลวก่อน commit สำเร็จ rollback และคงข้อมูลกับ PDF เดิม |
| `500 INTERNAL_ERROR` | ข้อผิดพลาดไม่คาดคิด ไม่ส่ง SQL, storage path หรือ stack trace ให้ client |
| `502 UPSTREAM_UNAVAILABLE` หรือ connection ขาด | proxy ติดต่อ Backend ไม่ได้หรือหมดเวลา ผลการเขียนอาจสำเร็จแล้ว UI ต้องอ่านสถานะใหม่ |

ความล้มเหลวระหว่าง commit ที่พิสูจน์ผลไม่ได้ห้ามอธิบายว่า rollback คืนข้อมูลแน่นอน Service ต้องตรวจจาก connection ใหม่เมื่อทำได้ หากตรวจไม่ได้ให้ถือว่าผลไม่แน่ชัด เก็บไฟล์ทั้งสองรุ่นไว้ และให้ UI refetch ก่อนตัดสินใจส่งใหม่

## 4 DAO methods และขอบเขต transaction

ชื่อคลาสและผลลัพธ์ด้านล่างเป็นแบบเสนอ DAO ทุกตัวใน write transaction เดียวกันใช้ write Session เดียวกัน Service เป็นผู้เริ่ม transaction, commit และ rollback รวมทั้งแปลง exception เป็น HTTP DAO คืนข้อมูลภายใน ไม่คืน HTTP response

การอ่านเบื้องต้นก่อน upload ใช้ read Session แยกและปิดให้จบทุกเส้นทางก่อนเตรียมไฟล์ SQLAlchemy เริ่ม transaction อัตโนมัติเมื่อ SELECT จึงห้ามอ่านด้วย Session เดิมแล้วเรียก begin ซ้ำ เก็บเพียง scalar ID ที่จำเป็นจาก preflight ไม่ถือ ORM object จาก read Session ไปใช้เขียน หลังเตรียมไฟล์จึงสร้าง write Session ใหม่ เริ่ม transaction และสร้าง DAO ที่ผูกกับ Session ใหม่นี้เพื่อ lock และอ่านค่าปัจจุบัน

| DAO method | Input ที่ผ่าน boundary แล้ว | Output | กรณีผิดพลาดและข้อกำหนด |
| --- | --- | --- | --- |
| `MySummaryDAO.list_owned(owner_id)` | ID ผู้ใช้จาก session | `list[SummaryRecord]` พร้อม Course และข้อมูล owner ที่ใช้สร้าง DTO | ไม่มีรายการคืน `[]` ไม่กลบ DB error ด้วย `[]` ไม่อ่าน file bytes |
| `UpdateOwnedSummaryDAO.get_for_update(summary_id)` | ID สรุป | `SummaryRecord` หรือ `None` | lock แถวจน transaction จบ ตรวจ owner ใน service ภายใต้ lock เดียวกัน ถ้าไม่มีคืน None |
| `UpdateOwnedSummaryDAO.update_owned(summary_id, owner_id, metadata, replacement)` | metadata ที่ validate แล้ว และ `PreparedPdfRef` หรือ None | SummaryRecord หลังแก้ หรือ None ถ้า affected rows ไม่ใช่ 1 | WHERE มีทั้ง ID และ owner, ไม่ INSERT, ไม่แก้ id/owner/created_at, replacement None ไม่เขียนทับ file fields |
| `DeleteOwnedSummaryDAO.get_for_update(summary_id)` | ID สรุป | SummaryRecord หรือ None | ใช้ lock และ semantics เดียวกับ update ไม่ตรวจเจ้าของด้วย query นอก transaction แล้วเชื่อผลเก่า |
| `DeleteOwnedSummaryDAO.delete_owned(summary_id, owner_id)` | ID สรุปและเจ้าของจาก session | `DeletedSummaryRef` ที่มี ID กับ file key เดิม หรือ None | ลบหนึ่งรายการภายใต้ owner predicate ไม่ลบ Course/User/Guide/สรุปอื่น |
| DAO อ่านร่วมของ Task100 `get_by_id(summary_id)` | ID สรุป | SummaryRecord หรือ None | ใช้สำหรับอ่าน metadata และตรวจสิทธิ์ Login ก่อนอ่านไฟล์ ห้ามเปิด storage ด้วย key จาก request |
| `CourseDAO.get_cs_by_id(course_id)` | ID วิชาปลายทาง | Course หรือ None | ใช้ [DAO ที่มีอยู่](../../../backend/app/dao/course_dao.py) ตรวจ CS prefix ที่ server |

`PreparedPdfRef` รวม private immutable key และ metadata ของไฟล์ที่ตรวจผ่านและพร้อมอ่านแล้ว ไม่รับค่าจาก client โดยตรง DAO ไม่รับ dictionary ที่เปิดให้แก้ทุกคอลัมน์ ใช้ชุดค่าแก้ไขที่อนุญาตเท่านั้น

DB exception ต้องส่งออกให้ service จัดการ การไม่มีแถวกับ DB ล้มเหลวเป็นคนละผลลัพธ์ `None` หลัง lock และ owner check ผ่านแล้วให้ service ตรวจแถวใน transaction อีกครั้ง หากไม่มีตอบ 404 ถ้ายังมีแต่ไม่อัปเดตตามที่คาดถือเป็นข้อผิดพลาดภายในและ rollback ไม่ตอบ success

### 4.1 SQL เชิงตรรกะสำหรับ SQL Server

SQL นี้อธิบาย predicate และ lock ไม่มีการรันหรือสร้าง schema ให้แทนชื่อคอลัมน์ด้วยแบบ Task100 ก่อน implementation ใช้ bound parameters เสมอ ไม่ต่อ SQL จากฟอร์ม

```sql
-- รายการของฉัน ไม่ต้อง lock เพื่อเขียน
SELECT s.*, c.course_code, c.course_name
FROM summaries AS s
JOIN courses AS c ON c.id = s.course_id
WHERE s.owner_id = :owner_id
ORDER BY s.created_at DESC, s.id DESC;

-- ภายใน transaction ของ update หรือ delete
SELECT s.*
FROM summaries AS s WITH (UPDLOCK, HOLDLOCK)
WHERE s.id = :summary_id;
-- ไม่พบ => 404; owner_id ไม่ตรง => 403; rollback เพื่อคืน lock

-- metadata-only ไม่ใส่ file fields ใน SET
UPDATE summaries
SET course_id = :course_id, title = :title,
    description = :description, updated_at = :now_utc
WHERE id = :summary_id AND owner_id = :owner_id;

-- เมื่อแทนที่ PDF ใช้คำสั่ง UPDATE เดียวรวม metadata และ file fields
UPDATE summaries
SET course_id = :course_id, title = :title,
    description = :description, updated_at = :now_utc,
    file_key = :new_key, original_name = :original_name,
    content_type = :content_type, size_bytes = :size_bytes
WHERE id = :summary_id AND owner_id = :owner_id;

DELETE FROM summaries
WHERE id = :summary_id AND owner_id = :owner_id;
```

ตรวจ `rowcount == 1` และอ่านข้อมูลที่ใช้สร้าง DTO ภายใน transaction ก่อน commit ให้พร้อม serialize หลัง commit เพื่อลดโอกาสเกิด error จาก lazy loading ภายหลัง ห้ามส่ง 200 หรือ 204 ก่อน commit confirmed

Task100 ต้องกำหนด FK ที่เกี่ยวข้อง การลบ Summary ต้องทำให้ API รีวิวและรายการบันทึกที่อ้าง Summary นี้ไม่คืน target ที่ถูกลบ โดยใช้ transaction เดียวสำหรับ record ที่ต้องลบตาม schema หรือกรองผ่านการมีอยู่ของ target ตาม contract ของ U8/U9/U10 ไม่เพิ่ม schema ของระบบ saved items ใน Task101 และไม่ลบ target อื่นที่เลข ID ซ้ำแต่คนละชนิด

## 5 ลำดับการแก้ไขและความสอดคล้องกับไฟล์

1. Router ตรวจ Login, ID และโครงสร้าง form Service เปิด read Session สั้นแยกจาก write Session อ่าน Summary เพื่อตรวจเจ้าของก่อนงาน parse PDF ที่มีต้นทุนสูง
2. ตรวจ title, description และวิชา CS ปลายทาง ไม่ถือว่าวิชาที่ไม่มีสรุปเป็นวิชาที่ผิด ปิด read Session และ transaction ของ preflight ในทุกเส้นทางก่อนเตรียมไฟล์ ไม่เก็บ transaction ค้างตลอดช่วง upload
3. ถ้ามีไฟล์ใหม่ storage รับลง staging แบบ private ตรวจขนาดจริงและ parse PDF เตรียมไฟล์ immutable ด้วย key ใหม่ที่ server สร้าง ห้ามเขียนทับ key เดิม
4. เปิด write Session ใหม่และเริ่ม transaction อ่าน Summary พร้อม write lock ตรวจการมีอยู่และเจ้าของอีกครั้ง เพราะอาจถูกลบระหว่าง upload ตรวจวิชาปลายทางอีกครั้งและให้ FK ป้องกันการหายก่อน commit
5. DAO อัปเดตแถวเดิม หากไม่มีไฟล์ใหม่ใช้ file reference ล่าสุดใต้ lock เพื่อไม่ย้อน PDF ที่คำขออื่นเพิ่งเปลี่ยน หากมีไฟล์ใหม่สลับ metadata และ file reference ใน UPDATE เดียว สร้าง DTO แล้ว commit
6. ตอบ 200 หลัง commit confirmed เท่านั้น ทุกหน้าเมื่อโหลดใหม่ต้องใช้ข้อมูลล่าสุด การย้ายวิชานำ Summary เดิมออกจากวิชาเก่าและแสดงในวิชาใหม่โดยไม่เพิ่ม ID
7. เมื่อยืนยัน commit สำเร็จให้ไฟล์เก่าเข้าสู่การเก็บกวาด หากยืนยัน rollback แล้วให้ไฟล์ใหม่ที่ไม่ได้ใช้งานเข้าสู่การเก็บกวาด อย่าทำลายไฟล์ใดเมื่อผล commit ยังไม่แน่ชัด

การแก้ไขพร้อมกันใช้ค่าที่ commit สำเร็จล่าสุดตาม baseline ไม่มี version token หรือ 409 เพิ่มในแบบนี้ แต่ writer ต้อง serialize บน Summary เดียวกัน ทั้ง update และ delete ใช้กติกา lock เดียวกัน ถ้า delete สำเร็จก่อน update ต้องตอบ 404 และไม่สร้างสรุปกลับมา

### 5.1 Storage interface ที่ต้องประสาน Task100

| Operation | ข้อรับประกันที่ต้องมี |
| --- | --- |
| `prepare_pdf(upload)` | คืน PreparedPdfRef หลังตรวจและอ่านได้จริง ไฟล์ยัง private การล้มเหลวไม่เปลี่ยนไฟล์เดิม |
| `open_pdf(file_key)` | เปิดเฉพาะ key ที่ DAO อ่านจาก Summary ปัจจุบันหลัง auth ใช้ stream handle ที่ยังอ่านต่อได้หากมีการเปลี่ยน reference ระหว่างคำขอ |
| `collect_unreferenced()` | เก็บกวาด staging และ immutable objects ที่ไม่มี Summary อ้าง โดยไม่ลบไฟล์ของ transaction ที่ยังทำงานหรือมีผล commit ไม่แน่ชัด |

Collector ต้องแยกไฟล์ที่กำลังเตรียมออกจากไฟล์ที่ลบได้ผ่าน lease หรือกลไกเทียบเท่าที่ storage layer ของ Task100 จัดให้ ห้ามใช้เพียง “ไม่มี reference ตอน query ครั้งเดียว” เป็นเงื่อนไขลบ เพราะไฟล์ใหม่อาจยังรอ commit ต้องตรวจผล transaction, reference ปัจจุบัน และ stream ที่ยังเปิดอยู่ก่อนลบ เมื่อพิสูจน์ไม่ได้ให้เลื่อนการเก็บกวาดและบันทึกเพื่อ retry การเก็บไฟล์ไว้ชั่วคราวปลอดภัยกว่าลบไฟล์ที่ยังใช้งาน

หาก process ล่มหลังเตรียมไฟล์แต่ก่อน commit Collector ต้องจัดการ orphan โดยใช้หลักฐานว่า request สิ้นสุดและไม่มี DB reference แล้ว การคิว cleanup ในหน่วยความจำเพียงอย่างเดียวไม่พอ ต้องค้น orphan ซ้ำได้หลัง restart ส่วนชนิด storage และรายละเอียด lease เป็นจุดประสาน Task100 ไม่บังคับเพิ่มตาราง U7 ใหม่

## 6 ลบและยกเลิกลบ

UI แสดงชื่อรายการในหน้าต่างยืนยัน เมื่อยกเลิกไม่ส่ง DELETE และไม่ลบข้อมูลฝั่ง client เมื่อยืนยันให้ป้องกันการกดซ้ำระหว่างรอผล แล้วส่ง DELETE พร้อม token

Service เริ่ม transaction lock Summary ตรวจ 404 และ 403 จากข้อมูลภายใต้ lock แล้วเรียก delete_owned ด้วย ID และ owner เดิม Commit สำเร็จเป็นจุดที่ลบสำเร็จเชิงระบบ ตอบ 204 โดยไม่ parse JSON ที่ UI คำขออ่านใหม่ต้องตรวจ DB ก่อนเข้าถึง storage และได้ 404 ทั้ง metadata, PDF และรีวิวของ target นี้ แม้ไฟล์จริงยังรอเก็บกวาด ห้ามมี public static URL ที่เปิด PDF ข้ามการตรวจ DB

ลบไฟล์จริงภายหลังด้วยกลไกเก็บกวาดของ Task100 หาก cleanup ล้มเหลวหลัง DB commit ให้ retry cleanup และคงผลลบสำเร็จ ห้ามตอบ 503 ที่สื่อว่ารายการเดิมยังอยู่หรือสร้าง Summary กลับมา การล้มเหลวของ cleanup เป็นคนละเหตุการณ์กับความล้มเหลวก่อน commit ต้องนำข้อนี้ให้ทีม review ยืนยันร่วมกัน

ถ้า DB delete หรือ commit ล้มเหลวและยืนยัน rollback แล้ว คง Summary เดิมและ PDF เดิมพร้อมอ่าน ตอบ 503 ถ้า commit มีผลไม่แน่ชัด ให้ตรวจจาก connection ใหม่และคงไฟล์ไว้ UI โหลด GET ใหม่ หากได้ 404 ถือว่าไม่มีรายการแล้ว หากยังมีให้แสดงข้อมูลปัจจุบันและให้ผู้ใช้เลือกดำเนินการต่อ หาก GET ล้มเหลวให้คงสถานะยังตรวจผลไม่ได้

คำขอ DELETE ซ้ำหลังลบสำเร็จตอบ 404 ไม่กระทบรายการอื่น ไฟล์ที่ส่งถึง Browser ไปก่อนลบแล้วเรียกคืนไม่ได้ เกณฑ์ “เปิดไม่ได้อีก” ใช้กับคำขอใหม่หลัง commit ลบ

## 7 อ่าน PDF และการจัดการผลที่ไม่แน่ชัดใน UI

หน้า my-list ใช้ owner ID จาก session ไม่ใช้ query owner ID รายการว่างคืน items เป็น array ว่าง พร้อมทางไปเผยแพร่ ส่วน DB ล้มเหลวต้องเป็น error ห้ามแสดงเป็นยังไม่มีสรุป

หน้าอ่านเรียก GET metadata แล้ว fetch read_path พร้อม Authorization ตรวจ status และ Content-Type ก่อนเปิด Blob URL แสดงชื่อไฟล์จาก DTO และ revoke Blob URL เมื่อเลิกใช้ Response PDF ใช้ `Content-Disposition: inline; filename="summary-{id}.pdf"` กับ `X-Content-Type-Options: nosniff` ไม่ใส่ token ใน URL ตาม baseline ส่งไฟล์เต็ม 200 แม้มี Range ไม่รองรับ 206 ในขอบเขตนี้

หลังแก้ไขหรือลบสำเร็จให้ reload หน้าของฉันและ invalidate ข้อมูลหน้าวิชาที่เกี่ยวข้อง เมื่อ timeout หรือ connection ขาด ห้ามแจ้งว่า “ข้อมูลเดิมไม่เปลี่ยน” และห้าม retry PUT/DELETE อัตโนมัติ ให้ refetch metadata แล้วแสดงสถานะปัจจุบันก่อนดำเนินการต่อ หากต้องพิสูจน์การแทนที่ PDF ให้ใช้ checksum ของ bytes ที่โหลดใหม่ในชุดทดสอบ ไม่ใช้เพียงชื่อไฟล์หรือ read_path ที่คงเดิม

## 8 ไฟล์ประกอบ

- [Sequence Diagram และคำอธิบายเส้นทาง](task101-u7-sequences.md)
- [Test mapping, review และ dependency ที่ต้องปิด](task101-u7-review-and-test-plan.md)
- ต้นฉบับ Mermaid ที่แก้ไขได้อยู่ใน `diagrams/task101-*.mmd` และแสดง inline ในเอกสาร Sequence
