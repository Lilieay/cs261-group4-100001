# Task104: U10 — แบบ DAO และลำดับการดู/เปิด/นำรายวิชาออก

**สถานะ:** พร้อมส่ง review แบบมีเงื่อนไข — ห้ามเริ่ม implementation จน Task94 และ Task99 ผ่าน DoD

**วันที่จัดทำ:** 4 พฤศจิกายน 2569

**วันที่แก้ไขล่าสุด:** 13 พฤศจิกายน 2569

**รุ่นเอกสาร:** 0.2

## 1. ขอบเขตและสมมติฐาน

แบบนี้ยึดความสามารถ U10 ใน Task104 และ endpoint ใน Task94: ผู้ใช้ที่ Login ดูรายวิชาที่บันทึก เปิดรายละเอียดรายวิชาด้วย API เดิม และนำรายวิชาออกจากรายการส่วนตัว การเปิดไม่สร้าง API ใหม่ และการนำออกไม่ลบ Course หรือเนื้อหา

Task99 ฉบับปัจจุบันยังมีคำถามที่ PO ต้องตัดสิน เพราะระบบเดิมเก็บ `SavedGuide` ด้วย `guide_id` ขณะที่ Task94 และ Task104 ระบุรายการรายวิชาด้วย `course_id` แบบนี้จึงออกแบบสำหรับ `SavedCourse` ที่ Task103 จัดเตรียม โดยถือว่า contract นี้เป็นข้อเสนอที่ยังต้อง review ไม่ได้อ้างว่า PO อนุมัติแล้ว

**สมมติฐานที่ Task103/Task94 ต้องตรวจร่วมกัน:** `SavedCourse` เชื่อม `user_id` กับ `course_id` ด้วย composite key; ใช้ `users.id` และ `courses.id` เดิม; ไม่รับ `user_id` จาก request; DAO ลบเฉพาะคู่ผู้ใช้ปัจจุบันกับรายวิชาที่ระบุ ถ้า Task103 ใช้ชื่อ field หรือ constraint ต่างกัน ให้แก้แบบนี้ก่อน implementation โดยไม่สร้างตาราง Course/User หรือ ER ซ้ำ

### Dependency gate ก่อนเริ่ม implementation

| งานก่อนหน้า | หลักฐานที่ตรวจ | สถานะ ณ 13 พฤศจิกายน 2569 | ผลต่อ Task104 |
|---|---|---|---|
| Task94 — API Contract กลาง U6–U10 | Branch `origin/docs/task94-api-contract`, commit `de3e669` | รุ่น 0.2 พร้อมส่งตรวจ แต่เอกสารระบุว่ายังรอ Frontend/Backend/PO review | ใช้เป็น baseline ในการออกแบบเท่านั้น ห้ามล็อก endpoint/DTO จนผ่าน DoD |
| Task99 — รายละเอียดและ Test Cases U10 | Branch `origin/feat/u10-task99-requirements`, commit `cc5b928` | TC ร่างครบ แต่ยังรอ PO ตัดสิน Course bookmark เทียบกับ Guide bookmark | แบบนี้เลือก Course bookmark ตาม Task94/Task104 แบบมีเงื่อนไข |
| Task103 — SavedCourse data design | ยังไม่พบ artefact ใน `sprint2` หรือ remote branches ที่ตรวจ | ยังยืนยัน schema, constraint และ FK policy ไม่ได้ | ต้องเทียบชื่อ table/field/key กับ Task103 ก่อน merge/implement |

การทำเอกสารแบบมีเงื่อนไขนี้ไม่ถือว่าเริ่ม implementation และไม่ถือว่า Task104 ผ่าน DoD จน dependency gate และ review checklist ในหัวข้อ 7 ถูกปิดครบ

## 2. ข้อมูลและ ER เดิมที่นำมาใช้

ไม่เพิ่ม Entity `Course` หรือ `User` และไม่ทำ ER ภาพรวมซ้ำ อ้างอิงตารางเดิมจาก [Task22 Course Entity](../../U2/design/task22-course-entity.md), [Task6 User/DAO](../../U1/design/task6-db-er-entity-dao.md) และ [Task36 ER ของ Guide/Course](../../U3/design/task36-db-er-entity-dao.md)

```mermaid
erDiagram
    users ||--o{ saved_courses : bookmarks
    courses ||--o{ saved_courses : bookmarked_by
    users {
        int id PK
    }
    courses {
        int id PK
        string course_code UK
        string course_name
    }
    saved_courses {
        int user_id PK,FK
        int course_id PK,FK
    }
```

