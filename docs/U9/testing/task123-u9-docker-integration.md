# ผลทดสอบ Integration U9 บน Docker

Task123 ทดสอบการบันทึกแนวข้อสอบและสรุป PDF ทีละชิ้นตามมติใน Task103 และ API Contract Task94 รุ่น 0.4 จากหน้าอ่านผ่าน Frontend proxy ไปยัง Backend และ SQL Server หน้า “รายวิชาที่บันทึก” และการจัดกลุ่มเป็นขอบเขตของ U10

วันที่ 16 พฤศจิกายน 2569 ใช้ `sprint2` commit `216300d0e68ad30e346f05a6b0a96847a357742b` หลังรวม #129 และ #130 ใช้ Docker Engine 29.8.2, SQL Server 2022 16.0.4305.5, Chrome 157.0.8103.78 และ Playwright Core 1.65.1 ยืนยันตัวตนด้วย TU mock สองบัญชีจากหน้า Login โดยตรวจว่าทั้งคู่มี user ID ต่างกัน ฐานข้อมูลและ volume PDF ใช้จริงใน Compose project แยก

## ผลที่ได้

ผลต่อไปนี้ทดสอบทั้ง Guide และ PDF ในวิชา CS261

| กรณี | ผลจากการรัน |
| --- | --- |
| อ่านสถานะและกดบันทึก | เริ่มจากยังไม่บันทึก กดจากหน้าอ่านได้ HTTP 200 ปุ่มขึ้น “บันทึกแล้ว” และ SQL มี bookmark ของบัญชี A หนึ่งแถว |
| บันทึกซ้ำและยิงพร้อมกัน | PUT ซ้ำ และ PUT สองคำขอพร้อมกันตอนยังไม่มี bookmark ตอบ HTTP 200 ทั้งคู่ เหลือหนึ่งแถวต่อบัญชีและผลงาน |
| Reload ล็อกอินใหม่ และสองบัญชี | A ยังเห็นสถานะบันทึกแล้วหลัง reload และล็อกอินใหม่ ส่วน B ยังไม่ได้บันทึกจนกว่าจะกดเอง ไม่มี session ได้ HTTP 401 |
| SQL ปฏิเสธ INSERT | Trigger จำกัดเฉพาะผลงานและบัญชี B ทำให้ PUT ได้ HTTP 503 `SAVED_ITEMS_UNAVAILABLE` หน้าอ่านโหลด GET ใหม่และแสดงข้อผิดพลาด B ยังไม่บันทึก ส่วน bookmark ของ A ยังอยู่ |
| ผล PUT มาถึงเบราว์เซอร์ไม่ครบ | ส่ง PUT ให้ Backend ทำงานจริงแล้วให้ Playwright ตัด response ฝั่งเบราว์เซอร์ หน้าอ่านแจ้งว่ายังยืนยันผลคำขอเดิมไม่ได้ แล้วโหลด GET ใหม่จนแสดงสถานะบันทึกตาม SQL |
| ผลงานถูกลบ | ลบผลงานผ่าน API เจ้าของแล้ว bookmark ของทั้งสองบัญชีหาย GET และ PUT ตอบ HTTP 404 ตามชนิดผลงาน |
| คืนข้อมูล | แถว Guide, Summary, SummaryFile, bookmark และ checksum ของไฟล์ใน volume ตรงกับก่อนสร้าง fixture ตรวจว่า trigger ทดสอบถูกลบแล้ว |

รัน `backend/test/test_saved_items_sqlserver.py` แบบเปิด SQL Server เพิ่มอีก **2 เคสผ่าน** สำหรับ Guide และ PDF ชุดนี้รอให้สองคำขออ่านสถานะก่อนเริ่มเขียน และตรวจกรณีผลงานถูกลบระหว่างอ่านสถานะกับเขียน bookmark

เคสผล PUT ขาดหายจำลองที่เบราว์เซอร์หลัง Backend ตอบ 200 ส่วนเคส SQL ใช้ trigger ปฏิเสธ INSERT ก่อน commit ทั้งสองเคสยังไม่ได้จำลองการตัดการเชื่อมต่อระหว่าง Backend กับ SQL Server ขณะรอผล commit

## หลักฐาน

- Guide [บันทึกสำเร็จ](../assets/task123/guide-01-saved.png) · [SQL ปฏิเสธการบันทึก](../assets/task123/guide-02-sql-failure.png) · [โหลดสถานะหลัง response หาย](../assets/task123/guide-03-lost-response.png)
- PDF [บันทึกสำเร็จ](../assets/task123/summary-01-saved.png) · [SQL ปฏิเสธการบันทึก](../assets/task123/summary-02-sql-failure.png) · [โหลดสถานะหลัง response หาย](../assets/task123/summary-03-lost-response.png)

## วิธีรันซ้ำ

ใช้ [compose.yaml](../../../compose.yaml) เดิม ตั้ง `MSSQL_SA_PASSWORD` ของชุดทดสอบในไฟล์ `.env` พร้อม `SQLSERVER_HOST_PORT=24433`, `BACKEND_HOST_PORT=30800`, `FRONTEND_HOST_PORT=27800` และ `TU_API_MODE=mock` ใช้ Compose project ขึ้นต้นด้วย `cs261-task123-` เพื่อแยก SQL กับ PDF volume ออกจากระบบที่ใช้งาน ตรวจว่า `backend/docker-entrypoint.sh` ใน working tree เป็น LF เมื่อใช้ Docker บน Windows

```powershell
$project = 'cs261-task123-216300d'
docker compose -p $project up -d --build --wait
docker compose -p $project run -d --no-deps --name "$project-backend-b" -e TU_MOCK_USERNAME=6800000001 backend
docker compose -p $project run -d --no-deps --name "$project-frontend-b" -e "BACKEND_URL=http://${project}-backend-b:8000" -p 127.0.0.1:27801:5000 frontend
```

เมื่อ Backend B ขึ้น healthy ให้รัน [สคริปต์เบราว์เซอร์](../../../scripts/task123-u9-browser.cjs) จากโฟลเดอร์ repo

```powershell
$tools = Join-Path $env:TEMP 'cs261-task123-tools'
npm.cmd install --prefix $tools --no-audit --no-fund playwright-core@1.65.1
$env:TASK123_PLAYWRIGHT = Join-Path $tools 'node_modules/playwright-core'
$env:TASK123_PROJECT = $project
$env:TASK123_EVIDENCE = Join-Path $env:TEMP 'cs261-task123-evidence'
node scripts/task123-u9-browser.cjs
```

สคริปต์ล็อกอินบัญชี mock `6800000000` กับ `6800000001` สร้าง PDF เองและตั้งชื่อผลงานขึ้นต้นด้วย `Task123` หลังจบจะลบเฉพาะผลงานที่สร้างในรอบนั้น บัญชี mock คงไว้สำหรับรันซ้ำ ถ้าหยุดกลางทาง ให้ตรวจชื่อกับเจ้าของ fixture ก่อนลบ และตรวจ trigger `dbo.task123_test_save` ในฐานทดสอบก่อนเริ่มใหม่ ปิด Compose ด้วย `docker compose -p $project down --remove-orphans`

ถ้าจะรันเคส SQL Server เพิ่ม ให้ชี้ `DB_CONNECTION_STRING` และ `DB_PASSWORD` ไปที่ฐานทดสอบบนพอร์ต 24433 ตั้ง `U9_TEST_SQLSERVER=1` แล้วรัน `python -m pytest -q test/test_saved_items_sqlserver.py` จาก `backend/` ชุดนี้สร้างและลบ schema ชั่วคราวของตัวเอง
