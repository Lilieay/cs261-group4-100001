# Task129 — U10 System Test และการตรวจรับ

รุ่นเอกสาร 0.2 · 17 พฤศจิกายน 2569 (Asia/Bangkok)

## ขอบเขตและสถานะ

รายงานนี้เชื่อมหลักฐาน Unit/API/Integration และ System ของ U10-TC01–TC06 ตาม Task99 รุ่นล่าสุดกับ source SHA `0c63713d6764e95b7f19a8edc980b3420d2e8f13` ซึ่งเป็น `sprint2` ที่ทดสอบ.

**สถานะ Task129: System/E2E และ regression ผ่าน; รอ UAT จาก PO ก่อนปิด DoD** — รัน stack แยก, Browser/API/SQL Server tests และ U10 Unit/API บน SHA ปัจจุบันแล้ว โดยใช้ TU mock สองบัญชี (ไม่ใช่ TU จริง) ยังไม่มีบันทึก UAT ที่ PO ตรวจจริง จึงยังปิดงานไม่ได้

## รุ่นและสภาพแวดล้อมของหลักฐานเดิม

| ชั้น | รุ่นที่รันจริง | สภาพแวดล้อม/โหมด Login | หลักฐาน |
|---|---|---|---|
| Unit/API U10 | `0c63713d6764e95b7f19a8edc980b3420d2e8f13` | Windows, Python 3.12.14, pytest 9.1.1; API ใช้ SQLite fixture; auth dependency เป็น test double; Unit ใช้ fake DAO/Session | **43 passed, 1 Starlette/httpx deprecation warning**, 1.32 วินาที |
| Frontend regression | `0c63713d6764e95b7f19a8edc980b3420d2e8f13` | Node.js 24.22.3; proxy tests ใช้ local TCP mock servers | **104 passed, 0 failed**, 0.60 วินาที |
| Safety guard tests | `0c63713d6764e95b7f19a8edc980b3420d2e8f13` | Node.js 24.22.3; Docker metadata mocked เฉพาะ guard test | **10 passed, 0 failed**, 0.07 วินาที; เป็น guard/unit evidence ไม่ใช่ System proof |
| Browser/Integration/System E2E | `0c63713d6764e95b7f19a8edc980b3420d2e8f13` | Docker Engine 29.9.3; SQL Server 2022 16.0.4325.4; Chrome 157.0.8103.79; Playwright Core 1.65.1; TU mock สองบัญชี; Backend, SQL Server และ PDF volume จริง | [ผล JSON](../assets/task129/results.json), [ผล TC01/TC05](../assets/task129/boundary-results.json), [ภาพหลักฐาน](../assets/task129/) |
| UAT กับ PO | — | **ยังไม่ได้ตรวจรับ** | รอ PO/ผู้ทดสอบบันทึกผลจริงด้านล่าง |

ผล Unit/API รอบนี้ยืนยันชุด U10 43 passed, 1 warning (Starlette แจ้ง deprecation ของการใช้ httpx กับ TestClient); ไม่ได้รัน Backend test suite ทั้งหมดใน Task129. Frontend regression มี 104 passed, 0 failed. System/E2E ใช้ SQL Server และ PDF volume จริง แต่ Login ใช้ TU mock; จึงไม่ใช่การยืนยันกับ TU authentication service จริง.

## การเชื่อม TC กับหลักฐาน

