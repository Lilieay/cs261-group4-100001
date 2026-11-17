# Task129 — U10 System Test และการตรวจรับ

รุ่นเอกสาร 0.4 · 17 พฤศจิกายน 2569 (Asia/Bangkok)

## ขอบเขตและสถานะ

รายงานนี้เชื่อมหลักฐาน Unit/API/Integration และ System ของ U10-TC01–TC07 ตาม Task99 รุ่นปัจจุบัน โดยแยก revision ของแอปกับ test runner: แอป `0c63713d6764e95b7f19a8edc980b3420d2e8f13`, runner `082d5567e3c997cc6483605e5859d9bbcefa7045`. Runner revisions เพิ่มเฉพาะ test scripts; application code ที่ทดสอบตรงกับ app SHA.

**สถานะ Task129: System/E2E และ regression ผ่าน และ PO รับ U10 แล้ว** ดู [บันทึกการตรวจรับ](task129-uat-record.md) สำหรับรายละเอียด

## รุ่นและสภาพแวดล้อมของหลักฐานเดิม

| ชั้น | รุ่นที่รันจริง | สภาพแวดล้อม/โหมด Login | หลักฐาน |
|---|---|---|---|
| Unit/API U10 | App SHA `0c63713...` | Windows, Python 3.12.14, pytest 9.1.1; API ใช้ SQLite fixture; auth dependency เป็น test double; Unit ใช้ fake DAO/Session | **43 passed, 1 Starlette/httpx deprecation warning**, 1.32 วินาที |
| Frontend regression | App SHA `0c63713...` | Node.js 24.22.3; proxy tests ใช้ local TCP mock servers | **104 passed, 0 failed**, 0.60 วินาที |
| Safety guard tests | Runner SHA `082d556...` | Node.js 24.22.3; Docker metadata mocked เฉพาะ guard test | **10 passed, 0 failed**, 0.07 วินาที; เป็น guard/unit evidence ไม่ใช่ System proof |
| Browser/Integration/System E2E | App SHA `0c63713...`; Runner SHA `082d556...` | Docker Engine 29.9.3; SQL Server 2022 16.0.4325.4; Chrome 157.0.8103.79; Playwright Core 1.65.1; TU mock สองบัญชี; Backend, SQL Server และ PDF volume จริง | [ผล JSON](../assets/task129/results.json), [ผล boundary](../assets/task129/boundary-results.json), [ผล PUT response failure](../assets/task129/second-put-failure-results.json), [ผล cleanup failure](../assets/task129/cleanup-failed-results.json), [ภาพหลักฐาน](../assets/task129) |
| UAT กับ PO | รอบตรวจยืนยัน `6591b5b4d64fecfb9ec9b03bac43a9452ea81e3e` | **รับ** | [บันทึกมติ](task129-uat-record.md) |

ผล Unit/API รอบนี้ยืนยันชุด U10 43 passed, 1 warning (Starlette แจ้ง deprecation ของการใช้ httpx กับ TestClient); ไม่ได้รัน Backend test suite ทั้งหมดใน Task129. Frontend regression มี 104 passed, 0 failed. System/E2E ใช้ SQL Server และ PDF volume จริง แต่ Login ใช้ TU mock; จึงไม่ใช่การยืนยันกับ TU authentication service จริง.

## การเชื่อม TC กับหลักฐาน

