# Task94 API contract

ออกแบบ API กลางสำหรับ U6 ถึง U10

รุ่น 0.4   |   วันที่ 14 พฤศจิกายน 2569   |   Sprint 2

เอกสารนี้กำหนด API สำหรับเผยแพร่และจัดการสรุป PDF รีวิวผลงาน และบันทึกผลงานไว้เปิดทีหลัง เพื่อให้ Frontend และ Backend ใช้เส้นทาง ข้อมูล และข้อผิดพลาดตรงกัน

รุ่นนี้รวมเพดาน PDF ของ U6, multipart สำหรับแก้สรุป U7 และ API สำหรับบันทึกแนวข้อสอบหรือสรุป PDF ทีละชิ้นของ U9/U10 ดูผลตรวจและประเด็น review ใน docs/task94-review.md

## ขอบเขต API

| Story | ความสามารถ | กลุ่มเส้นทางใหม่ |
| --- | --- | --- |
| U6 | เผยแพร่ รายการ หน้าอ่าน และไฟล์ PDF | /api/summaries<br>/api/courses/{course_id}/summaries |
| U7 | รายการของฉัน แก้ไข และลบสรุป | /api/my-summaries<br>/api/summaries/{summary_id} |
| U8 | ดู เพิ่ม แก้ไข และลบรีวิว | /api/guides/{guide_id}/reviews<br>/api/summaries/{summary_id}/reviews<br>/api/reviews/{review_id} |
| U9 U10 | บันทึก จัดกลุ่ม เปิด และนำผลงานรายชิ้นออก | /api/saved-items<br>/api/saved-items/{item_type}/{item_id} |

## กติกาที่กำหนดในฉบับนี้

| เรื่อง | ข้อกำหนดและเหตุผล |
| --- | --- |
| PDF | หนึ่งไฟล์ต่อสรุป สูงสุด 15 MB หรือ 15,000,000 ไบต์ ตรวจชนิดและการเปิดอ่านจริง ขนาดพอสำหรับสรุปและควบคุมภาระ upload |
| ข้อมูลสรุป | ตอนเผยแพร่ต้องส่งวิชา ชื่อ และ PDF ส่วนตอนแก้ไขส่ง PDF ใหม่เฉพาะเมื่อต้องการแทนไฟล์เดิม ข้อมูลเสริมใช้ description |
| รีวิว | หนึ่งคนหนึ่งรีวิวต่อผลงาน ห้ามรีวิวผลงานตัวเอง ใช้กติกา U8 TC07 และ TC08 ที่เสนอไว้ |
| รายการที่บันทึก | บันทึกแนวข้อสอบหรือสรุป PDF ทีละชิ้น แล้วจัดกลุ่มตามรายวิชา |
| ขอบเขตฉบับนี้ | มี contract และชุดข้อมูลตัวอย่างร่วมใน docs/task94-fixtures ยังรอ review จาก Frontend Backend และ PO |

## 1 กติกากลางของ API

### เส้นทางและการยืนยันตัวตน

เส้นทางใหม่ทุกเส้นในเอกสารนี้เป็น Backend path และ Browser path เดียวกัน ใช้ prefix /api โดย Frontend proxy ส่งต่อ path เดิม ไม่เปลี่ยนเส้นทาง API เดิมของ U1 ถึง U5 เช่น /courses และ /guides

ทุก API ใหม่ต้องมี Authorization: Bearer <access_token> จาก POST /api/auth/login เดิม รวมทั้งรายการสรุป รายการรีวิว และไฟล์ PDF Backend ระบุตัวผู้ใช้และสิทธิ์จาก session เท่านั้น ไม่รับ user_id หรือ username เพื่อเลือกบัญชีเป้าหมาย

อ่านข้อมูลได้ทุกบัญชีนักศึกษาที่ Login ใช้ได้ แก้ไขหรือลบสรุปและรีวิวได้เฉพาะเจ้าของ ไม่มีสิทธิ์ผู้ดูแลเพิ่มเติมในขอบเขตนี้ Token หาย ผิด หรือหมดอายุตอบ 401 พร้อม WWW-Authenticate: Bearer และไม่ส่งข้อมูลผลงานหรือไฟล์

### ชนิดข้อมูลและการตรวจคำขอ

| รายการ | ข้อกำหนด |
| --- | --- |
| ID | course_id summary_id guide_id review_id และ user.id เป็นจำนวนเต็ม 1 ถึง 2,147,483,647 JSON ต้องส่งเป็น number ไม่รับ string float หรือ boolean ส่วน path ใช้เลขฐานสิบจำนวนเต็มบวก |
| Namespace | ID ของแนวข้อสอบและสรุปเป็นคนละชุด งานสองชนิดอาจมีเลข id เท่ากันได้ ต้องอ้างชนิดผลงานจาก route หรือ target_type เสมอ |
| JSON | ใช้ application/json; UTF-8 ยกเว้น multipart สำหรับเผยแพร่หรือแก้ไขสรุป และการรับไฟล์ ห้ามส่งฟิลด์ที่ไม่ได้ประกาศ ฟิลด์ read-only ก็ห้ามส่งกลับมาเพื่อเปลี่ยนค่า |
| ข้อความ | ตัด whitespace หัวท้ายก่อนตรวจความยาว นับ Unicode code points เก็บและแสดงเป็น plain text ไม่ตีความ HTML |
| วันที่ | created_at และ updated_at เป็น RFC 3339 แบบ UTC เช่น 2026-10-27T03:00:00Z Backend เป็นผู้กำหนด |
| รายการ | ยังไม่แบ่งหน้าและไม่รับ filter หรือ query parameter ส่งทั้งหมดตามลำดับที่ระบุ items เป็น [] เมื่อไม่มีข้อมูลเท่านั้น |
| GET และ DELETE | ไม่ส่ง request body การบันทึกผลงานด้วย PUT ก็ไม่ส่ง body พารามิเตอร์ query ที่ไม่ได้ระบุถูกปฏิเสธด้วย 422 |
| Cache | ทุก response ของ API ใหม่ รวมไฟล์และข้อผิดพลาด ใช้ Cache-Control: no-store |

### รูปแบบข้อผิดพลาด

```json
{
  "error": {
    "code": "INVALID_PARAMETERS",
    "message": "ข้อมูลไม่ถูกต้อง",
    "fields": [
      {
        "field": "title",
        "message": "กรุณากรอกชื่อสรุป"
      }
    ]
  }
}
```