แผนภาพเป็น fragment แสดงเฉพาะ relation ที่ U10 ใช้ ตารางและ field ของ `saved_courses` ต้องตรงกับ Entity/ตารางจาก Task103 ก่อน merge; ไม่ให้ Task104 สร้างตารางใหม่ซ้ำอีกชุด การลบ bookmark ต้องคง `courses`, `guides`, summaries และข้อมูลของผู้ใช้อื่นไว้

## 3. DAO และการแบ่งหน้าที่

| Component / method | Input | Output | หน้าที่และข้อผิดพลาด |
|---|---|---|---|
| `SavedCourseDAO.list_by_user(user_id)` | ID จาก `AuthenticatedUser` | `list[Course]` | Join `SavedCourse` กับ `Course` ด้วย `course_id`; filter `SavedCourse.user_id == user_id`; เรียง `course_code ASC, Course.id ASC`; คืน `[]` เมื่อไม่มีรายการ |
| `SavedCourseDAO.remove(user_id, course_id)` | ID ผู้ใช้จาก session และ ID จาก path | จำนวนแถวที่ลบ หรือ bool | DELETE ด้วยเงื่อนไขทั้ง `user_id` และ `course_id`; ไม่ delete Course; ศูนย์แถวคือ no-op ที่สำเร็จสำหรับการนำออกซ้ำ |
| `CourseDAO.get_cs_by_id(course_id)` (เดิม) | ID จาก path | `Course` หรือ `None` | ตรวจว่ารายวิชามีอยู่และเป็นวิชา CS ก่อนตอบสถานะ/นำออก; เปิดรายละเอียดใช้ Course API เดิม |
| `SavedCoursesService.list_for_user(user_id)` | Principal ที่ผ่าน `current_user` | `SavedCourseListResponse(items=[CourseRefDTO...])` | แปลง `Course` เป็น `{id, course_code, course_name}`; storage error แปลงเป็น `STORAGE_UNAVAILABLE` ไม่แปลงเป็นรายการว่าง |
| `SavedCoursesService.remove(user_id, course_id)` | Principal และ path ID ที่ validate แล้ว | `SavedCourseState(course_id, saved=False)` | ตรวจ Course CS ที่มีอยู่, ลบ association, commit; ถ้า DB error ให้ rollback แล้วคืน storage error |

DAO ไม่ commit transaction เอง ให้ Service ถือ session/transaction เดียวตามรูปแบบ dependencies ปัจจุบัน กรณี remove ซ้ำ Service commit no-op ได้และตอบ `{course_id, saved: false}` ตาม contract

DAO รับ `user_id` จาก Service เท่านั้น Router ต้องสร้างค่านี้จาก authenticated principal และไม่ส่ง `user_id` จาก body/query ลง Service การขอเข้าถึงรายการของผู้ใช้อื่นจึงไม่มี route ที่ถูกต้องให้เรียก; ถ้าส่ง owner field/query ที่ contract ไม่รับ ให้ตอบ `422 INVALID_PARAMETERS` ก่อนเรียก DAO ไม่ใช้ `403` เพื่อเปิดเผยว่าผู้อื่นมีรายการใดอยู่

### SQL เชิงแนวคิด

รายการ:

```sql
SELECT c.id, c.course_code, c.course_name
FROM saved_courses AS sc
JOIN courses AS c ON c.id = sc.course_id
WHERE sc.user_id = :current_user_id
ORDER BY c.course_code ASC, c.id ASC;
```

นำออก:

```sql
DELETE FROM saved_courses
WHERE user_id = :current_user_id
  AND course_id = :course_id;
```

ใช้ parameter binding ผ่าน SQLAlchemy ORM/Core; SQL นี้อธิบายขอบเขตการกรอง ไม่ใช่คำสั่งให้สร้างตารางใหม่

## 4. API/DTO และกติกา

อ้าง endpoint จาก Task94: `GET /api/saved-courses`, `DELETE /api/saved-courses/{course_id}` และ `GET /api/courses/{course_id}` เดิม ทุก endpoint ต้องผ่าน Bearer session; ไม่รับ owner ID ใน body/query