| TC | Unit/API ที่รองรับ (mock/ขอบเขต) | System/Integration ที่มีอยู่ | ผลเทียบเกณฑ์และงานที่ยังต้องทำบน SHA ปัจจุบัน |
|---|---|---|---|
| U10-TC01 เพิ่มและเพิ่มซ้ำ | Unit/API: PUT/save flow บน SQLite fixture | Browser login A → frontend proxy → Backend → SQL Server; PUT เดิมสองครั้งได้ `200 saved:true`; SQL มี relation เดียวและ Guide/Course ยังอยู่ | **ผ่าน** — [ภาพ TC01](../assets/task129/u10-TC01.png), [ผล JSON](../assets/task129/boundary-results.json). Fault injection ให้ PUT ครั้งที่สอง commit ที่ upstream แต่ response ถูกตัด; cleanup คืน baseline ได้: [ผล](../assets/task129/second-put-failure-results.json), [ภาพก่อน cleanup](../assets/task129/u10-TC01-second-put-failure.png) |
| U10-TC02 เปิดวิชาและผลงานที่เลือก | Unit/API: DTO/open path และ proxy mapping; API fixture เป็น SQLite | มี Guide G1/G2 และ PDF S1/S2 ใน CS261; คลิกเปิด G2 จริงและตรวจ ID/title; เปิด PDF ที่เลือกและตรวจ viewer blob checksum ตรง fixture | **ผ่าน** — [ภาพ TC02](../assets/task129/u10-TC02.png), [เปิด G2](../assets/task129/02-open-guide-2.png), [เปิด PDF S1](../assets/task129/02-open-summary-1.png), [PDF S2](../assets/task129/02-open-summary-2.png), [ผล JSON](../assets/task129/results.json) |
| U10-TC03 รายการว่าง | API fixture ยืนยัน `200 items:[]` | บัญชี A GET จริงได้ `200` และ `items:[]`; คลิกลิงก์ค้นหาและตรวจ URL `/courses.html`; anonymous GET ได้ `401` | **ผ่าน** — [ภาพ TC03](../assets/task129/u10-TC03.png), [ผล JSON](../assets/task129/results.json) |
| U10-TC04 สิทธิ์และ Login | API ใช้ current user; ไม่มี/ผิด token `401`; user isolation | B มีรายการของตนและลอง DELETE G2 ซึ่งมี bookmark เฉพาะ A; ได้ `200 saved:false`; SQL ยังมี bookmark ของ A, หน้า A ยังเห็น G2; bearer token ผิดได้ `401` | **ผ่านตาม TU mock** — [ภาพรายการ B](../assets/task129/u10-TC04.png), [ผล JSON](../assets/task129/results.json); ไม่ใช่ TU service จริง |
| U10-TC05 ไม่มี target/ID ผิด | API tests validate type/ID บน SQLite | PUT nonexistent target บน SQL Server ได้ `404 GUIDE_NOT_FOUND`; `0`, `-1`, nonnumeric ได้ `422 INVALID_PARAMETERS`; relation ไม่เพิ่ม | **ผ่าน** — [ภาพผล API](../assets/task129/u10-TC05.png), [ผล/cleanup verification](../assets/task129/boundary-results.json) |
| U10-TC06 storage/DB ล้มเหลว | Unit/API ทดสอบ mock DAO/read/commit errors และ rollback บน SQLite | SQL Server จริง: SELECT/DELETE failure ได้ `503`; UI แจ้ง error; rollback, GET state หลัง failure และ retry ผ่าน | **ผ่านตาม read/delete failure paths** — [ภาพ TC06](../assets/task129/u10-TC06.png), [Guide failure](../assets/task129/03-guide-delete-sql-failure.png), [Summary failure](../assets/task129/03-summary-delete-sql-failure.png), [read failure](../assets/task129/04-list-sql-failure.png), [ผล JSON](../assets/task129/results.json). ไม่ได้จำลอง SQL PUT commit failure บนระบบจริง |
| U10-TC07 นำออกซ้ำและคงข้อมูล | Unit/API: repeated DELETE และ user isolation ใน test suite | A ลบ G1 แล้วลบซ้ำ; ครั้งที่สอง `saved:false`; bookmark เหลือเฉพาะ B; SQL ยืนยัน Guide/Course และข้อมูล Summary/PDF ไม่เปลี่ยน | **ผ่าน** — [ภาพ A หลังลบ](../assets/task129/u10-TC07-a.png), [ภาพ B ที่ยังเห็น Guide](../assets/task129/u10-TC07-b.png), [ผล JSON](../assets/task129/results.json) |

## Regression ที่ตรวจในหลักฐานเดิม

รอบนี้ Browser suite รันบน app SHA ที่ระบุและตรวจ Course/Guide/Summary/SummaryFile/review/PDF ไม่ถูกลบจาก bookmark operation, bookmark อีกบัญชีคงอยู่, PDF ตรงไฟล์, SQL read/delete failure ไม่แสดง success/empty ผิด, cleanup คืน baseline. ครอบคลุม TC01/TC05/TC07 บน SQL Server จริง. **Regression ที่ทดสอบ: ผ่าน**.

## ข้อบกพร่องและ Retest

