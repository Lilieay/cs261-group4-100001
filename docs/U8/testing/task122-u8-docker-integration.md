# Task122 ผลทดสอบ Integration รีวิว U8 บน Docker

ทดสอบการดู เพิ่ม แก้ไข และลบรีวิวของ Guide กับสรุป PDF ผ่านหน้าเว็บจริงแล้ว โดยใช้ Express proxy, FastAPI, SQL Server และ PDF volume จาก Compose ของโครงการเดิม การยืนยันตัวตนใช้ **TU mock** ไม่ได้เรียก TU จริง

วันที่ทดสอบ 16 พฤศจิกายน 2569 ใช้ source ของ `sprint2` ที่ `a646cdba46ed6ba27232e7400f97aeefa05fcd8a` ซึ่งรวม Backend U6/U8 และ Frontend U8 แล้ว รันซ้ำหลังแก้ตาม review ที่ commit `f2e2105` ผลรอบสุดท้ายบันทึก SHA เต็มและรุ่น browser/Docker/SQL Server ไว้ใน [results.json](../assets/task122/results.json)

## ผลจากระบบจริง

| สิ่งที่ตรวจ | ผลที่ได้ ทั้ง Guide และ PDF |
| --- | --- |
| บัญชีและสิทธิ์ | Login ผ่านหน้าเว็บสองบัญชี ได้ user ID ต่างกันใน SQL จริง เจ้าของผลงานเห็นข้อความว่ารีวิวงานตนเองไม่ได้และไม่มีปุ่มเพิ่มรีวิว |
| เพิ่มและแสดงรีวิว | ผู้ใช้อีกคนเพิ่ม 5 ดาวพร้อมข้อความผ่านหน้าเว็บได้ 201 อ่านข้อมูลคืนผ่านรายการรีวิวและตรวจแถว SQL ว่าตรงกัน |
| โหลดใหม่และ session ใหม่ | เปิดหน้าอ่านใหม่แล้วรีวิวยังอยู่ Login ใหม่ออก Bearer session ใหม่แล้วเปิดรีวิวเดิมได้ |
| แก้ไข | เปลี่ยนเป็น 4 ดาวและข้อความใหม่ผ่านหน้าเว็บ ได้ 200 โดยใช้ review ID เดิม SQL เก็บค่าล่าสุด |
| ตรวจข้อมูล | API ปฏิเสธดาวทศนิยมและข้อความ emoji 2,001 code points ด้วย 422 ข้อมูลเดิมไม่เปลี่ยน |
| ตรวจสิทธิ์ | ไม่มี token ได้ 401 รีวิวงานตนเองได้ 403 เพิ่มซ้ำได้ 409 อีกบัญชีแก้หรือลบรีวิวไม่ได้ ได้ 403 |
| SQL ล้มเหลว | Trigger ที่จำกัดเฉพาะ target ทดสอบปฏิเสธ INSERT/UPDATE/DELETE จริง ได้ 503 ไม่มีรีวิวใหม่เมื่อเพิ่มล้มเหลว และคะแนน/ข้อความเดิมยังอยู่เมื่อแก้หรือลบล้มเหลว |
| หน้าเว็บเมื่อ SQL ล้มเหลว | ส่งแก้ไขผ่านฟอร์มแล้วได้ 503 ตรวจว่า error message มองเห็นจริงและตรงข้อความจาก API มี GET รีวิวของ target นั้นหลัง PUT ล้มเหลว ได้ 200 พร้อม review ID เดิม 4 ดาว/ข้อความ “แก้ไขแล้ว” หน้าแจ้งว่าโหลดข้อมูลล่าสุดแล้ว draft 1 ดาว/ข้อความ “ต้องไม่ถูกบันทึก” ยังคงอยู่ เมื่อยกเลิกฟอร์มเห็นรีวิวเดิม 4 ดาว/ข้อความเดิมบนหน้าเว็บ และ SQL ยังคงค่าเดิม ตรวจแยก Guide/PDF |
| ลบรีวิว | กดยกเลิกลบแล้วข้อมูลยังอยู่ กดยืนยันได้ 204 และตรวจว่าแถว SQL หาย รีวิวของอีกบัญชีบนผลงานอีกชิ้นยังเหมือนเดิม |
| ลบแล้วสร้างใหม่และคำขอพร้อมกัน | หลังลบ ส่ง POST พร้อมกันสองคำขอ ได้หนึ่ง 201 และหนึ่ง 409 เกิดรีวิวเดียว ใช้ review ID ใหม่ |
| PDF จริง | เผยแพร่ PDF ที่ parser อ่านได้และโหลดผ่าน API หลังทดสอบรีวิว ได้ SHA-256 ตรงไฟล์ตั้งต้น ตรวจไฟล์ใน volume ด้วย checksum อีกชั้น |
| Target ถูกลบ | ลบ Guide/PDF ด้วย API เจ้าของแล้ว SQL cascade เฉพาะรีวิวที่เกี่ยวข้อง GET/POST ของ target ได้ 404 และ PUT/DELETE ของรีวิวที่หายได้ 404 รีวิวของอีกผลงานยังอยู่ |
| คืนข้อมูล | หลังจบเทียบทุกแถวในตารางที่ตรวจและ SHA-256 ของไฟล์ PDF กับ baseline ก่อนสร้างผลงาน ตรงกันทั้งหมด ลบ trigger ทดสอบแล้ว |

