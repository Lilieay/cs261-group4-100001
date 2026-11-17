# Task103 U9 — Review และ Test Plan

**รุ่น 0.4 | วันที่ 15 พฤศจิกายน 2569 | สถานะ: Test Plan — Not Run**

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
| GET state / PUT เมื่อ target หาย | `404 GUIDE_NOT_FOUND` หรือ `404 SUMMARY_NOT_FOUND` ตามชนิด |
| DELETE เมื่อ target หายหรือไม่มี bookmark | `200 {item_type,item_id,saved:false}` เป็น no-op แบบ idempotent |
| GET list เมื่อมี bookmark อ้าง target ที่ถูกลบ | `200` และข้าม bookmark นั้น; DB read failure จริงตอบ `503 SAVED_ITEMS_UNAVAILABLE` |
| token ใช้ไม่ได้ | `401 AUTH_REQUIRED` |
| type/ID ไม่ถูกต้อง | `422 INVALID_PARAMETERS` |

Duplicate message “ได้บันทึกการแบ่งปันนี้ไปแล้ว” เป็น UI behavior เท่านั้น: ถ้า UI รู้จาก state ก่อนกดว่า saved อยู่แล้ว ให้แสดงข้อความนี้ได้โดยไม่ต้องรอ response ที่มี `already_saved` เพราะ response PUT ทั้งครั้งแรก/ซ้ำเหมือนกัน

## 3. Current Acceptance Test Cases U9-TC06–U9-TC12 (อ้างอิง Task98 v0.3)

เลขและชื่อ TC ในตารางนี้ยึดตามหัวข้อ 5.2 ของ Task98 ฉบับใน Repository ที่ commit `40e2c4a61541ca31d64db556458e955ee04fb9ff` โดยตรง ส่วน FK, transaction ordering และ concurrent PUT แยกเป็น Supplementary Tests ไม่เปลี่ยนเลข acceptance test ของ PO

| TC | Scenario ตาม Task98 | ขั้นตอนหลัก | Expected result ตาม Task98 / Contract |
|---|---|---|---|
| **TC06** | บันทึกแนวข้อสอบรายรายการสำเร็จ | A Login แล้ว PUT Guide ที่มีอยู่จริง; ตรวจรายการส่วนตัว, reload และ Login ใหม่ | Guide รายการนั้นปรากฏในรายการส่วนตัวของ A ใต้ Course ที่ถูกต้องและคงอยู่หลัง reload/Login ใหม่; PUT ตอบ `200 saved:true` |
| **TC07** | บันทึกสรุป PDF รายรายการสำเร็จ | A Login แล้ว PUT Summary PDF ที่มีอยู่จริง; ตรวจรายการส่วนตัว, reload และ Login ใหม่ | Summary PDF รายการนั้นปรากฏในรายการส่วนตัวของ A ใต้ Course ที่ถูกต้องและคงอยู่หลัง reload/Login ใหม่; PUT ตอบ `200 saved:true` |
| **TC08** | แสดงรายการที่บันทึกใต้รายวิชาที่ถูกต้อง | บันทึก Guide และ Summary ที่สังกัดอย่างน้อยสอง Course แล้วเปิดรายการส่วนตัว | Guide และ Summary แต่ละรายการอยู่ใต้ Course ต้นสังกัดที่ถูกต้อง ไม่ปะปนหรือแสดงผิด Course |
| **TC09** | บันทึกผลงานเดิมซ้ำ | A บันทึก Guide G1 หรือ Summary S1 สองครั้งผ่าน API แล้วตรวจ UI | PUT ทั้งสองครั้งตอบ `200 saved:true` ด้วย body เดียวกัน; มี bookmark เดียวต่อชนิดและ ID; UI แสดง “ได้บันทึกการแบ่งปันนี้ไปแล้ว” เมื่อทราบจาก state ก่อนกดว่าบันทึกอยู่แล้ว |
| **TC10** | คำขอไม่มีสิทธิ์หรือผลงานไม่ถูกต้อง | ทดสอบไม่มี token, token ผิด/หมดอายุ, ส่ง `user_id` ของ B, type/ID ผิดรูปแบบ และ target ที่หาย ทั้ง Guide และ Summary | Token ใช้ไม่ได้ `401 AUTH_REQUIRED`; owner spoof หรือพารามิเตอร์ผิด `422 INVALID_PARAMETERS`; target หาย `404 GUIDE_NOT_FOUND` หรือ `404 SUMMARY_NOT_FOUND`; ไม่สร้าง bookmark ใหม่ |
| **TC11** | บันทึกล้มเหลวต้องคงรายการเดิม | A ทดลองบันทึก Guide และ Summary ที่ยังไม่ saved โดยจำลอง DB write failure ก่อน commit | `503 SAVED_ITEMS_UNAVAILABLE`; UI แจ้งบันทึกไม่สำเร็จ; target ยังคง `saved:false`; bookmark เดิมยังอยู่และไม่มี success ลวง |
| **TC12** | แสดง bookmark แนวข้อสอบเดิมในรายการรวม | A มี G1 เดิมจาก `/api/saved-guides`; บันทึก S1 ผ่าน PUT saved-items; เปิดรายการรวม แล้ว PUT G1 ซ้ำผ่าน saved-items | รายการรวมแสดง G1 และ S1 คนละชิ้น; G1 ปรากฏเพียงครั้งเดียว; `item_type` และ `item_id` ตรงกับผลงาน |