- **ปัญหาการ build ใน working copy:** `backend/docker-entrypoint.sh` เป็น CRLF ทำให้ Linux ตีความ shebang ไม่ได้ในการ build รอบแรก; เปลี่ยนเป็น LF เฉพาะตอน build image แล้ว stack healthy. เป็นข้อจำกัด line ending ของ working copy ไม่ใช่ logic defect; ไม่ commit การเปลี่ยน line ending.
- **ข้อผิดพลาด test runner:** รอบแรกพบ assertion ชนิด Boolean และ helper query ขาดใน report TC07; แก้ใน runner revisions และรันจาก `082d556...` จน suite ผ่านและ cleanup คืน baseline.
- **Cleanup failure handling:** จำลอง DELETE cleanup ถูกตัดก่อนถึง Backend; JSON บันทึก `cleanup.status=FAIL`, `baselineRestored=false`, `browserClosed=true` ตามคาด. หลังเก็บหลักฐาน ลบเฉพาะ test relation ที่ค้างออกจาก SQL ของ stack แยก แล้วรัน suite ปกติยืนยัน baseline กลับมาตรงเดิม. [ผล](../assets/task129/cleanup-failed-results.json), [ภาพ TC05 ขณะ cleanup ล้ม](../assets/task129/u10-TC05-cleanup-failed.png).
- **Defect ผลิตภัณฑ์:** ไม่พบ defect ที่ทำให้ TC01–TC07 fail ในรอบนี้. ขอบเขตที่ยังไม่ครอบคลุมบนระบบจริงคือ SQL PUT/INSERT commit failure.
- **Retest:** E2E และ boundary/fault injection รันบน app SHA `0c63713...` ด้วย runner SHA `082d556...` ผ่าน; response PUT ครั้งที่สองหลุดหลัง upstream commit แล้ว cleanup คืน baseline; cleanup ล้มเหลวถูกบันทึกและปิด browser ตามที่กำหนด.

## ขั้นตอนรันซ้ำ

ใช้ Docker Desktop แบบ Linux containers และ Chrome. แอปของรอบนี้คือ SHA `0c63713...`; test runner อยู่ใน revision `082d5567e3c997cc6483605e5859d9bbcefa7045`. Checkout runner revision เพื่อให้ได้ source แอปเดิมและ runner ที่บันทึกใน JSON. ต้องมี `.env` ใน root ตาม [คู่มือ Task124](task124-u10-docker-integration.md) และห้าม commit เพราะมีรหัส SQL. หาก checkout บน Windows ทำให้ `backend/docker-entrypoint.sh` เป็น CRLF ให้แปลงเป็น LF เฉพาะตอน build image เพื่อให้ Linux อ่าน shebang ได้; คืนไฟล์ working copy หลัง build.

```powershell
$task129RunnerSha = '082d5567e3c997cc6483605e5859d9bbcefa7045'
$task129AppSha = '0c63713d6764e95b7f19a8edc980b3420d2e8f13'
git checkout $task129RunnerSha
$entrypoint = 'backend/docker-entrypoint.sh'
$text = [System.IO.File]::ReadAllText((Resolve-Path $entrypoint))
[System.IO.File]::WriteAllText((Resolve-Path $entrypoint), ($text -replace "`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
$task129Project = 'cs261-task124-0c63713'
docker compose --env-file .env -p $task129Project -f compose.yaml -f compose.task124.yaml up -d --build --wait
git checkout -- $entrypoint
docker compose --env-file .env -p $task129Project exec -T backend python -m scripts.init_reviews
node --test scripts/task124-guards.test.cjs

$task129Tools = Join-Path $env:TEMP 'cs261-task129-browser-tools'
New-Item -ItemType Directory -Force -Path $task129Tools | Out-Null
docker run --rm -v "${task129Tools}:/work" node:24-bookworm-slim sh -c "npm install --prefix /work --no-audit --no-fund playwright-core@1.65.1"
$env:TASK129_APP_SHA = $task129AppSha
$env:TASK124_PROJECT = $task129Project
$env:TASK124_EVIDENCE = Join-Path (Get-Location) 'docs/U10/assets/task129'
$env:TASK124_PLAYWRIGHT = Join-Path $task129Tools 'node_modules/playwright-core'
$env:TASK124_BROWSER = 'chrome'
node scripts/task124-u10-browser.cjs

$env:TASK129_PROJECT = $task129Project
$env:TASK129_APP_SHA = $task129AppSha
$env:TASK129_EVIDENCE = Join-Path (Get-Location) 'docs/U10/assets/task129'
$env:TASK129_PLAYWRIGHT = Join-Path $task129Tools 'node_modules/playwright-core'
$env:TASK129_BROWSER = 'chrome'
node scripts/task129-u10-boundary-check.cjs

$env:TASK129_SIMULATE_SECOND_PUT_FAILURE = '1'
node scripts/task129-u10-boundary-check.cjs
Remove-Item Env:TASK129_SIMULATE_SECOND_PUT_FAILURE

# Optional: verify cleanup-failure reporting/browser closure. This intentionally leaves one
# synthetic bookmark in the isolated DB; remove only the user/guide relation named in the JSON
# and verify the saved_guides baseline before ending the test stack.
$env:TASK129_SIMULATE_CLEANUP_FAILURE = '1'
node scripts/task129-u10-boundary-check.cjs
if ($LASTEXITCODE -eq 0) { throw 'Expected the simulated cleanup-failure run to exit nonzero.' }
Remove-Item Env:TASK129_SIMULATE_CLEANUP_FAILURE