ผลนี้มาจากการรัน browser กับ Docker จริง ไม่มีการ mock DAO, SQL, API response หรือ PDF storage ส่วน TU Login เป็น mock ตามที่ระบุ ข้อผิดพลาดฐานข้อมูลใช้ SQL trigger จริง ไม่ใช่การหยุด SQL Server หรือจำลอง connection หลุดระหว่าง commit จึงยังไม่ใช่ผลทดสอบกรณีเครือข่ายฐานข้อมูลขาดหาย

## หลักฐาน

- Guide: [เพิ่ม](../assets/task122/guide-01-create.png), [แก้ไข](../assets/task122/guide-02-update.png), [SQL ปฏิเสธการแก้](../assets/task122/guide-03-sql-failure.png), [ลบแล้ว](../assets/task122/guide-04-delete.png)
- PDF: [เพิ่ม](../assets/task122/summary-01-create.png), [แก้ไข](../assets/task122/summary-02-update.png), [SQL ปฏิเสธการแก้](../assets/task122/summary-03-sql-failure.png), [ลบแล้ว](../assets/task122/summary-04-delete.png)
- หลังออกจากฟอร์มที่ SQL ปฏิเสธการแก้ แสดงรีวิวเดิม: [Guide](../assets/task122/guide-03a-review-after-failure.png), [PDF](../assets/task122/summary-03a-review-after-failure.png)
- [ผลแบบ JSON รวม SHA/environment/auth mode และ ID ข้อมูลทดสอบ](../assets/task122/results.json)
- [สคริปต์ browser และคำขอที่รันซ้ำได้](../../../scripts/task122-u8-browser.cjs)

## ข้อมูลทดสอบและสิ่งที่จำลอง

ใช้บัญชี mock `6800000000` กับ `6800000001` รหัสผ่านสำหรับ mock คือ `0000000000000` เท่านั้น ทั้งสองมี user ID ต่างกันในฐานเดียวกัน ใช้ Backend สอง process เพราะ mock provider รองรับบัญชีนักศึกษาหนึ่งบัญชีต่อ process และ session เก็บในหน่วยความจำ แยก Frontend proxy สองตัวให้ส่ง token ไปยัง Backend ที่ออก session นั้น

สคริปต์สร้าง Guide และ PDF อย่างละสองชิ้นผ่าน API ตั้งชื่อด้วย `Task122-<timestamp>` บนวิชา CS261 เดิม บัญชี A เป็นเจ้าของผลงานชุดแรก B เป็นผู้รีวิว ส่วนอีกชุดสลับบทบาท ใช้รีวิวชุดหลังเป็นข้อมูลควบคุมว่าคำขอบนผลงานแรกไม่เปลี่ยนข้อมูลคนอื่น ไฟล์ PDF สร้างโดยสคริปต์ ไม่ใช้เอกสารจริงของสมาชิก

Baseline เก็บหลัง Login ก่อนสร้างผลงาน ตรวจตาราง `users`, `courses`, `guides`, `summaries`, `summary_files`, `reviews`, `saved_guides`, `saved_summaries` และไฟล์ใน PDF volume หลัง cleanup ต้องมีแถวและไฟล์เท่าเดิม บัญชี mock จึงยังอยู่สำหรับรันซ้ำ ไม่ย้อน identity counters ของ SQL Server

## วิธีรันซ้ำ

ใช้ Docker Desktop แบบ Linux containers, Node, Chrome หรือ Edge และ Playwright Core ทดสอบบนสำเนา source รุ่นที่ระบุข้างต้น สร้างไฟล์ `.env` สำหรับทดสอบโดยกำหนดค่าต่อไปนี้ รหัสผ่าน SQL ให้ตั้งเองและไม่ commit:

```dotenv
MSSQL_SA_PASSWORD=<รหัสผ่าน SQL สำหรับชุดทดสอบตามกติกา SQL Server>
SQLSERVER_HOST_PORT=22433
BACKEND_HOST_PORT=28800
FRONTEND_HOST_PORT=25800
TU_API_MODE=mock
```

