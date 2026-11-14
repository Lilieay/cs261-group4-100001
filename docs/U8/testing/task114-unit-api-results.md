# Task114 ผลทดสอบ Unit และ API

วันที่ 14 พฤศจิกายน 2569 บน Windows, Python 3.12.14, FastAPI 0.162.7, Pydantic 2.14.3, SQLAlchemy 2.1.8, pytest 9.2.0

ผลล่าสุด `python -m pytest backend/test -q --disable-warnings --maxfail=1`: **232 passed, 2 skipped, 65 subtests passed** ใช้เวลา 5.01 วินาที มี warning 1 รายการจาก dependency ผลนี้รวม Unit/API ของ Task114 และ regression ของ Backend เดิม ไม่ใช่ผล SQL Server หรือ Browser Integration

ชุด Task114 มี 94 tests ใน `backend/test/test_reviews_unit.py` และ `backend/test/test_reviews_api.py` โดยผลรันรวมข้างต้นผ่านทั้งหมด 2 tests ที่ skip อยู่ในชุดเดิมและต้องเปิด flag SQL Server

## สิ่งที่ทดสอบและส่วนที่จำลอง

| ระดับ | ส่วนที่ใช้จริง | ส่วนที่ Mock หรือใช้แทน |
| --- | --- | --- |
| Unit validation | Pydantic schema, strict rating, normalize comment และ Unicode code points | ไม่มี SQL/API |
| Unit business | Service ตรวจเจ้าของ/target, rollback และแปลง error | Session กับ DAO เป็น MagicMock |
| Unit DDL / initializer | compile SQL Server DDL/lock hint, ตรวจสร้างเฉพาะ reviews และไม่เปลี่ยน target เดิมบน SQLite | ไม่รัน SQL Server DDL; summaries เป็น schema ขั้นต่ำสำหรับ test |
| API | FastAPI routing, request validation, current_user, Service, DAO, SQLAlchemy transaction และ SQLite constraints | auth service เป็น test double ของ Bearer token; get_db_session เปลี่ยนเป็น SQLite; ไม่มี TU API, SQL Server, PDF หรือ Browser จริง |
| API failure injection | SQL เขียนจริงใน SQLite ก่อนจำลอง exception แล้วตรวจ rollback และค่าหลังโหลดใหม่ | patch DAO เพื่อให้ล้มเหลวหลังเขียนก่อน commit และ patch session.commit ให้ล้มเหลวก่อน commit จริง |

Tests ไม่ mock response DTO หรือ service ใน API lifecycle จึงตรวจค่าที่บันทึกและอ่านกลับผ่าน API จริงของแอปบน SQLite แต่การล็อกและชนกันของ SQL Server ยังไม่ถูกพิสูจน์

## จับคู่ TC

| TC | กรณีที่ผ่านใน Unit/API |
| --- | --- |
| U8-TC01 | เพิ่มคะแนนพร้อมข้อความทั้ง guide/summary อ่านกลับจากรายการของผลงานเดียวกัน เรียงจากใหม่ไปเก่า |
| U8-TC02 | คะแนนขอบเขต 1/5, ไม่ส่งข้อความ, null, whitespace |
| U8-TC03 | POST/PUT คะแนนขาด/null/0/6/ติดลบ/ทศนิยม/string/boolean โดยคงรีวิวเดิม |
| U8-TC04 | PUT ใช้ ID เดิมและล้าง comment เมื่อไม่ส่ง อ่านผลใหม่ผ่าน GET |
| U8-TC05 | DELETE ไม่มี body ลบเฉพาะรีวิวตนเอง รีวิวคนอื่นและ target ทั้งสองชนิดยังอยู่ |
| U8-TC06 | ทุก route ตรวจ token หาย/หมดอายุ/ผิด scheme; ห้ามคนอื่นแก้หรือลบ; ปฏิเสธ author_id/target_id ปลอม |
| U8-TC07 | เจ้าของ Guide และ Summary เพิ่มรีวิวงานตนเองได้ 403 |
| U8-TC08 | เพิ่มซ้ำได้ 409; Guide/Summary เลข ID เท่ากันมีรีวิวแยกกัน; ลบแล้วสร้างใหม่ได้ |
| U8-TC09 | target/review หายได้ 404, จำลอง read/write/commit ล้มเหลวได้ 503, rollback คงข้อมูลเดิม; cascade/rollback ของ target บน SQLite และผลงานอีกชนิดยังอยู่ |
| EXT | comment 2,000/2,001 code points รวม emoji; query/body/ID/media/JSON ผิด; JSON ขนาดเกิน; 404/405 มี error envelope |

## ข้อจำกัดของผลตรวจ

ยังไม่ได้ทดสอบ concurrent POST กับ SQL Server, cascade paths ของ schema U6/U7 จริง, commit ที่สำเร็จแล้วแต่ response หาย, PDF storage จริง หรือการใช้ร่วมกับ Frontend จึงต้องส่งตรวจใน Integration ต่อ รายงานนี้ไม่ใช้แทนผล review จากผู้ตรวจต่างคนหรือ PO

พบ regression ระหว่างพัฒนาเมื่อ Review อยู่ใน Base เดิมและทำให้ชุดทดสอบเก่าพยายามสร้าง FK ไปยัง summaries ที่ยังไม่มี แก้โดยแยกทะเบียนตาราง Review และใช้คำสั่ง init_reviews เฉพาะ U8 แล้วรัน suite ใหม่ได้ผลผ่านข้างต้น