code เป็นค่าคงที่ให้โปรแกรมใช้ตัดสินใจ message เป็นข้อความภาษาไทย ส่วน fields เป็น array เสมอและใช้ [] เมื่อไม่เจาะจงช่อง ผู้ใช้ที่ยืนยันตัวตนไม่ผ่านได้ 401 ก่อนเปิดเผยว่ารายการมีอยู่หรือไม่ API ใหม่ใช้รูปแบบนี้ รวมข้อผิดพลาดจาก proxy โดยไม่บังคับเปลี่ยน error ของ API เดิม

## 2 DTO ของสรุป PDF

### คำขอเผยแพร่ SummaryCreateForm

POST /api/summaries ใช้ multipart/form-data ช่องข้อมูลแต่ละช่องส่งเพียงครั้งเดียว ไม่รับช่องอื่นหรือไฟล์เพิ่ม Browser เป็นผู้กำหนด boundary อัตโนมัติ

| ฟิลด์ | ชนิด | ข้อกำหนด |
| --- | --- | --- |
| course_id | form text | บังคับ เป็นเลขฐานสิบจำนวนเต็มบวกในช่วง ID และเป็นวิชา CS ที่มีอยู่ Backend แปลงเป็น integer ไม่รับทศนิยมหรือเลขรูปแบบ exponent |
| title | form text | บังคับ หลัง trim ยาว 1 ถึง 200 ตัวอักษร |
| description | form text | ไม่บังคับ หลัง trim ไม่เกิน 2,000 ตัวอักษร ไม่ส่งหรือช่องว่างล้วนจัดเก็บเป็น null |
| file | binary file | บังคับหนึ่งไฟล์ เงื่อนไข PDF ตามส่วน U6 |

### คำขอแก้ไข SummaryUpdateForm

| ฟิลด์ | ชนิด | ข้อกำหนด |
| --- | --- | --- |
| course_id | form text | บังคับ ใช้เงื่อนไขเดียวกับการเผยแพร่ |
| title | form text | บังคับ หลัง trim ยาว 1 ถึง 200 ตัวอักษร |
| description | form text | ไม่บังคับ หลัง trim ไม่เกิน 2,000 ตัวอักษร ไม่ส่งหรือช่องว่างล้วนหมายถึงล้างค่าเดิม |
| file | binary file | ไม่บังคับ ถ้าส่งให้ส่ง PDF หนึ่งไฟล์ตามเงื่อนไข U6 |

PUT ใช้ multipart/form-data ต้องส่ง course_id และ title ทุกครั้ง ฟิลด์แต่ละช่องส่งได้ครั้งเดียว ห้ามส่งช่องนอกตาราง เช่น owner, id, created_at และ updated_at ถ้าไม่ส่ง file ให้ใช้ PDF เดิม

### ผลลัพธ์ SummaryDTO

| ฟิลด์ | ชนิด | ความหมาย |
| --- | --- | --- |
| id | integer | summary_id |
| course | CourseRefDTO | {id, course_code, course_name} ทั้งรหัสและชื่อวิชาเป็น string |
| title | string | ชื่อสรุปหลัง normalize |
| description | string หรือ null | ข้อมูลประกอบ |
| owner | PublicUserDTO | {id, display_name} ไม่ส่ง username หรือข้อมูล Login |
| file | SummaryFileDTO | {original_name, content_type, size_bytes, read_path} |
| created_at<br>updated_at | string | เวลาสร้างและแก้ไข metadata ครั้งล่าสุด แบบ UTC |

PublicUserDTO = {id: integer, display_name: string} ส่วน SummaryFileDTO มี original_name เป็น string ชื่อไฟล์ที่ตัด path และอักขระควบคุมแล้ว content_type เป็น string ค่า application/pdf size_bytes เป็น integer มากกว่า 0 และ read_path เป็น string ค่า /api/summaries/{summary_id}/file ไม่ส่ง storage path หรือ public URL

SummaryListResponse = {items: SummaryDTO[]} และ CourseSummaryListResponse = {course_id: integer, items: SummaryDTO[]} เรียง created_at จากใหม่ไปเก่า แล้ว id จากมากไปน้อย ไม่เปลี่ยนลำดับเมื่อแก้ไขชื่อ

## 3 U6 เผยแพร่และเปิดอ่านสรุป

| Method และ path | คำขอ | ผลสำเร็จ |
| --- | --- | --- |
| POST /api/summaries | SummaryCreateForm<br>multipart/form-data | 201 SummaryDTO |
| GET /api/courses/{course_id}/summaries | ไม่มี body | 200<br>CourseSummaryListResponse |
| GET /api/summaries/{summary_id} | ไม่มี body | 200 SummaryDTO |
| GET /api/summaries/{summary_id}/file | ไม่มี body | 200 PDF binary |

ทุกเส้นต้อง Login การเผยแพร่ผูกเจ้าของกับ session ที่ยืนยันแล้ว วิชาไม่มีอยู่หรือไม่อยู่ในขอบเขต CS ตอบ 404 COURSE_NOT_FOUND สรุปไม่มีอยู่หรือถูกลบแล้วตอบ 404 SUMMARY_NOT_FOUND รายวิชาที่มีอยู่แต่ไม่มีสรุปตอบ 200 พร้อม items: []

### เงื่อนไขไฟล์ที่รับ

รับไฟล์นามสกุล .pdf โดยไม่สนตัวพิมพ์ใหญ่เล็ก file part ต้องเป็น application/pdf ขนาดไฟล์จริงมากกว่า 0 และไม่เกิน 15,000,000 ไบต์ รวมไม่เกินหนึ่งไฟล์ ขนาดนี้นับเฉพาะเนื้อไฟล์ ไม่รวม multipart overhead

Backend ตรวจ signature และ parse PDF จริงจนอ่านโครงสร้างเอกสารและจำนวนหน้าได้ ต้องมีอย่างน้อยหนึ่งหน้า ไม่รับไฟล์เสีย PDF ที่เข้ารหัสหรือมี password และไฟล์ชนิดอื่นที่เพียงเปลี่ยนนามสกุลเป็น .pdf การตรวจ MIME หรือนามสกุลอย่างเดียวไม่เพียงพอ

ไฟล์ไม่ใช่ PDF ตอบ 422 PDF_INVALID ไฟล์ PDF เสีย เปิดอ่านไม่ได้ หรือเข้ารหัสตอบ 422 PDF_UNREADABLE ไฟล์เกินขนาดตอบ 413 PDF_TOO_LARGE แต่ละกรณีใช้ fields ระบุ file และไม่สร้างสรุปที่เผยแพร่ค้างไว้