ใช้ [Compose เดิม](../../../compose.yaml) และ [override ของ Task122](../../../compose.task122.yaml) ให้ชื่อ project ขึ้นต้น `cs261-task122-` เพื่อแยกข้อมูลทดสอบจากชุดใช้งาน ไม่มีการสร้างโครงการแอปหรือออกแบบ schema U6 ซ้ำ override บังคับ TU mock และให้ Backend B รอ schema จาก Backend A ก่อน

```powershell
$task122Project = 'cs261-task122-a646cdb'
docker compose --env-file .env -p $task122Project -f compose.yaml -f compose.task122.yaml up -d --build --wait
docker compose --env-file .env -p $task122Project exec -T backend python -m scripts.init_reviews
```

Backend entrypoint ลง schema U6 เดิมก่อน คำสั่งที่สองเพิ่มเฉพาะ `reviews` และ indexes ตาม Task114 ต้องรันครั้งเดียวในชุดใหม่ ถ้ามีตารางอยู่แล้วคำสั่งจะหยุดโดยไม่แก้ตาราง ให้ตรวจ columns, FK และ indexes เทียบ Task114 ก่อนใช้ ห้ามลบตารางเพื่อให้คำสั่งผ่าน

Frontend A เปิดที่ `http://127.0.0.1:25800` และ B ที่ `http://127.0.0.1:25801` Backend ใช้พอร์ต 28800/28801 SQL Server ใช้ 22433 สคริปต์ยึดสองพอร์ต Frontend นี้

```powershell
$task122Tools = Join-Path $env:TEMP 'cs261-task122-browser-tools'
npm.cmd install --prefix $task122Tools --no-audit --no-fund playwright-core@1.65.1
$env:TASK122_PLAYWRIGHT = Join-Path $task122Tools 'node_modules/playwright-core'
$env:TASK122_PROJECT = $task122Project
$env:TASK122_EVIDENCE = Join-Path $env:TEMP 'cs261-task122-evidence'
node scripts/task122-u8-browser.cjs
```

ถ้าใช้ Edge ให้ตั้ง `$env:TASK122_BROWSER = 'msedge'` ก่อนรัน ผลสำเร็จต้อง exit 0 และ `results.json` มี `passed: true` พร้อมผล cleanup การรันซ้ำใช้ชุดเดิมได้โดยไม่เรียก `init_reviews` ซ้ำ สคริปต์จะสร้างและลบเฉพาะผลงานของรอบนั้น ไม่บันทึก token หรือรหัสผ่าน SQL ลงหลักฐาน

## การคืนข้อมูลและสถานะส่งตรวจ

รอบแก้ตาม Requested changes ของ PR #132 เพิ่ม assertions ที่เดิมตรวจเพียงหยุด busy กับ SQL ยังไม่เปลี่ยน โดยรอ response GET จริงหลัง PUT 503 ตรวจ payload ที่อ่านใหม่ ตรวจ error ที่มองเห็นและข้อความโหลดข้อมูลล่าสุด รวมถึงตรวจรีวิวที่แสดงหลังยกเลิกฟอร์ม พร้อมเก็บรายละเอียดผลใน JSON ทั้ง Guide/PDF เพิ่มการรอ PDF viewer พร้อมและโฟกัสปุ่มก่อนเปิดรีวิว หลังรอบแรกหยุดที่จังหวะเปิดหน้าต่าง PDF แล้วรันทั้งชุดซ้ำผ่าน ไม่ได้แก้โค้ดแอปเพื่อให้ผ่าน

สคริปต์ใช้ `finally` ลบ trigger แล้วลบผลงานที่ตัวเองสร้างผ่าน API เจ้าของ จากนั้นเทียบ baseline หากหยุด process หรือปิด Docker กลางทาง ให้ใช้ ID ในผลรอบนั้นตรวจชื่อและเจ้าของก่อนคืนเฉพาะ fixture ห้ามลบข้อมูลทั้งตาราง ผลรอบที่ cleanup ไม่ผ่านยังถือว่ารันไม่สำเร็จ

หลังเก็บผล ปิดเฉพาะชุดทดสอบได้ด้วยคำสั่งนี้ โดยเก็บ volume ไว้สำหรับรันซ้ำ:

```powershell
docker compose --env-file .env -p $task122Project -f compose.yaml -f compose.task122.yaml down --remove-orphans
```

เตรียมชุดทดสอบ ค่าตั้ง หลักฐานและรายงานครบแล้ว เปิด PR จาก `feat/u8-reviews-backend` เข้า `sprint2` ตามข้อตกลงของทีม ยังต้องให้สมาชิกอีกคน review ก่อน merge