| ขั้นตอน | ผลสำเร็จ | กรณีผิดพลาด |
|---|---|---|
| ดูรายการ | `200 {"items": [{"id": 1, "course_code": "CS261", "course_name": "..."}]}`; ไม่มีรายการเป็น `200 {"items": []}` | ไม่มี/ผิด/หมดอายุ token: `401 AUTH_REQUIRED`; storage error: `503 STORAGE_UNAVAILABLE` |
| เปิดรายวิชา | UI ใช้ `CourseRefDTO.id` เรียก `GET /api/courses/{course_id}` ผ่าน proxy เดิม; ได้ Course DTO จาก API เดิม | ID ไม่ใช่จำนวนบวก: `422 INVALID_PARAMETERS`; วิชาไม่มีหรือไม่ใช่ CS: `404 COURSE_NOT_FOUND`; token ไม่ผ่าน: `401`; storage error ของ API เดิมเป็น `500 INTERNAL_ERROR` ตาม `CourseApiRoute` ปัจจุบัน |
| นำออก | ลบเฉพาะ association ของ current user แล้วตอบ `200 {"course_id": 1, "saved": false}`; เรียกซ้ำได้ผลเดิม | ID ผิด `422`; Course ไม่มี/ไม่ใช่ CS `404 COURSE_NOT_FOUND`; DB error `503 STORAGE_UNAVAILABLE` และ association ต้องยังอยู่ |

กติกาที่ใช้ร่วมกัน: body/query ที่ endpoint ไม่รับ รวมถึง `user_id` ตอบ `422 INVALID_PARAMETERS`; route ไม่มีตอบ `404 ROUTE_NOT_FOUND`; method ผิดตอบ `405 METHOD_NOT_ALLOWED` พร้อม `Allow`; response error ใช้ envelope กลางจาก Task94 ไม่ใช้ `200` พร้อมข้อความ error

รายการ Course ที่บันทึกต้องแยกจาก `/api/saved-guides` ซึ่งบันทึก Guide คนละชนิด ถ้าระบบมี saved-course reference ที่ชี้ไป Course ที่ถูกลบ ให้ปฏิบัติตาม FK/ลำดับ cleanup ที่ Task103 กำหนด; GET list ต้องไม่คืนรายการที่เปิดต่อไม่ได้

## 5. Sequence Diagrams

ไฟล์ Mermaid ต้นฉบับแยกแก้ไขได้: [ER fragment](task104-saved-courses-er.mmd), [ดูรายการ](task104-saved-courses-list.mmd), [เปิดรายวิชา](task104-saved-courses-open.mmd), [นำออก](task104-saved-courses-remove.mmd). แผนภาพด้านล่างแสดง UI, API/DTO/Service, DAO, SQL และ storage พร้อมเส้นทางสำเร็จและข้อผิดพลาดสำคัญ

### 5.1 ดูรายการรายวิชาที่บันทึก

```mermaid
sequenceDiagram
    actor Student as นักศึกษา
    participant UI as Saved courses UI
    participant API as SavedCourse Router / DTO
    participant SVC as SavedCoursesService
    participant DAO as SavedCourseDAO
    participant DB as SQL storage
    Student->>UI: เปิดรายการส่วนตัว
    UI->>API: GET /api/saved-courses + Bearer
    API->>API: current_user ตรวจ token
    alt token ใช้ไม่ได้
        API-->>UI: 401 AUTH_REQUIRED
    else token ผ่าน
        API->>SVC: list_for_user(current_user.id)
        SVC->>DAO: list_by_user(current_user.id)
        DAO->>DB: SELECT join saved_courses/courses by user_id, ordered
        alt อ่านฐานข้อมูลล้มเหลว
            DB-->>DAO: SQL error
            DAO-->>SVC: storage exception
            SVC-->>API: STORAGE_UNAVAILABLE
            API-->>UI: 503 STORAGE_UNAVAILABLE
        else อ่านสำเร็จ
            DB-->>DAO: Course rows หรือ []
            DAO-->>SVC: list[Course]
            SVC-->>API: SavedCourseListResponse / CourseRefDTO
            API-->>UI: 200 {items: [...]} หรือ {items: []}
        end
    end
    UI-->>Student: แสดงรายการหรือ empty state / แจ้งโหลดไม่สำเร็จ
```

### 5.2 เปิดรายวิชาจากรายการ