### ผลสำเร็จและความล้มเหลว

ตอบ 201 หลังข้อมูลและไฟล์พร้อมอ่านจริงแล้วเท่านั้น กรณีบันทึกส่วนใดล้มเหลวก่อนสำเร็จต้องไม่เหลือรายการที่เปิดเผยผ่าน API การเก็บไฟล์ชั่วคราวและการชดเชย transaction เป็นรายละเอียด implementation แยกจาก contract

POST ไม่รับประกัน idempotency หากขาดการตอบกลับ Frontend ต้องโหลดรายการของฉันตรวจสอบก่อนให้ผู้ใช้ตัดสินใจส่งอีกครั้ง ห้าม retry POST อัตโนมัติจนสร้างสรุปซ้ำโดยไม่รู้ตัว

### การส่ง PDF ผ่าน Login

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: inline; filename="summary-101.pdf"
Cache-Control: no-store
X-Content-Type-Options: nosniff

<PDF bytes>
```

ใช้ชื่อ ASCII summary-{id}.pdf ใน Content-Disposition และแสดงชื่อเดิมจาก metadata ใน UI ทุกครั้งที่ขอไฟล์ต้องตรวจ token และสถานะสรุป ห้ามเปิด public static directory เพื่อเลี่ยง Login ไม่รองรับ Range ใน Sprint 2 หากมี Range ให้ส่งไฟล์เต็มด้วย 200 ไม่ตอบ 206

Frontend ใช้ fetch พร้อม Authorization แล้วตรวจ status และ Content-Type ก่อนอ่าน Blob จากนั้นเปิด Blob URL และ revoke เมื่อเลิกใช้ ห้ามใส่ token ใน URL หรือใช้ iframe ที่ชี้ read_path โดยไม่ส่ง header หาก token ใช้ไม่ได้ให้แสดงทางเข้าสู่ระบบแทน PDF

## 4 U7 จัดการสรุปของฉัน

| Method และ path | คำขอ | ผลสำเร็จ |
| --- | --- | --- |
| GET /api/my-summaries | ไม่มี body | 200 SummaryListResponse |
| PUT /api/summaries/{summary_id} | SummaryUpdateForm<br>multipart/form-data | 200 SummaryDTO |
| DELETE /api/summaries/{summary_id} | ไม่มี body | 204 ไม่มี response body |

GET /api/my-summaries กรองเจ้าของจาก session เท่านั้น ใช้ลำดับรายการเดียวกับ U6 เมื่อยังไม่เคยเผยแพร่ตอบ {"items": []} การเปิดรายละเอียดและไฟล์ใช้ GET ของ U6 ไม่สร้าง endpoint อ่านไฟล์สำหรับเจ้าของแยกอีกชุด

PUT และ DELETE ต้องเป็นเจ้าของสรุป หากสรุปยังอยู่แต่เป็นของผู้อื่นตอบ 403 SUMMARY_FORBIDDEN หากไม่พบหรือถูกลบไปแล้วตอบ 404 SUMMARY_NOT_FOUND ต้องไม่สร้างรายการขึ้นใหม่ด้วย PUT

### การแก้ไขข้อมูล

แก้ชื่อ ข้อความประกอบ และวิชาได้ รวมถึงแทน PDF เมื่อส่งไฟล์ใหม่ หากเปลี่ยนวิชาให้รายการไปอยู่ในวิชาใหม่หลังบันทึกสำเร็จ ID เจ้าของ created_at และ read_path คงเดิม ส่วน updated_at สะท้อนการแก้ไข การแก้พร้อมกันใช้ค่าที่บันทึกสำเร็จล่าสุด ไม่มี version token ในฉบับนี้

```http
PUT /api/summaries/101
Authorization: Bearer <access_token>
Content-Type: multipart/form-data; boundary=edit-summary

--edit-summary
Content-Disposition: form-data; name="course_id"

2
--edit-summary
Content-Disposition: form-data; name="title"

