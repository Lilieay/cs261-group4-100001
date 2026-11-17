# Task124 ผลทดสอบ Integration U10 บน Docker

ทดสอบหน้า “รายวิชาที่บันทึก” ผ่าน Frontend proxy, Backend, SQL Server และ PDF volume จริงแล้ว ครอบคลุมดูรายการ จัดกลุ่มตามวิชา เปิด Guide/PDF ตรงชิ้น และนำออกเฉพาะ bookmark ของบัญชีปัจจุบัน ตาม Task104 และ Task94 รุ่น 0.4 ไม่ใช้ SavedCourse หรือลบเนื้อหาทั้งวิชา

รันรอบแก้วันที่ 17 พฤศจิกายน 2569 (Asia/Bangkok) หลังรวม `sprint2` commit `d854470` ซึ่งมี Task119 จาก #135 แล้ว ชุดทดสอบกับ source ที่รันจริงคือ `ee56764bb03f74599e4c9b84b1f878820664a822` รอบสุดท้าย exit 0 และ [results.json](../assets/task124/results.json) มี `passed: true` ใช้ Chrome 142.0.7444.176, Docker Engine 29.8.2, SQL Server 2022 รุ่น 16.0.4305.5 และ Playwright Core 1.65.1 การ Login ใช้ **TU mock** ไม่ใช่ TU จริง เวลาใน JSON เป็น UTC

## ผลจากการรัน

| กรณี | ผลที่ยืนยัน |
| --- | --- |
| ยืนยัน stack ก่อน Login | ตรวจ Docker metadata ของ Frontend A/B ว่าเป็นเจ้าของพอร์ต 29800/29801 จริง อยู่ใน Compose project ที่เลือก และแต่ละ proxy ชี้ Backend A/B ที่ใช้ mock ใน project/network เดียวกัน หากไม่ตรงจะหยุดก่อนเปิด browser/Login/สร้าง fixture |
| Empty | ยังไม่มี bookmark แสดง “ยังไม่มีรายการที่บันทึก” พร้อมลิงก์ค้นหารายวิชา ไม่มี token เรียก GET list ได้ 401 |
| รายการและการจัดกลุ่ม | A มี Guide หนึ่งชิ้นกับ PDF สองชิ้นใน CS261 แสดงสามรายการในหนึ่งกลุ่ม ไม่แสดงรายการเฉพาะของ B กดหัวกลุ่มแล้วตรวจ courseId ใน URL พร้อมรหัสและชื่อวิชาที่หน้า `courseHeading`/`courseName` แสดงจริง |
| เปิดตรงผลงาน | กด Guide ได้ title/ID ตรงรายการและ alias `/api/guides/{id}` ใช้ได้ PDF สองไฟล์มี checksum ต่างกัน ตรวจ SHA-256 จาก blob URL ใน `src` ของ iframe ตัวอ่านจริง เทียบ fixture ของชิ้นที่กด ไม่ใช้ GET แยกจากตัวอ่าน พร้อมเก็บ checksum ทั้งสองด้านใน JSON |
| Reload และ session ใหม่ | หลัง reload และ Login ใหม่ รายการสามชิ้นของ A ยังอยู่ ส่วน B เห็นสี่ชิ้นตาม bookmark ของตัวเอง |
| นำออกและนำออกซ้ำ | กดนำ Guide/PDF ออกได้ 200 การ์ดหายหลัง reload ลบซ้ำยังได้ 200 `saved:false` SQL เหลือ bookmark ของ B โดย Course, Guide, Summary, SummaryFile, reviews และไฟล์ไม่เปลี่ยน |
| SQL ปฏิเสธ DELETE | Trigger จำกัดเฉพาะบัญชี A และผลงานทดสอบทำให้ DELETE ได้ 503 `SAVED_ITEMS_UNAVAILABLE` รอ GET `/api/saved-items` ที่เกิดหลัง response 503 ตรวจว่าได้ 200 และ payload ยังมี bookmark เดิมของ A หน้าแสดงข้อผิดพลาดและการ์ดยังอยู่ SQL ยืนยัน bookmark ของทั้ง A/B ยังอยู่ ทดสอบแยก Guide/PDF |
| SQL อ่านรายการไม่ได้ | เปลี่ยนชื่อตาราง relation ของชุดทดสอบชั่วคราว ทำให้ SELECT จริงล้มเหลว ได้ 503 หน้าแจ้ง “โหลดรายการไม่สำเร็จ” ไม่แสดงรายการบางส่วนหรือ empty เมื่อคืนชื่อตารางแล้วกดลองอีกครั้ง เห็นครบสามรายการ |
| Browser ไม่ได้รับผล DELETE | ให้คำขอผ่านไปลบใน Backend/SQL จริงจนได้ 200 แล้ว Playwright ตัด response เฉพาะฝั่ง Browser หน้าโหลด GET list ใหม่ การ์ดหายตาม SQL แต่ยังแจ้งว่ายืนยันผลคำขอเดิมไม่ได้ Bookmark ของ B คงอยู่ ทดสอบ Guide/PDF แยกกัน |
| เปิดรายการเก่าที่ผลงานถูกลบ | ลบ target ด้วยคำขอเจ้าของอีกชุด โดยหน้า list ยังมีการ์ดเก่า กดเปิดแล้วได้หน้าไม่พบผลงาน กด Browser Back แล้วมี GET list ใหม่ การ์ดที่หายถูกนำออก แต่ PDF อีกชิ้นยังอยู่ ทดสอบทั้ง Guide/PDF |
| ข้อมูลและสิทธิ์ | type/ID ผิด เช่น `course`, `1.0` ได้ 422 ส่ง `user_id` ใน query ไม่ได้ และไม่มี token ส่ง DELETE ได้ 401 |
| นำชิ้นสุดท้ายออก | หน้า A กลับเป็น empty และยังว่างหลัง Login ใหม่ ส่วน B ยังมี bookmark ของ PDF ชิ้นนั้นกับ Guide ของตน และรายละเอียด PDF ยังเปิดได้ |
| Cleanup | ลบเฉพาะผลงานของสคริปต์ผ่าน API เจ้าของ คืนชื่อตาราง ลบ trigger แล้วเทียบแถว SQL และไฟล์/checksum กับ baseline ตรงกัน |
| Trigger ที่มีอยู่ก่อน | เตรียม trigger ไว้ก่อนเรียกสคริปต์หลัก สคริปต์หยุดก่อน Login/fixture ตรวจ object ID, definition, จำนวนข้อมูล และจำนวนคำขอ Login ไม่เปลี่ยน trigger เดิมยังอยู่ |
| Assertion ล้มหลังสร้าง trigger | สร้าง trigger ผ่าน ownership helper เดียวกับสคริปต์หลัก แล้วจำลอง assertion ล้ม ตรวจว่า `finally` ลบเฉพาะ trigger ที่สร้างในรอบนั้น และข้อมูลกลับเท่าเดิม |

