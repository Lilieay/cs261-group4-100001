# ชุดข้อมูลร่วมของ Task94

รุ่น 0.3 วันที่ 14 พฤศจิกายน 2569 ใช้กับ [API contract ของ U6 ถึง U10](../task94-api-contract.md)

[examples.json](examples.json) เก็บข้อมูลตั้งต้นและตัวอย่างรับส่งสำหรับ Frontend mocks และ Backend API tests ครอบคลุม TC ของ U6 ถึง U10 37 ข้อ ข้อมูลเป็นบัญชีและผลงานสมมติ ไม่มีรหัสผ่านหรือ token จริง และไม่ใช่ผลทดสอบระบบที่พัฒนาแล้ว

ตัวอย่าง saved-courses ของ U9/U10 ยังอิงรุ่น 0.2 ให้ใช้เป็นข้อมูลเทียบเท่านั้น ระหว่างรอ route และ DTO สำหรับ bookmark รายชิ้น กลุ่มนี้ยังไม่นับ U10-TC07 เป็น fixture ของ API ใหม่

## รูปแบบข้อมูล

| ส่วน | ความหมาย |
| --- | --- |
| `data` | record ที่ตั้งชื่อไว้ เช่น `owner`, `reader`, `cs261`, `summary_owner` และ `review_summary` |
| `endpoints` | method, path template, ชนิด response และ status ที่ตัวอย่างอ้างใช้ |
| `cases[].id` | ชื่อกรณีที่ไม่ซ้ำ ใช้เลือก mock หรืออ้างใน test |
| `test_cases` | TC ต้นทางที่กรณีนี้รองรับ |
| `setup` | รายชื่อ record ที่ต้องมีอยู่ก่อนเริ่มกรณีนี้ แต่ละกลุ่มเลือกจาก `data` |
| `steps` | คำขอตามลำดับและผลที่คาดหวัง คำขอหลังใช้สถานะที่คำขอก่อนเปลี่ยนแล้ว |
| `parallel_steps` | คำขอที่ต้องทดสอบพร้อมกัน ไม่ผูกผลกับลำดับที่ response กลับมา |
| `request.form` | ค่า form text ของ multipart ส่วน `file` และ `file_content_type` ใช้ประกอบ file part |
| `request.body` | JSON body ของคำขอ |
| `response` | status, headers, content type และ body หรือชื่อ PDF ที่คาดหวัง การตอบ 204 ไม่มี body |
| `fault` | เงื่อนไขจำลองความล้มเหลวใน test harness ใช้ test double หรือ failure injection ภายใน tests ไม่ใช่ API parameter |
| `invariant` | สิ่งที่ต้องคงจริงหลังเรียก เช่นไม่เปลี่ยนข้อมูลผู้อื่นและไม่เกิดรายการซ้ำ |
| `ui_expectation` | สิ่งที่ต้องตรวจบน UI เช่นยกเลิกลบแล้วไม่มี DELETE หรือเปิดวิชาผ่าน API เดิม |

เริ่มด้วยฐานข้อมูลแยกสำหรับ tests แล้วเติมเฉพาะ record ที่ `setup` เลือกไว้ก่อนแต่ละกรณี การไม่เลือก review หรือ saved course หมายถึงยังไม่มี relation นั้น ห้ามนำข้อมูลชุดนี้ไป seed ทับฐานข้อมูลผู้ใช้จริง

`Guide` ใน `data.guides` เป็นข้อมูลระบุตัวผลงานสำหรับ contract รีวิว ไม่ใช่ row ของ ORM ที่ insert ได้ทันที ตัวทดสอบ Backend ต้องเติมฟิลด์บังคับของโมเดลเดิมเองโดยคง id, course และเจ้าของตามตัวอย่าง เช่นเดียวกับการแปลง SummaryDTO เป็นข้อมูลภายใน ซึ่งเป็นงานของ test harness หลังมี implementation

## บัญชีและ session

