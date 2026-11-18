# Task114 Backend รีวิวแนวข้อสอบและสรุป PDF

รุ่น 0.1 วันที่ 14 พฤศจิกายน 2569 สถานะพัฒนาและทดสอบ Unit/API แล้ว รอผู้ตรวจต่างคน review

เพิ่ม API ดู เพิ่ม แก้ และลบรีวิวของ guide และ summary ตาม Task102 และส่วน U8 ของ Task94 รุ่น 0.4 (`cc7dc14`) ใช้มติ D01–D04 ที่ผู้ตรวจแจ้งยืนยันใน Task97 รุ่น 0.3 (`68c866e`) โดยหนึ่งบัญชีมีหนึ่งรีวิวต่อผลงาน ห้ามรีวิวตนเอง ลบแล้วสร้างใหม่ได้ และไม่ต้องมีประวัติการอ่าน

Branch `feat/u8-reviews-backend` แยกจาก `sprint2` commit `c198d7d` เปิด PR เข้า `sprint2` ตามข้อตกลง Sprint 2 ล่าสุด แม้ข้อความการ์ดเดิมระบุ develop

## API

ทุกเส้นใช้ Bearer session เดิม ผู้เขียนรีวิวมาจากผู้ใช้ที่ล็อกอินเท่านั้น

| Method | Path | ผลสำเร็จ |
| --- | --- | --- |
| GET | `/api/guides/{guide_id}/reviews` | 200 `{target_type, target_id, items}` |
| POST | `/api/guides/{guide_id}/reviews` | 201 ReviewDTO |
| GET | `/api/summaries/{summary_id}/reviews` | 200 `{target_type, target_id, items}` |
| POST | `/api/summaries/{summary_id}/reviews` | 201 ReviewDTO |
| PUT | `/api/reviews/{review_id}` | 200 ReviewDTO ของ ID เดิม |
| DELETE | `/api/reviews/{review_id}` | 204 ไม่มี body |

POST/PUT รับ JSON เช่น `{"rating":5,"comment":"อ่านง่าย"}` ต้องมี rating จำนวนเต็ม 1–5 ปฏิเสธ string, boolean, ทศนิยม, null และฟิลด์เกิน comment ไม่บังคับ trim ก่อนนับไม่เกิน 2,000 Unicode code points ช่องว่างล้วนเก็บ null PUT ไม่ส่ง comment หมายถึงล้างข้อความเดิม โดยต้องส่ง rating เสมอ

ID เป็นเลขฐานสิบบวกไม่เกิน 2,147,483,647 ทุกเส้นปฏิเสธ query ที่ไม่ได้กำหนด GET/DELETE ไม่รับ body JSON body จำกัด 32,768 ไบต์ response สำเร็จและ error มี `Cache-Control: no-store` error เป็น `{error:{code,message,fields:[]}}` เสมอ

| เงื่อนไข | ผล |
| --- | --- |
| ไม่มี token หรือหมดอายุ | 401 AUTH_REQUIRED พร้อม WWW-Authenticate: Bearer |
| รีวิวผลงานตนเอง | 403 SELF_REVIEW_FORBIDDEN |
| แก้หรือลบรีวิวผู้อื่น | 403 REVIEW_FORBIDDEN |
| ไม่มีผลงาน | 404 GUIDE_NOT_FOUND หรือ SUMMARY_NOT_FOUND |
| ไม่มีรีวิว หรือรีวิวถูก cascade ลบไปพร้อมผลงาน | 404 REVIEW_NOT_FOUND |
| เพิ่มรีวิวซ้ำ | 409 REVIEW_ALREADY_EXISTS |
| JSON เสีย / media type ผิด / ข้อมูลผิด | 400 MALFORMED_REQUEST / 415 UNSUPPORTED_MEDIA_TYPE / 422 INVALID_PARAMETERS |
| SQL หรือ commit ล้มเหลว | 503 STORAGE_UNAVAILABLE |

หากไม่ทราบผล commit ต้องโหลดข้อมูลล่าสุดก่อนลองใหม่ โดยเฉพาะ POST ห้ามถือว่าการไม่ได้รับ response แปลว่า rollback สำเร็จ

## โค้ดและ transaction

Model อยู่ใน `backend/app/models/review.py`, DAO ใน `backend/app/dao/review_dao.py`, Service ใน `backend/app/services/reviews.py`, DTO ใน `backend/app/schemas/reviews.py` และ Router ใน `backend/app/routers/reviews.py` ซึ่งลงทะเบียนใน main แล้ว

Review ใช้ทะเบียนตารางของ U8 แยกจาก Base เดิม เพื่อไม่ให้ initializer U1–U5 สร้างตารางที่พึ่งพา U6 โดยไม่ได้ตั้งใจ FK users/guides ใช้ Column ของ model เดิม ส่วน summaries เป็น Core reference ของเฉพาะ id/owner_id ใน metadata แยก ไม่ใช่ model สรุปใหม่ และคำสั่งติดตั้ง U8 ไม่สร้าง summaries หรือ summary_files

DAO list ใช้ LEFT JOIN จากผลงานไปรีวิวและผู้เขียน แยก target หายจากรายการว่าง และเรียง created_at DESC, id DESC สำหรับ SQL Server POST ล็อกแถวผลงานด้วย UPDLOCK/HOLDLOCK ส่วน PUT/DELETE ล็อกแถวรีวิวและกรองทั้ง ID กับ author_id การเพิ่มถูกบังคับด้วย filtered unique indexes แยก guide/summary จึงไม่ชนกันเมื่อเลข ID เท่ากัน แปลงเฉพาะ conflict ของ index รีวิวเป็น 409

