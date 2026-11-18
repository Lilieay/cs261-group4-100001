# ผลทดสอบ Integration U7 บน Docker

Task121 ทดสอบหน้า “สรุปของฉัน” ตั้งแต่เบราว์เซอร์ผ่าน Frontend proxy และ Backend ไปถึง SQL Server กับที่เก็บ PDF ส่วนตัวแล้ว เมื่อยืนยันลบ ทั้งข้อมูลและไฟล์หายจากระบบ เมื่อการแก้ไขล้มเหลว ข้อมูลและไฟล์เดิมยังอยู่

ทดสอบวันที่ 16 พฤศจิกายน 2569 จาก `sprint2` ที่ commit `649a4d67fa9d5d1576a0e4653584549fa2a1d97b` พร้อม [ค่าตั้ง LF สำหรับ entrypoint](../../../.gitattributes) ของ Task121 โค้ดนี้รวม Frontend U6 (#124), Frontend U7 (#125) และ Backend U7 (#123) แล้ว ใช้ Docker Engine 29.8.2, SQL Server 2022 รุ่น 16.0.4305.5, Chrome 157.0.8103.78 และ Playwright 1.65.1

## ผลที่ได้

| กรณี | ผลจากการรันจริง |
| --- | --- |
| TC01–TC02 ดูรายการและเปิด PDF | A เห็นเฉพาะรายการของตน หน้าอ่านเปิดไฟล์ตรงกับรายการและ SHA-256 ตรงกับไฟล์ตั้งต้น เมื่อไม่มีรายการ หน้าแสดงข้อความและทางไปเผยแพร่ |
| TC03 แก้ข้อมูล ย้ายวิชา และเปลี่ยนไฟล์ | PUT ตอบ 200 รายการย้ายไปวิชาใหม่และอยู่หลัง reload กับ login ใหม่ แก้ข้อมูลอย่างเดียวคงไฟล์เดิม เมื่อแทนที่ PDF แล้วได้ checksum ใหม่และไฟล์เก่าถูกเก็บกวาด ปีการศึกษา ภาคเรียน และช่วงสอบยังอยู่ |
| TC04 ข้อมูลไม่ถูกต้อง | ชื่อว่างหลัง trim ทำให้หน้าแสดง error และไม่ส่ง PUT ข้อมูลเก่ายังอยู่ |
| TC05–TC06 ยืนยันหรือยกเลิกลบ | ยกเลิกไม่ส่ง DELETE และเปิด PDF เดิมได้ ยืนยันตอบ 204 แล้วแถวสรุป แถวไฟล์ และไฟล์จริงหาย |
| TC07 แยกสิทธิ์ | ไม่มี token เรียกรายการได้ 401 บัญชี B เปิดอ่านสรุปที่เผยแพร่ได้ แต่แก้หรือลบของ A ได้ 403 และข้อมูลไม่เปลี่ยน |
| TC08 รายการหายหรือฐานข้อมูลเขียนไม่ได้ | หลังลบ เปิดรายละเอียด เปิด PDF และลบซ้ำได้ 404 โดยไม่กระทบรายการของ B เมื่อ trigger ทดสอบปฏิเสธการแก้แถวไฟล์ SQL Server ย้อนการแก้ metadata และไฟล์ใหม่ที่เตรียมไว้ถูกเก็บกวาด |
| TC09 ที่เก็บไฟล์เขียนไม่ได้ | ใช้ volume จริงแบบอ่านได้แต่เขียนไม่ได้ชั่วคราว ได้ 503 `STORAGE_UNAVAILABLE` ฟอร์มยังเก็บค่าที่กรอกและไฟล์ที่เลือกไว้ ส่วน SQL และ PDF ที่เปิดจากระบบยังเป็นตัวเดิม |
| เพิ่มคอลัมน์ใน schema เดิม | สร้างสรุปแบบเดิมในชุดทดสอบ จำลองตารางก่อนมีสามคอลัมน์ แล้วรันตัวเพิ่มคอลัมน์บน SQL Server สองครั้ง คอลัมน์ใหม่เป็น null และชื่อ คีย์ไฟล์ และ checksum เดิมยังตรง |

ภาพประกอบ: [รายการของเจ้าของ](../assets/task121/01-owned-list.png) · [หน้าเปิด PDF](../assets/task121/02-open-pdf.png) · [ฟอร์มเมื่อที่เก็บไฟล์เขียนไม่ได้](../assets/task121/03-storage-failure.png) · [ยืนยันลบ](../assets/task121/04-confirm-delete.png)

## จุดที่แก้ระหว่างทดสอบ

Windows แปลง `backend/docker-entrypoint.sh` เป็น CRLF ได้ แม้ใน commit เดิมจะเก็บ LF อยู่ ทำให้ Linux เปิด Backend ไม่ได้และแจ้ง `exec /app/docker-entrypoint.sh: no such file or directory` เพิ่ม `.gitattributes` ให้ไฟล์นี้ checkout เป็น LF แล้ว build ซ้ำได้ครบทั้งสาม service

## ขอบเขตและข้อมูลทดสอบ

ใช้ Docker Compose โปรเจกต์แยก ฐานข้อมูลและ volume PDF แยกจากชุดใช้งาน สร้างบัญชี mock นักศึกษา A `6800000000` และ B `6800000001` ให้มี user ID คนละค่าในฐานเดียวกัน รัน Backend สองตัวเพราะ mock provider รองรับบัญชีนักศึกษาหนึ่งบัญชีต่อ process และ token อยู่ในหน่วยความจำของแต่ละ process ทั้งสองตัวใช้โค้ดเดียวกัน ไม่ใช้ TU Login จริง

สคริปต์สร้าง PDF ตัวอย่างเอง มีไฟล์เดิม ไฟล์ใหม่ และไฟล์สำหรับทดสอบการเขียนล้มเหลว เทียบเนื้อหาด้วย SHA-256 และตรวจแถว `summaries`, `summary_files` กับไฟล์ใน volume หลังดำเนินการ ไม่มีรหัสผ่าน SQL Server หรือ token ในหลักฐาน

## วิธีรันซ้ำ

ใช้ [compose.yaml](../../../compose.yaml) กับ source ที่ SHA ข้างต้นและไฟล์ `.gitattributes` จากงานนี้ ตรวจด้วย `git ls-files --eol -- backend/docker-entrypoint.sh` ว่าไฟล์ที่ใช้ build เป็น `w/lf` ตั้งรหัสผ่าน SQL Server สำหรับทดสอบในไฟล์ `.env` ของสำเนา และตั้ง `TU_API_MODE=mock`, `SQLSERVER_HOST_PORT=21433`, `BACKEND_HOST_PORT=28000`, `FRONTEND_HOST_PORT=25000` ใช้ฐานข้อมูลและ volume ว่างเพื่อให้ทดสอบจำลอง schema เก่าและจำกัดสิทธิ์เขียน PDF ได้

```powershell
$project = 'cs261-task121-649a4d6'
docker compose -p $project up -d --build --wait
docker compose -p $project run -d --no-deps --name "$project-backend-b" -e TU_MOCK_USERNAME=6800000001 backend
docker compose -p $project run -d --no-deps --name "$project-frontend-b" -e "BACKEND_URL=http://${project}-backend-b:8000" -p 127.0.0.1:25001:5000 frontend
```

เมื่อ Backend บัญชี B ตอบ HTTP 200 ที่ `/` แล้ว ให้รัน [scripts/task121-u7-browser.cjs](../../../scripts/task121-u7-browser.cjs) จากโฟลเดอร์ repo ด้วย Node และ Playwright ที่แยกไว้สำหรับทดสอบ พร้อม Chrome หรือ Edge ที่ติดตั้งในเครื่อง

```powershell
$browserTools = Join-Path $env:TEMP 'cs261-task121-browser-tools'
npm.cmd install --prefix $browserTools --no-audit --no-fund playwright-core@1.65.1
$env:TASK121_PROJECT = 'cs261-task121-649a4d6'
$env:TASK121_PLAYWRIGHT = Join-Path $browserTools 'node_modules/playwright-core'
$env:TASK121_EVIDENCE = Join-Path $env:TEMP 'cs261-task121-evidence'
node scripts/task121-u7-browser.cjs
```

ถ้าใช้ Edge ให้ตั้ง `TASK121_BROWSER=msedge` ก่อนรัน สคริปต์จะลบเฉพาะสรุปที่ตัวเองสร้าง คืนสิทธิ์เขียน volume และลบ SQL trigger ทดสอบหลังใช้ ปิดชุดทดสอบด้วย `docker compose -p cs261-task121-649a4d6 down --remove-orphans` จากโฟลเดอร์ที่ใช้เปิดระบบ โดยคง volumes ไว้ถ้าจะเก็บหลักฐานเพิ่ม

## ขอบเขตผลและการคืนข้อมูล

รอบนี้ตรวจ SQL Server และ volume จริง แต่การยืนยันตัวตนใช้ TU mock เท่านั้น หลังทดสอบตรวจแล้วว่า `summaries`, `summary_files`, ไฟล์ PDF ทดสอบ และ trigger ทดสอบเหลือ 0 รายการ สิทธิ์โฟลเดอร์ PDF กลับเป็น 755 เก็บบัญชี mock ไว้สำหรับรันซ้ำ

ชุด Unit/API ที่รันก่อนหน้าใช้ SHA เดียวกัน: Frontend 76 ผ่าน และ Backend 395 ผ่าน, 81 subtests ผ่าน, ข้าม 3 เคสที่ต้องเปิดโหมด SQL Server แยก ผลในตารางด้านบนมาจากการรันเบราว์เซอร์กับ Docker อีกชุดหนึ่ง