```mermaid
sequenceDiagram
    actor Student as นักศึกษา
    participant UI as Saved courses UI
    participant API as Course Router / DTO
    participant SVC as CourseService (เดิม)
    participant DAO as CourseDAO (เดิม)
    participant DB as SQL storage
    Student->>UI: เลือกรายวิชา course_id
    UI->>API: GET /api/courses/{course_id} + Bearer
    API->>API: current_user และ Path validation
    alt token ใช้ไม่ได้
        API-->>UI: 401 AUTH_REQUIRED
    else path ID ไม่ถูกต้อง
        API-->>UI: 422 INVALID_PARAMETERS
    else ผ่านการตรวจ
        API->>SVC: get(course_id)
        SVC->>DAO: get_cs_by_id(course_id)
        DAO->>DB: SELECT Course WHERE id = ? AND course_code LIKE 'CS%'
        alt อ่าน storage ล้มเหลว
            DB-->>DAO: SQL error
            DAO-->>SVC: exception
            SVC-->>API: unhandled storage error ตาม API เดิม
            API-->>UI: 500 INTERNAL_ERROR
        else ไม่พบ/ไม่ใช่ CS
            DB-->>DAO: None
            DAO-->>SVC: None
            SVC-->>API: COURSE_NOT_FOUND
            API-->>UI: 404 COURSE_NOT_FOUND
        else พบรายวิชา
            DB-->>DAO: Course row
            DAO-->>SVC: Course
            SVC-->>API: CourseDTO เดิม
            API-->>UI: 200 CourseDTO
            UI-->>Student: เปิดหน้ารายละเอียดรายวิชาเดิม
        end
    end
```

### 5.3 นำรายวิชาออกจากรายการส่วนตัว

```mermaid
sequenceDiagram
    actor Student as นักศึกษา
    participant UI as Saved courses UI
    participant API as SavedCourse Router / DTO
    participant SVC as SavedCoursesService
    participant CourseDAO as CourseDAO (เดิม)
    participant DAO as SavedCourseDAO
    participant DB as SQL storage
    Student->>UI: กดนำออก
    UI->>API: DELETE /api/saved-courses/{course_id} + Bearer
    API->>API: current_user และ Path validation
    alt token ใช้ไม่ได้
        API-->>UI: 401 AUTH_REQUIRED
    else ID/body/query ไม่ถูกต้อง
        API-->>UI: 422 INVALID_PARAMETERS
    else ผ่านการตรวจ
        API->>SVC: remove(current_user.id, course_id)
        SVC->>CourseDAO: get_cs_by_id(course_id)
        CourseDAO->>DB: ตรวจ Course CS ที่มีอยู่
        alt ไม่พบ/ไม่ใช่ CS
            DB-->>CourseDAO: None
            CourseDAO-->>SVC: None
            SVC-->>API: COURSE_NOT_FOUND
            API-->>UI: 404 COURSE_NOT_FOUND
        else พบ Course
            CourseDAO-->>SVC: Course
            SVC->>DAO: remove(current_user.id, course_id)
            DAO->>DB: DELETE saved_courses WHERE user_id=? AND course_id=?
            alt ลบหรือ commit ล้มเหลว
                DB-->>DAO: SQL error
                DAO-->>SVC: storage exception
                SVC->>DB: ROLLBACK
                SVC-->>API: STORAGE_UNAVAILABLE
                API-->>UI: 503 STORAGE_UNAVAILABLE
            else ลบได้หรือไม่มี association อยู่แล้ว
                DB-->>DAO: rowcount 1 หรือ 0
                DAO-->>SVC: ผลลบ
                SVC->>DB: COMMIT
                SVC-->>API: SavedCourseState(saved=false)
                API-->>UI: 200 {course_id, saved:false}
                UI-->>Student: เอาออกจากรายการ และคง Course/เนื้อหาเดิม
            end
        end
    end
```

## 6. จุดทดสอบตามระดับ

รายการนี้เป็นแผนสำหรับผู้ implement/ผู้ทดสอบภายหลัง ไม่ใช่ผลรันทดสอบจริง

| ระดับ | ตรวจอะไร | กรณีสำคัญ |
|---|---|---|
| Unit — DAO | filter เจ้าของ, join Course, sort คงที่, delete แบบ composite predicate | ผู้ใช้ A/B มี bookmark course เดียวกัน; A remove แล้ว B ยังอยู่; remove ซ้ำ rowcount 0; list ว่าง |
| Unit — Service | DTO mapping, ตรวจ Course ก่อน remove, commit/rollback, error mapping | Course หาย/ไม่ใช่ CS; DB ล้มเหลวขณะอ่าน/ลบ/commit; error ห้ามกลายเป็น empty/false success |
| API | auth, validation, status/error envelope, DTO shape | ไม่มี/ผิด token 401; ID 0/ติดลบ/ไม่ใช่เลข 422; unknown/non-CS course 404; list 200; repeated DELETE 200 false |
| Integration | FK และ transaction บน SQL Server/DB ที่โครงการใช้จริง | remove A ไม่กระทบ bookmark B, Course, Guide/summary; forced rollback คง association; list order `course_code,id` |
| UI/API | เปิดรายการ, empty/error states, เปิดรายละเอียดผ่าน Course API เดิม, remove แล้ว refresh | 401 ไปหน้า Login ตาม flow เดิม; 503 แสดงล้มเหลวและไม่ซ่อนรายการ; เปิด Course ไม่เพิ่ม API ใหม่ |

