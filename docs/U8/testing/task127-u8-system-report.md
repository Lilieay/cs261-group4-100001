# Task127 — System/E2E และการตรวจรับ U8

**สถานะ: System/E2E ผ่าน และ PO รับ U8 แล้ว**

ทดสอบวันที่ 17 พฤศจิกายน 2569 (Asia/Bangkok) ใช้ฐาน `sprint2` ที่ `0c63713` ซึ่งรวม Task122 PR #132 ที่ผ่าน review แล้ว รอบแก้ตาม review ใช้ชุด System ที่ `a945503` ผลแต่ละ TC พร้อม expected/actual/status และลิงก์ภาพอยู่ใน [system-results.json](../assets/task127/system-results.json) และ [ตาราง CSV](task127-tc-results.csv) เวลา JSON เป็น UTC

## ผลและขอบเขต

- System/E2E: **18/18 แถวผ่าน** คือ U8-TC01–TC09 แยก Guide และ PDF ทุกกรณี ไม่มีการข้ามทั้ง TC
- Unit/API Backend ของ U8 ที่รันเพิ่ม: **106 ผ่าน** ใช้ SQLite/auth test double และ mock DAO/session ใน Unit ไม่ใช่ผล SQL Server
- Regression Frontend เฉพาะรีวิว: **9 ผ่าน** ใช้ test harness จำลอง browser/network แยกจาก System จริง
- Guard/cleanup ของ System runner: **11 ผ่าน** ตรวจ metadata ผิด port/project/service/TTL/auth, การลบ fixture ที่เหลือต่อเมื่อ DELETE ล้ม และการรักษา exception ต้นเหตุ ใช้ test doubles เฉพาะ helper ไม่ใช่ผล SQL/System จริง
- System ใช้ Chrome 142.0.7444.176, Docker 29.8.2, SQL Server 2022 16.0.4305.5 และ PDF volume จริง Login เป็น **TU mock** ไม่ได้เชื่อม TU จริง
- การทดสอบ token หมดอายุใช้ Backend แยกที่ TTL 1 วินาที ออก session ผ่าน Login API จริง รอให้หมดอายุแล้วตรวจ HTTP 401 ไม่ใช้ token ปลอมหรือ mock เวลา
- Cleanup ผ่าน แถวข้อมูลกับไฟล์/checksum กลับเท่า baseline หลัง Login ไม่มี trigger ทดสอบค้าง บัญชี mock คงไว้รันซ้ำ
- มติ UAT **รับ** บันทึกวันที่ 17 พฤศจิกายน 2569 ดู [บันทึกผล UAT](task127-uat-record.md)

## TC และระดับทดสอบที่รองรับ

อ้างเกณฑ์ [Task97 รุ่น 0.3](../requirements/task97-u8-requirements-and-test-cases.md), API [Task94](../../shared/api-contract/task94-api-contract.md), [Unit/API Task114](task114-unit-api-results.md) และ [Integration Task122](task122-u8-docker-integration.md)