### 3.1 Supplementary Tests (ไม่ใช่ U9 acceptance TC)

| รหัสเสริม | ประเด็น | วิธีตรวจและผลคาดหวัง |
|---|---|---|
| **ST01 — FK / Composite key** | Referential integrity และ uniqueness | ตรวจ FK ไป `users` และ target; PK/unique `(user_id, guide_id)` และ `(user_id, summary_id)`; Guide 101 กับ Summary 101 อยู่ร่วมกันได้ แต่คู่เดิมใน relation เดียวกันซ้ำไม่ได้ |
| **ST02 — Transaction order** | SQLAlchemy transaction boundary | instrument Session แล้วพิสูจน์ว่า `session.begin()` เกิดก่อน SELECT target; SELECT และ INSERT อยู่ใน transaction เดียว; ไม่เกิด autobegin conflict |
| **ST03 — Concurrent PUT** | คำขอบันทึกพร้อมกัน | ยิง PUT หลาย request สำหรับ user/type/id เดียวกันบน SQL Server; เหลือ relation เดียวและทุก request ที่ยืนยันผลได้ตอบ `200 saved:true`; duplicate-key recovery ต้อง rollback แล้วอ่าน state ใหม่ |
| **ST04 — Cross-feature consistency** | U9/U10 ใช้ relation ร่วมกัน | U9 PUT แล้ว U10 GET list เห็นรายการเดียวกัน; U10 DELETE แล้ว U9 GET state เป็น `saved:false` |
| **ST05 — Delete from stale list** | ผลงานถูกลบหลังเปิดหน้ารายการก่อนกดนำออก | เปิดรายการ A ค้างไว้ขณะ bookmark target ยังอยู่; ลบ target จากแหล่งข้อมูล; กด DELETE จากหน้าค้างและกดซ้ำ ต้องได้ `200 {item_type,item_id,saved:false}` ทั้งสองครั้ง; bookmark อื่นของ A และ bookmark ของ B ต้องคงอยู่; GET list ตอบ `200` และข้าม target ที่หาย |
| **ST06 — PUT races with target deletion** | Guide และ Summary ถูกลบระหว่างบันทึก | ทดสอบแยก Guide/Summary โดยให้ target ถูกลบหลัง target SELECT แต่ก่อน INSERT (เช่นจำลอง FK conflict ที่ constraint ของ target); Service rollback T1 แล้วเริ่ม T2 เพื่อตรวจ target ใหม่; เมื่อยืนยันว่า target หายต้องตอบ `404 GUIDE_NOT_FOUND` หรือ `404 SUMMARY_NOT_FOUND` และห้ามตอบ saved:true; ถ้า recheck อ่าน/เขียนไม่ได้ตอบ `503 SAVED_ITEMS_UNAVAILABLE` |
| **ST07 — Concurrent PUT without target deletion** | PUT พร้อมกันสองคำขอสำหรับ target ที่ยังอยู่ | ยิง PUT พร้อมกันสองคำขอของ user/type/id เดียวกันบน SQL Server โดยไม่มีการลบ target; ทั้งสองคำขอที่ยืนยันผลได้ตอบ `200 saved:true` และมี bookmark เพียงแถวเดียว; duplicate-key path rollback T1, begin T2, recheck target+relation; DB read/write failure ตอบ `503 SAVED_ITEMS_UNAVAILABLE` |

