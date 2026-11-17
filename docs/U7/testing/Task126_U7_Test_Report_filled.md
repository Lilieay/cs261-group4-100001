# Task126 ผลทดสอบระบบ U7 และตรวจตามเกณฑ์การยอมรับ

U7 ผ่าน System/E2E TC01–TC08 ในรอบตรวจวันที่ 17 พฤศจิกายน 2569 รวมการปฏิเสธสิทธิ์ต่างบัญชี การแก้ไข/ลบรายการที่ถูกลบจากอีกแท็บ และการย้อนข้อมูลเมื่อ SQL Server ปฏิเสธการแก้ไขหรือลบ มีผล API, SQL และ PDF ประกอบ ไม่ได้เปลี่ยนข้อกำหนด U7 หรือ application code

## 1 รุ่นระบบและสภาพแวดล้อม

| รายการ | ค่าที่ตรวจจริง |
| --- | --- |
| Repository / Branch | `Lilieay/cs261-group4-100001` / `test/task126-u7` |
| Source SHA ที่ build และทดสอบ | `f347ebb73d2139a0f9f1bfa8cb2ad504ba742da5` |
| System/E2E เริ่มและสิ้นสุด Asia/Bangkok | 17/11/2026 23:40:30–23:40:59 |
| Docker Engine / Compose | 29.8.2 / 5.5.1 |
| SQL Server / Python / Node ใน container | 16.0.4305.5 / 3.14.10 / v24.22.3 |
| Browser / Playwright Core | Chrome 157.0.8103.79 / 1.65.1 |
| Frontend ของบัญชี A / B | `http://127.0.0.1:25626` / `http://127.0.0.1:25627` |
| Backend A | `http://127.0.0.1:28626` |
| Docker project | `cs261-task126-f347ebb` |
| Authentication | TU mock; A และ B มี user ID ต่างกันใน SQL Server เดียวกัน ไม่ใช่ผลยืนยัน TU Login จริง |
| SQL / PDF | ฐานข้อมูลและ PDF volume สร้างใหม่แยกจากระบบใช้งานจริง |
| งานก่อนหน้า | [Task121 Docker integration](task121-u7-docker-integration.md) ใช้เป็น prerequisite และแนวทางจัดสภาพแวดล้อม; ผลด้านล่างมาจากการรันรอบ Task126 ใหม่ |

รอบนี้ใช้ Chrome ผ่าน Frontend proxy ไป Backend, SQL Server และ PDF storage จริง ส่วนการยืนยันตัวตนใช้ mock เท่านั้น ชุด Unit/API ใช้ test doubles ตามไฟล์ทดสอบและแยกจากผล System/E2E

## 2 ผล System และ End to End

| TC | วิธีตรวจและผลที่เกิดจริง | Status |
| --- | --- | --- |
| TC01 ดูรายการและเปิด PDF | รายการของ A ไม่แสดงสรุปของ B เปิดหน้าอ่านจากรายการที่เลือกได้ ชื่อรายการตรงและ PDF ผ่าน API มี SHA-256 ตรงกับไฟล์ตั้งต้น | PASS |
| TC02 ไม่มีรายการ | แสดง “คุณยังไม่ได้แบ่งปันสรุป PDF” และลิงก์ “แบ่งปันสรุป” ไป `upload-summary.html` | PASS |
| TC03 แก้ไขสรุป | เปลี่ยนชื่อ/คำแนะนำ/วิชาแล้ว PUT 200; รายการย้ายวิชา อยู่หลัง reload และ login ใหม่ แก้ metadata อย่างเดียวคง storage key และ checksum เดิม เปลี่ยน PDF ได้ไฟล์ใหม่และเก็บกวาดไฟล์เก่า ปีการศึกษา/ภาคเรียน/ช่วงสอบยังอยู่ | PASS |
| TC04 ข้อมูลไม่ถูกต้อง | ชื่อเป็นช่องว่างล้วนแสดง validation และไม่ส่ง PUT ข้อมูลเดิมไม่เปลี่ยน | PASS |
| TC05 ยืนยันลบ | DELETE 204; รายการหายจากหน้าของฉันและหน้าวิชา GET รายละเอียด/ไฟล์และลบซ้ำได้ 404; แถวสรุป แถวไฟล์ และ PDF จริงถูกลบ โดยสรุปและ PDF ของ B ยังอยู่ | PASS |
| TC06 ยกเลิกลบ | ปิดกล่องด้วยยกเลิก ไม่ส่ง DELETE รายการยังอยู่และ checksum ของ PDF เดิมตรง | PASS |
| TC07 ผู้ไม่มีสิทธิ์ | B ส่ง PUT และ DELETE ไป ID ของ A ได้ `403 SUMMARY_FORBIDDEN` ทั้งสองคำขอ รายละเอียดที่อ่านกลับและ snapshot SQL/storage เหมือนก่อนทดสอบ B อ่าน PDF ที่เผยแพร่ได้แต่รายการของตนไม่มีสรุป A; ไม่มี token และ token ใช้ไม่ได้ได้ 401 โดย token ใช้ไม่ได้มี `AUTH_REQUIRED` | PASS |
| TC08 รายการหายหรือทำรายการไม่สำเร็จ | ตรวจครบทั้ง stale PUT, stale DELETE, SQL UPDATE failure และ SQL DELETE failure ตามรายละเอียดหัวข้อ 3 | PASS |

