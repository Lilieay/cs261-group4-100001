# Task103 U9 จุดทดสอบและบันทึก review

รุ่น 0.1 | วันที่ 13 พฤศจิกายน 2569 | สถานะ: ยังไม่รัน Unit, API หรือ Integration tests

ใช้คู่กับ [แบบ DAO](task103-u9-dao-design.md) และ [Sequence Diagram](task103-u9-sequences.md) การตรวจเอกสารไม่ใช่ผลทดสอบ implementation หรือการอนุมัติของทีม

## 1 ข้อมูลทดสอบ

เตรียมบัญชีสมมติ A และ B ที่มี session ใช้งานได้, session หมดอายุ และคำขอไม่มี token เตรียม Guide G1 และ G2 ที่มีอยู่จริง, Summary PDF S1 และ S2 ที่มีอยู่จริง และ target ID ที่ไม่มีอยู่

ควรเตรียม Guide กับ Summary ที่มีเลข ID เท่ากันอย่างน้อยหนึ่งคู่ เพื่อทดสอบการแยก namespace เช่น Guide 101 และ Summary 101 ต้องเป็นคนละ target เตรียมบัญชี A ที่บันทึก Guide 101 แล้ว และบัญชี B ที่ยังไม่ได้บันทึก Guide 101

เตรียมข้อมูล legacy ใน `saved_guides` ก่อนทดสอบ และบันทึกจำนวน/ค่าอ้างอิงไว้เพื่อเปรียบเทียบหลัง migration/test ห้ามใช้ token จริงหรือข้อมูลส่วนบุคคลใน Git

Unit ใช้ fake DAO เพื่อทดสอบ service logic; API ตรวจ HTTP boundary; Integration ใช้ SQL Server จริงเพื่อทดสอบ unique constraint, transaction และ concurrent request ไม่ใช้ SQLite แทนหลักฐาน concurrency ของ SQL Server

## 2 Mapping กับ U9-TC01 ถึง U9-TC05

| TC และผลคาดหวัง | Unit | API | Integration / UI |
| --- | --- | --- | --- |
| TC01 บันทึกผลงานสำเร็จ | service ระบุ user จาก auth และเรียก save ด้วยชนิด/ID ถูกต้อง | PUT target ที่มีอยู่ตอบ saved true ตาม DTO ที่อนุมัติ | SQL มี relation หนึ่ง row; reload/Login บัญชีเดิมยังเห็นสถานะ saved |
| TC02 บันทึกผลงานที่ไม่มีเนื้อหา | ตรวจตามกติกาชนิดผลงานที่ PO ยืนยัน ไม่บังคับให้มี PDF/Guide content หาก requirement อนุญาต | target ที่มีอยู่แต่ไม่มี content ต้องบันทึกได้ตาม rule ที่อนุมัติ | ยืนยัน saved relation ถูกสร้างโดยไม่สร้าง content/target ใหม่ |
| TC03 บันทึกซ้ำไม่เพิ่มรายการซ้ำ | duplicate path คืน already_saved โดยไม่ insert เพิ่ม | PUT ซ้ำแสดงข้อความ “ได้บันทึกการแบ่งปันนี้ไปแล้ว” | unique constraint ทำให้มีหนึ่ง row แม้ยิงพร้อมกัน |
| TC04 ไม่มีสิทธิ์หรือ target ใช้ไม่ได้ | auth/validation/target existence ถูกตรวจตามลำดับ | no token/invalid token = 401; owner field spoof = 422; target missing = 404; type/id invalid = 422 | ไม่สร้าง saved row และไม่เปลี่ยนบัญชีอื่น |
| TC05 บันทึกล้มเหลวต้องไม่แจ้งสำเร็จ | service แปลง DB failure เป็น error และไม่คืน success | response เป็น error ตาม Contract; ไม่ตอบ success ลวง | จำลอง insert/commit failure; เมื่อยืนยัน rollback แล้วไม่มี saved row; UI ไม่แสดง saved state |

**หมายเหตุ:** Task98 ระบุ TC01–TC05 เป็น Not Run ทั้งหมด ห้ามทำเครื่องหมาย Pass จนกว่าจะรันทดสอบและแนบหลักฐานจริง

TC02 เดิมกล่าวถึงรายวิชาที่ไม่มีแนวข้อสอบหรือสรุป แต่ PO เปลี่ยนเป้าหมายเป็นการบันทึก Guide/Summary รายชิ้น จึงต้องให้ PO ยืนยันความหมายใหม่ของ “ไม่มีเนื้อหา” ก่อนใช้ TC02 เป็น acceptance test

## 3 กรณีขยายสำหรับ DAO, API และ concurrency

