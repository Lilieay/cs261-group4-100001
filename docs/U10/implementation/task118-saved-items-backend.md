# Task118 Backend ดูรายการและนำ bookmark ออก

รุ่น 0.1 วันที่ 16 พฤศจิกายน 2569 พัฒนาและทดสอบ Unit/API แล้ว รอผู้ตรวจต่างคน review

ต่อจาก Task116 ที่ merge แล้วใน `sprint2` commit `a646cdb` ใช้ `SavedGuide` / `saved_guides` และ `SavedSummary` / `saved_summaries` ชุดเดิมตาม Task103, Task104 รุ่น 0.3 และ Task94 รุ่น 0.4 ชื่อ SavedCourse ในการ์ดเป็นข้อกำหนดเดิม ปัจจุบันบันทึก Guide/PDF ทีละชิ้นและจัดกลุ่มตามวิชา

Branch `feat/u10-saved-courses-backend` เปิด PR เข้า `sprint2` ตามข้อตกลงทีมล่าสุด แยกจาก Frontend U10 ไม่เปิด branch ต่อ task เพิ่ม

## API ที่เพิ่ม

| API | ผล |
| --- | --- |
| `GET /api/saved-items` | 200 `{items:[SavedItemDTO...]}` เฉพาะผู้ใช้ปัจจุบัน ไม่มีข้อมูลได้ `{items:[]}` |
| `DELETE /api/saved-items/{item_type}/{item_id}` | 200 `{item_type,item_id,saved:false}` หลัง commit ลบเฉพาะ bookmark ของผู้ใช้ปัจจุบัน |

ใช้ Bearer token และ `current_user` เดิม ไม่รับ user_id จาก client ไม่รับ body/query `item_type` เป็น guide หรือ summary และ item_id รับเฉพาะข้อความเลขฐานสิบบวกไม่เกิน 2,147,483,647 โดยใช้ parser ร่วมกับ Task116 ค่า 1.0, +1, ติดลบ และศูนย์ถูกปฏิเสธ

SavedItemDTO มี `item_type`, `item_id`, `course:{id,course_code,course_name}`, `title` และ `open_path` เรียง course_code ASC, item_type ASC, item_id DESC ข้อมูลวิชาและชื่ออ่านจาก target ปัจจุบัน UI ใช้ course.id จัดกลุ่ม ส่วนผลงานชนิดเดียวกันในวิชาเดียวกันยังคงแสดงแยกชิ้น

Guide ใช้ open_path `/api/guides/{id}` เพิ่ม alias ใน Node proxy ส่งไป Backend `/guides/{id}` เดิม Summary ใช้ `/api/summaries/{id}` แล้วอ่าน PDF จาก file.read_path ของ U6 พร้อม Bearer token ไม่เพิ่มระบบอ่าน PDF ใหม่ และไม่ใส่ token ใน URL Node proxy รองรับ list/state/remove และส่ง PUT ต่อ API Task116 เดิม รวมทั้งคง legacy Guide proxy

## กติกาและ transaction

- Service เริ่ม transaction ก่อน SELECT/DELETE สร้าง DTO ภายใน transaction และตอบเมื่อ commit ผ่านแล้ว DAO ไม่ commit เอง
- list JOIN กับ target จึงไม่แสดง bookmark ที่ target หาย ถ้า DAO ชนิดใดล้มเหลวให้ fail ทั้ง response ไม่คืนรายการบางส่วนหรือแสดงเป็น empty
- remove กรองทั้ง user_id จาก session และ target ID ลง relation ที่ตรงชนิด ไม่มี target lookup ก่อนลบ จึงลบซ้ำ/ไม่มี bookmark/target ถูกลบแล้วได้ saved:false เหมือนกัน
- ลบเฉพาะ relation ไม่ลบ Course, Guide, Summary, summary_files, PDF หรือ bookmark ของคนอื่น และไม่สร้างตารางหรือ save logic ชุดใหม่
- error ใช้ `{error:{code,message,fields:[]}}` และ Cache-Control no-store: 401 AUTH_REQUIRED, 422 INVALID_PARAMETERS, 503 SAVED_ITEMS_UNAVAILABLE ส่วน Node upstream ขัดข้องได้ 502 UPSTREAM_UNAVAILABLE
- เมื่อ commit หรือ response ขาดจนไม่ทราบผล ให้โหลด state/list ล่าสุดก่อนแจ้งสำเร็จหรือลองใหม่ การตอบ 503 ไม่ใช่หลักฐานว่า DB rollback สำเร็จทุกกรณี