ผลรวม TC01–TC08: **8/8 PASS** มี 12 จุดตรวจใน [results.json](../assets/task126/system-f347ebb/results.json) รวม regression การเขียน PDF ล้มเหลว ผลเก่ากับภาพที่แนบไว้ก่อนหน้ายังคงอยู่ใน repository แต่ตารางนี้อ้างอิงรอบใหม่ข้างต้น

## 3 หลักฐานเฉพาะ TC07 และ TC08

### TC07 สิทธิ์ต่างบัญชี

1. A สร้าง PDF และ B สร้างรายการควบคุมของตนเอง ผ่านหน้า upload จริง
2. บันทึกข้อมูล A จาก GET ที่อ่านกลับหลังจัดเก็บแล้ว และ snapshot แถวสรุป/ไฟล์กับรายการ object ใน volume
3. ใช้ session ของ B ส่ง PUT แบบ multipart ที่มีข้อมูลถูกต้อง และ DELETE ไป ID ของ A แยกกัน ทั้งคู่ได้ 403 พร้อม `SUMMARY_FORBIDDEN`
4. GET ของ A หลังคำขอทั้งสองตรงกับก่อนทดสอบ snapshot SQL/storage ไม่เปลี่ยน PDF ที่อ่านด้วย B มี checksum เดิม หน้าของ B แสดงเฉพาะผลงานของตน
5. ก่อน login เรียก `/api/my-summaries` ได้ 401 และเรียกด้วย token จำลองที่ใช้ไม่ได้ได้ `401 AUTH_REQUIRED`

หลักฐาน: [บัญชี B](../assets/task126/system-f347ebb/05-tc07-other-account.png), Method/Path/Status/Response ใน [results.json](../assets/task126/system-f347ebb/results.json) ไม่มี token หรือ cookie ในหลักฐาน

### TC08 รายการถูกลบไปแล้วจากอีกแท็บ

ทดสอบสองรายการแยกกัน โดยแท็บแรกเปิดฟอร์มแก้ไขหรือกล่องยืนยันลบค้างไว้ แล้วแท็บที่สองของ A ลบรายการเดียวกันผ่านหน้าเว็บจนได้ 204 จากนั้นกลับแท็บแรกส่งคำขอเดิม

| กรณี | ผลจริง |
| --- | --- |
| กดบันทึกจากฟอร์มเก่า | PUT ได้ `404 SUMMARY_NOT_FOUND` หน้าแสดง “ไม่พบสรุป” และโหลดรายการล่าสุด ไม่แสดงบันทึกสำเร็จ |
| ยืนยันลบจากกล่องเก่า | DELETE ได้ `404 SUMMARY_NOT_FOUND` หน้าแสดง “ไม่พบสรุป” และโหลดรายการล่าสุด ไม่แจ้งลบสำเร็จซ้ำ |
| ตรวจหลังแต่ละกรณี | GET รายละเอียด/ไฟล์และ DELETE ซ้ำได้ `404 SUMMARY_NOT_FOUND`; reload ไม่พบรายการกลับมา SQL ไม่มีแถวสรุปและแถวไฟล์ |

หลักฐาน: [stale PUT](../assets/task126/system-f347ebb/08-tc08-stale-edit.png), [stale DELETE](../assets/task126/system-f347ebb/08-tc08-stale-delete.png) และ response ใน `results.json`

### TC08 การแก้ไขและลบล้มเหลวก่อนสำเร็จ

ใช้ SQL trigger เฉพาะ ID ทดสอบบนฐานข้อมูลแยกเพื่อปฏิเสธ operation จริง แล้วถอน trigger หลังแต่ละกรณี ไม่ใช้การตัดเครือข่ายแทนผล rollback