| รหัส | เหตุการณ์ | ผลคาดหวังที่ต้องพิสูจน์ |
| --- | --- | --- |
| U9-D01 | A บันทึก Guide G1 ครั้งแรก | มี relation ของ A/G1 หนึ่งรายการ |
| U9-D02 | A บันทึก Guide G1 ซ้ำ | ไม่เพิ่ม row และคืน duplicate message ตาม PO |
| U9-D03 | A บันทึก Summary S1 ที่ ID เลขเดียวกับ Guide G1 | เก็บแยกกันตาม item_type |
| U9-D04 | B อ่านสถานะ G1 ที่ A บันทึก | B ได้ saved=false; ไม่เห็นข้อมูลรายการส่วนตัวของ A |
| U9-D05 | ไม่มี token / token ผิด / หมดอายุ | 401 AUTH_REQUIRED และ WWW-Authenticate: Bearer |
| U9-D06 | ส่ง user_id หรือ owner_id จาก client | 422 INVALID_PARAMETERS และไม่เปลี่ยนข้อมูล |
| U9-D07 | item_type ไม่รองรับ หรือ item_id ไม่ใช่จำนวนเต็มบวก | 422 INVALID_PARAMETERS |
| U9-D08 | target ไม่มีอยู่จริง | 404 ตามชนิด; ห้ามสร้าง target ใหม่ |
| U9-D09 | DB อ่านสถานะไม่ได้ | error ตาม Contract; ห้ามตอบ saved=false |
| U9-D10 | DB insert ล้มเหลวก่อน commit และยืนยัน rollback | ไม่มี saved relation; UI ไม่แสดง success |
| U9-D11 | PUT เดียวกันพร้อมกันหลาย request | SQL Server unique constraint ทำให้เหลือหนึ่ง relation |
| U9-D12 | Guide 101 และ Summary 101 | state และ save ของแต่ละชนิดไม่ปะปน |
| U9-D13 | ตรวจ legacy saved_guides ก่อน/หลัง | ไม่มีการ convert/delete อัตโนมัติจากงานนี้ |
| U9-D14 | reload หรือ Login ใหม่ด้วยบัญชีเดิม | สถานะ saved ยังคงอยู่ |
| U9-D15 | target ถูกลบหลัง save | behavior ต้องตรง deletion policy ที่ PO/Backend อนุมัติ; ห้ามปล่อย broken reference โดยไม่กำหนด |

## 4 ผลตรวจแบบและข้อจำกัดที่ต้องแก้ก่อน implementation

| ข้อพบ | แนวทางในแบบ | จุดตรวจต่อ |
| --- | --- | --- |
| Task94 v0.2 มี `/api/saved-courses` แต่ PO U9 ให้บันทึก Guide/Summary | เสนอ endpoint ใหม่แบบ item_type + item_id | ปรับ Task94 และ review กับ Frontend/Backend/PO |
| legacy `/api/saved-guides` ใช้ guide_id | ไม่แปลงข้อมูลเดิมอัตโนมัติ | ยืนยัน compatibility/deprecation แยก |
| ID ของ Guide และ Summary อาจชนกัน | ใช้ item_type เป็นส่วนหนึ่งของ key | ตรวจ schema/unique constraint กับ Task100 |
| เช็คก่อน insert อย่างเดียวไม่กัน race | unique constraint เป็น final guard | ทดสอบ concurrent request บน SQL Server |
| Task98 ระบุข้อความ duplicate แต่ไม่ระบุ HTTP status/DTO | แสดงเป็น contract question | ให้ PO/Frontend/Backend ยืนยัน response |
| TC02 อ้างวิชาที่ไม่มี content แต่ PO เปลี่ยนเป็น item saving | ระบุว่าต้องแก้ acceptance criteria | ให้ PO ยืนยันความหมายก่อนรันทดสอบ |
| สิทธิ์บันทึกผลงานของตนเองยังไม่ชัด | ไม่สมมติคำตอบ | ขอ PO decision |

## 5 DoD และ review ที่ยังต้องมีหลักฐาน

| ข้อของ Task103/U9 | หลักฐานในชุดนี้ | สถานะ |
| --- | --- | --- |
| DAO input/output/errors | `task103-u9-dao-design.md` ส่วน 4–5 | จัดทำแล้ว รอทีมตรวจ |
| Sequence อ่านสถานะและบันทึก | `task103-u9-sequences.md` และ `.mmd` 2 ไฟล์ | จัดทำแล้ว รอทีมตรวจ |
| duplicate และ concurrent save | U9-D02/U9-D11 และ DAO unique guard | จัดทำแบบแล้ว รอ Backend review |
| auth, invalid target, failure | U9-TC04/TC05 และ U9-D05–D10 | จัดทำแบบแล้ว รอ Contract alignment |
| ทบทวน Requirement/TC กับ PO | Task98 มี PO decision บางข้อ แต่ TC02 และ policy บางเรื่องยังต้องยืนยัน | Pending |
| จัดเก็บไฟล์แก้ไขได้ใน Repository | Markdown และ Mermaid source | พร้อมนำเข้า repo หลัง review |

### Review record

| ผู้ตรวจตามบทบาท | ประเด็นที่ต้อง review | ผู้ตรวจ/วันที่/ผล |
| --- | --- | --- |
| Frontend | endpoint, DTO, duplicate message, saved/unsaved/loading/error states | Pending |
| Backend / Task100 | table/column/FK, unique constraint, transaction, concurrency | Pending |
| PO / ผู้ดูแล Task94/98 | item types, duplicate response, TC02, self-save policy, deletion policy | Pending |

เมื่อมี review ให้บันทึกผู้ตรวจจริง วันที่ รุ่นเอกสาร ลิงก์ comment/PR ข้อพบและผลแก้ ไม่ใช้ self-review หรือการตรวจไฟล์แทนการยอมรับร่วม

### Definition of Done

- [ ] ทบทวน U9 Requirement และ TC01–TC05 ร่วมกับ PO
- [ ] ยืนยันการบันทึก Guide/Summary รายชิ้นและ item types
- [ ] ยืนยัน duplicate behavior, response status/DTO และข้อความ UI
- [ ] ยืนยัน auth, owner identity, target validation และ self-save policy
- [ ] ยืนยัน DAO methods, unique constraint และ transaction กับ Backend/Task100
- [ ] ตรวจ Sequence อ่านสถานะและบันทึกกับ Frontend/Backend
- [ ] ปรับ Task94 API Contract และจัดเก็บ contract รุ่นที่ review แล้ว
- [ ] รัน Unit, API และ Integration tests พร้อมหลักฐานจริง

**สถานะปัจจุบัน:** Draft for Review; ยังไม่ implement, ยังไม่รัน tests และยังไม่ผ่าน DoD