## 7. Review และประเด็นค้าง

| รายการ | สถานะ |
|---|---|
| ตรวจ schema/model/DAO ที่มี และ ER อ้างอิง | ตรวจแล้ว: ปัจจุบันมี `SavedGuide`; ยังไม่พบ `SavedCourse` ใน branch นี้ จึงระบุ Task103 เป็น dependency และไม่อ้างว่า implementation มีแล้ว |
| ตรวจ endpoint/DTO/error กับ Task94 v0.2 | ตรวจเทียบแล้วในฐานะ draft; Task94 PR #103 ยังรอ Frontend/Backend/PO review |
| ตรวจความสอดคล้องกับ Task99/TC | พบ conflict ระหว่าง Guide bookmark ในระบบปัจจุบันกับ Course bookmark ใน Task94/Task104; ต้องให้ PO/ทีมยืนยันก่อนล็อก implementation |
| ตรวจข้อผิดพลาดของ Course API เดิม | ตรวจแล้ว: `CourseApiRoute` แปลง unhandled storage exception เป็น `500 INTERNAL_ERROR`; ไม่อ้างว่าเป็น `503` |
| ผู้ทบทวนอิสระ / วันที่ / revision ที่ตรวจ | รอ reviewer ของทีมกรอกหลัง review จริง; เอกสารนี้ยังไม่อ้าง independent review |

### ประวัติรุ่นและบันทึก review

| รุ่น | วันที่ | ผู้จัดทำ/ผู้ตรวจ | รายการเปลี่ยนแปลงหรือผลตรวจ |
|---|---|---|---|
| 0.1 | 4 พฤศจิกายน 2569 | ผู้จัดทำแบบ | ร่าง DAO, SQL, ER fragment และ 3 sequence flows จาก Task94 v0.2 |
| 0.2 | 13 พฤศจิกายน 2569 | ผู้จัดทำแบบ; รอ reviewer ทีม | แยก Router/DTO, Service, DAO และ storage ใน diagram; เพิ่ม dependency gate, validation, rollback และ storage error paths; แก้ reference ให้ใช้ได้จาก branch ที่แตกจาก `sprint2` |
| Review | รอกรอก | ชื่อ reviewer / วันที่ / commit | บันทึกข้อพบ การแก้ไข และผลยอมรับจริงก่อนปิด Task104 |

### Review checklist สำหรับ PR

- [ ] Task94 ผ่าน DoD และ Frontend/Backend ยืนยัน endpoint, DTO และ empty/error behavior
- [ ] Task99 ผ่าน DoD และ PO ยืนยัน scope Course bookmark เทียบกับ Guide bookmark
- [ ] Task103 model/table, key, FK และ cleanup policy ตรงกับสมมติฐานในเอกสาร
- [ ] Reviewer ตรวจ SQL ownership predicate, transaction และกรณีล้มเหลว; เติมชื่อ/วันที่/commit/review link และข้อแก้ไขจริง

## 8. แหล่งอ้างอิงใน Repository

- [Task94 API Contract v0.2](https://github.com/Lilieay/CS261-Group4-Project/blob/docs/task94-api-contract/docs/task94-api-contract.md) — baseline จาก branch ที่ยังรอ review
- [Task99 U10 Requirements/TC](https://github.com/Lilieay/CS261-Group4-Project/blob/feat/u10-task99-requirements/docs/U10/requirements/task99-u10-requirements-and-test-cases.md) — draft จาก prerequisite branch ที่ยังรอ PO ยืนยัน
- [Course Entity/DAO](../../U2/design/task22-course-entity.md), [User Entity/DAO](../../U1/design/task6-db-er-entity-dao.md), [Guide/Course ER](../../U3/design/task36-db-er-entity-dao.md)
- Current implementation reference: `backend/app/models/saved_guide.py`, `backend/app/dao/saved_guide_dao.py`, `backend/app/routers/courses.py`, `backend/app/dao/course_dao.py`, `backend/app/services/courses.py`
- Target implementation reference: `SavedCourse` จาก Task103 (ยังไม่พบใน `sprint2` หรือ remote branches ที่ตรวจ ณ 13 พฤศจิกายน 2569)