Service เป็นผู้ commit/rollback สร้าง DTO ก่อน commit และตอบสำเร็จหลัง commit เท่านั้น การลบรีวิวไม่แตะ Guide, Summary, Course, PDF หรือรีวิวของผู้อื่น ไม่มี file storage ใหม่ใน U8

## ติดตั้งตารางโดยรักษาข้อมูลเดิม

ต้องติดตั้งตารางเดิม users, courses, guides และตาราง summaries จาก U6 ก่อน รอบแก้ conflict รวม `sprint2` commit `fd1d031` ซึ่งมี implementation U6 แล้ว ให้รัน initializer ของระบบเดิม/U6 ก่อนคำสั่งติดตั้ง U8 คำสั่ง U8 จะหยุดเมื่อไม่พบตารางหรือคอลัมน์ที่จำเป็น

จากโฟลเดอร์ backend หลังตั้ง `backend/.env` ด้วย DB_CONNECTION_STRING ของสภาพแวดล้อมที่ต้องการ:

```powershell
python -m pip install -r requirements.txt
python -m scripts.init_reviews
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`init_reviews` สร้างเฉพาะ reviews พร้อม FK, CHECK และ indexes ใน transaction ไม่ลบตารางเดิม ไม่ seed ทับข้อมูล หาก reviews มีอยู่แล้วจะหยุดโดยไม่แก้ schema ให้ตรวจเทียบคอลัมน์ FK และ indexes ก่อนดำเนินการต่อ ไม่ควรใช้ create_all ของ Base เดิมเพื่อแทนคำสั่งนี้

### ขั้นตอนบน Docker สำหรับ Integration

Docker entrypoint ปัจจุบันรัน `python -m app.init_db` เพื่อสร้างตารางเดิมและ U6 แต่ยังไม่สร้าง reviews โดยอัตโนมัติ หลังตั้ง `.env` และเปิด Docker ให้รันจาก repository root:

```powershell
docker compose up -d --build
docker compose exec backend python -m scripts.init_reviews
```

รันคำสั่ง init_reviews ครั้งแรกหลังตาราง U6 พร้อม ก่อนเริ่มทดสอบรีวิว ถ้า backend เปิดได้แต่ยังไม่ได้สร้าง reviews API รีวิวจะตอบ 503 STORAGE_UNAVAILABLE เมื่อเข้าถึงตาราง ไม่ถือว่าระบบ U8 พร้อมจาก healthcheck `/` เพียงอย่างเดียว เมื่อ reviews มีอยู่แล้วให้ตรวจ schema เดิมและข้ามการสร้างซ้ำ ห้ามลบ volume เพื่อแก้ปัญหานี้ เก็บผลคำสั่งและ SHA ที่ใช้เป็นหลักฐานใน Task122 ขั้นตอนนี้ยังไม่ได้รันกับ Docker/SQL Server จริงใน Task114

ก่อนติดตั้งบน SQL Server ต้องตรวจ schema ที่ใช้งานจริงและ cascade paths ร่วมกับ U6/U7 แล้วทดสอบในฐานข้อมูลแยก งานนี้ตรวจ compilation ของ DDL แล้ว แต่ยังไม่มีผลรัน DDL บน SQL Server จริง

## ข้อมูลทดสอบและการรัน

Pytest fixture `api` ใน `backend/test/test_reviews_api.py` สร้างฐาน SQLite ในหน่วยความจำใหม่ต่อ test มี user 11 เป็นเจ้าของผลงาน, 22 เป็นผู้รีวิว, 33 เป็นคนอื่น, CS261 และ Guide 42 / Summary 42 เพื่อพิสูจน์การแยกชนิดแม้ ID เท่ากัน Summary ใน fixture มีเฉพาะ id/owner_id สำหรับทดสอบ U8 ไม่ใช่ schema U6 เต็มรูปแบบ และไม่มีการ seed ลงฐานผู้ใช้จริง

จาก repository root ใน PowerShell:

```powershell
$env:PYTHONPATH='backend'
$env:DB_CONNECTION_STRING='DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=task114_tests;Trusted_Connection=yes;TrustServerCertificate=yes'
python -m pytest backend/test/test_reviews_unit.py backend/test/test_reviews_api.py -q
python -m pytest backend/test -q
```

connection string ในตัวอย่างเป็นค่าทดสอบเพื่อให้ import app ได้ Unit/API ชุดนี้เปลี่ยน DB session เป็น SQLite และไม่เชื่อม SQL Server ดูขอบเขต Mock และผลจริงใน [รายงานทดสอบ](../testing/task114-unit-api-results.md)

## สิ่งที่ต้องยืนยันใน Integration และ review

- รัน schema จริงบน SQL Server ที่มี U6/U7 แล้ว ตรวจ FK/CHECK/filtered indexes, rollback และ cascade โดยรักษาผลงานอีกชนิดและข้อมูลบัญชีอื่น
- ส่ง POST พร้อมกันจริงสองคำขอต่อผลงานเดียวกัน ต้องได้หนึ่ง 201 และหนึ่ง 409 รวมการเพิ่มรีวิวชนกับการลบผลงาน ตรวจ lock/deadlock และการตอบ 503
- ทดสอบ PDF จริงว่าแก้หรือลบรีวิวไม่เปลี่ยน metadata/bytes และทดสอบ target หายผ่าน flow U6/U7 จริง
- ให้ผู้ตรวจต่างคน review ก่อน merge เข้า sprint2; ยังไม่ถือว่า DoD ข้อ PR ผ่าน review และ merge เสร็จแล้ว
