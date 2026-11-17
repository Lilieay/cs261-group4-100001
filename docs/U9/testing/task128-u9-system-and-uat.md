# ผลทดสอบระบบและตรวจรับ U9 Task128

ทดสอบวันที่ 17 พฤศจิกายน 2569 (เวลาไทย) บน branch `test/task128-u9` จาก `sprint2` ที่ SHA `0c63713d6764e95b7f19a8edc980b3420d2e8f13` ซึ่งรวม Task123 ผ่าน PR #136 แล้ว ใช้ Chrome 157.0.8103.51, Playwright Core 1.65.1, Node 24.21.0, Docker Engine 29.8.2 และ SQL Server 2022 16.0.4295.3

ผู้ทดสอบใช้บัญชีสังเคราะห์ A และ B จากหน้า Login ผ่าน TU mock ซึ่งให้คนละ user ID คำขอระบบวิ่งจาก Chrome ผ่าน Express ไป FastAPI, SQL Server และ PDF volume จริงใน Compose project แยกจากฐานที่ใช้งาน

## การเทียบเลขเคสใน Trello กับมติ PO

[Task98 ส่วน 5.1 และ 5.2](../requirements/Task98_U9_Requirements_and_Test_Cases_PO_Content_Updated.md#5-u9-test-cases) ระบุว่า TC01–TC05 อ้างการบันทึกทั้งรายวิชา จึงบันทึกเป็น N/A สำหรับการตรวจรับรุ่นนี้และทดสอบกรณีตามมติ PO ปัจจุบันแทน

| เลขใน Trello | Expected ตามเกณฑ์เดิม | Actual ในรุ่นที่ทดสอบ | สถานะ |
| --- | --- | --- | --- |
| U9-TC01 | บันทึกทั้งวิชา | ผู้ใช้บันทึก Guide หรือ PDF ทีละชิ้นและเห็นรายการหลังล็อกอินใหม่ ตรวจด้วย TC06–TC07 | N/A |
| U9-TC02 | บันทึกวิชาที่ไม่มีผลงาน | วิชาเป็นกลุ่มของผลงานที่บันทึก Task98 ใช้ TC06–TC07 แทน | N/A |
| U9-TC03 | บันทึกวิชาเดิมซ้ำได้หนึ่งรายการ | งดซ้ำที่ระดับประเภทและ ID ผลงาน ตรวจด้วย TC09 | N/A |
| U9-TC04 | ปฏิเสธการบันทึกทั้งวิชาเมื่อสิทธิ์หรือวิชาผิด | ตรวจสิทธิ์และพารามิเตอร์ที่ระดับผลงานด้วย TC10 | N/A |
| U9-TC05 | บันทึกทั้งวิชาล้มเหลวและไม่ขึ้นข้อความสำเร็จ | ตรวจข้อความและข้อมูลคงเดิมที่ระดับผลงานด้วย TC11 | N/A |

## System และ End-to-End

ผลดิบจากสคริปต์อยู่ใน [results.json](../assets/task128/results.json) ภาพถ่ายจากชุด Docker เดียวกัน

| Test case | Expected | Actual | Status | หลักฐาน |
| --- | --- | --- | --- | --- |
| U9-TC06 | บันทึก Guide ได้ รายการอยู่ครบหลัง reload และล็อกอินใหม่ | กดบันทึกจากหน้าอ่านได้ 200 การ์ดอยู่ใต้ CS261 หลัง reload และล็อกอินใหม่ SQL มีหนึ่ง bookmark ของ A | Pass | [Guide หลังล็อกอินใหม่](../assets/task128/U9-TC06-after-relogin.png) |
| U9-TC07 | บันทึก PDF ได้ รายการอยู่ครบหลัง reload และล็อกอินใหม่ | ตัวอ่านเปิด PDF จาก volume จริง กดบันทึกได้ 200 การ์ดอยู่ใต้ CS261 หลัง reload และล็อกอินใหม่ SQL มีหนึ่ง bookmark ของ A | Pass | [PDF หลังล็อกอินใหม่](../assets/task128/U9-TC07-after-relogin.png) |
| U9-TC08 | Guide และ PDF อยู่ในกลุ่มวิชาที่ถูกต้อง | บันทึก Guide และ PDF ของ CS261 กับ CS101 ได้ 4 การ์ดใน 2 กลุ่ม ตรวจทั้ง course ID และรหัสวิชาของแต่ละการ์ด รวมถึงตัวนับรีวิวครบ 4 ใบ | Pass | [การ์ดสองกลุ่มวิชา](../assets/task128/U9-TC08-two-course-groups.png) |
| U9-TC09 | PUT ซ้ำได้ 200 และคงหนึ่ง bookmark ต่อชิ้น | PUT ซ้ำสองครั้งได้ 200 ทั้ง Guide และ PDF กดบันทึกซ้ำบนหน้าอ่านแล้วขึ้น “ได้บันทึกการแบ่งปันนี้ไปแล้ว” และ SQL ยังมีหนึ่งแถวต่อชิ้น | Pass | [Guide](../assets/task128/U9-TC09-guide-duplicate.png) · [PDF](../assets/task128/U9-TC09-summary-duplicate.png) |
| U9-TC10 | คำขอไม่มีสิทธิ์หรือผลงานไม่ถูกต้องถูกปฏิเสธ | ผ่าน proxy จริงทั้งสองชนิด ไม่ส่ง token, token ผิด และ token ที่ถูกยกเลิกหลัง logout ได้ 401 ชนิด/ID ผิดหรืออ้างบัญชี B ใน body/query ได้ 422 ผลงานไม่มีอยู่ได้ 404 ตามชนิด บัญชี B ยังว่างและ bookmark ของ A ยังอยู่ | Pass | [ผลตรวจ HTTP และ SQL](../assets/task128/results.json) |
| U9-TC11 | เขียนล้มเหลวก่อน commit แล้ว UI แจ้งข้อผิดพลาดและข้อมูลคงเดิม | Trigger SQL ปฏิเสธการบันทึกของ B จากหน้าอ่านทั้งสองชนิด ได้ 503 `SAVED_ITEMS_UNAVAILABLE` หน้าอ่านอ่านสถานะซ้ำได้ `saved:false` และแสดงข้อผิดพลาด ส่วน bookmark ของ A ยังอยู่ | Pass | [Guide 503](../assets/task128/U9-TC11-guide-sql-rejected.png) · [PDF 503](../assets/task128/U9-TC11-summary-sql-rejected.png) |
| U9-TC12 | รายการเดิมและรายการใหม่แสดงร่วมกันโดยไม่ซ้ำ | บันทึก Guide ผ่าน `/api/saved-guides` แล้วบันทึก PDF จากหน้าอ่าน พบทั้งสองในกลุ่ม CS261 การ PUT Guide ผ่าน saved-items ซ้ำยังคงหนึ่ง bookmark | Pass | [รายการ Guide เดิมและ PDF](../assets/task128/U9-TC12-legacy-and-summary.png) |

หลังทดสอบลบเฉพาะผลงานที่ชุดทดสอบสร้าง และเทียบข้อมูลในตารางผลงาน/ไฟล์/bookmark รวมถึง SHA-256 ของไฟล์ใน volume กับค่าก่อนรัน ผลตรงกันและ trigger ทดสอบถูกนำออก

## Unit, API, Integration และ Regression ที่เกี่ยวข้อง

| ระดับ | ผลรอบนี้ | กรณีที่รองรับ |
| --- | --- | --- |
| Frontend unit และ proxy | 104 ผ่าน | [อ่านและบันทึก PDF](../../../frontend/src/read-summary.test.js) ครอบคลุม TC07/TC11 รวมถึง refresh สถานะตอนกลับมาโฟกัส [รายการที่บันทึก](../../../frontend/src/saved-courses.test.js) ครอบคลุม TC08/TC09/TC12 และกรณีกลับมาหลังเปิดรายการที่ถูกลบได้ 404 |
| Backend unit และ API | 480 ผ่าน, 6 ข้าม และ 81 subtests ผ่าน | [Service](../../../backend/test/test_saved_items_service.py) และ [API Guide/PDF](../../../backend/test/test_saved_items_api.py) รองรับ TC06/TC07/TC09–TC12 [API รายการ](../../../backend/test/test_saved_items_u10_api.py) รองรับ TC08/TC10/TC12 [Auth unit](../../../backend/test/test_auth.py) ตรวจหมดอายุจากเวลา ส่วน System Test ตรวจ token ผิดและ token ที่ถูกยกเลิกจริงหลัง logout |
| SQL Server Integration | 3 ผ่านเมื่อเปิด `U9_TEST_SQLSERVER` และ `TASK116_TEST_SQLSERVER` | [PUT พร้อมกันและผลงานถูกลบระหว่างบันทึก](../../../backend/test/test_saved_items_sqlserver.py) รองรับ TC09/TC10 [บันทึกและอ่านสถานะทั้งสองชนิดบน SQL Server](../../../backend/test/test_saved_items_sqlserver_integration.py) รองรับ TC06/TC07 |
| Task123 Browser Integration | รันซ้ำผ่านทั้ง Guide และ PDF บน Docker ชุดเดียวกัน [บันทึกผลรันซ้ำ](../assets/task128/task123-regression.txt) · [ผลเดิมจาก Task123](task123-u9-docker-integration.md) | TC06/TC07/TC09/TC11 และ regression ผลตอบกลับ PUT หายหลังเขียนสำเร็จ, การอ่านใหม่ และ 404 หลังลบผลงาน |

## ข้อพบและการทดสอบซ้ำ

- สองรอบแรก Playwright รอ PUT ของ PDF หรือรอไปหน้ารายการเกินเวลา ปรับการทดสอบให้รอปุ่มพร้อมและใช้ Enter กับปุ่มและลิงก์จริง แล้วรันใหม่ผ่าน TC06–TC12 บน SHA เดิม
- การตั้งค่า Docker เริ่มต้นให้คะแนนรีวิวตอบ 503 จนลง schema รีวิวด้วย `scripts.init_reviews` ตาม [วิธีรัน Task122](../../U8/testing/task122-u8-docker-integration.md) หลังตั้งค่าแล้ว TC08 เห็นตัวนับรีวิวครบ 4 การ์ด

## วิธีรันซ้ำ

เปิด Docker Desktop แล้วรันจากโฟลเดอร์ repo ที่รุ่นเดียวกับรายงาน ใช้ `.env` ของชุดทดสอบที่ตั้ง `MSSQL_SA_PASSWORD` แล้ว คำสั่งนี้ใช้พอร์ตแยกและสร้าง SQL/PDF volume ภายใต้ชื่อ Compose project ที่ระบุ

```powershell
$env:SQLSERVER_HOST_PORT = '24433'
$env:BACKEND_HOST_PORT = '30800'
$env:FRONTEND_HOST_PORT = '27800'
$env:TU_API_MODE = 'mock'
$project = 'cs261-task123-task128-0c63713'
docker compose -p $project up -d --build --wait
docker compose -p $project run -d --no-deps --name "$project-backend-b" -e TU_MOCK_USERNAME=6800000001 backend
docker compose -p $project run -d --no-deps --name "$project-frontend-b" -e "BACKEND_URL=http://$project-backend-b:8000" -p 127.0.0.1:27801:5000 frontend
```

ถ้าเป็น SQL volume ใหม่ ให้สร้างตารางรีวิวตาม Task122 หนึ่งครั้งด้วย `docker compose -p $project exec -T backend python -m scripts.init_reviews` เมื่อ Backend ทั้งสองตัว healthy ให้รัน

```powershell
$toolPath = Join-Path $env:TEMP 'cs261-task128-tools'
npm.cmd install --prefix $toolPath --no-audit --no-fund playwright-core@1.65.1
$env:TASK123_PLAYWRIGHT = Join-Path $toolPath 'node_modules/playwright-core'
$env:TASK123_PROJECT = $project
$env:TASK128_EVIDENCE = Join-Path $env:TEMP 'cs261-task128-evidence'
node scripts/task128-u9-system.cjs
```

หากต้องการทำซ้ำ regression ของ Task123 ให้รัน `node scripts/task123-u9-browser.cjs` หลังชุด Task128 จบ โดยใช้ตัวแปร `TASK123_PROJECT` และ `TASK123_PLAYWRIGHT` เดิม

สคริปต์ตรวจ project และพอร์ตก่อนเปิดเบราว์เซอร์ แล้วสร้างและลบข้อมูลทดสอบรายรอบ หากจะปิดชุดทดสอบให้ใช้ `docker compose -p $project down --remove-orphans` เพื่อเก็บ volumes ไว้สำหรับรันรอบถัดไป

## UAT กับ PO

สถานะ **รอ PO ทดสอบและยืนยันผล** ช่องผู้ตรวจ วันเวลา และผลตรวจรับยังรอผลจริง

| รายการ | ค่าที่บันทึก |
| --- | --- |
| PO และผู้ร่วมทดสอบ | รอระบุ |
| วันและเวลาตรวจรับ (Asia/Bangkok) | รอระบุ |
| รุ่นระบบที่ใช้ตรวจรับ | รอยืนยัน SHA ตอนเริ่ม UAT |
| ขอบเขต | ให้ PO บันทึก Guide และ PDF จากหน้าอ่าน ตรวจหลัง reload และล็อกอินใหม่ เปิดรายการจากกลุ่มวิชา และตรวจบันทึกซ้ำกับข้อความแสดงความล้มเหลว |
| ผลและหลักฐานการตัดสินใจ | รอบันทึกผลจริงและลิงก์หลักฐาน |