| actor | ข้อมูลตั้งต้น | วิธีใช้ |
| --- | --- | --- |
| `owner` | user id 11 นักศึกษา A | เจ้าของสรุป 101 และผู้เขียนรีวิวแนวข้อสอบ 42 |
| `reader` | user id 22 นักศึกษา B | เจ้าของแนวข้อสอบ 42 และสรุป 102 และผู้เขียนรีวิวสรุป 101 |
| `other` | user id 33 นักศึกษา C | บัญชีที่ไม่ใช่เจ้าของตัวอย่างข้างต้น |
| `anonymous` | ไม่มี session | ไม่ส่ง Authorization header |
| `expired` | session ใช้ไม่ได้ | ใช้ token ที่หมดอายุหรือไม่มีอยู่ใน session store สำหรับ tests |

Frontend ใช้ actor เป็นชื่อ mock ได้ ส่วน API tests ต้องสร้าง session ที่ระบุตัวบัญชีตรงกัน ไม่ใช้ `owner` เป็น Bearer token จริง การกำหนด id ใน fixtures ไม่เปลี่ยนวิธี Login ของ production

## ไฟล์ PDF

ใช้ Python 3.10 ขึ้นไปสร้างไฟล์ในโฟลเดอร์ชั่วคราวจาก repository root คำสั่งนี้ใช้ Python standard library และไม่เรียก network

```powershell
python scripts/task94_fixtures.py build-pdfs --output-dir "$env:TEMP/task94-pdf-fixtures"
```

| ไฟล์ | เงื่อนไขที่ใช้ทดสอบ |
| --- | --- |
| `valid-summary.pdf` | PDF เปิดอ่านได้หนึ่งหน้า ขนาดเล็ก ใช้คู่กับ response metadata ใน fixtures |
| `empty.pdf` | ไฟล์ขนาด 0 bytes คาดหวัง 422 PDF_INVALID |
| `disguised.pdf` | เนื้อหาเป็น PNG signature แต่ตั้งนามสกุล PDF คาดหวัง 422 PDF_INVALID |
| `unreadable.pdf` | มี PDF signature แต่โครงสร้างขาด คาดหวัง 422 PDF_UNREADABLE |
| `no-pages.pdf` | โครงสร้าง PDF ที่มี 0 หน้า คาดหวัง 422 PDF_UNREADABLE |
| `at-limit.pdf` | PDF เปิดอ่านได้ ขนาด 15,000,000 ไบต์ ผ่านเงื่อนไขขนาด |
| `over-limit.pdf` | PDF เปิดอ่านได้ ขนาด 15,000,001 ไบต์ คาดหวัง 413 PDF_TOO_LARGE |

ไม่เก็บ PDF ขนาด 15 MB ใน Git ไฟล์สร้างซ้ำได้จาก generator ให้แนบแต่ละไฟล์เป็น file part ที่มี `application/pdf` ตามตัวอย่าง กรณีตรวจชื่อไฟล์หรือ MIME ให้เปลี่ยนเฉพาะชื่อหรือ MIME ใน test โดยใช้ bytes เดิม

## ตรวจชุดข้อมูลก่อนใช้

```powershell
python scripts/task94_fixtures.py check
```

คำสั่งตรวจชื่อ record, endpoint, method, status, error envelope, response DTO, TC mapping และขนาด PDF ที่ generator สร้าง ต้องผ่านก่อนนำ fixtures ไปอ้างใน UI หรือ API tests การตรวจนี้ไม่เรียก FastAPI, Frontend หรือฐานข้อมูล และไม่ทดแทนการทดสอบ behavior จริง

ตัวอย่างครอบคลุมการเผยแพร่และอ่าน PDF การจัดการของเจ้าของ รีวิวทั้ง guide และ summary การบันทึกวิชาไม่มีเนื้อหา สิทธิ์ผิด คำขอซ้ำ และความล้มเหลวก่อน commit แต่ละ TC อาจยังต้องเพิ่มกรณีย่อยในงานทดสอบของ Story เช่นหลาย Browser การยืนยันหน้าแก้ไข และการ reconnect หลัง timeout

## ส่วนที่รอทีมตรวจ

Frontend ตรวจว่า response และ error fields ใช้สร้าง UI states ได้ครบ Backend ตรวจการแปลงข้อมูลตั้งต้นเป็น test setup และจุดจำลอง fault ส่วน PO ตรวจว่าข้อมูลและผลคาดหวังตรง Story และ TC บันทึกชื่อผู้ตรวจ วันที่ และผลตรวจที่ [หมายเหตุ review](../task94-review.md)