| TC | Unit/API ที่รองรับ (mock/ขอบเขต) | System/Integration ที่มีอยู่ | ผลเทียบเกณฑ์และงานที่ยังต้องทำบน SHA ปัจจุบัน |
|---|---|---|---|
| U10-TC01 เพิ่มและเพิ่มซ้ำ | Unit/API: PUT/save flow บน SQLite fixture | Browser login mock A → frontend proxy → Backend → SQL Server; PUT เดียวกันสองครั้ง ได้ `200 saved:true`; SQL relation count = 1, Guide/Course ยังอยู่ | **ผ่าน** — [ภาพ TC01](../assets/task129/u10-TC01.png), [ผล JSON](../assets/task129/boundary-results.json), Guide 1 / Course 12; cleanup คืน baseline |
| U10-TC02 เปิดวิชาและผลงานที่เลือก | Unit/API: DTO/open path และ proxy mapping; API fixture เป็น SQLite | Browser UI จัดกลุ่มวิชา เปิด Guide/PDF ตรงชิ้น; checksum ของ PDF blob ตรง fixture; reload/session ใหม่ยังเห็นรายการ | **ผ่าน** — [ภาพ TC02](../assets/task129/u10-TC02.png), [Guide](../assets/task129/02-open-guide.png), [PDF 1](../assets/task129/02-open-summary-1.png), [PDF 2](../assets/task129/02-open-summary-2.png), [ผล JSON](../assets/task129/results.json) |
| U10-TC03 รายการว่าง | API fixture ยืนยัน `200 items:[]` | Browser empty state/ลิงก์ค้นหา และ anonymous list `401`; SQL baseline จริง | **ผ่าน** — [ภาพ TC03](../assets/task129/u10-TC03.png), [ผล JSON](../assets/task129/results.json) |
| U10-TC04 สิทธิ์และ Login | API ใช้ current user; ไม่มี/ผิด token `401`; user isolation | Browser Login ด้วย TU mock A/B คนละ session; SQL user IDs แยก; แต่ละคนเห็นรายการตน; anonymous call `401` | **ผ่านตาม TU mock** — [ภาพบัญชี B](../assets/task129/u10-TC04.png), [ผล JSON](../assets/task129/results.json); ไม่ใช่ TU service จริง |
| U10-TC05 ไม่มี target/ID ผิด | API tests validate type/ID บน SQLite | PUT nonexistent target บน SQL Server ได้ `404 GUIDE_NOT_FOUND`; `0`, `-1`, nonnumeric ได้ `422 INVALID_PARAMETERS`; relation ไม่เปลี่ยน | **ผ่าน** — [ภาพผล API จริงจาก test harness](../assets/task129/u10-TC05.png), [ผล JSON](../assets/task129/boundary-results.json); cleanup คืน baseline |
| U10-TC06 storage/DB ล้มเหลว | Unit/API ทดสอบ mock DAO/read/commit errors และ rollback บน SQLite | SQL Server จริง: SELECT/DELETE failure ได้ `503`; UI แจ้ง error; rollback, GET state หลัง failure และ retry ผ่าน | **ผ่านตาม read/delete failure paths** — [ภาพ TC06](../assets/task129/u10-TC06.png), [Summary failure](../assets/task129/03-summary-delete-sql-failure.png), [read failure](../assets/task129/04-list-sql-failure.png), [ผล JSON](../assets/task129/results.json). ไม่ได้จำลอง SQL PUT commit failure บนระบบจริง |

## Regression ที่ตรวจในหลักฐานเดิม

รอบนี้ Browser suite Task124 รันซ้ำบน SHA ปัจจุบันและตรวจว่า remove ไม่ลบ Course, Guide, Summary, SummaryFile, review หรือ PDF; ไม่แตะ bookmark ของอีกบัญชี; PDF ตรงไฟล์; SQL read/delete failure ไม่แสดง success/empty ผิด; cleanup คืน SQL rows, trigger และ PDF checksums. TC01/TC05 เพิ่มเติมยืนยัน save ซ้ำและ missing/invalid target พร้อมคืน bookmark baseline. **Regression ที่ทดสอบ: ผ่าน**.

## ข้อบกพร่องและ Retest

- **ปัญหาการ build ใน working copy:** `backend/docker-entrypoint.sh` เป็น CRLF ทำให้ Linux ตีความ shebang ไม่ได้ในการ build รอบแรก; เปลี่ยนเป็น LF เฉพาะตอน build image แล้ว stack healthy. เป็นข้อจำกัด line ending ของ working copy ไม่ใช่ logic defect; ไม่ commit การเปลี่ยน line ending.
- **ข้อผิดพลาด test runner:** boundary runner รอบแรก assert ชนิด Boolean ผิดหลัง cleanup; แก้ runner แล้วรันซ้ำ TC01/TC05 ผ่าน และ cleanup คืน baseline.
- **Defect ผลิตภัณฑ์:** ไม่พบ defect ที่ทำให้ TC01–TC06 fail ในรอบนี้. ขอบเขตที่ยังไม่ครอบคลุมบนระบบจริงคือ SQL PUT/INSERT commit failure.
- **Retest:** TC01/TC05 รันซ้ำหลังแก้ runner บน SHA `0c63713...` ผ่าน พร้อมยืนยัน baseline bookmark คืนเดิม.

## ขั้นตอนรันซ้ำ