## Schema และวิธีรัน

ใช้ initializer เดิมของ Task116 ซึ่ง import SavedSummary ก่อน `Base.metadata.create_all` ไม่เพิ่ม migration ไม่ copy/rename ตาราง saved_guides และไม่ seed ทับข้อมูลจริง ต้องมี schema U1/U3/U6/Task116 ก่อนเรียก U10

สำหรับเครื่องพัฒนาจาก backend หลังตั้ง DB_CONNECTION_STRING และ PDF storage ตาม runbook U6:

```powershell
python -m pip install -r requirements.txt
python -m app.init_db
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Docker ใช้ compose เดิมและ volume เดิม `docker compose up -d --build` จะรัน initializer ใน backend entrypoint ห้ามใช้ down -v เพื่อเตรียมหรือคืนข้อมูลทดสอบ งานนี้ยังไม่ได้รัน Docker/SQL Server จริง

## เตรียมข้อมูลทดสอบและรันซ้ำ

Fixture `saved_item_client` จาก Task116 สร้าง SQLite ใหม่ในหน่วยความจำแต่ละเคส มีบัญชี A/B, CS261, Guide และ Summary ที่มี ID เลขเดียวกัน, file metadata และ bookmark Guide เดิมของ B ชุด U10 เพิ่ม CS104 และ PDF หลายชิ้นในบางเคสเพื่อทดสอบ sort และ grouping ใช้ IDs ที่ fixture สร้างจริง ไม่ใช้ alias แทน path ID

Auth dependency เปลี่ยนเป็นบัญชีทดสอบ API auth cases ใช้ current_user จริงกับ auth test double สำหรับ token ผิด/หมดอายุ DAO, Service, HTTP routing และ SQLite SQL ใช้จริง ยกเว้น failure tests ที่ patch DAO ให้เกิด exception หลัง DELETE และจำลอง before_commit failure เพื่อตรวจ rollback PDF bytes ไม่ได้ถูกเปิดหรือจำลองว่าผ่าน storage Integration

จาก repository root:

```powershell
$env:PYTHONPATH='backend'
$env:DB_CONNECTION_STRING='DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=task118_tests;Trusted_Connection=yes;TrustServerCertificate=yes'
python -m pytest backend/test/test_saved_items_u10_api.py backend/test/test_saved_items_u10_service.py -q
python -m pytest backend/test -q
cd frontend
npm ci --ignore-scripts
npm test
```

ค่าการเชื่อมต่อข้างต้นใช้ให้ import แอปได้ ชุด SQLite ไม่ต่อ SQL Server และไม่ใช้ password/token จริง Fixture ปิด engine และคืน dependency overrides หลังจบ ไม่ลบข้อมูลในฐานเดิม ดู [รายงานผลทดสอบ](../testing/task118-unit-api-results.md)

## งานที่ต้องตรวจต่อ

ให้ผู้ตรวจต่างคน review ก่อน merge จึงยังไม่ติ๊ก DoD/artefact ข้อ PR ผ่าน review และ merge แล้ว งาน Integration U10 ต้องยืนยัน SQL Server จริง, FK/cascade และ rollback, UI grouping/open exact target, PDF bytes และการคงข้อมูลหลัง reload/session ใหม่ พร้อมบันทึก environment/auth mode/SHA และวิธีคืนข้อมูล
