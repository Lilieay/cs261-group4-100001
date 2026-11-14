# Task103 U9 ออกแบบ DAO และการจัดการรายการบันทึก

รุ่น 0.1 | วันที่ 13 พฤศจิกายน 2569 | สถานะ: Draft for Backend / Frontend / PO Review

เอกสารนี้เป็นแบบ Backend สำหรับ Task103 U9 ครอบคลุมการอ่านสถานะและบันทึกผลงานที่ผู้ใช้สนใจ โดยยึดมติ PO Review ใน Task98 หน้า 4 ที่ให้บันทึกแนวข้อสอบหรือสรุป PDF แยกเป็นรายชิ้น ไม่ใช่บันทึกทั้งรายวิชา มี [Sequence Diagram](task103-u9-sequences.md) และ [แผนทดสอบกับบันทึก review](task103-u9-review-and-test-plan.md) ประกอบ ยังไม่มีการ implement หรือรัน API ตามแบบนี้

## 1 แหล่งอ้างอิงและข้อจำกัดของฐานงาน

| แหล่งข้อมูล | รุ่นที่ตรวจและสิ่งที่ใช้ |
| --- | --- |
| Task94 API Contract | ใช้เป็นฐานรูปแบบ Login/Bearer, DTO, error envelope และ API conventions แต่ส่วน `/api/saved-courses` ต้องทบทวนใหม่ตาม PO Review U9 |
| Task94 Review v0.2 | สถานะพร้อมส่งตรวจ แต่ยังรอ Frontend, Backend และ PO review; DoD การตกลงร่วมและ review ยังไม่เสร็จ |
| Task98 U9 Requirements and Test Cases PO Review | User Story และ TC01–TC05; หน้า 4 ระบุมติให้บันทึก Guide หรือ Summary PDF แยกเป็นรายชิ้น และปรับ API ให้ระบุชนิดกับ ID |
| Task101 U7 DAO design | ใช้เป็นรูปแบบเอกสารและแนวการเขียน DAO, transaction boundary, error handling และ test levels เท่านั้น |
| Task100 แบบข้อมูล/ER | เป็นเจ้าของการออกแบบตารางและ ER ที่เกี่ยวข้อง ต้องใช้ชื่อตารางและ FK ที่ Task100 ยืนยัน ไม่สร้างตาราง User/Course/Guide/Summary ซ้ำ |
| งานเดิมเรื่อง saved_guides | มี API/ข้อมูลเดิมที่อ้าง `guide_id`; ห้ามแปลงหรือย้ายข้อมูลเดิมอัตโนมัติในงานนี้ |

### 1.1 ข้อกำหนดที่ยืนยันได้จาก U9

- ผู้ใช้ต้อง Login ด้วยสถานะที่ใช้งานได้ก่อนบันทึก
- Backend ระบุเจ้าของจากตัวตนที่ยืนยันแล้วเท่านั้น
- ไม่รับ `user_id`, `owner_id` หรือ field เจ้าของจาก Frontend เพื่อเลือกบัญชีเป้าหมาย
- ต้องตรวจว่าผลงานชนิดและ ID ที่ส่งมามีอยู่จริง
- บันทึก Guide หรือ Summary PDF เป็นรายชิ้น ไม่ใช่บันทึก Course ทั้งวิชา ตามมติ PO
- การบันทึกซ้ำต้องไม่สร้างรายการซ้ำ
- เมื่อบันทึกซ้ำ ให้แจ้งผู้ใช้ตามมติ PO ว่า “ได้บันทึกการแบ่งปันนี้ไปแล้ว”
- รายการต้องคงอยู่หลัง reload และกลับมา Login ด้วยบัญชีเดิม
- เมื่อบันทึกล้มเหลว ห้ามแสดงผลสำเร็จลวง และต้องไม่มี saved relation ที่ไม่สำเร็จ
- `saved_guides` เดิมไม่ถูก migrate/convert อัตโนมัติ

### 1.2 ประเด็นที่ยังไม่ใช่ข้อสรุปสุดท้าย

| ประเด็น | สถานะ |
| --- | --- |
| ชื่อ endpoint และ schema ใหม่ | ต้องปรับ Task94 และให้ Frontend/Backend/PO ยืนยัน |
| ชื่อตารางและคอลัมน์จริงของ Guide/Summary | รอ Task100 และเจ้าของข้อมูลยืนยัน |
| จะใช้ตารางกลาง `saved_items` หรือแยกตารางตามชนิด | เป็นการตัดสินใจเชิง schema ที่ต้องให้ Backend/Task100 review |
| บันทึกผลงานของตนเองได้หรือไม่ | Task98 ที่มีไม่ได้ให้ข้อสรุป ต้องถาม PO |
| เมื่อผลงานต้นทางถูกลบ จะลบ saved relation อย่างไร | ต้องตกลงกับเจ้าของ Guide/Summary และ Task100 |
| HTTP status เมื่อบันทึกซ้ำ | PO ระบุข้อความ UI แล้ว แต่ต้องยืนยัน status/body ใน API Contract |