# Restore only the synthetic A→Guide relation left by the intentional cleanup-failure test.
$cleanupFailure = Get-Content docs/U10/assets/task129/cleanup-failed-results.json -Raw | ConvertFrom-Json
$systemRun = Get-Content docs/U10/assets/task129/results.json -Raw | ConvertFrom-Json
$task129UserId = ($systemRun.results | Where-Object { $_.name -like 'U10-TC03:*' }).userIds[0]
$task129GuideId = ($cleanupFailure.cases | Where-Object { $_.id -eq 'U10-TC01' }).guideId
@"
from app.db import engine
with engine.begin() as connection:
    rows = connection.exec_driver_sql('SELECT user_id FROM dbo.saved_guides WHERE user_id=? AND guide_id=?', ($task129UserId, $task129GuideId)).fetchall()
    assert rows == [($task129UserId,)], rows
    connection.exec_driver_sql('DELETE FROM dbo.saved_guides WHERE user_id=? AND guide_id=?', ($task129UserId, $task129GuideId))
with engine.connect() as connection:
    remaining = connection.exec_driver_sql('SELECT COUNT(*) FROM dbo.saved_guides WHERE user_id=? AND guide_id=?', ($task129UserId, $task129GuideId)).scalar()
assert remaining == 0, remaining
print('Removed only the injected test relation; baseline restored.')
"@ | docker compose --env-file .env -p $task129Project -f compose.yaml -f compose.task124.yaml exec -T backend python -

