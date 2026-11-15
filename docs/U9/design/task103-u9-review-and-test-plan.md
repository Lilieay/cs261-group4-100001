# Task103 U9 — Review และ Test Plan

**รุ่น 0.2 | วันที่ 15 พฤศจิกายน 2569 | สถานะ: Test Plan — Not Run**

เอกสารนี้อัปเดตแผนทดสอบของ Task103 ให้ตรง Task94 API Contract v0.4 และการใช้ relation ร่วมกับ U10 ตาม Task104 v0.3 ไม่มีการอ้างว่ารัน Unit/API/Integration tests แล้ว

## 1. ข้อมูลตั้งต้น

เตรียมบัญชี A และ B ที่ Login ได้, token ผิด/หมดอายุ/ไม่มี token, Guide G1/G2 ที่มีอยู่, Summary S1/S2 ที่มีอยู่ และ ID ที่ไม่มีอยู่ เตรียมคู่ Guide 101 กับ Summary 101 เพื่อพิสูจน์ว่า ID namespace แยกตามชนิด

เตรียม bookmark เดิมใน `saved_guides` ของ A และ bookmark ใหม่ที่ U9 บันทึกเพิ่มภายหลัง พร้อมตรวจว่ารายการทั้งสองปรากฏใน U10 `GET /api/saved-items` โดยไม่ migrate หรือ copy ข้อมูลเดิม

สำหรับ SQLAlchemy ให้ใช้ Session จริงใน Integration test และยืนยันว่าไม่มี SELECT เกิดก่อน `session.begin()` ใน save flow ใช้ SQL Server จริงสำหรับ FK/PK และ concurrent behavior ไม่ใช้ SQLite แทนหลักฐาน concurrency ของ SQL Server

## 2. Contract ที่ใช้เป็น oracle

| Operation | Expected |
|---|---|
| PUT ครั้งแรก | `200 {"item_type":"guide","item_id":101,"saved":true}` |
| PUT ซ้ำ | `200` body เดียวกันทุก field |
| GET state มี bookmark | `200 saved:true` |
| GET state ไม่มี bookmark แต่ target มี | `200 saved:false` |
| DELETE | `200 saved:false` และลบเฉพาะ relation ของ current user |
| DB read/write/commit error | `503 SAVED_ITEMS_UNAVAILABLE` |
| target หาย | `404 GUIDE_NOT_FOUND` หรือ `404 SUMMARY_NOT_FOUND` |
| token ใช้ไม่ได้ | `401 AUTH_REQUIRED` |
| type/ID ไม่ถูกต้อง | `422 INVALID_PARAMETERS` |

Duplicate message “ได้บันทึกการแบ่งปันนี้ไปแล้ว” เป็น UI behavior เท่านั้น: ถ้า UI รู้จาก state ก่อนกดว่า saved อยู่แล้ว ให้แสดงข้อความนี้ได้โดยไม่ต้องรอ response ที่มี `already_saved` เพราะ response PUT ทั้งครั้งแรก/ซ้ำเหมือนกัน

## 3. Test cases TC06–TC12 สำหรับส่วน DAO/API

> หมายเหตุด้าน traceability: ไฟล์ Task98 ฉบับเต็มไม่ได้แนบมาในชุดไฟล์รอบนี้ จึงจัดทำรายละเอียด TC06–TC12 ด้านล่างจากข้อกำหนดแก้ไขที่ผู้มอบหมายระบุและ Contract v0.4 เพื่อใช้เป็นแผนทดสอบต่อ ต้องเทียบชื่อ/ข้อความ acceptance กับ Task98 ต้นฉบับก่อน merge ห้ามถือว่าเป็นการถอดข้อความต้นฉบับ Task98 แบบคำต่อคำ

