# Task125 — U6 System test และผลตรวจรับ

**ผลตรวจรับ UAT: PO รับแล้ว ครบ U6-TC01–TC08**

ทดสอบวันที่ 18 พฤศจิกายน 2026 เวลา 06:55–06:56 น. (Asia/Bangkok) ที่ source commit `f296d6f731c1d6c8d43011b7193c3b7a80bf33fa` หลังรวม sprint2 `259b967a07b480a3ef283cb24cd8346b0ca075db` เข้าสาขานี้ ไม่มีการแก้ application code

ใช้ frontend/backend, SQL Server และ PDF volume จริงใน Docker project แยก `cs261-task125-f296d6f-r2` Chrome 157.0.8103.79 / Playwright Core 1.65.1 การเข้าสู่ระบบใช้ **TU mock** ไม่ใช่ TU จริง

## ผลทดสอบ

| กรณี | สิ่งที่ตรวจยืนยัน | ผล |
| --- | --- | --- |
| TC01 | บัญชีอื่นเปิด PDF ผ่าน UI, reload และ checksum ตรงกัน | ผ่าน |
| TC02 | ไม่กรอก description เผยแพร่ได้ SQL เก็บ null | ผ่าน |
| TC03 | ชื่อว่าง/ช่องว่าง วิชาหรือไฟล์ว่าง ถูก UI/API ปฏิเสธ ไม่มี SQL/PDF ค้าง | ผ่าน |
| TC04 | นามสกุล/MIME ผิด เนื้อหาปลอม และเกิน 15,000,000 bytes ถูกปฏิเสธ | ผ่าน |
| TC05 | วิชาไม่มีจริง วิชานอก CS และปลอม owner_id/user_id ถูกปฏิเสธ | ผ่าน |
| TC06 | ไม่มี token, token ผิด, revoke และ session หมดอายุจริงถูกปฏิเสธ; UI กลับ login | ผ่าน |
| TC07 | SQL และ storage ล้มเหลว ได้ 503 พร้อม UI error ไม่มี success dialog และ rollback ไม่เหลือข้อมูล | ผ่าน |
| TC08 | CS261 แสดงตรงวิชา CS104 ว่างทั้ง UI/API | ผ่าน |

Regression: restart backend ด้วย volume เดิม จากนั้น login ใหม่ metadata และ PDF checksum ยังคงเดิม ตรวจ SQL rows และ PDF objects ก่อน/หลังกรณีล้มเหลวด้วย

Frontend ผ่าน 104 tests; backend ผ่าน 480 tests และ 81 subtests, skipped 6 พร้อมคำเตือน Starlette/httpx เดิมหนึ่งรายการ Unit/API tests ใช้ test doubles ตามชุดทดสอบ ส่วน browser run ใช้ SQL และ storage จริง

## หลักฐาน

- [Browser/API checks, requests และ snapshots](../assets/task125/system-f296d6f/results.json)
- [Cleanup SQL และ volume](../assets/task125/system-f296d6f/cleanup.json)
- [Verification และ SHA256 runner แบบ LF](../assets/task125/system-f296d6f/verification.json)
- [01-read-pdf.png](../assets/task125/system-f296d6f/01-read-pdf.png)
- [02-sql-publish-failure.png](../assets/task125/system-f296d6f/02-sql-publish-failure.png)
- [03-storage-publish-failure.png](../assets/task125/system-f296d6f/03-storage-publish-failure.png)
- [TC03-course.png](../assets/task125/system-f296d6f/TC03-course.png)
- [TC03-file.png](../assets/task125/system-f296d6f/TC03-file.png)
- [TC03-title.png](../assets/task125/system-f296d6f/TC03-title.png)
- [TC03-whitespace.png](../assets/task125/system-f296d6f/TC03-whitespace.png)
- [TC04-disguised.pdf.png](../assets/task125/system-f296d6f/TC04-disguised.pdf.png)
- [TC04-not-pdf.txt.png](../assets/task125/system-f296d6f/TC04-not-pdf.txt.png)
- [TC08-other-course-empty.png](../assets/task125/system-f296d6f/TC08-other-course-empty.png)

[ภาพเดิมของ PR](../assets/task125/original-submission/) เก็บแยกจากหลักฐานรันครั้งนี้

## การรันซ้ำและ cleanup

ใช้ [runner](../../../scripts/task125-u6-browser.cjs) กับ [Compose](../../../compose.yaml) บน project ใหม่ชื่อ `cs261-task125-<suffix>` ตั้ง TU_API_MODE=mock และรหัสผ่าน SQL สำหรับทดสอบใหม่ ใช้ frontend A ที่ 27500 และ B ที่ 27501 โดย frontend แต่ละตัวชี้ backend ของตัวเองบน network เดียวกัน ชื่อ containers ต้องเป็น `<project>-backend-1`, `<project>-frontend-1`, `<project>-backend-b`, `<project>-frontend-b` และมี Compose project label ตรงกัน สร้าง `<project>-backend-expiring` ด้วย AUTH_SESSION_TTL_SECONDS=1 และ host port 28526 รอทุก backend พร้อมก่อนรัน

ตั้ง TASK125_PROJECT เป็น project นั้น, TASK125_PLAYWRIGHT เป็น absolute path ของ playwright-core และ TASK125_EVIDENCE เป็น directory หลักฐานใหม่ แล้วรัน `node scripts/task125-u6-browser.cjs` runner ตรวจ ownership ก่อนเริ่มและล้าง fixture ใน finally

ผล cleanup ครั้งนี้: summary rows 0, file rows 0, test triggers 0, non-CS fixture 0, PDF objects ว่าง และ permission กลับเป็น 0755 หลังเก็บหลักฐานหยุดเฉพาะ test project โดยไม่ลบ volumes
