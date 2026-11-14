# สถานะส่งตรวจ Task94

รุ่นเอกสาร 0.4 วันที่แก้ไข 14 พฤศจิกายน 2569

สถานะ **พร้อมส่งตรวจ รอ Frontend Backend และ PO review** ยังไม่อ้างว่าทีมอนุมัติหรือ Task94 ผ่าน DoD ทั้งหมด

เอกสารครอบคลุม U6 ถึง U10 จึงจัดเก็บใต้ `docs/` ตามคำสั่งล่าสุด แทน `docs/sprint-2/contract.md` ที่ระบุใน Trello export เดิม เอกสารเฉพาะ Story ของ Task อื่นยังใช้ `docs/U6/` ถึง `docs/U10/` ตามเดิม

## ไฟล์ส่งมอบ

- [API contract แบบ Markdown](task94-api-contract.md)
- [API contract แบบ Word](task94-api-contract.docx)
- [วิธีใช้ข้อมูลทดสอบร่วม](task94-fixtures/README.md)
- [ข้อมูลตั้งต้นและตัวอย่าง request response](task94-fixtures/examples.json)
- [เครื่องมือตรวจ fixtures และสร้าง PDF](../scripts/task94_fixtures.py)

Branch `docs/task94-api-contract` ใช้ฐาน `sprint2` commit `db682e2044be73498fea6d9fcfe4c80bd42c1a09`