| TC | Scenario / ระดับ | ขั้นตอนหลัก | Expected result |
|---|---|---|---|
| **TC06** | PUT ครั้งแรก / API + Integration | A PUT `/api/saved-items/guide/101` เมื่อ target มีอยู่และยังไม่ saved | `200` และ body `{item_type:"guide", item_id:101, saved:true}`; มี relation ใน `saved_guides` เพียงหนึ่งแถว |
| **TC07** | PUT ซ้ำ / API + UI | A PUT target เดิมอีกครั้ง; ตรวจ response และ UI ที่รู้ state ก่อนกด | `200` และ body เหมือน TC06 ทุก field; ไม่มี row ซ้ำ; UI แสดง duplicate message จาก pre-known state ไม่อ่าน `already_saved` |
| **TC08** | Shared storage กับ U10 / Integration + API | บันทึก Guide และ Summary ผ่าน U9 แล้วเรียก U10 `GET /api/saved-items`; จากนั้น DELETE ผ่าน U10 | U10 เห็น bookmark ที่ U9 บันทึกจาก relation ชุดเดียวกัน; DELETE ทำให้ U9 GET state เป็น `saved:false`; Guide ใช้ `saved_guides`, Summary ใช้ `saved_summaries` |
| **TC09** | ER / FK / uniqueness / Integration | ตรวจ FK ไป users และ target; insert duplicate pair; บันทึก Guide 101 และ Summary 101 ให้ user เดียวกัน | duplicate ใน relation ชนิดเดียวกันถูกปฏิเสธ/ทำ idempotent; Guide 101 และ Summary 101 อยู่ร่วมกันได้; PK เป็น `(user_id, guide_id)` และ `(user_id, summary_id)` |
| **TC10** | Transaction ordering / Unit + Integration | instrument SQLAlchemy Session; เรียก PUT; ตรวจ event/order ของ transaction และ SELECT | `session.begin()` เกิดก่อน target SELECT; SELECT และ INSERT อยู่ใน transaction เดียว; ไม่มี autobegin conflict/InvalidRequestError |
| **TC11** | Storage unavailable / API + Integration | จำลอง DB read failure, insert failure และ commit failure ใน GET/PUT/DELETE | ทุกกรณี saved-items ตอบ `503 SAVED_ITEMS_UNAVAILABLE`; ห้ามตอบ `saved:false` หรือ `200`; rollback เมื่อยืนยัน failure ก่อน commit และไม่มี success ลวง |
| **TC12** | Concurrent PUT / SQL Server Integration | ส่ง PUT พร้อมกันหลาย request สำหรับ current user/type/id เดียวกัน | มี bookmark row เดียว; ทุก request ที่ผลยืนยันได้ตอบ `200 saved:true`; DB error อื่นที่ไม่ใช่ duplicate ต้องไม่ถูกกลบ; ถ้า timeout/ผลไม่แน่ชัด UI GET state ก่อน retry |

## 4. การทดสอบร่วมที่ยังต้องครอบคลุม

| Case | สิ่งที่ต้องพิสูจน์ |
|---|---|
| Auth | no token / invalid / expired → `401 AUTH_REQUIRED` และ WWW-Authenticate |
| Validation | unsupported type, ID 0, negative, float/string/bool, unknown query/body → `422 INVALID_PARAMETERS` |
| Target missing | guide → `404 GUIDE_NOT_FOUND`; summary → `404 SUMMARY_NOT_FOUND`; ไม่มี relation ใหม่ |
| Owner isolation | A save แล้ว B GET state เป็น false; B DELETE ไม่ลบ bookmark ของ A |
| State durability | reload และ Login ใหม่บัญชีเดิมยังอ่าน saved state เดิม |
| Empty list vs failure | ไม่มี bookmark = `200 {"items":[]}`; DB error = `503 SAVED_ITEMS_UNAVAILABLE` |
| Legacy | bookmark เดิมใน `saved_guides` ยังคงอยู่; ไม่มี auto migration/copy/delete |
| List consistency | U10 list เรียง course_code ASC, item_type ASC, item_id DESC และเปิด exact `open_path` |
| Delete safety | ลบเฉพาะ relation; ไม่ลบ Guide/Summary/PDF/Course หรือ bookmark ของ user อื่น |

## 5. Test levels และหลักฐานที่ต้องแนบ

- **Unit:** DAO predicate, service dispatch, DTO mapping, UI pre-known state, transaction begin ordering (mock/session event).
- **API:** auth, validation, status/body exact match, Cache-Control no-store, PUT duplicate response equality, 503 mapping.
- **Integration (SQL Server):** composite PK/FK, shared relation visibility U9↔U10, rollback, concurrent PUT, target cleanup policy.
- **UI:** saved/unsaved initial state, loading/error, duplicate message from state known before PUT, refresh after uncertain network outcome.

หลักฐานต่อ TC: test command, environment/database version, request/response หรือ assertion log, commit SHA, วันที่รัน, ผู้รัน และผล Pass/Fail/Blocked ห้ามทำเครื่องหมาย Pass จากการอ่านเอกสาร

## 6. Review record

| Role | Review focus | Reviewer / date / outcome |
|---|---|---|
| Frontend | DTO เดียวทั้ง PUT ครั้งแรก/ซ้ำ; UI duplicate message จาก state | Pending |
| Backend | DAO relation dispatch, Session transaction, duplicate conflict handling, 503 | Pending |
| Data model / Task100 | saved_summaries PK/FK, saved_guides existing constraints, cleanup | Pending |
| PO / Task98 | TC06–TC12 traceability, message behavior, acceptance | Pending |

## 7. สถานะ

**Draft for Review — Not Implemented / Tests Not Run.** ต้อง review และแนบหลักฐานจริงก่อนเปลี่ยนสถานะ