| กรณี | ผลจริง |
| --- | --- |
| แก้ metadata พร้อมเปลี่ยน PDF แล้ว SQL ปฏิเสธ UPDATE ของแถวไฟล์ | PUT ได้ `503 STORAGE_UNAVAILABLE`; หน้าแสดงข้อผิดพลาด ข้อมูลที่อ่านกลับยังเป็นชุดเดิม snapshot storage เหมือนเดิมและ PDF checksum เดิม ไฟล์ใหม่ที่เตรียมไว้ถูกเก็บกวาด |
| ยืนยันลบแล้ว SQL ปฏิเสธ DELETE | DELETE ได้ `503 STORAGE_UNAVAILABLE`; หน้าแจ้งว่ายังยืนยันผลไม่ได้และโหลดรายการล่าสุด ไม่แสดงลบสำเร็จ กลับมาพบรายการเดิม ข้อมูล แถวไฟล์ และ PDF checksum ไม่เปลี่ยน หลัง reload ยังอยู่ |

หน้าเว็บถือ 5xx เป็นผลที่ต้องตรวจสถานะล่าสุดก่อนทำซ้ำ การแสดงข้อความดังกล่าวสอดคล้องกับพฤติกรรมนี้ ส่วนการยืนยันว่าไม่มีการ commit มาจาก SQL trigger และการอ่าน SQL/PDF หลังคำขอ

หลักฐาน: [UPDATE failure](../assets/task126/system-f347ebb/06-tc08-update-failure.png), [DELETE failure](../assets/task126/system-f347ebb/07-tc08-delete-failure.png), response และ snapshot ใน `results.json`

## 4 Test Levels และ Regression

| ระดับ | ชุดที่รันในรอบนี้ | ผล |
| --- | --- | --- |
| Frontend Unit / proxy | `npm test` ภายใน Frontend image ของ SHA ที่ระบุ รวม U7 client, form และ proxy | 104 ผ่าน, 0 ล้มเหลว, 0 ข้าม |
| Backend Unit / API | `test_my_summaries_with_u6.py`, `test_my_summary_update_schema.py`, `test_my_summary_form.py`, `test_summaries_api.py`, `test_summary_api_errors.py`, `test_summary_storage.py` | 125 ผ่าน และ 16 subtests ผ่าน; มี Starlette/httpx deprecation warning 1 รายการ ไม่ใช่ test failure |
| System / Integration | `scripts/task126-u7-browser.cjs` ผ่าน Chrome → proxy → Backend → SQL/PDF จริง | TC01–TC08 ผ่านครบ; JSON มี 12 จุดตรวจ |
| Regression PDF write failure | เปลี่ยนสิทธิ์ volume แยกเป็นอ่านอย่างเดียวชั่วคราว แล้วแก้ข้อมูลพร้อมแนบ PDF ใหม่ | 503 `STORAGE_UNAVAILABLE`; ฟอร์มยังมีค่าที่กรอกและไฟล์ที่เลือก SQL/PDF เดิมยังอยู่ คืน permission เดิมแล้ว |
| Regression การเผยแพร่/อ่าน/รายการวิชา | สร้าง PDF ใหม่ผ่าน UI เปิดไฟล์ เปลี่ยนวิชา ตรวจหน้ารายวิชา และตรวจสรุปของ B หลังลบ A | ผ่านในรอบเดียวกัน |

คำสั่ง รุ่นเครื่องมือ จำนวนผล และ SHA-256 ของ runner อยู่ใน [verification.json](../assets/task126/system-f347ebb/verification.json) ผล Unit/API ใช้ SQLite และ adapters ของชุดทดสอบ ไม่ใช้แทนหลักฐาน SQL Server จริงในหัวข้อ 2–3

## 5 ผลตรวจตามเกณฑ์การยอมรับ

| เกณฑ์ | ผลที่ตรวจได้จากรอบนี้ | Status |
| --- | --- | --- |
| แสดงรายการของบัญชีที่ login | แยกรายการ A/B และแสดง empty state ได้ | PASS |
| เปิด PDF ที่ตรงรายการ | หน้าอ่านและ checksum ตรงไฟล์ที่เลือก | PASS |
| แก้ไขแล้วข้อมูลอยู่หลังโหลดใหม่ | ชื่อ/วิชา/ไฟล์ถูกต้องหลัง reload และ login ใหม่ | PASS |
| ยกเลิกและยืนยันลบ | ยกเลิกไม่มีคำขอลบ ยืนยันแล้วข้อมูลและไฟล์หาย | PASS |
| ป้องกันสิทธิ์และแจ้งข้อผิดพลาด | ต่างบัญชี 403, ไม่มีสิทธิ์ login 401, รายการหาย 404, บันทึก/ลบล้มเหลว 503; ไม่แจ้งสำเร็จลวง | PASS |