PR [#103](https://github.com/Lilieay/cs261-group4-100001/pull/103) เปิดเข้า `sprint2` แล้ว สถานะยังรอ Frontend Backend และ PO review

## Definition of Done

- [ ] ทบทวน Story/TC และตกลงกติกาที่กระทบ API **กับทีม** มีแบบตั้งต้นแล้ว แต่ยังรอยืนยันร่วมกับ Frontend Backend และ PO
- [x] กำหนด endpoint/method, DTO, request/response/error, ID และสิทธิ์
- [x] กำหนดรูปแบบส่งไฟล์ PDF และรูปแบบตอบกลับ PDF/ข้อมูลกำกับใน contract พร้อมให้ทีมตรวจ
- [x] จัดทำตัวอย่างข้อมูลสำเร็จ/ผิดพลาดสำหรับ UI/API tests พร้อม TC mapping และวิธีสร้างไฟล์ PDF
- [ ] ทบทวนกับ Frontend/Backend/PO แก้ข้อพบ และจัดเก็บ contract **ที่ Review แล้ว** ใน Repository

## Artefact to deliver

- [x] เอกสาร API กลางแยก U6 ถึง U10 พร้อม API/DTO ตัวอย่างรับส่งและข้อผิดพลาด สิทธิ์ และ TC mapping ใช้ path `docs/task94-api-contract.md` ตามรูปแบบโฟลเดอร์ล่าสุด
- [x] ข้อตกลง upload/read PDF ผ่าน Login และตัวอย่างข้อมูลทดสอบร่วม
- [ ] บันทึก **ผล review จริง** พร้อมผู้ตรวจ วันที่ รุ่นเอกสาร และลิงก์ PR บันทึกข้อแก้จาก Anas ด้านล่างแล้ว ยังรอทีมยืนยันและตรวจฉบับแก้ไข

## ผู้ตรวจและประเด็นที่รอ

| บทบาท | ผู้ตรวจ | วันที่ตรวจ | รุ่นที่ตรวจ | ผลตรวจ | ประเด็น |
| --- | --- | --- | --- | --- | --- |
| Frontend | ยังไม่ระบุ | ยังไม่ตรวจ | 0.2 | รอตรวจ | multipart, binary PDF, DTO, error และ UI states รวมการใช้ fixtures |
| Backend | ยังไม่ระบุ | ยังไม่ตรวจ | 0.2 | รอตรวจ | validation, session และ ownership, การบันทึกข้อมูลกับไฟล์, คำขอซ้ำ และการเตรียม test setup |
| PO | ยังไม่ระบุ | ยังไม่ตรวจ | 0.2 | รอตรวจ | Story และ TC, PDF 15,000,000 ไบต์, ข้อมูลเสริม, ห้ามรีวิวตัวเอง และหนึ่งคนหนึ่งรีวิว |

หลังตรวจแต่ละรอบให้เพิ่มชื่อผู้ตรวจจริง วันที่ รุ่น ลิงก์ comment หรือ PR และผลแก้ไข ห้ามใช้ผลตรวจอัตโนมัติของ fixtures แทนการยอมรับจากทีม

## ผล review รอบ 14 พฤศจิกายน 2569

[Anas ตรวจรุ่น 0.2 ใน PR #103](https://github.com/Lilieay/cs261-group4-100001/pull/103#pullrequestreview-5904441698) และขอแก้สี่เรื่อง

| เรื่อง | ผลแก้ |
| --- | --- |
| U6 เพดาน PDF | ใช้ 15,000,000 ไบต์ตาม Task95 ทั้ง contract, fixtures และ generator เพดาน multipart รวมใช้ 16,000,000 ไบต์ตามแบบ Task101 เพื่อเผื่อ form parts |
| U7 รูปแบบ PUT | ใช้ multipart ให้ย้ายวิชาและส่ง PDF ใหม่ได้ เพิ่มตัวอย่างแทนไฟล์สำเร็จและล้มเหลวก่อน commit ตาม Task96 |
| U9/U10 รายการส่วนตัว | กำหนด `/api/saved-items` สำหรับ list และเส้นทางแบบระบุชนิดกับ ID สำหรับ save/state/delete ยึด DTO และลำดับรายการจาก [Task104](https://github.com/Lilieay/cs261-group4-100001/pull/106) |
| U10 TC07 | เพิ่ม u10-remove-again และตรวจ coverage ถึง TC07 ทดสอบการลบซ้ำและการคงผลงานกับ bookmark ของคนอื่น |

## ขอบเขตการตรวจไฟล์

ผลตรวจรุ่น 0.4 วันที่ 14 พฤศจิกายน 2569

- ตัวตรวจ fixtures ผ่าน 83 ตัวอย่าง 17 endpoint และ 38 TC รวม U10-TC07
- ตรวจว่า Guide กับ Summary ที่ใช้ ID เดียวกันมี open path คนละเส้นทางและแสดงใต้รายวิชาเดียวกัน
- เปิด Word รุ่น 0.4 ตรวจการจัดหน้าครบ 14 หน้า

ผลตรวจรุ่น 0.3 วันที่ 14 พฤศจิกายน 2569

- ตัวตรวจ fixtures ผ่าน 81 ตัวอย่าง 17 endpoint 37 TC และ PDF input 7 ชนิด ส่วน U9/U10 ยังเป็นชุดเทียบรุ่น 0.2
- pypdf เปิดไฟล์ 15,000,000 และ 15,000,001 ไบต์ได้อย่างละหนึ่งหน้า
- เปิดฉบับ Word รุ่น 0.3 ได้ครบ 14 หน้าและตรวจการจัดหน้าแล้ว

การตรวจในงานนี้ยืนยันความสอดคล้องของเอกสารและ fixtures รวมถึงความถูกต้องของโครงสร้าง DOCX และการแสดงผลทุกหน้า ไม่ได้ยืนยันว่า API ใหม่ implement แล้วหรือผ่านการทดสอบกับ SQL Server และ Browser

ผลตรวจไฟล์วันที่ 31 ตุลาคม 2569

| การตรวจ | ผล |
| --- | --- |
| `python scripts/task94_fixtures.py check` | ผ่าน 78 ตัวอย่าง 17 endpoint 36 TC และ PDF input 7 ชนิด |
| อ่าน PDF ที่สร้างด้วยตัวอ่าน pypdf แยกจาก generator | PDF ปกติและไฟล์ขนาดเท่ากับหรือเกินขีดจำกัดมี 1 หน้า ส่วน PDF ไม่มีหน้ามี 0 หน้า ขนาดตรงตามกำหนด |
| ตรวจ DOCX ด้วย Word | แสดงผลครบ 14 หน้า ตรวจตาราง ข้อความภาษาไทย และการตัดหน้าแล้ว |
| ตรวจอิสระด้านความสอดคล้องของ contract และ fixtures | แก้ setup ของ U10-TC02 ให้บัญชีเดียวมีทั้งสองวิชา และตรวจซ้ำแล้ว |

ผลข้างต้นเป็นการตรวจ artefact เพื่อเตรียมส่งทีม ไม่ใช่การอนุมัติจาก Frontend Backend หรือ PO

Task100 ถึง Task104 ยังรับผิดชอบตาราง ER DAO และ Sequence Diagram ส่วน Task105 ถึง Task109 ยังรับผิดชอบ UI Prototype Storyboard และ UI states การยืนยัน Requirement ของแต่ละ Story ยังเป็นงาน Task95 ถึง Task99