## 4. การทดสอบร่วมที่ยังต้องครอบคลุม

| Case | สิ่งที่ต้องพิสูจน์ |
|---|---|
| Auth | no token / invalid / expired → `401 AUTH_REQUIRED` และ WWW-Authenticate |
| Validation | unsupported type, ID 0, negative, float/string/bool, unknown query/body → `422 INVALID_PARAMETERS` |
| GET state / PUT target missing | guide → `404 GUIDE_NOT_FOUND`; summary → `404 SUMMARY_NOT_FOUND`; ไม่มี relation ใหม่ |
| DELETE target missing | `200 saved:false` ทั้งเมื่อไม่มี relation และเมื่อ target ถูกลบแล้ว; เรียกซ้ำได้ผลเดิมและไม่กระทบ bookmark อื่น |
| GET list มี stale bookmark | ตอบ `200` และข้าม bookmark ที่อ้าง target ถูกลบ; ถ้า DB อ่านไม่ได้จริงตอบ `503 SAVED_ITEMS_UNAVAILABLE` |
| PUT target deletion race | target FK conflict ที่คาดหมาย → rollback T1 → begin T2 → recheck target; target หายตอบ 404 ตามชนิด; target ยังอยู่แต่ไม่ยืนยัน relation หรือ DB อ่าน/เขียนไม่ได้ตอบ 503 |
| Duplicate-key recheck | หลัง rollback T1 และ begin T2 ให้ตรวจ target กับ relation; relation มีและ target อยู่ตอบ 200 saved:true; target หายตอบ 404 ตามชนิด; recheck DB failure หรือ target ยังอยู่แต่ relation หายตอบ 503 |
| Owner isolation | A save แล้ว B GET state เป็น false; B DELETE ไม่ลบ bookmark ของ A |
| State durability | reload และ Login ใหม่บัญชีเดิมยังอ่าน saved state เดิม |
| Empty list vs failure | ไม่มี bookmark = `200 {"items":[]}`; DB error = `503 SAVED_ITEMS_UNAVAILABLE` |
| Duplicate-key recovery | unique conflict ที่เป็นคู่ key นี้เท่านั้น → rollback transaction เดิม → begin transaction ใหม่ → ตรวจ target และ relation; target อยู่และ relation พบจึงตอบ 200 saved:true; target หายตอบ 404 ตามชนิด; DB recheck ล้มเหลวหรือ target ยังอยู่แต่ relation ไม่พบตอบ 503 |
| Stale-list DELETE | เปิด list ก่อน target ถูกลบ แล้ว DELETE จากหน้าค้าง; ต้องได้ 200 saved:false แม้ target หาย, กดซ้ำได้ผลเดิม, bookmark อื่นยังอยู่ |
| PUT/delete race | ทดสอบ Guide และ Summary เมื่อ delete target ชนกับ PUT; เมื่อ recheck ยืนยัน target หายต้องตอบ 404 ไม่ใช่ saved:true; DB failure ต้องเป็น 503 |
| Concurrent PUT without delete | สอง PUT พร้อมกันกับ target ที่ไม่ถูกลบ; ทั้งคู่ 200 saved:true และ relation เหลือแถวเดียว |
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
| Backend | DAO relation dispatch, Session transaction, duplicate-key rollback/re-read, 503 | Pending |
| Data model / Task100 | saved_summaries PK/FK, saved_guides existing constraints, cleanup | Pending |
| PO / Task98 | TC06–TC12 traceability ตาม Task98 v0.3; supplementary tests แยกจาก acceptance | Pending |

## 7. สถานะและแหล่งอ้างอิง

**Draft for Review — Not Implemented / Tests Not Run.** ต้อง review และแนบหลักฐานจริงก่อนเปลี่ยนสถานะ

แหล่งอ้างอิงหลัก: [Task98 U9 Requirements and Test Cases PO Content Updated — commit `40e2c4a`](https://github.com/Lilieay/cs261-group4-100001/blob/40e2c4a61541ca31d64db556458e955ee04fb9ff/docs/U9/requirements/Task98_U9_Requirements_and_Test_Cases_PO_Content_Updated.md#L147) หัวข้อ 5.2 Current Acceptance Test Cases; Task94 API Contract v0.4; Task104 U10 DAO design v0.3.