สรุปฉบับแก้ไข
--edit-summary--
```

ตัวอย่างนี้ย้ายสรุปไปวิชา 2 ล้าง description และใช้ PDF เดิม ถ้าจะเก็บข้อความเดิมให้ส่ง description ปัจจุบัน ถ้าจะแทน PDF ให้แนบ file part ชื่อ file ใช้ FormData ให้ Browser ใส่ boundary เอง วิชาที่ไม่พบหรืออยู่นอก CS ตอบ 404 COURSE_NOT_FOUND ถ้า validation หรือการแทน PDF ล้มเหลวก่อน commit ให้คงข้อมูลและไฟล์เดิม

### การลบและการยกเลิก

UI ยืนยันก่อนส่ง DELETE เมื่อผู้ใช้ยกเลิกไม่ส่งคำขอ API เมื่อสำเร็จตอบ 204 รายการหายจากหน้าวิชาและหน้าของฉัน การขอรายละเอียด ไฟล์ หรือรีวิวของสรุปนั้นในครั้งถัดไปได้ 404

การลบไม่ลบรายวิชา ผลงานอื่น หรือรีวิวของผลงานอื่น รีวิวที่ผูกกับสรุปที่ถูกลบต้องไม่เปิดอ่านหรือแก้ไขผ่าน API อีก ส่วนวิธีลบ record และไฟล์จริงเป็นงานออกแบบข้อมูลภายใน

หากส่ง DELETE ซ้ำหลังลบแล้วตอบ 404 SUMMARY_NOT_FOUND การเรียกซ้ำต้องไม่กระทบรายการอื่น กรณีบันทึกหรือลบล้มเหลวก่อนสำเร็จตอบ 503 STORAGE_UNAVAILABLE และคงข้อมูลเดิมที่ใช้งานได้

### การแสดงผลเมื่อยืนยันผลไม่ได้

204 ไม่มี JSON จึงห้ามเรียก response.json() หาก connection หลุดหรือ proxy timeout อาจมีการบันทึกสำเร็จแล้ว Frontend ต้องโหลดข้อมูลใหม่เพื่อตรวจผลก่อนแจ้งสำเร็จหรือลองซ้ำ ไฟล์ที่ถูกส่งถึง Browser ไปแล้วไม่สามารถเรียกคืนย้อนหลัง แต่คำขออ่านใหม่หลังลบต้องถูกปฏิเสธ

## 5 U8 ข้อมูลและกติการีวิว

รีวิวรองรับทั้งแนวข้อสอบและสรุป PDF แยกชนิดผลงานจาก route ค่า target_type ใช้ guide หรือ summary และ target_id คือ id ในชนิดนั้น ไม่สร้างตาราง ID กลางเป็นเงื่อนไขของ API

### กติกาที่ใช้ตรวจรับ

ผู้ใช้ Login ให้รีวิวผลงานที่ยังมีอยู่และเป็นของผู้อื่นได้เท่านั้น หนึ่งบัญชีมีหนึ่งรีวิวต่อคู่ target_type และ target_id การเพิ่มซ้ำตอบ 409 REVIEW_ALREADY_EXISTS และให้แก้ไขรีวิวเดิม การแก้ไขคง review.id เดิม การลบรีวิวแล้วสามารถสร้างใหม่ได้

ใช้ U8 TC07 และ TC08 เป็นกติกาของฉบับนี้ ห้ามรีวิวผลงานของตนเองและห้ามรีวิวซ้ำ รวมคำขอตรงไป Backend ไม่เปิดให้ client ระบุหรือเปลี่ยนผู้รีวิวหรือผลงานเป้าหมายผ่าน body

Story ระบุบริบทว่าอ่านผลงานแล้ว ฉบับนี้ไม่สร้างระบบบันทึกประวัติการอ่านเป็นเงื่อนไข Backend การมีสิทธิ์รีวิวพิจารณาจาก Login ผลงานยังอยู่ การไม่ใช่เจ้าของผลงาน และการไม่ซ้ำเท่านั้น UI วางการส่งรีวิวในหน้าอ่าน

### ReviewWriteRequest สำหรับ POST และ PUT

| ฟิลด์ | ชนิด | ข้อกำหนด |
| --- | --- | --- |
| rating | integer | บังคับ 1 ถึง 5 ไม่รับ null string boolean หรือทศนิยม |
| comment | string หรือ null | ไม่บังคับ หลัง trim ไม่เกิน 2,000 ตัวอักษร ไม่ส่ง null หรือช่องว่างล้วนหมายถึงไม่มีข้อความ |

PUT แทนที่ rating และ comment ทั้งชุด ต้องส่ง rating ทุกครั้ง หากไม่ส่ง comment จะล้างข้อความเก่า คะแนน 0 6 ติดลบ ทศนิยม หรือไม่ส่งคะแนนตอบ 422 INVALID_PARAMETERS โดย fields ระบุ rating

### ReviewDTO และ ReviewListResponse

| ฟิลด์ ReviewDTO | ชนิด | ความหมาย |
| --- | --- | --- |
| id | integer | review_id |
| target_type | guide หรือ summary | ชนิดผลงานที่รีวิว |
| target_id | integer | id ของผลงาน |
| rating | integer | คะแนนเต็ม 1 ถึง 5 |
| comment | string หรือ null | ข้อความประกอบ |
| author | PublicUserDTO | {id, display_name} เป็นเจ้าของรีวิว |
| created_at<br>updated_at | string | เวลาสร้างและแก้ไขแบบ UTC |

ReviewListResponse = {target_type, target_id, items: ReviewDTO[]} เรียง created_at จากใหม่ไปเก่า แล้ว id จากมากไปน้อย ผลงานมีอยู่แต่ยังไม่มีรีวิวตอบ 200 พร้อม items: [] ทุกบัญชีที่ Login อ่านรีวิวได้ ข้อมูล aggregate เช่นคะแนนเฉลี่ยยังไม่อยู่ใน scope

## 6 U8 เส้นทางจัดการรีวิว

| Method และ path | คำขอ | ผลสำเร็จ |
| --- | --- | --- |
| GET /api/guides/{guide_id}/reviews | ไม่มี body | 200 ReviewListResponse |
| POST /api/guides/{guide_id}/reviews | ReviewWriteRequest | 201 ReviewDTO |
| GET /api/summaries/{summary_id}/reviews | ไม่มี body | 200 ReviewListResponse |
| POST /api/summaries/{summary_id}/reviews | ReviewWriteRequest | 201 ReviewDTO |
| PUT /api/reviews/{review_id} | ReviewWriteRequest | 200 ReviewDTO |
| DELETE /api/reviews/{review_id} | ไม่มี body | 204 ไม่มี body |

POST และ PUT ใช้ application/json ทุกเส้นต้อง Login GET และ POST ตรวจว่าผลงานยังมีอยู่ หากแนวข้อสอบหายตอบ 404 GUIDE_NOT_FOUND หากสรุปหายตอบ 404 SUMMARY_NOT_FOUND

POST สำหรับผลงานของตนตอบ 403 SELF_REVIEW_FORBIDDEN รีวิวที่ซ้ำในผลงานเดิมตอบ 409 REVIEW_ALREADY_EXISTS รวมคำขอพร้อมกัน ต้องมีรีวิวสำเร็จเพียงหนึ่งรายการและอีกคำขอได้ 409

PUT และ DELETE ต้องเป็นเจ้าของรีวิว หากรีวิวยังอยู่แต่เป็นของผู้อื่นตอบ 403 REVIEW_FORBIDDEN หากไม่พบรีวิวหรือผลงานเป้าหมายถูกลบไปแล้วตอบ 404 REVIEW_NOT_FOUND และไม่สร้างรีวิวกลับมาใหม่

### ตัวอย่างเพิ่มและแก้ไขรีวิว

```http
POST /api/summaries/101/reviews
Authorization: Bearer <access_token>
Content-Type: application/json
{
  "rating": 5,
  "comment": "อ่านง่ายและตรงประเด็น"
}
{
  "id": 501,
  "target_type": "summary",
  "target_id": 101,
  "rating": 5,
  "comment": "อ่านง่ายและตรงประเด็น",
  "author": {
    "id": 22,
    "display_name": "นักศึกษา B"
  },
  "created_at": "2026-10-31T03:00:00Z",
  "updated_at": "2026-10-31T03:00:00Z"
}
```

แก้ไขด้วย PUT /api/reviews/501 เช่น {"rating": 4, "comment": null} ได้ 200 พร้อม ReviewDTO เดิมที่เปลี่ยนคะแนนและล้างข้อความ หากผู้ใช้ id 23 ส่งคำขอแก้รีวิวนี้ได้ 403 REVIEW_FORBIDDEN

### ความล้มเหลว

เพิ่ม แก้ไข หรือลบที่ล้มเหลวก่อนสำเร็จตอบ 503 STORAGE_UNAVAILABLE ต้องไม่แจ้งสำเร็จหรือเปลี่ยนรีวิวอื่น DELETE ซ้ำได้ 404 REVIEW_NOT_FOUND เมื่อ connection หลุดให้โหลดรายการใหม่เพื่อตรวจผล ก่อนเสนอให้ส่ง POST ใหม่

## 7 U9 และ U10 ผลงานที่บันทึก

ผู้ใช้บันทึกแนวข้อสอบหรือสรุป PDF ทีละชิ้น Backend แยกรายการด้วยคู่ item_type และ item_id เช่น guide 101 กับ summary 101 เป็นคนละรายการ course ใช้จัดกลุ่มใน UI

| Method และ path | ผลสำเร็จ | พฤติกรรม |
| --- | --- | --- |
| GET /api/saved-items | 200 SavedItemListResponse | คืนเฉพาะรายการของผู้ใช้ที่ล็อกอิน |
| PUT /api/saved-items/{item_type}/{item_id} | 200 SavedItemState | บันทึกผลงานและตอบ saved: true เรียกซ้ำได้โดยไม่เพิ่มรายการ |
| GET /api/saved-items/{item_type}/{item_id} | 200 SavedItemState | เช็กสถานะของผลงานสำหรับบัญชีปัจจุบัน |
| DELETE /api/saved-items/{item_type}/{item_id} | 200 SavedItemState | นำ bookmark ออกและตอบ saved: false เรียกซ้ำได้ |

ทุกเส้นทางต้องใช้ Bearer token และไม่รับ body หรือ query ใช้ item_type เป็น guide หรือ summary และ item_id เป็นเลขฐานสิบจำนวนเต็มบวกถึง 2,147,483,647 ถ้า type, ID หรือพารามิเตอร์ผิดตอบ 422 INVALID_PARAMETERS บัญชีมาจาก session เสมอ

### DTO และการเปิดผลงาน

| DTO | รูปแบบ |
| --- | --- |
| SavedItemState | {item_type: guide หรือ summary, item_id: integer, saved: boolean} |
| SavedItemListResponse | {items: SavedItemDTO[]} |
| SavedItemDTO | {item_type, item_id, course: CourseRefDTO, title: string, open_path: string} |

```json
{
  "item_type": "guide",
  "item_id": 42,
  "saved": true
}
```

รายการเรียงตาม course.course_code จาก A ถึง Z แล้ว item_type จาก A ถึง Z และ item_id จากมากไปน้อย ถ้าไม่มีรายการให้ตอบ {"items": []} UI จัดกลุ่มด้วย course.id และใช้ปุ่มค้นหารายวิชาในหน้าว่าง

Backend สร้าง open_path จากชนิดและ ID ของผลงาน สำหรับ guide ใช้ /api/guides/{item_id} สำหรับ summary ใช้ /api/summaries/{item_id} แล้วเปิด PDF จาก file.read_path ด้วย Bearer token ตาม U6 ผู้ใช้เปิดหน้าวิชาจากหัวข้อกลุ่มได้ผ่าน /api/courses/{course_id} เดิม ส่วนการกดผลงานต้องเปิดตรงชิ้นที่เลือก

### ผลงานหายและการบันทึกไม่สำเร็จ

GET สถานะและ PUT ตอบ 404 GUIDE_NOT_FOUND หรือ SUMMARY_NOT_FOUND ตามชนิดเมื่อผลงานหาย ถ้าผลงานอยู่แต่ยังไม่บันทึก GET สถานะตอบ 200 saved: false รายการ GET ข้าม bookmark ที่อ้างผลงานที่ลบแล้ว หากกดเปิดรายการเก่าแล้วได้ 404 ให้โหลดรายการใหม่

PUT พร้อมกันสำหรับบัญชีและผลงานเดียวกันต้องเหลือ bookmark เดียว ทั้งสองคำขอตอบ 200 saved: true ได้ DELETE ลบเฉพาะ bookmark ของบัญชีปัจจุบัน ถ้าไม่มี bookmark หรือผลงานถูกลบไปแล้วก็ตอบ 200 saved: false รายวิชา แนวข้อสอบ สรุป PDF และ bookmark ของบัญชีอื่นยังอยู่ตามเดิม

ถ้าอ่านหรือบันทึกไม่ได้ให้ตอบ 503 SAVED_ITEMS_UNAVAILABLE ถ้ายืนยันว่าล้มเหลวก่อน commit สถานะเดิมต้องคงอยู่ ถ้าไม่ทราบผลหลังส่งคำขอให้โหลดสถานะใหม่ก่อนแจ้งว่าทำสำเร็จหรือลองอีกครั้ง

## 8 ตัวอย่างข้อมูลสรุปและการรับไฟล์

ข้อมูลในหน้านี้อธิบาย schema ส่วนชุดข้อมูลร่วมสำหรับ UI และ API tests อยู่ที่ docs/task94-fixtures/examples.json ยังไม่ใช่ผลทดสอบ API จริง

### ผลเผยแพร่หรืออ่านรายละเอียด SummaryDTO

```json
{
  "id": 101,
  "course": {
    "id": 1,
    "course_code": "CS261",
    "course_name": "INTRODUCTION TO SOFTWARE ENGINEERING"
  },
  "title": "สรุป CS261 ก่อนสอบ",
  "description": null,
  "owner": {
    "id": 11,
    "display_name": "นักศึกษา A"
  },
  "file": {
    "original_name": "valid-summary.pdf",
    "content_type": "application/pdf",
    "size_bytes": 603,
    "read_path": "/api/summaries/101/file"
  },
  "created_at": "2026-10-31T02:00:00Z",
  "updated_at": "2026-10-31T02:00:00Z"
}
```

GET /api/courses/1/summaries ตอบ {"course_id": 1, "items": [SummaryDTO ข้างต้น]} ส่วน GET /api/my-summaries ของผู้ใช้ id 11 ตอบ {"items": [SummaryDTO ข้างต้น]} ข้อความ SummaryDTO ข้างต้นเป็นคำอธิบาย ไม่ใช่ literal JSON

### ตัวอย่างเตรียม upload จาก Browser

```javascript
const form = new FormData();
form.append("course_id", "1");
form.append("title", "CS261 summary");
form.append("file", pdfFile);
const response = await fetch("/api/summaries", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form
});
```

ไม่ตั้ง Content-Type ด้วยตนเองเพื่อให้ Browser ใส่ boundary ให้ถูกต้อง ไม่ส่ง description ในตัวอย่างนี้จึงได้ null ต้องตรวจ response.ok ก่อนนำข้อมูลไปแสดงว่าบันทึกสำเร็จ

### รับไฟล์และรับข้อผิดพลาดคนละรูปแบบ

GET read_path พร้อม Bearer token เมื่อสำเร็จรับ application/pdf เป็น binary เมื่อผิดพลาดรับ application/json ด้วย ErrorResponseDTO ตาม status เช่น 401 AUTH_REQUIRED หรือ 404 SUMMARY_NOT_FOUND ห้ามนำ JSON error ไปสร้าง PDF Blob

## 9 Status code และรหัสข้อผิดพลาด

ตารางนี้ใช้กับ API ใหม่ทั้งหมด ส่วน error.fields ใช้ชื่อฟิลด์ body หรือชื่อ path parameter เช่น title rating file หรือ course_id ข้อผิดพลาดที่ไม่ผูกกับช่องใช้ [] ไม่ส่ง exception SQL หรือ storage path ให้ client

| HTTP | error.code | เงื่อนไข |
| --- | --- | --- |
| 400 | MALFORMED_REQUEST | JSON syntax เสียหรือ multipart boundary เสียจนอ่านคำขอไม่ได้ |
| 401 | AUTH_REQUIRED | ไม่มี token token ไม่ถูกต้องหรือหมดอายุ |
| 403 | SUMMARY_FORBIDDEN | แก้ไขหรือลบสรุปที่ไม่ใช่ของตน |
| 403 | REVIEW_FORBIDDEN | แก้ไขหรือลบรีวิวที่ไม่ใช่ของตน |
| 403 | SELF_REVIEW_FORBIDDEN | เพิ่มรีวิวผลงานของตนเอง |
| 404 | COURSE_NOT_FOUND | ไม่มีรายวิชาหรือรายวิชาไม่อยู่ในขอบเขต CS |
| 404 | SUMMARY_NOT_FOUND | ไม่พบสรุปหรือสรุปถูกลบแล้ว |
| 404 | GUIDE_NOT_FOUND | ไม่พบแนวข้อสอบ เช่น เมื่อจะอ่าน เพิ่มรีวิว หรือบันทึก |
| 404 | REVIEW_NOT_FOUND | ไม่พบรีวิวหรือผลงานเป้าหมายถูกลบแล้ว |
| 404 | ROUTE_NOT_FOUND | ไม่มีเส้นทาง API ที่เรียก |
| 405 | METHOD_NOT_ALLOWED | method ไม่รองรับบน route นี้ พร้อม Allow header |
| 409 | REVIEW_ALREADY_EXISTS | บัญชีนี้มีรีวิวในผลงานชนิดและ id เดิมแล้ว |
| 413 | PDF_TOO_LARGE | เนื้อไฟล์ PDF มากกว่า 15,000,000 ไบต์ |
| 413 | REQUEST_TOO_LARGE | JSON body เกิน 32 KiB หรือ multipart ทั้งคำขอเกิน 16 MB |
| 415 | UNSUPPORTED_MEDIA_TYPE | Content-Type ของทั้งคำขอไม่ตรงกับ endpoint |
| 422 | INVALID_PARAMETERS | ฟิลด์บังคับหาย ชนิดหรือค่าไม่ถูกต้อง ฟิลด์เกิน query เกิน หรือ body ที่ route ไม่รับ |
| 422 | PDF_INVALID | ไฟล์ว่าง นามสกุลหรือ MIME ไม่ใช่ PDF หรือเนื้อหาเป็นไฟล์ชนิดอื่น |
| 422 | PDF_UNREADABLE | เป็น PDF แต่ parse ไม่ได้ ไม่มีหน้า หรือเข้ารหัส |
| 500 | INTERNAL_ERROR | ข้อผิดพลาดที่ไม่คาดคิด |
| 502 | UPSTREAM_UNAVAILABLE | Frontend proxy ติดต่อ Backend ไม่ได้ connection หลุด หรือ timeout |
| 503 | STORAGE_UNAVAILABLE | อ่านหรือเขียนฐานข้อมูลหรือที่เก็บไฟล์ไม่ได้ |
| 503 | SAVED_ITEMS_UNAVAILABLE | อ่านหรือเปลี่ยนสถานะ bookmark ไม่ได้ |

32 KiB = 32,768 bytes และ 16 MB = 16,000,000 ไบต์ ขีดจำกัดคำขอรวมรองรับ multipart overhead ของ PDF 15 MB แต่ไม่เพิ่มขีดจำกัดเนื้อไฟล์ เมื่อเกินเพดานคำขอรวมตอบ REQUEST_TOO_LARGE ได้ก่อนตรวจไฟล์

ความผิดพลาดที่ Backend ยืนยันว่าล้มเหลวก่อนสำเร็จต้องไม่เปลี่ยนข้อมูลที่เผยแพร่แล้ว ส่วน 502 หรือเครือข่ายขาดหายเป็นผลที่ยังยืนยันไม่ได้ Client ต้องอ่านสถานะล่าสุด ไม่สรุปว่าบันทึกสำเร็จหรือไม่สำเร็จจากการขาด response อย่างเดียว

## 10 การเชื่อม API กับ Test case

ตารางนี้จับคู่ API กับ TC กรณี UI ยังต้องตรวจในงาน UI และ Integration

| TC | API หรือกติกาที่รองรับ |
| --- | --- |
| U6 TC01 TC02 | POST summary และ GET รายการ รายละเอียด ไฟล์ ข้อมูลเสริมไม่บังคับ |
| U6 TC03 | บังคับ course_id title file และ trim ชื่อก่อนตรวจ |
| U6 TC04 | ตรวจ PDF จริง ขนาดไฟล์ และการเปิดอ่าน |
| U6 TC05 | ตรวจวิชา CS ผูก owner จาก session ปฏิเสธฟิลด์สวมสิทธิ์ |
| U6 TC06 | ทุก GET รวม file ต้องมี Bearer token ที่ใช้ได้ |
| U6 TC07 TC08 | ไม่มี published record ค้างเมื่อเผยแพร่ล้มเหลว รายการกรองวิชาตรงและมี empty state |
| U7 TC01 TC02 | GET my-summaries กรองบัญชีและรองรับ items: [] เปิดไฟล์ด้วย U6 |
| U7 TC03 TC04 | PUT แบบ multipart แก้ข้อมูล ย้ายวิชาและเปลี่ยน PDF ได้ ไม่ส่งไฟล์ให้คง PDF เดิม |
| U7 TC05 TC06 | DELETE ปิดการอ่านทุกทางหลังลบ ยกเลิกใน UI แล้วไม่ส่ง DELETE |
| U7 TC07 TC08 | 401 403 404 และ 503 ไม่สร้างรายการที่ลบแล้วกลับมา |
| U7 TC09 | แทน PDF ล้มเหลวก่อน commit ต้องคงข้อมูลและเปิด PDF เดิมได้ |
| U8 TC01 TC02 TC03 | POST rating 1 ถึง 5 comment ไม่บังคับ ตรวจคะแนนเต็มอย่างเข้มงวด |
| U8 TC04 TC05 | PUT คง id เดิม DELETE ลบเฉพาะรีวิวของตน |
| U8 TC06 TC07 | 401 และ ownership check ห้ามสวม author และห้ามรีวิวงานตัวเอง |
| U8 TC08 TC09 | 409 เมื่อซ้ำ 404 เมื่อหาย 503 เมื่อล้มเหลว ทดสอบทั้ง guide และ summary |
| U9 TC01 TC02 TC03 | PUT บันทึก guide และ summary รายชิ้น แยกชนิดแม้ ID เท่ากัน และบันทึกซ้ำได้ |
| U9 TC04 TC05 | ตรวจ Login, ชนิดและ ID ของผลงาน ไม่ให้ระบุบัญชีอื่น และคงสถานะเดิมเมื่อบันทึกล้มเหลว |
| U10 TC01 | บันทึกซ้ำแล้วมี bookmark เดียว เช็ก saved จาก GET สถานะ |
| U10 TC02 TC03 | รายการแยกตามบัญชี เปิดตรงชิ้นจากกลุ่มวิชา และมีทางไปค้นหาเมื่อรายการว่าง |
| U10 TC04 | แยก list/state ตามบัญชีและนำ bookmark ของคนอื่นออกไม่ได้ |
| U10 TC05 | ผลงานหายตอบ 404 ส่วน type หรือ ID ผิดตอบ 422 |
| U10 TC06 | ข้อผิดพลาดแยกจากรายการว่างและผลนำออกสำเร็จ |
| U10 TC07 | นำ bookmark ออกซ้ำได้ saved: false ผลงาน PDF รายวิชา และ bookmark ของคนอื่นยังอยู่ |

### กรณีร่วมที่ต้องตรวจตอน implement

ทดสอบบัญชี A และ B ด้วย id ที่มีอยู่จริง รวมกรณีปลอม owner หรือ author ขอ PDF โดยตรงด้วย token หมดอายุ เพิ่มรีวิวซ้ำพร้อมกัน และบันทึกผลงานซ้ำพร้อมกัน ต้องไม่อาศัยการซ่อนปุ่มใน UI เป็นการบังคับสิทธิ์

ทดสอบการลบผลงานแล้วอ่านไฟล์หรือรีวิวซ้ำ การคืน error จาก proxy และการแยก JSON error ออกจาก PDF binary ชุดข้อมูลตัวอย่างครอบคลุม TC ใน docs/task94-fixtures แต่การรันทดสอบกับ API จริงเป็นงาน implementation ภายหลัง

## 11 จุดเชื่อมกับระบบเดิมและสถานะส่งมอบ

### สิ่งที่ใช้จากระบบเดิม

ใช้ Login และ Bearer session เดิมจาก backend/app/dependencies.py และ backend/app/routers/auth.py ใช้ Course.id และขอบเขต course_code ขึ้นต้น CS ตาม CourseDAO เดิม ใช้ Guide.id เป็นเป้าหมายรีวิวชนิด guide โดยไม่แก้ DTO ของแนวข้อสอบเดิม

API สรุป รีวิว และ saved-items ต้องตรวจในงาน implementation ส่วน /api/saved-guides เดิมยังรองรับแนวข้อสอบตามเดิม ใช้ bookmark แนวข้อสอบเดิมของบัญชีนี้ในรายการรวมได้โดยไม่สร้างรายการซ้ำ

### สิ่งที่ต้องเพิ่มในงาน implementation

เพิ่ม router และ DTO ของ API ใหม่ พร้อมบังคับสิทธิ์จาก session ฝั่ง Backend ออกแบบที่เก็บ PDF และการชดเชยเมื่อบันทึกข้อมูลหรือไฟล์ล้มเหลวในงานข้อมูลของ U6 และ U7 โดยให้ผลภายนอกเป็นไปตาม contract นี้

frontend/src/server.js ปัจจุบันมี proxy ที่อ่าน response เป็น text และส่ง body แบบ JSON ต้องเพิ่มเส้นทาง multipart และ binary PDF แยกจาก helper นั้น โดยคง Authorization Content-Type boundary และเนื้อไฟล์ตามจริง พร้อมส่ง Content-Disposition และ Cache-Control กลับให้ Browser

Proxy ใช้ allowlist ของ route และ method ใหม่โดยตรง วาง /api/guides/:guideId/reviews ก่อน wildcard /api/guides/*path เดิม เพื่อไม่ให้ wildcard เดิมปฏิเสธ route รีวิว ไม่เปลี่ยน mapping ของ API เดิม

ใช้เพดาน body ตามส่วน status code และให้ proxy ส่ง ErrorResponseDTO สำหรับ API ใหม่ ระยะเวลา timeout ของ upload และอ่านไฟล์ตั้งต้น 120 วินาที API JSON ใหม่ใช้ 12 วินาที เมื่อหมดเวลาตอบ 502 UPSTREAM_UNAVAILABLE และไม่ retry คำขอเขียนอัตโนมัติ

### ส่วนที่เสร็จในเอกสารนี้และงานที่เหลือของ Task94

ฉบับนี้กำหนด endpoint method DTO validation สิทธิ์ error และข้อตกลง PDF ตั้งต้นครบ พร้อมตัวอย่างรับส่ง TC mapping และชุดข้อมูลร่วม กติกาที่ Story เปิดไว้ใช้ค่าที่ระบุในเอกสารนี้เป็น baseline สำหรับพัฒนาต่อ

จัดเก็บเอกสารหลาย Story ไว้ที่ docs/task94-api-contract.md และ DOCX ตามรูปแบบโฟลเดอร์ที่กำหนดล่าสุด พร้อมชุดข้อมูลร่วมใน docs/task94-fixtures ส่วนที่ยังรอคือการ review ของ Frontend Backend และ PO รวมผลแก้ไข ผู้ตรวจ วันที่ และลิงก์ PR ติดตามใน docs/task94-review.md จึงยังไม่ถือว่า Task94 ผ่าน DoD ทั้งหมด

### แหล่งข้อมูลและรุ่นที่อ้างอิง

Trello export ที่ผู้ขอให้ตรวจ
o61hTRJw - group4section-100001 (3).json
ใช้การ์ด Task94 และ Story U6 ถึง U10 พร้อม Test case ทั้งหมดจาก snapshot นี้

แหล่งโค้ดที่ตรวจใน working tree วันที่ 31 ตุลาคม 2569
backend/app/routers/auth.py และ dependencies.py
backend/app/routers/guides.py และ schemas/guides.py
backend/app/routers/courses.py และ dao/course_dao.py
backend/app/routers/saved_guides.py
frontend/src/server.js
docs/U5/design/task65-my-guides-api-spec.md

การเปลี่ยน requirement ที่กระทบ API ต้องแก้เอกสารรุ่นถัดไปและนำส่วนที่เปลี่ยนไป review ไม่ย้อนกลับมาบังคับให้ทุก Story รอปิด Task94 ใหม่

## 12 ชุดข้อมูลตัวอย่างร่วม

ชุดข้อมูล docs/task94-fixtures/examples.json มีตัวอย่าง 83 กรณี ครอบคลุม API ใหม่ 17 endpoint และ TC ของ U6 ถึง U10 38 ข้อ ใช้สำหรับสร้าง mock หรือเตรียม API tests โดยไม่เพิ่ม endpoint จำลองความล้มเหลวในระบบจริง

### ข้อมูลตั้งต้นและการแยกแต่ละกรณี

data กำหนดบัญชี owner reader และ other วิชา CS261 CS104 และวิชานอก CS รวมแนวข้อสอบ สรุป รีวิว และผลงานที่บันทึก แต่ละ case ใช้เฉพาะ record ที่ระบุใน setup และเริ่มใหม่ก่อนรัน เพื่อไม่ให้การลบหรือแก้ไขในกรณีก่อนหน้ากระทบกรณีถัดไป

steps ระบุ method path actor request และ response ที่คาดหวังตามลำดับ ส่วน parallel_steps ระบุคำขอพร้อมกัน เช่นรีวิวซ้ำและบันทึกวิชาซ้ำ โดยลำดับ response ของคำขอพร้อมกันไม่ตายตัว ไม่เก็บรหัสผ่านหรือ token จริง ให้ test harness สร้าง session ของบัญชีที่ระบุเอง

### ไฟล์ PDF สำหรับทดสอบ

สร้างไฟล์ด้วย python scripts/task94_fixtures.py build-pdfs --output-dir <temporary-folder> ได้ไฟล์ปกติ ไฟล์ว่าง ไฟล์ปลอมเป็น PDF ไฟล์เสีย PDF ไม่มีหน้า และ PDF ขนาดเท่ากับหรือเกิน 15 MB อย่างละหนึ่งไฟล์ ไม่เก็บไฟล์ขนาดใหญ่ใน Git

ไฟล์ at-limit.pdf มีขนาด 15,000,000 ไบต์ และ over-limit.pdf มีขนาด 15,000,001 ไบต์ ตัวอย่าง JSON ใช้ชื่อไฟล์ตรงกับ generator ข้อมูล file_content_type และชื่อไฟล์อยู่ใน request เพื่อประกอบ multipart จริง

### การตรวจความสอดคล้อง

รัน python scripts/task94_fixtures.py check เพื่อตรวจ reference ของข้อมูล coverage ของ TC route method status schema และขนาดไฟล์ที่สร้าง การตรวจนี้ไม่เรียก API หรือฐานข้อมูลและไม่ยืนยันว่า implementation ผ่าน TC แล้ว

กรณี ui_expectation เช่นยกเลิกลบและคลิกเปิดวิชา ไม่มี endpoint ใหม่ ส่วน fault เป็นเงื่อนไขจำลองใน test harness รายละเอียดวิธีใช้และขอบเขตอยู่ใน docs/task94-fixtures/README.md

## 13 หมายเหตุการส่งตรวจ Task94

สถานะเอกสารรุ่น 0.4 พร้อมให้ทีมตรวจ ส่วนที่ทำเสร็จคือ API contract ข้อตกลง PDF ตัวอย่างข้อมูลร่วม และ TC mapping ยังไม่บันทึกว่ามีผู้ตรวจอนุมัติหรือผ่าน DoD ทั้ง Task แล้ว

### รายการที่รอคนตรวจ

Frontend รอตรวจการประกอบ multipart การรับ PDF แบบ binary error states และความเพียงพอของ DTO สำหรับหน้าจอ Backend รอตรวจ validation สิทธิ์ ความสอดคล้องของการบันทึกไฟล์กับข้อมูล และผลคำขอซ้ำ PO รอตรวจกติกาเทียบ Story และ TC รวมขนาด PDF ข้อมูลเสริม และข้อห้ามรีวิวงานตัวเองหรือรีวิวซ้ำ

บันทึกชื่อผู้ตรวจจริง วันที่ตรวจ รุ่นเอกสาร ลิงก์ PR ผลตรวจ และการแก้ไขที่ docs/task94-review.md ช่องที่ยังไม่ได้ตรวจคงสถานะรอตรวจ ไม่ใช้การตรวจไฟล์อัตโนมัติแทนการยอมรับของ Frontend Backend หรือ PO

### การจัดเก็บเอกสาร

เอกสารนี้ครอบคลุมหลาย Story จึงใช้ docs/task94-api-contract.md และ docs/task94-api-contract.docx แทน path docs/sprint-2/contract.md ในการ์ดเดิม ตามรูปแบบโฟลเดอร์ที่ผู้ขอกำหนดล่าสุด เอกสารเฉพาะ Story ของงานถัดไปยังใช้ docs/U6 ถึง docs/U10 ตามเดิม

เมื่อมีข้อแก้จาก review ให้ปรับ Markdown DOCX และชุดข้อมูลที่ได้รับผลกระทบให้เป็นรุ่นเดียวกัน ก่อนบันทึกผลตรวจรอบถัดไป Task95 ถึง Task109 ยังต้องส่ง artefact และ review ของตนเอง เอกสาร Task94 ไม่แทนตาราง DAO Sequence Diagram หรือแบบ UI ของ Task เหล่านั้น

## ไฟล์ประกอบ

- [เอกสาร Word](task94-api-contract.docx)
- [วิธีใช้ชุดข้อมูลร่วม](task94-fixtures/README.md)
- [ข้อมูลและตัวอย่าง request response](task94-fixtures/examples.json)
- [สถานะและหมายเหตุการ review](task94-review.md)