| TC | Unit/API ที่รองรับ | Integration Task122 | System/E2E รอบนี้ ทั้ง Guide/PDF |
| --- | --- | --- | --- |
| TC01 | `test_lifecycle_and_isolation` | สร้าง/อ่าน/โหลดใหม่/login ใหม่ | ให้ 5 ดาวพร้อมข้อความ ผ่าน UI อ่านหลัง reload/login ใหม่ และบัญชี X เห็นรีวิวเดียวกัน |
| TC02 | `test_payload_valid_boundaries`, comment boundaries | สร้างรีวิวไม่มีข้อความระหว่างทดสอบสร้างใหม่ | ให้ 1 และ 5 ดาวโดยไม่เขียนข้อความ แยกข้อมูลก่อนแต่ละคะแนน ตรวจ null และ UI หลัง reload |
| TC03 | `test_payload_rejects_invalid_rating`, `test_invalid_rating_on_create_and_update` | ทศนิยมกับข้อความเกินขอบเขต | UI ไม่ส่ง POST เมื่อไม่เลือกดาว; ส่ง missing/0/6/-1/2.5 ผ่าน HTTP จาก browser ทั้ง POST/PUT ได้ 422 และข้อมูลเดิมไม่เปลี่ยน |
| TC04 | lifecycle และ validation | แก้รีวิวเดิม | แก้ดาวอย่างเดียว ข้อความอย่างเดียว ทั้งสองอย่าง และล้างข้อความ ผ่าน UI ตรวจ ID/author/target เดิมและอ่านหลัง reload |
| TC05 | lifecycle/isolation | ลบ/ยกเลิกลบ ไม่กระทบอีกผลงาน | มีรีวิว R และ X บน target เดียวกัน ยกเลิกแล้วคงอยู่ ลบ R แล้วตรวจ GET 200 ว่าไม่มี ID ของ R แต่มี ID ของ X จากนั้นโหลดหน้าใหม่ เห็นรีวิวของ X เพียงรายการเดียว ไม่มี own entry ของ R ตัวผลงาน/ไฟล์ยังอยู่ และ PDF blob ตรง fixture |
| TC06 | `test_authentication`, forbidden fields, isolation | สองบัญชี/401/403 | X แก้/ลบของ R ได้ 403; ไม่มี token/หมดอายุจริงได้ 401 สำหรับ POST/PUT/DELETE; ปลอม author ใน POST/PUT ได้ 422 และอ่านรีวิวผู้อื่นได้ |
| TC07 | `test_self_review_and_missing_target`, business rules | owner UI และ self 403 | เจ้าของไม่มีปุ่มเพิ่ม เห็นข้อความห้ามรีวิวตนเอง ส่ง POST ตรงได้ 403 ไม่เพิ่มแถว |
| TC08 | lifecycle, `test_same_id_targets_are_distinct` | POST ซ้ำ/พร้อมกัน, filtered unique indexes | POST ซ้ำได้ 409 ไม่เปลี่ยนรีวิวเดิม control target ยังว่าง และหลังลบสร้างใหม่ได้ใน TC05 |
| TC09 | rollback/read/commit failures และ missing target | SQL write failures/refresh/cascade จริง | SQL ปฏิเสธ create/update/delete ได้ 503 หน้าแสดง error; หลัง PUT 503 มี GET 200 พร้อม ID/rating/comment เดิม ปิดฟอร์มแล้วเห็นรีวิวเดิมบนหน้า; target ถูกลบแล้ว GET/POST ได้ GUIDE_NOT_FOUND หรือ SUMMARY_NOT_FOUND ตรงชนิด ส่วน PUT/DELETE ได้ REVIEW_NOT_FOUND และ control target ไม่เปลี่ยน |

System TC03/06/08 บางขั้นตอนยิง HTTP จาก browser หรือ Playwright request client เพื่อพิสูจน์ว่า Backend ไม่พึ่งการซ่อนปุ่ม TC06 กรณี TTL ใช้ HTTP ไป Backend อายุสั้นโดยตรง จัดเป็น System security check ไม่ใช่การกด UI และไม่ใช่ mock

กรณี Guide/Summary มี ID เท่ากันรองรับด้วย Unit/API `test_same_id_targets_are_distinct` รอบ System ใช้ ID ที่ API สร้างจริง ไม่บังคับเลขให้เท่ากัน เงื่อนไข comment 2,000/2,001 Unicode code points และ protocol/UTF-8 ใช้ผล Unit/API ที่รันซ้ำ ไม่อ้างว่าทุก EXT ผ่าน UI ใน Task127

## Regression ที่ตรวจ

1. Guide เปิดจากหน้าอ่านและเรียก alias เดิมได้ สรุป PDF เปิด blob จริงได้ ก่อน/หลังจัดการรีวิว metadata กับไฟล์ทั้งหมดต้องเท่าเดิมก่อนลบ target เพื่อทดสอบ 404
2. หลังลบรีวิวของ R รีวิวของ X ในผลงานเดียวกันยังอยู่ และอีก target ไม่มีรีวิวหลงไปแสดง ตรวจ SQL และ UI
3. หลัง API ปฏิเสธการแก้ SQL ยังเป็นข้อมูลเดิม หน้าแสดง error และโหลดรีวิวใหม่ ไม่แจ้งสำเร็จลวง
4. Frontend regression tests 9 เคสตรวจ no-op 503, profile failure/retry, review ID ที่เปลี่ยน และการอ้างผลคำขอเมื่อ network/storage ยังยืนยันผลไม่ได้

ไม่ใช้ผล Unit/API หรือ Frontend จำลองรับรอง SQL/PDF จริง ส่วน SQL failure ของ System ใช้ trigger ที่จำกัด target ทดสอบ ไม่ได้จำลองการตัด connection Backend–SQL ระหว่าง commit และ TU Login จริงอยู่นอกผลรับรองรอบนี้

## เตรียมและรันซ้ำ

ใช้ [Compose เดิม](../../../compose.yaml) กับ [override Task127](../../../compose.task127.yaml) ตั้งไฟล์ `.env` ทดสอบที่ไม่ commit:

```dotenv
MSSQL_SA_PASSWORD=<ตั้งรหัสผ่าน SQL สำหรับชุดทดสอบ>
SQLSERVER_HOST_PORT=28433
BACKEND_HOST_PORT=34800
FRONTEND_HOST_PORT=31800
TU_API_MODE=mock
```