ไม่ได้ mock SQL, DAO, API response หรือ PDF storage กรณี SELECT/DELETE ล้มเหลวเป็นข้อผิดพลาดจาก SQL Server จริง ส่วนการตัด response จำลองด้วย Playwright หลัง Backend ทำงานเสร็จ จึง **ไม่ใช่** การตัดการเชื่อมต่อ Backend–SQL Server ขณะรอผล commit และไม่ใช้ผลนี้อ้างว่าทดสอบกรณีนั้นแล้ว

## หลักฐาน

- [รายการว่าง](../assets/task124/01-empty.png) และ [หลายผลงานในวิชาเดียว](../assets/task124/02-grouped-list.png)
- [เปิด Guide](../assets/task124/02-open-guide.png), [PDF ชิ้นแรก](../assets/task124/02-open-summary-1.png), [PDF ชิ้นที่สอง](../assets/task124/02-open-summary-2.png)
- SQL ปฏิเสธการลบ [Guide](../assets/task124/03-guide-delete-sql-failure.png) / [PDF](../assets/task124/03-summary-delete-sql-failure.png)
- [SQL อ่านรายการไม่ได้](../assets/task124/04-list-sql-failure.png)
- โหลดสถานะหลัง response หาย [Guide](../assets/task124/05-guide-lost-response.png) / [PDF](../assets/task124/05-summary-lost-response.png)
- [นำรายการสุดท้ายออกแล้ว](../assets/task124/06-final-empty.png)
- [ผล JSON พร้อม SHA/environment/auth mode และ fixture IDs](../assets/task124/results.json)
- [สคริปต์ทดสอบและคืนข้อมูล](../../../scripts/task124-u10-browser.cjs)
- [ผลทดสอบ trigger บน SQL จริง](../assets/task124/trigger-safety-results.json) และ [สคริปต์รันซ้ำ](../../../scripts/task124-trigger-check.cjs)
- [Guard tests](../../../scripts/task124-guards.test.cjs): **10 ผ่าน** ครอบคลุม port/project/proxy/network/auth ที่ไม่ตรง, CREATE ล้มเหลวไม่ถือ ownership และ cleanup หลัง assertion ล้ม