# Re-run the normal boundary suite to restore the passing TC05 image/results.
Remove-Item Env:TASK129_SIMULATE_SECOND_PUT_FAILURE -ErrorAction SilentlyContinue
node scripts/task129-u10-boundary-check.cjs
```

`task124-u10-browser.cjs` validates Docker project/ports/proxies/auth before login, runs UI/SQL/PDF/regression scenarios, then restores its fixture baseline and writes screenshots/JSON. Boundary runner checks TC01/TC05 against SQL Server, registers cleanup before the first PUT, and verifies saved-guide baseline whether the second response succeeds or fails. The failure-injection run commits the second PUT upstream, aborts only the browser response, then verifies cleanup. Cleanup status and baseline verification are written even on failure, and browser closure is in the finalization path. ภาพ TC05 เป็นผล API จริงและจะแสดง baseline PASS เฉพาะเมื่อ cleanup ตรวจยืนยันสำเร็จ. เก็บค่า SHA ของแอปและ runner แยกกัน พร้อม Docker/SQL/browser versions และ auth mode; ห้ามบันทึก password/token. ห้ามใช้ `down -v`. หลัง UAT และเก็บหลักฐานเสร็จ ปิดเฉพาะ project ทดสอบด้วย `docker compose --env-file .env -p $task129Project -f compose.yaml -f compose.task124.yaml down --remove-orphans` (ไม่ลบ volumes).

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
| TC01 | PUT สองครั้ง; relation เดียว; Course/Guide ยังอยู่ | 200 สองครั้ง, saved true, count 1; Course/Guide อยู่ | PASS | App `0c63713...`; Runner `082d556...`; Docker 29.9.3; SQL 16.0.4325.4; Chrome 157.0.8103.79; TU mock | [JSON](../assets/task129/boundary-results.json), [fault injection](../assets/task129/second-put-failure-results.json) |
| TC02 | มี Guide สองชิ้นในวิชาเดียวกัน; เปิด G2 และ PDF ที่เลือกตรงชิ้น | เปิด Guide G2 ตรง ID/title; PDF checksum ตรง; reload/session คงอยู่ | PASS | เหมือนข้างต้น | [JSON](../assets/task129/results.json), [ภาพ](../assets/task129/u10-TC02.png) |
| TC03 | A GET list ว่างและคลิกลิงก์ค้นหาจริง | `200 items:[]`; URL `/courses.html`; anonymous GET `401` | PASS | เหมือนข้างต้น | [JSON](../assets/task129/results.json), [ภาพ](../assets/task129/u10-TC03.png) |
| TC04 | B ลบ bookmark เฉพาะ A; token ผิดถูกปฏิเสธ | B ได้ `saved:false`; bookmark ของ A ยังอยู่; invalid token `401` | PASS (TU mock) | เหมือนข้างต้น | [JSON](../assets/task129/results.json), [ภาพ](../assets/task129/u10-TC04.png) |
| TC05 | target ไม่มี `404`; ID ผิด `422`; ไม่มี relation เกิด | missing `404 GUIDE_NOT_FOUND`; `0`, `-1`, nonnumeric `422`; cleanup baseline ผ่าน | PASS | เหมือนข้างต้น | [JSON](../assets/task129/boundary-results.json), [cleanup PASS](../assets/task129/u10-TC05.png), [cleanup fail path](../assets/task129/u10-TC05-cleanup-failed.png) |
| TC06 | DB/storage failure ไม่สำเร็จลวง; rollback/recovery | SQL SELECT/DELETE failure ได้ 503; rollback/retry ผ่าน; SQL PUT commit failure ไม่ได้จำลองจริง | PASS (tested paths) | เหมือนข้างต้น | [JSON](../assets/task129/results.json), [ภาพ](../assets/task129/u10-TC06.png) |
| TC07 | A ลบ G1 สองครั้ง; bookmark B และ source records/files คงอยู่ | second DELETE `saved:false`; bookmark เหลือ user B; Guide/Course อยู่; Summary/PDF ไม่เปลี่ยน | PASS | App `0c63713...`; Runner `082d556...`; TU mock | [JSON](../assets/task129/results.json), [A](../assets/task129/u10-TC07-a.png), [B](../assets/task129/u10-TC07-b.png) |
| Regression ที่กระทบ | ข้อมูลต้นทาง/ไฟล์/ผู้ใช้อื่นไม่เปลี่ยน | baseline SQL rows/checksums คืนเดิม; other account/content คงอยู่ | PASS | เหมือนข้างต้น | [JSON](../assets/task129/results.json) |

## บันทึก UAT กับ PO

| PO/ผู้ตรวจ | ผู้ทดสอบ | วันเวลา (เขตเวลา) | SHA/รุ่นระบบ | ผลตรวจรับจริง/ข้อสังเกต | หลักฐาน/ลิงก์ |
|---|---|---|---|---|---|
| กชพร ผดุงเกียรติวงษ์ | ตรวจผ่าน Chrome ด้วย browser runners | 17 พฤศจิกายน 2569 เวลา 22:40–22:42 น. (Asia/Bangkok) | รอบตรวจยืนยัน `6591b5b4d64fecfb9ec9b03bac43a9452ea81e3e` | รับ | [บันทึกผล UAT](task129-uat-record.md) |

แนวทาง UAT ที่เตรียมไว้: ให้ PO Login บน frontend A ด้วยบัญชี TU mock สำหรับทดสอบ, บันทึก Guide สองรายการและ PDF หนึ่งรายการในวิชาเดียวกัน, เปิดหน้ารายการที่บันทึก, ตรวจกลุ่มวิชาและเปิดผลงานตรงชิ้น; ลองรายการว่าง/อีกบัญชี, ยืนยันว่าไม่มี token ได้ 401, ตรวจ ID ผิด/รายการไม่มีอยู่, แล้วให้ผู้ทดสอบตรวจเส้นทาง error ที่มีหลักฐาน SQL จริงใน E2E. PO ต้องยืนยันผลจากการสาธิตจริงและบันทึกชื่อ/เวลา/ผล/ข้อสังเกต ไม่ใช้รายงานนี้กรอกแทน.

## สถานะ DoD และ Artefact

- [x] ตรวจและเชื่อมผล Unit/API/Integration ที่มีอยู่กับ U10-TC01–TC07 พร้อมบอกขอบเขต mock และ SHA ของหลักฐาน
- [x] เตรียมข้อมูลและรัน System/E2E ครบ TC01–TC07 บนรุ่นปัจจุบัน (TC06 ครอบคลุม SQL read/delete failure; SQL PUT commit failure ไม่ได้จำลองจริง)
- [x] ตรวจ regression ที่กระทบซ้ำบนรุ่นปัจจุบัน
- [x] บันทึก expected/actual/status/SHA/environment/auth/evidence สำหรับผลรอบปัจจุบัน
- [x] บันทึก issue ของ test runner และ retest; ไม่พบ defect ผลิตภัณฑ์ที่ทำให้ TC fail
- [x] บันทึกมติ PO และแนบผลรอบตรวจยืนยัน UAT

มีผล System/E2E หลักฐาน ขั้นตอนรันซ้ำ และ [บันทึกมติ UAT](task129-uat-record.md) รอบตรวจยืนยันที่ `6591b5b4d64fecfb9ec9b03bac43a9452ea81e3e` มี [ผล System/E2E](../assets/task129/uat-6591b5b/results.json) และ [ผล TC01/TC05](../assets/task129/uat-6591b5b/boundary-results.json) พร้อมภาพรายเคส
