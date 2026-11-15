# Task112 Backend จัดการสรุปของฉัน

U7 ใช้ตาราง `summaries`, `summary_files` และ private PDF storage ของ U6 ร่วมกัน ให้ตั้งฐานข้อมูลและที่เก็บไฟล์ตาม [วิธีตั้งค่า Task110](../../U6/implementation/task110-u6-pdf-backend-implementation.md) คำสั่ง `python -m app.init_db` ในโฟลเดอร์ `backend/` สร้างตารางที่ใช้ร่วมกันและตรวจไฟล์ที่รอเก็บกวาดก่อนเปิดแอป

| API | ผลที่ได้ |
| --- | --- |
| `GET /api/my-summaries` | รายการของบัญชีที่ล็อกอิน เรียงจากใหม่ไปเก่า ใช้ API อ่านรายละเอียดและไฟล์ของ U6 |
| `PUT /api/summaries/{summary_id}` | เจ้าของเปลี่ยนชื่อ คำอธิบาย วิชา และแทนที่ PDF ได้ ใช้ `multipart/form-data` และส่ง `course_id` กับ `title` ทุกครั้ง ถ้าไม่ส่ง `file` จะใช้ PDF เดิม |
| `DELETE /api/summaries/{summary_id}` | เจ้าของลบสรุปได้ รับ `204` หลัง commit การเปิดสรุปหรือ PDF ครั้งถัดไปได้ `404` |

PDF จำกัด 15,000,000 ไบต์ ส่วนคำขอ multipart ทั้งก้อนจำกัด 16,000,000 ไบต์ ใช้ตัวตรวจไฟล์เดียวกับ U6

เมื่อเปลี่ยน PDF จะเตรียมไฟล์ด้วย key ใหม่ แล้วอัปเดต `summaries` และ `summary_files` ใน transaction เดียว หลัง commit จึงลบไฟล์เก่า เมื่อลบสรุป foreign key ของ U6 จะลบแถว `summary_files` พร้อมกัน ถ้าโปรแกรมยืนยันผล commit ไม่ได้ ให้คงไฟล์ไว้แล้วใช้ขั้นตอนตรวจจากฐานข้อมูลตอนเริ่มระบบก่อนเก็บกวาด

## วิธีรันเทส

ตั้งค่า `DB_CONNECTION_STRING` ตาม Task110 และติดตั้งด้วย `python -m pip install -r requirements.txt` ในโฟลเดอร์ `backend/` จากนั้นรัน

```powershell
python -m pytest test -q -p no:cacheprovider
```

ชุด U7 สร้างฐานข้อมูล SQLite ในหน่วยความจำและไฟล์ PDF ในโฟลเดอร์ชั่วคราว เทสใช้ router ในแอปจริงกับ SQLAlchemy และ private storage จริงของ U6 ส่วน TU Login ใช้ข้อมูลบัญชีจำลอง ตรวจการแยกรายการตามเจ้าของ การคงไฟล์เดิมเมื่อแก้ metadata การอ่าน PDF ใหม่ผ่าน U6 การ rollback เมื่อบันทึกแถวไฟล์ล้มเหลว การเก็บไฟล์เมื่อไม่ทราบผล commit และการลบจนทั้งรายละเอียดและ PDF เปิดไม่ได้

รันซ้ำบน **pytest 9.2.0** หลังแก้ fixture ให้คืน `app.state.pdf_storage` เดิมเมื่อจบแต่ละเคส ชุด `test_my_summaries_with_u6.py` ผ่านทั้ง **13 เคส** และชุด Backend ทั้งหมดได้ **287 ผ่าน, 3 ข้าม และ 81 subtests ผ่าน** เคสที่ข้ามเป็นชุด SQL Server ที่ต้องเปิดใช้ฐานทดสอบโดยเฉพาะ ส่วนการล็อกบน SQL Server จริง การทำงานร่วมกับ U8/U9 และการเรียกผ่าน Frontend รอตรวจในงาน Integration