ชื่อภาพเปิดผลงานใช้ลำดับ fixture เพื่อให้รันซ้ำแล้วเขียนทับภาพเดิมได้ ID จริงของรอบล่าสุดอยู่ใน JSON ไม่ต้องกำหนด ID เอง

## บัญชี ข้อมูล และ baseline

ใช้บัญชี TU mock A `6800000000` และ B `6800000001` รหัสผ่าน mock `0000000000000` ทั้งสอง Login ผ่านหน้าเว็บและมี user ID ต่างกันใน SQL ฐานเดียว ใช้ Backend สอง process เนื่องจาก mock provider รับบัญชีนักศึกษาหนึ่งบัญชีต่อ process และ Bearer session อยู่ในหน่วยความจำ ไม่บันทึก token หรือรหัสผ่าน SQL ลงหลักฐาน

สคริปต์สร้าง Guide และ PDF ผ่าน API เดิม ตั้งชื่อ `Task124-<timestamp>` ใช้วิชา CS261 ที่ seed ไว้ PDF สองชิ้นสร้างโดยสคริปต์เองและมีขนาดหน้าต่างกันเพื่อให้ SHA-256 ต่างกัน บันทึกผ่าน PUT ของ U9 แล้วจัดการผ่านหน้ารายการ U10 ไม่สร้างตารางหรือระบบ save ซ้ำ

Baseline เก็บหลัง Login ก่อนสร้างผลงาน รวม `users`, `courses`, `guides`, `summaries`, `summary_files`, `reviews`, `saved_guides`, `saved_summaries` และไฟล์ทุกไฟล์ใน PDF volume หลัง cleanup ต้องตรงกัน บัญชี mock คงไว้สำหรับรันซ้ำ ไม่ย้อน identity counters

## วิธีรันซ้ำ

ใช้ Docker Desktop แบบ Linux containers, Node, Chrome หรือ Edge บน source รุ่นที่ระบุ ใช้ [compose.yaml เดิม](../../../compose.yaml) ร่วมกับ [override ทดสอบ](../../../compose.task124.yaml) ตั้งรหัสผ่าน SQL ของชุดทดสอบเองใน `.env` โดยไม่ commit:

```dotenv
MSSQL_SA_PASSWORD=<รหัสผ่านทดสอบที่ตรงกติกา SQL Server>
SQLSERVER_HOST_PORT=26433
BACKEND_HOST_PORT=32800
FRONTEND_HOST_PORT=29800
TU_API_MODE=mock
```

```powershell
$task124Project = 'cs261-task124-d854470'
docker compose --env-file .env -p $task124Project -f compose.yaml -f compose.task124.yaml up -d --build --wait
docker compose --env-file .env -p $task124Project exec -T backend python -m scripts.init_reviews
```

ใช้ project ขึ้นต้น `cs261-task124-` เพื่อแยก SQL/PDF volumes จากชุดใช้งาน โดยยังใช้แอปและ schema เดิม Backend entrypoint เตรียม U6/U9 ตามระบบเดิม คำสั่ง `init_reviews` เพิ่มเฉพาะตาราง U8 สำหรับคะแนนที่ใช้ร่วมบนหน้า list รันครั้งเดียวในชุดใหม่ ถ้าตารางมีแล้วให้ตรวจ schema ตาม Task114 และข้ามคำสั่งนี้ ไม่ลบตารางเพื่อเริ่มใหม่

Frontend A/B อยู่ที่พอร์ต 29800/29801 Backend 32800/32801 และ SQL Server 26433 สคริปต์ใช้พอร์ต Frontend ตามนี้ override บังคับ TU mock และรอ Backend A ก่อนเริ่ม B เพื่อเลี่ยงการลง schema พร้อมกัน