```powershell
$task127Project = 'cs261-task127-0c63713'
docker compose --env-file .env -p $task127Project -f compose.yaml -f compose.task127.yaml up -d --build --wait
docker compose --env-file .env -p $task127Project exec -T backend python -m scripts.init_reviews
$task127Tools = Join-Path $env:TEMP 'cs261-task127-tools'
npm.cmd install --prefix $task127Tools --no-audit --no-fund playwright-core@1.65.1
$env:TASK127_PLAYWRIGHT = Join-Path $task127Tools 'node_modules/playwright-core'
$env:TASK127_PROJECT = $task127Project
$env:TASK127_EVIDENCE = Join-Path $env:TEMP 'cs261-task127-evidence'
node scripts/task127-u8-system.cjs
```

`init_reviews` รันเฉพาะครั้งแรกหลัง schema U6 เดิม ถ้าตารางมีอยู่แล้วให้ตรวจตาม Task114 และข้ามคำสั่ง ห้ามลบตารางเพื่อเริ่มใหม่ ตรวจ LF ของ entrypoint เมื่อใช้ Windows

บัญชี owner/R/X คือ `6800000000` / `6800000001` / `6800000002` รหัสผ่าน mock `0000000000000` เข้า Frontend 31800/31801/31802 ตามลำดับ ใช้ user IDs ต่างกัน ฐานเดียวกัน บัญชี `6800000003` อยู่บน Backend พอร์ต 34803 สำหรับ TTL 1 วินาทีเท่านั้น ไม่ใช้เป็นบัญชี UAT

สคริปต์สร้าง Guide/PDF ตาม API เดิม ตั้งชื่อ Task127 พร้อม timestamp สร้าง PDF เอง ไม่ใช้ข้อมูลหรือ secret ของมหาวิทยาลัย ตรวจ project/port/proxy ก่อน Login เก็บ baseline หลังสร้าง session แล้ว cleanup เฉพาะ target ของรอบนั้นผ่าน API เจ้าของ Trigger ลบเฉพาะที่รอบนี้สร้าง หากหยุด process กลางทางให้ตรวจชื่อ/ID/เจ้าของก่อนคืน fixture ไม่ล้างตารางหรือ volume

รอบแก้เพิ่ม preflight ของ `backend-expiring` โดยตรวจ project/service, running state, เจ้าของพอร์ต 34803, mock auth และ TTL 1 วินาทีก่อน Login โดยตรง เก็บ Docker metadata ที่ตรวจแล้วใน `environment.expiringBackend` หาก cleanup ลบหนึ่ง fixture ไม่สำเร็จ จะลองรายการที่เหลือต่อ พร้อมเก็บ `cleanupErrors` และ `remainingFixtures` ใน JSON และแสดง IDs บน stderr ข้อผิดพลาด TC ต้นเหตุยังเป็น error เดิม ไม่ถูก cleanup กลบ การรันที่ cleanup ล้มยัง exit nonzero และไม่ผ่าน

รันทดสอบ guard/cleanup เพิ่มจาก root ด้วย `node --test scripts/task127-support.test.cjs` ผลรอบแก้ 11 ผ่าน; การจำลอง cleanup error ใช้ helper tests ส่วน System เต็มรอบใหม่ตรวจ cleanup จริงตาม baseline

รัน Unit/API จาก `backend/` ด้วย Python environment ที่มี requirements และแยก PDF root ว่างเพื่อไม่อ่าน marker จากการรันอื่น:

```powershell
$env:DB_CONNECTION_STRING='DRIVER={UNIT_TEST_DO_NOT_CONNECT};SERVER=unit'
$env:PDF_STORAGE_ROOT=Join-Path $env:TEMP 'cs261-task127-unit-pdfs'
python -m pytest test/test_reviews_unit.py test/test_reviews_api.py -q --disable-warnings --maxfail=1
```

DB string นี้เป็น placeholder ที่ไม่เชื่อมจริง ชุด API เปลี่ยน session เป็น SQLite ตาม fixture ส่วน Frontend จาก root repo ใช้ `node --test frontend/src/reviews.test.js` ผลรอบนี้ Backend 106 ผ่าน/1 warning, Frontend 9 ผ่าน; host Python 3.12.14, pytest 9.2.0, Node 26.12.0

ปิดเฉพาะชุดทดสอบหลังเก็บหลักฐานด้วย `docker compose --env-file .env -p $task127Project -f compose.yaml -f compose.task127.yaml down --remove-orphans` โดยคง volumes ไว้รันซ้ำ

## บันทึกการตรวจรับ

ดู [บันทึกการตรวจรับ](task127-uat-record.md) สำหรับมติ PO และผลรอบตรวจยืนยันผ่าน Chrome ที่ SHA `6591b5b4d64fecfb9ec9b03bac43a9452ea81e3e` ครบ 18/18 เคส พร้อม [ผล JSON ใหม่](../assets/task127/uat-6591b5b/system-results.json) และผลคืนข้อมูล
