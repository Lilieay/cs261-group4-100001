# Task118 ผลทดสอบ Unit และ API

วันที่ 16 พฤศจิกายน 2569 สถานะผ่าน Unit/API และ proxy tests รอ independent review กับ SQL Server/Docker Integration

| คำสั่ง | ผลจริง |
| --- | --- |
| pytest test_saved_items_u10_api.py และ test_saved_items_u10_service.py | 43 passed, 1 warning ใน 2.21 วินาที |
| pytest backend/test -q --disable-warnings --maxfail=1 | 467 passed, 4 skipped, 81 subtests passed, 1 warning ใน 10.44 วินาที |
| npm test ใน frontend | 90 passed, 0 failed ใน 940 มิลลิวินาที |

Environment: Windows, Python 3.12.14, pytest 9.2.0, FastAPI 0.162.7, SQLAlchemy 2.1.8; skipped เป็นชุด SQL Server opt-in เดิม Warning เป็น Starlette TestClient/httpx deprecation ใช้ base `sprint2` commit `a646cdb` ผลนี้ไม่ใช่ SQL Server หรือ Browser Integration

## TC mapping และขอบเขต Mock

| กรณี | หลักฐานที่ตรวจ |
| --- | --- |
| U10-TC01 เพิ่ม/เพิ่มซ้ำ | ใช้ PUT จาก Task116 เตรียมข้อมูล และรัน regression ของ Task116 เดิม ไม่สร้างระบบ save ซ้ำ |
| U10-TC02 เปิดวิชา/ผลงานตรงชิ้น | API list ส่ง identity+course+open_path ถูกชนิดแม้ ID เท่ากัน มีหลาย Summary ในวิชาเดียว Node test ตรวจ Guide alias ส่ง exact ID และ Bearer; การกด UI และอ่าน PDF จริงยังรอ Integration |
| U10-TC03 empty | บัญชี A ไม่มี bookmark ได้ 200 items ว่าง บัญชี B มี Guide เดิมแล้วได้เฉพาะรายการของ B; ข้อความ UI/ปุ่มค้นหาตรวจในงาน Frontend |
| U10-TC04 สิทธิ์ | list/remove ใช้ current user, ไม่มี/หมดอายุ token ได้ 401 พร้อม WWW-Authenticate, ไม่รับ user_id ใน body/query, bookmark ของอีกบัญชีอยู่ครบ |
| U10-TC05 invalid/missing | DELETE ปฏิเสธ type/ID ผิดเป็น 422; target ถูกลบแล้ว/ไม่มี bookmark ได้ 200 false ซ้ำได้ตาม contract แยกจาก GET state/PUT ที่ใช้ 404 ของ Task116 |
| U10-TC06 failure | mock read error ของ Guide/Summary DAO แยกกันต้อง 503 ทั้งรายการ; หลัง DELETE จริงใน SQLite จำลอง exception และก่อน commit จำลอง failure ต้อง rollback และ state ยัง true; Node failure ได้ ErrorResponseDTO |
| U10-TC07 remove ซ้ำ | DELETE สองครั้งได้ false ทั้งคู่ อีกชนิดในบัญชีเดิมและ bookmark ของ B ยังอยู่ Course/Guide/Summary/file metadata ไม่เปลี่ยน |

Unit Service ใช้ fake Session/DAO ตรวจ dispatch, sort, transaction และผล zero-row/one-row API ใช้ routing/service/DAO และ SQLite จริง โดย override auth กับ DB session; Node proxy ใช้ HTTP server จริงแต่ mock upstream fetch ไม่เรียก Backend/SQL จริง ชุดข้อมูลและวิธีรันอยู่ใน [คู่มือ](../implementation/task118-saved-items-backend.md)

## สิ่งที่พบและแก้ระหว่างทดสอบ

หลังเพิ่ม Guide alias `/api/guides/{guideId}` เส้นทาง `/api/guides/my-guides` ถูกตรวจเป็น ID ผิดและได้ 422 แทน 404 เดิม ปรับ regression test ให้ตรง alias ใหม่ พร้อมยืนยันว่าไม่ส่งคำขอไป Backend ส่วน legacy `/api/guides/guides/{id}` ยังเปิดได้

ยังต้องตรวจ persistence กับบัญชี/session จริง, SQL Server isolation/cascade/rollback, PDF checksum ก่อน–หลัง และ UI ผ่าน Docker ใน Task124 ไม่มีการอ้างว่า 4 tests ที่ skip ผ่านแล้ว
