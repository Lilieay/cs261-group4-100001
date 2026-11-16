# ผลทดสอบ Integration U6 บน Docker

Task120 ทดสอบจาก sprint2 ที่ `a646cdba46ed6ba27232e7400f97aeefa05fcd8a` วันที่ 16 พฤศจิกายน 2569 ใช้ Docker Engine 29.8.2, SQL Server 2022 16.0.4305.5, Chrome 157.0.8103.78 และ Playwright Core 1.65.1

## ผลที่ได้

| กรณี | ผลจากการรัน |
| --- | --- |
| เผยแพร่ → รายการตรงวิชา → เปิด PDF | A เผยแพร่จากฟอร์มได้ HTTP 201 ตรวจพบ metadata และไฟล์ใน SQL/volume แล้ว B กดเปิดจากการ์ดในหน้า CS261 ได้และ SHA-256 ตรงกับไฟล์ต้นฉบับ |
| สิทธิ์และข้อมูล | สองบัญชีมี user ID ต่างกัน เปิดไฟล์โดยไม่มี session ได้ HTTP 401 เผยแพร่ด้วย ID วิชาที่ไม่มีอยู่ได้ HTTP 404 |
| SQL เขียนไม่ได้ | Trigger ปฏิเสธการเพิ่มเฉพาะชื่อ fixture ได้ HTTP 503 ไม่เกิดแถวใหม่และชุดไฟล์ใน volume เท่าเดิม |
| ที่เก็บ PDF เขียนไม่ได้ | ปิดสิทธิ์เขียน volume ชั่วคราว ได้ HTTP 503 `STORAGE_UNAVAILABLE` ไม่เกิดแถวหรือไฟล์เพิ่ม คืนสิทธิ์เดิมหลังทดสอบ |
| สร้าง Backend ใหม่ | Recreate เฉพาะ Backend โดยคง SQL และ PDF volume ไว้ A ล็อกอินใหม่ด้วย user ID เดิมและอ่าน metadata กับ PDF ที่ checksum ตรงเดิมได้ |
| คืนข้อมูล | ลบสรุปผ่าน API ของ A แล้วตรวจว่าแถวสรุป แถวไฟล์ และไฟล์ทดสอบหาย |

[ภาพเปิด PDF จากหน้ารายวิชา](../assets/task120/01-read-pdf.png) · [สคริปต์ทดสอบ](../../../scripts/task120-u6-browser.cjs)

ใช้ TU mock สำหรับ Login สองบัญชี ส่วนเบราว์เซอร์, Frontend proxy, Backend, SQL Server และ PDF volume ใช้จริง บัญชีทดสอบคือ `6800000000` และ `6800000001` สคริปต์สร้าง PDF ขนาดเล็กเอง และลบเฉพาะสรุปที่สร้างในรอบนั้น บัญชี mock คงไว้สำหรับรันซ้ำ

## วิธีรันซ้ำ

ใช้ Compose เดิมในโฟลเดอร์ repo ตั้งค่าในไฟล์ `.env` ของชุดทดสอบ ได้แก่ `MSSQL_SA_PASSWORD` ของชุดทดสอบ, `TU_API_MODE=mock`, `SQLSERVER_HOST_PORT=23433`, `BACKEND_HOST_PORT=29800`, `FRONTEND_HOST_PORT=26800` ใช้ project ใหม่ที่ขึ้นต้นด้วย `cs261-task120-` เพื่อแยก SQL และ PDF volume และให้ volume PDF ว่างก่อนเริ่ม

```powershell
$project = 'cs261-task120-a646cdb'
docker compose -p $project up -d --build --wait
docker compose -p $project run -d --no-deps --name "$project-backend-b" -e TU_MOCK_USERNAME=6800000001 backend
docker compose -p $project run -d --no-deps --name "$project-frontend-b" -e "BACKEND_URL=http://${project}-backend-b:8000" -p 127.0.0.1:26801:5000 frontend
```

เมื่อ Backend B ตอบ HTTP 200 ที่ `/` แล้ว ให้รันจากโฟลเดอร์เดียวกัน

```powershell
$tools = Join-Path $env:TEMP 'cs261-task120-tools'
npm.cmd install --prefix $tools --no-audit --no-fund playwright-core@1.65.1
$env:TASK120_PROJECT = $project
$env:TASK120_PLAYWRIGHT = Join-Path $tools 'node_modules/playwright-core'
$env:TASK120_EVIDENCE = Join-Path $env:TEMP 'cs261-task120-evidence'
node scripts/task120-u6-browser.cjs
```

คง line ending ของ `backend/docker-entrypoint.sh` เป็น LF ด้วย `.gitattributes` เพื่อให้ entrypoint ทำงานใน Linux container เมื่อ checkout บน Windows เมื่อจบงานใช้ `docker compose -p $project down --remove-orphans` เพื่อหยุดชุดทดสอบโดยเก็บ volumes ไว้ ถ้าหยุดสคริปต์กลางทาง ให้ตรวจ trigger `task120_test_publish` และคืนสิทธิ์ PDF volume ก่อนรันซ้ำ จากนั้นตรวจชื่อขึ้นต้น `Task120` และเจ้าของก่อนลบเฉพาะ fixture ค้าง