ห้ามถือข้อเสนอด้านล่างเป็น API Contract หรือ DDL ที่อนุมัติแล้ว

## 2 โครงสร้างที่อ้างใช้และขอบเขตความรับผิดชอบ

ไม่สร้างตาราง User, Course, Guide หรือ Summary ซ้ำในงาน DAO นี้ และไม่ประกาศ DDL/ER แทน Task100

| ข้อมูลที่ DAO ต้องใช้ | หน้าที่ |
| --- | --- |
| User identity | ระบุผู้ใช้จาก authenticated session/token |
| Guide identifier | ระบุแนวข้อสอบรายชิ้นที่มีอยู่จริง |
| Summary identifier | ระบุสรุป PDF รายชิ้นที่มีอยู่จริง |
| Saved relation | เชื่อมผู้ใช้กับผลงานที่บันทึก โดยแยกชนิดผลงาน |
| `created_at` หรือ saved timestamp | ใช้แสดงเวลาบันทึก หาก schema กลางกำหนดไว้ |

**ข้อเสนอเชิงตรรกะ:** ให้ saved relation เก็บ `user_id`, `item_type`, `item_id` และเวลาบันทึก โดย `item_type` แยก `guide` กับ `summary` เพื่อป้องกัน ID ชนกันระหว่างคนละตาราง ตัวอย่าง Guide ID 101 และ Summary ID 101 ต้องเป็นคนละรายการ

หาก Task100/Backend เลือกแยก relation table เช่น saved_guides และ saved_summaries ให้ DAO interface คงพฤติกรรมเดียวกันโดยไม่บังคับใช้ polymorphic table

### 2.1 ชั้นและหน้าที่

| ชั้น | หน้าที่ตามแบบ |
| --- | --- |
| UI / API client | กดบันทึก, โหลดสถานะ, แสดง saved/unsaved/duplicate/error |
| Router / DTO | ตรวจ token, path, request fields และแปลง error ตาม Contract |
| `SavedItemsService` | ระบุ current user, ตรวจชนิด/ID/target, คุม transaction และตัดสิน duplicate |
| `SavedItemsDAO` | อ่านสถานะ, insert-if-absent และ query relation ผ่าน Session ที่ Service ส่งให้ |
| Guide/Summary DAO ของเจ้าของข้อมูล | ตรวจว่า target มีอยู่จริงตามชนิด ไม่สร้าง Guide/Summary ใหม่ |
| SQL Server | บังคับ unique relation และเก็บข้อมูลถาวร |

DAO ไม่รับผิดชอบการสร้าง PDF, อ่านไฟล์ PDF หรือแก้ไข Guide/Summary ต้นทาง

## 3 API และ DTO ที่ใช้ในแบบ

Task98 Q03 ระบุว่า `/api/saved-guides` เดิมใช้ `guide_id` และ Task94 v0.2 ออกแบบ `/api/saved-courses` สำหรับ Course แต่ PO ยืนยันให้บันทึก Guide/Summary รายชิ้น จึงต้องออกแบบ endpoint/schema ใหม่ร่วมกัน

### 3.1 Endpoint proposal สำหรับ review

| Method และ path (ข้อเสนอ) | Request | ผลที่ต้องการ |
| --- | --- | --- |
| `GET /api/saved-items/{item_type}/{item_id}` | Bearer token; ไม่มี body | อ่านสถานะ saved ของผลงานหนึ่งชิ้น |
| `PUT /api/saved-items/{item_type}/{item_id}` | Bearer token; ไม่มี owner field | บันทึกผลงานให้ current user แบบไม่ซ้ำ |
| `GET /api/saved-items` | Bearer token; ไม่มี owner query | อ่านรายการ saved ของ current user หากรวมอยู่ใน scope ที่ PO อนุมัติ |

`item_type` รับเฉพาะ `guide` หรือ `summary`; `item_id` เป็น ID ของตารางตามชนิดที่ระบุ ไม่ fallback ข้ามชนิด

> Endpoint ทั้งหมดเป็นข้อเสนอเพื่อให้ทีม review เท่านั้น ต้องเทียบ API contract ปัจจุบันและตกลงชื่อจริงก่อน implement

### 3.2 DTO proposal

สถานะรายการ:

```json
{
  "item_type": "guide",
  "item_id": 101,
  "saved": true
}
```

ผลบันทึกครั้งแรก:

```json
{
  "item_type": "guide",
  "item_id": 101,
  "saved": true,
  "already_saved": false,
  "message": "บันทึกการแบ่งปันเรียบร้อยแล้ว"
}
```

ผลบันทึกซ้ำ:

```json
{
  "item_type": "guide",
  "item_id": 101,
  "saved": true,
  "already_saved": true,
  "message": "ได้บันทึกการแบ่งปันนี้ไปแล้ว"
}
```

DTO เป็นตัวอย่างเพื่อ review; ให้ยึดชื่อ field และข้อความที่ PO/Frontend อนุมัติใน Contract รุ่นใหม่

### 3.3 Validation และ Error

| กรณี | ผลที่เสนอ |
| --- | --- |
| ไม่มี token / token ผิด / หมดอายุ | `401 AUTH_REQUIRED` และ `WWW-Authenticate: Bearer` ตามมติ PO |
| `item_type` ไม่ใช่ guide หรือ summary | `422 INVALID_PARAMETERS` |
| `item_id` ไม่ใช่เลขจำนวนเต็มบวก | `422 INVALID_PARAMETERS` |
| ส่ง `user_id`, `owner_id` หรือ field เจ้าของที่ Contract ไม่อนุญาต | `422 INVALID_PARAMETERS` ตามมติ PO |
| target ไม่พบในตารางชนิดนั้น | 404 ตาม error code ที่ตกลงใน Contract |
| บันทึกซ้ำ | คืนสถานะ saved และข้อความ “ได้บันทึกการแบ่งปันนี้ไปแล้ว”; status/body รอ Contract ยืนยัน |
| SQL อ่าน/เขียนไม่ได้ | `503 STORAGE_UNAVAILABLE` ตาม mapping ที่ Contract อนุมัติ |
| ข้อผิดพลาดไม่คาดคิด | `500 INTERNAL_ERROR` ไม่เปิดเผย SQL/stack trace |

## 4 DAO methods และขอบเขต transaction

DAO ใช้ Session ที่ Service ส่งให้ ไม่ commit/rollback เอง ไม่สร้าง HTTP response และไม่รับ user ID จาก request body

| DAO method (ชื่อเสนอ) | Input | Output | กรณีผิดพลาดและข้อกำหนด |
| --- | --- | --- | --- |
| `target_exists(session, item_type, item_id)` | ชนิดและ ID ที่ผ่าน validation | target record หรือ `None` | เลือกตารางตามชนิดเท่านั้น; DB error ต้อง propagate ไม่คืน None แทน |
| `get_saved_state(session, user_id, item_type, item_id)` | user จาก auth, ชนิด, ID | `bool` | target existence ตรวจแยก; target มีแต่ยังไม่บันทึก = false |
| `insert_saved_if_absent(session, user_id, item_type, item_id)` | user จาก auth, ชนิด, ID | result: inserted/already_exists | ใช้ unique constraint เป็น guard สุดท้าย; duplicate key ต้องไม่กลบ DB error อื่น |
| `list_saved_by_user(session, user_id)` | user จาก auth | list ของ saved relation/target metadata | เฉพาะ current user; ไม่มีรายการคืน []; DB error ต้อง propagate |
| `count_saved(session, user_id, item_type, item_id)` | user/ชนิด/ID | จำนวน 0 หรือ 1 | ใช้ตรวจ state เท่านั้น ไม่ใช้แทน unique constraint |

### 4.1 SQL pattern สำหรับ state

```sql
SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM dbo.saved_items
    WHERE user_id = :user_id
      AND item_type = :item_type
      AND item_id = :item_id
) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS saved;
```

### 4.2 SQL pattern สำหรับ insert-if-absent

```sql
IF NOT EXISTS (
    SELECT 1
    FROM dbo.saved_items WITH (UPDLOCK, HOLDLOCK)
    WHERE user_id = :user_id
      AND item_type = :item_type
      AND item_id = :item_id
)
BEGIN
    INSERT INTO dbo.saved_items (user_id, item_type, item_id)
    VALUES (:user_id, :item_type, :item_id);
END;
```

SQL นี้เป็นเพียง pattern เพื่ออธิบายพฤติกรรม ไม่ใช่ DDL ที่ยืนยันแล้ว ชื่อตาราง/คอลัมน์ต้องตรงแบบ Task100 และ Backend; unique constraint บน `(user_id, item_type, item_id)` ต้องเป็นกลไกบังคับไม่ซ้ำจริง แม้มี transaction และ lock แล้วก็ตาม

### 4.3 Transaction และ concurrent requests