ใช้เครื่องทดสอบ Docker Desktop แบบ Linux containers, Chrome, และ source ที่ checkout บน SHA ที่จะรายงาน; ตัวอย่างด้านล่างคือรอบนี้บน `0c63713...`. ต้องมี `.env` ใน root ตาม [คู่มือ Task124](task124-u10-docker-integration.md) และห้าม commit เพราะมีรหัส SQL. หากติดตั้ง Node/npm บน host ไม่ครบ สามารถติดตั้ง `playwright-core` ลง temp ผ่าน Node container ได้โดยไม่เพิ่ม package ใน repo.

```powershell
$task129Project = 'cs261-task124-0c63713'
docker compose --env-file .env -p $task129Project -f compose.yaml -f compose.task124.yaml up -d --build --wait
docker compose --env-file .env -p $task129Project exec -T backend python -m scripts.init_reviews
node --test scripts/task124-guards.test.cjs

$task129Tools = Join-Path $env:TEMP 'cs261-task129-browser-tools'
New-Item -ItemType Directory -Force -Path $task129Tools | Out-Null
docker run --rm -v "${task129Tools}:/work" node:24-bookworm-slim sh -c "npm install --prefix /work --no-audit --no-fund playwright-core@1.65.1"
$env:TASK124_PROJECT = $task129Project
$env:TASK124_EVIDENCE = Join-Path (Get-Location) 'docs/U10/assets/task129'
$env:TASK124_PLAYWRIGHT = Join-Path $task129Tools 'node_modules/playwright-core'
$env:TASK124_BROWSER = 'chrome'
node scripts/task124-u10-browser.cjs

$env:TASK129_PROJECT = $task129Project
$env:TASK129_EVIDENCE = Join-Path (Get-Location) 'docs/U10/assets/task129'
$env:TASK129_PLAYWRIGHT = Join-Path $task129Tools 'node_modules/playwright-core'
$env:TASK129_BROWSER = 'chrome'
node scripts/task129-u10-boundary-check.cjs
```

`task124-u10-browser.cjs` validates Docker project/ports/proxies/auth before login, runs UI/SQL/PDF/regression scenarios, then restores its fixture baseline and writes screenshots/JSON. Boundary runner checks TC01/TC05 against SQL Server and removes only the bookmark it created, then asserts the user's saved-guide baseline is restored. ภาพ TC05 เป็น browser rendering ของ HTTP responses จริงจาก test harness ไม่ใช่ภาพ UI ของแอป. เก็บค่า SHA, Docker/SQL/browser versions และ auth mode; ห้ามบันทึก password/token. ห้ามใช้ `down -v`. หลัง UAT และเก็บหลักฐานเสร็จ ปิดเฉพาะ project ทดสอบด้วย `docker compose --env-file .env -p $task129Project -f compose.yaml -f compose.task124.yaml down --remove-orphans` (ไม่ลบ volumes).

Unit/API และ Frontend regression ที่รันในรอบนี้:

```powershell
$env:PYTHONPATH = 'backend'
$env:DB_CONNECTION_STRING = 'DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=master;Trusted_Connection=yes;TrustServerCertificate=yes'
backend/.venv/Scripts/python.exe -m pytest backend/test/test_saved_items_u10_api.py backend/test/test_saved_items_u10_service.py -q
node --test frontend/src/*.test.js
```

ชุด API ใช้ SQLite fixture ตาม test code; connection string ข้างต้นใช้ให้ import แอปได้ ไม่ได้ใช้ยืนยัน SQL Server. ชุด Browser/Integration ข้างต้นต่างหากที่เรียก Backend และ SQL Server จริง.

## บันทึกผล System/E2E รุ่นปัจจุบัน