**ผลตรวจตามเกณฑ์การทำงาน:** ผ่านในสภาพแวดล้อมที่ระบุข้างต้น

**ผลตรวจรับจาก Product Owner:** PO รับงาน U7 ตามเกณฑ์ TC01–TC08 วันที่ 17 พฤศจิกายน 2569

**หลักฐานประกอบการตรวจรับ:** ผล System/E2E, API, SQL และ PDF ในหัวข้อ 2–4 ยืนยันว่า TC01–TC08 ผ่านครบในสภาพแวดล้อมที่ระบุ

## 6 Defects และการคืนสภาพแวดล้อม

ไม่พบ application defect ในกรณีที่รันรอบนี้ ไม่ได้แก้ application code ระหว่างทดสอบ มีการปรับ runner ก่อนรอบที่ผ่านให้เปรียบเทียบข้อมูลที่อ่านกลับจาก SQL Server รองรับการสร้างหลายแท็บ และตรวจข้อความหลัง 5xx ตามพฤติกรรมโหลดรายการล่าสุดของหน้าเว็บ

หลังจบถอน SQL trigger ทดสอบ คืนสิทธิ์ PDF root เป็น 755 และลบ fixture ที่สร้างเองแล้ว ตรวจ `summaries = 0`, `summary_files = 0`, test triggers = 0 และ PDF objects ว่าง ผลอยู่ใน [cleanup.json](../assets/task126/system-f347ebb/cleanup.json) ปิดเฉพาะ containers/network ของ project ทดสอบหลังเก็บหลักฐาน เก็บ volumes ไว้

## 7 วิธีรันซ้ำ

ใช้ source SHA ข้างต้นกับ runner ที่แนบใน PR นี้ ตั้ง project และ ports ตามหัวข้อ 1 และตั้ง `MSSQL_SA_PASSWORD` เป็นค่าใหม่ใน environment ของ process ก่อนเปิด Compose ห้ามใช้ฐานข้อมูลหรือ PDF volume ที่มีข้อมูลใช้งาน สร้าง project แยกซึ่งชื่อขึ้นต้น `cs261-task126-` และมีฐานข้อมูลว่าง

```powershell
$env:TU_API_MODE = 'mock'
$env:SQLSERVER_HOST_PORT = '21626'
$env:BACKEND_HOST_PORT = '28626'
$env:FRONTEND_HOST_PORT = '25626'
$project = 'cs261-task126-f347ebb'
docker compose -p $project up -d --build --wait
docker compose -p $project run -d --no-deps --name "$project-backend-b" -e TU_MOCK_USERNAME=6800000001 backend
docker compose -p $project run -d --no-deps --name "$project-frontend-b" -e "BACKEND_URL=http://${project}-backend-b:8000" -p 127.0.0.1:25627:5000 frontend
```

รอ Backend B พร้อม แล้วใช้ Node กับ Playwright Core 1.65.1 และ Chrome ที่ติดตั้งในเครื่อง โดยกำหนด path ของ package และที่เก็บหลักฐานใหม่ให้ตรงกับเครื่อง

```powershell
$env:TASK126_PROJECT = $project
$env:TASK126_PLAYWRIGHT = '<absolute path to playwright-core>'
$env:TASK126_EVIDENCE = '<absolute path to new evidence directory>'
node scripts/task126-u7-browser.cjs
```

สคริปต์ใช้บัญชี mock สองบัญชีและ PDF ที่สร้างขึ้นเอง เปลี่ยน permission/สร้าง trigger เฉพาะใน project ทดสอบ คืน permission และถอน trigger ใน `finally` และลบรายการที่สร้างเอง เก็บ stdout, `results.json` และตรวจ SQL/storage หลังจบ ก่อนปิดชุดทดสอบด้วย `docker compose -p $project down --remove-orphans` โดยไม่ลบ volumes

**สถานะ Task126:** เสร็จสิ้น — System/E2E และ regression ที่ระบุผ่าน พร้อมหลักฐาน TC01–TC08 และ PO รับงานแล้ว