1. Router ตรวจ token ผ่าน auth dependency เดิม
2. Service อ่าน `user_id` จาก authenticated principal เท่านั้น
3. Service ตรวจ `item_type` และ `item_id`
4. Service/DAO ตรวจ target existence ตามชนิด
5. Service เปิด transaction
6. DAO พยายาม insert relation แบบ insert-if-absent
7. unique constraint ป้องกันคำขอพร้อมกันสร้างแถวซ้ำ
8. Service commit
9. Service สร้าง response ตามผลจริงหลัง commit

เมื่อเกิด duplicate-key จากคำขอพร้อมกัน ให้ Service อ่านสถานะใหม่ด้วย Session/transaction ที่ถูกต้องและตอบ duplicate result ไม่กลบ exception อื่นเป็น duplicate

หาก DB ล้มเหลวก่อน commit และยืนยัน rollback ได้ ให้ตอบ error ตาม Contract และ UI ห้ามแสดง success หากผล commit ไม่แน่ชัด ห้ามสรุปว่าไม่สำเร็จจากการเรียก rollback อย่างเดียว ให้ UI อ่าน state ใหม่ก่อน retry

### 4.4 การแยก namespace ของ ID

ห้ามใช้ `item_id` อย่างเดียวเป็น uniqueness key เพราะ Guide และ Summary อาจมีเลข ID เท่ากัน ตัวอย่าง:
- `(user 7, guide, 101)` บันทึกได้
- `(user 7, summary, 101)` ต้องบันทึกแยกได้
- `(user 7, guide, 101)` ซ้ำอีกครั้งต้องไม่เพิ่ม row

### 4.5 Legacy `saved_guides`

- ไม่ convert/copy `saved_guides` เดิมไป schema ใหม่โดยอัตโนมัติ
- ไม่ drop, rename หรือแก้ข้อมูลเดิมในงานนี้
- API เดิมต้องคงพฤติกรรมจนกว่าจะมีแผน deprecation ที่อนุมัติ
- ห้ามรวมผลจาก `saved_guides` เดิมเข้ากับ saved-items ใหม่โดยไม่ผ่าน PO/Backend review
- หากจะ migrate ในอนาคต ต้องมี mapping, duplicate policy, backup, rollback plan และ approval แยก

## 5 Error handling และข้อควรระวัง

| จุดเสี่ยง | แนวทาง |
| --- | --- |
| เชื่อ user_id จาก Frontend | ใช้ current user จาก auth session เท่านั้น |
| ID ชนกันระหว่าง Guide/Summary | ใช้ item_type ประกอบ ID ใน query และ unique key |
| เช็คก่อน insert อย่างเดียว | ใช้ unique constraint และทดสอบ concurrent PUT |
| target ไม่มีจริง | ตรวจตารางตามชนิด; ห้ามสร้าง target ใหม่ |
| DB failure ถูกแปลงเป็น false | propagate exception และตอบ error |
| save ซ้ำ | คง row เดียวและแจ้งข้อความตาม PO |
| ลบหรือแก้ target ต้นทาง | DAO saved relation ห้ามลบ/แก้ target |
| legacy migration | ห้ามแปลง saved_guides อัตโนมัติ |

## 6 DoD และ Review ที่ยังต้องมีหลักฐาน

| ข้อ | หลักฐานในชุดนี้ | สถานะ |
| --- | --- | --- |
| DAO input/output/errors | ส่วน 4 | จัดทำแบบแล้ว รอทีมตรวจ |
| อ่านสถานะและบันทึก | Sequence 2 flow พร้อม Mermaid source | จัดทำแบบแล้ว รอทีมตรวจ |
| duplicate และ concurrent request | ส่วน 4.3–4.4 และ test plan | จัดทำแบบแล้ว รอ Backend review |
| auth/invalid/not-found/failure | ส่วน 3 และ 5 | จัดทำแบบแล้ว รอ Contract alignment |
| ไม่ migrate saved_guides เดิม | ส่วน 4.5 | ระบุข้อกำหนดแล้ว |
| ตรง API Contract และ PO decision | ต้องปรับ Task94 และยืนยันร่วม | Pending |

| ผู้ตรวจตามบทบาท | ประเด็นที่ต้อง review | สถานะ |
| --- | --- | --- |
| Frontend | endpoint, DTO, duplicate message, saved/unsaved/loading/error states | Pending |
| Backend / Task100 | table/column/FK, unique constraint, transaction และ concurrency | Pending |
| PO / ผู้ดูแล Task94/98 | item types, duplicate behavior, self-save policy, error/status | Pending |

บันทึกชื่อผู้ตรวจจริง วันที่ รุ่นเอกสาร ลิงก์ comment/PR ข้อพบและผลแก้หลัง review เท่านั้น เอกสารนี้ยังไม่ใช่หลักฐานอนุมัติหรือผลทดสอบ implementation