| TC | Expected | Actual | Status | SHA / environment / auth | หลักฐาน |
|---|---|---|---|---|---|
| TC01 | PUT สองครั้ง; relation เดียว; Course/Guide ยังอยู่ | 200 สองครั้ง, saved true, count 1; Course/Guide อยู่ | PASS | SHA `0c63713...`; Docker 29.9.3; SQL 16.0.4325.4; Chrome 157.0.8103.79; TU mock | [JSON](../assets/task129/boundary-results.json) |
| TC02 | เปิดวิชาและ Guide/PDF ที่เลือกตรงชิ้น | UI แสดง course/item ตรงรายการ; PDF checksum ตรง; reload/session คงอยู่ | PASS | เหมือนข้างต้น | [JSON](../assets/task129/results.json), [ภาพ](../assets/task129/) |
| TC03 | empty state/link; ไม่ leak ข้อมูล | empty state/link ถูกต้อง; anonymous list 401 | PASS | เหมือนข้างต้น | [JSON](../assets/task129/results.json), [ภาพ](../assets/task129/01-empty.png) |
| TC04 | แยกข้อมูลผู้ใช้; no token ได้ 401 | A/B แยก SQL IDs/bookmarks; anonymous 401 | PASS (TU mock) | เหมือนข้างต้น | [JSON](../assets/task129/results.json) |
| TC05 | target ไม่มี `404`; ID ผิด `422`; ไม่มี relation เกิด | missing `404 GUIDE_NOT_FOUND`; `0`, `-1`, nonnumeric `422`; cleanup baseline | PASS | เหมือนข้างต้น | [JSON](../assets/task129/boundary-results.json) |
| TC06 | DB/storage failure ไม่สำเร็จลวง; rollback/recovery | SQL SELECT/DELETE failure ได้ 503; rollback/retry ผ่าน; SQL PUT commit failure ไม่ได้จำลองจริง | PASS (tested paths) | เหมือนข้างต้น | [JSON](../assets/task129/results.json), [ภาพ](../assets/task129/) |
| Regression ที่กระทบ | ข้อมูลต้นทาง/ไฟล์/ผู้ใช้อื่นไม่เปลี่ยน | baseline SQL rows/checksums คืนเดิม; other account/content คงอยู่ | PASS | เหมือนข้างต้น | [JSON](../assets/task129/results.json) |

## บันทึก UAT กับ PO

| PO/ผู้ตรวจ | ผู้ทดสอบ | วันเวลา (เขตเวลา) | SHA/รุ่นระบบ | ผลตรวจรับจริง/ข้อสังเกต | หลักฐาน/ลิงก์ |
|---|---|---|---|---|---|
| รอดำเนินการ | รอดำเนินการ | รอดำเนินการ | `0c63713...` | System/E2E ผ่านตามหลักฐาน แต่ยังไม่ได้ทำ UAT; ยังไม่ถือว่าตรวจรับ | ใช้ [แบบบันทึก UAT](task129-uat-record.md) และแนบหลักฐานเมื่อทำจริง |

แนวทาง UAT ที่เตรียมไว้: ให้ PO Login บน frontend A ด้วยบัญชี TU mock สำหรับทดสอบ, บันทึก Guide สองรายการและ PDF หนึ่งรายการในวิชาเดียวกัน, เปิดหน้ารายการที่บันทึก, ตรวจกลุ่มวิชาและเปิดผลงานตรงชิ้น; ลองรายการว่าง/อีกบัญชี, ยืนยันว่าไม่มี token ได้ 401, ตรวจ ID ผิด/รายการไม่มีอยู่, แล้วให้ผู้ทดสอบตรวจเส้นทาง error ที่มีหลักฐาน SQL จริงใน E2E. PO ต้องยืนยันผลจากการสาธิตจริงและบันทึกชื่อ/เวลา/ผล/ข้อสังเกต ไม่ใช้รายงานนี้กรอกแทน.

## สถานะ DoD และ Artefact

- [x] ตรวจและเชื่อมผล Unit/API/Integration ที่มีอยู่กับ U10-TC01–TC06 พร้อมบอกขอบเขต mock และ SHA ของหลักฐานเดิม
- [x] เตรียมข้อมูลและรัน System/E2E ครบ TC01–TC06 บนรุ่นปัจจุบัน (TC06 ครอบคลุม SQL read/delete failure; SQL PUT commit failure ไม่ได้จำลองจริง)
- [x] ตรวจ regression ที่กระทบซ้ำบนรุ่นปัจจุบัน
- [x] บันทึก expected/actual/status/SHA/environment/auth/evidence สำหรับผลรอบปัจจุบัน
- [x] บันทึก issue ของ test runner และ retest; ไม่พบ defect ผลิตภัณฑ์ที่ทำให้ TC fail
- [ ] ทำ UAT กับ PO และบันทึกผลตรวจรับจริง

Artefact ขั้นตอนทดสอบซ้ำ, ผล System/E2E รุ่นปัจจุบัน, หลักฐาน, การเชื่อม Unit/API/Integration, บันทึก retest และ [แบบบันทึก UAT](task129-uat-record.md) จัดทำแล้ว. ผล UAT กับ PO ยังรอการตรวจจริง จึงยังไม่ครบ Artefact to deliver และยังปิด DoD ไม่ได้.