```powershell
$task124Tools = Join-Path $env:TEMP 'cs261-task124-browser-tools'
npm.cmd install --prefix $task124Tools --no-audit --no-fund playwright-core@1.65.1
$env:TASK124_PLAYWRIGHT = Join-Path $task124Tools 'node_modules/playwright-core'
$env:TASK124_PROJECT = $task124Project
$env:TASK124_EVIDENCE = Join-Path $env:TEMP 'cs261-task124-evidence'
node scripts/task124-u10-browser.cjs
```

ตรวจ guard และสองกรณี ownership บน SQL จริงได้ก่อนรันชุดหลัก ด้วย environment เดียวกัน:

```powershell
node --test scripts/task124-guards.test.cjs
node scripts/task124-trigger-check.cjs
```

Guard tests ใช้ Docker metadata จำลองเพื่อตรวจเงื่อนไขหยุด ส่วน trigger-check ใช้ SQL Server จริงและเรียกสคริปต์หลักใน subprocess เพื่อตรวจการหยุดก่อน Login ผลรอบนี้ guard tests 10 ผ่าน, trigger-check exit 0 พร้อม `passed: true` และชุด browser เต็ม exit 0 พร้อม `passed: true` ทั้งหมดใช้ SHA เดียวกันใน JSON

ถ้าใช้ Edge ให้ตั้ง `$env:TASK124_BROWSER = 'msedge'` ก่อนรัน ผลสำเร็จต้อง exit 0, มีผล cleanup และ `results.json` เป็น `passed: true` รันซ้ำได้หลังจบโดยไม่เรียก `init_reviews` อีก ไม่ได้รัน Unit/API ทั้งชุดซ้ำใน Task124 เพราะรอบนี้เพิ่มเฉพาะชุด Integration และรายงาน ไม่มีการแก้โค้ดแอป

## คืนข้อมูลและสถานะส่งตรวจ

ตรวจ stack และ trigger ที่มีอยู่ก่อนก่อนเปิด browser หากเจอ trigger ค้าง สคริปต์หยุดโดยไม่เข้า cleanup ที่จะลบของเดิม Ownership ได้มาหลัง CREATE สำเร็จเท่านั้น `finally` จึงลบ `task124_delete_failure` เฉพาะที่รอบนี้สร้าง คืนชื่อ `task124_saved_summaries_unavailable` กลับเป็น `saved_summaries` หากจำเป็น และลบเฉพาะ target ที่สคริปต์สร้างผ่าน API เจ้าของ จากนั้นเทียบ baseline ถ้าหยุด process กลางทาง ให้ตรวจเฉพาะฐาน project ทดสอบนี้ ตรวจชื่อ/เจ้าของ/ID ในผลรอบนั้นก่อนคืน fixture และตรวจชื่อตารางกับ trigger ก่อนเริ่มใหม่ ไม่ล้างทั้งตารางหรือ volume

หลังเก็บหลักฐานแล้วปิดเฉพาะชุดทดสอบ โดยเก็บ volumes สำหรับรันซ้ำ:

```powershell
docker compose --env-file .env -p $task124Project -f compose.yaml -f compose.task124.yaml down --remove-orphans
```

ผลรอบแรกหยุดเพราะสคริปต์รอข้อความ 404 ของ PDF ว่า “ไม่พบสรุป PDF” แต่ระบบตอบ “ไม่พบสรุป” ปรับตัวตรวจให้ตรงข้อความจริงแล้วรันทั้งชุดซ้ำผ่าน ไม่มีการแก้พฤติกรรมแอปเพื่อให้ทดสอบผ่าน

รอบแก้ PR #137 เปลี่ยนจากฐานเก่า `89a60fa` เป็นโค้ดที่รวม #135 แล้ว เพิ่ม stack preflight, trigger ownership, การตรวจชื่อวิชาบนหน้าและ blob ที่ตัวอ่านใช้จริง และ GET หลัง DELETE 503 ทั้ง Guide/PDF อัปเดตภาพทั้งหมดให้ตรงหน้า Task119 ล่าสุดแล้ว

ส่งงานจาก `feat/u10-saved-courses-backend` เดิมเข้า `sprint2` รอสมาชิกอีกคน review ก่อน merge ผล Integration รอบนี้พร้อมให้ตรวจ แต่ไม่ได้อ้างว่า PR ผ่าน review/merge แล้ว
