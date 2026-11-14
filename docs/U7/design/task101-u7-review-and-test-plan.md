# Task101 U7 จุดทดสอบและบันทึก review

รุ่น 0.2 | วันที่ 10 พฤศจิกายน 2569 | สถานะ: ยังไม่รัน Unit, API หรือ Integration tests

ใช้คู่กับ [แบบ DAO](task101-u7-dao-design.md) และ [Sequence Diagram](task101-u7-sequences.md) การตรวจเอกสารไม่ใช่ผลทดสอบ implementation หรือการอนุมัติของทีม

## 1 ข้อมูลทดสอบ

แต่ละกรณีเริ่มจากข้อมูลแยกกัน ใช้บัญชีสมมติ A และ B ที่มี session ใช้งานได้, session หมดอายุ และคำขอไม่มี token สร้าง S1 ID 101 ของ A ใน CS261 พร้อม PDF P1, S2 ID 202 ของ B และ S3 อีกหนึ่งรายการของ A สร้างวิชา CS104 ที่ยังไม่มีสรุปกับวิชานอก CS และยืนยันว่า ID 999999 ไม่มีจริง เก็บ metadata เดิมและ SHA-256 ของ P1 ก่อนเริ่ม

เตรียม PDF P2 ที่ bytes ต่างจาก P1, PDF ที่ขนาดตรง 15,000,000 และ 15,000,001 bytes โดยยัง parse ได้, ไฟล์ว่าง, ไฟล์ปลอม, PDF เสีย, PDF ไม่มีหน้า และ PDF มี password ไม่เก็บ PDF ขนาดใหญ่หรือ token จริงใน Git

Unit ใช้ fake DAO และ storage เพื่อทดสอบการตัดสินใจของ service ส่วน API ตรวจ HTTP boundary และ Integration ใช้ SQL Server กับ private storage จริงในสภาพแวดล้อมทดสอบ รวม proxy สำหรับ body limit และ timeout ไม่ใช้ SQLite แทนหลักฐานการ lock ของ SQL Server

## 2 Mapping กับ U7-TC01 ถึง U7-TC08

| TC และผลคาดหวัง | Unit | API | Integration และ UI |
| --- | --- | --- | --- |
| TC01 แสดงของ A และเปิด PDF ตรงรายการ | DAO กรอง owner และ sort, mapping DTO ไม่ส่ง private key | GET my-list มี S1/S3 ไม่มี S2; GET file ที่ Login แล้วได้ PDF | เทียบ bytes กับ P1; SQL join ไม่เพิ่มแถวซ้ำ; request PDF ไม่มี token ได้ 401 |
| TC02 บัญชีไม่มีสรุป | คืน [] เมื่อไม่มีข้อมูลจริง; exception ไม่กลายเป็น [] | 200 `{"items":[]}` แยกจาก DB fail 503 | UI แสดงยังไม่มีสรุปและทางไปเผยแพร่ |
| TC03 แก้ไขสำเร็จ | คง id/owner/created_at, trim, clear description, ไม่ส่ง file ใช้ reference ล่าสุด | PUT multipart เปลี่ยน title/description และย้ายไป CS104 ได้; DTO ตรง GET หลังแก้ | Metadata-only checksum ยังเท่า P1; ส่ง P2 ได้ checksum ใหม่; วิชาเก่าไม่มี S1 วิชาใหม่มี S1 |
| TC04 ชื่อผิดไม่บันทึก | แยกชื่อว่างและ whitespace; title 200 ผ่าน 201 ไม่ผ่าน; description 2,000 ผ่าน 2,001 ไม่ผ่าน | 422 fields ชี้ title หรือ description; ฟิลด์เกินและ part ซ้ำถูกปฏิเสธ | แม้ส่ง P2 มาพร้อมชื่อผิด DB และ checksum P1 คงเดิม |
| TC05 ยืนยันลบ | delete เฉพาะ id กับ owner; รอ commit ก่อน success | 204 body ว่าง; GET detail/file/reviews ครั้งใหม่ 404; DELETE ซ้ำ 404 | S1 หายจาก my-list และหน้าวิชา; Course, User, S2/S3 และ target อื่นไม่ถูกลบ; cleanup retry ได้ |
| TC06 ยกเลิกลบ | ไม่เรียก API client เมื่อ cancel | ไม่มี request DELETE จาก UI | ดัก network ยืนยันว่าไม่มี DELETE และ reload แล้วยังอ่าน P1 ได้ |
| TC07 ไม่มีสิทธิ์ | service ปฏิเสธ B ก่อน prepare PDF; owner predicate ป้องกันเขียนข้ามบัญชี | ไม่มี/หมดอายุ token 401 พร้อม WWW-Authenticate; B แก้/ลบ S1 ได้ 403; owner spoof ได้ 422 | ยิงตรง Backend และผ่าน proxy ไม่เปลี่ยน S1/P1; my-list ไม่รับ user_id query |
| TC08 หายหรือล้มเหลว | 404 ไม่ upsert; rollback เฉพาะเมื่อยืนยันว่าไม่ commit; uncertain result ไม่สั่งลบไฟล์ | missing ID GET/PUT/DELETE 404; confirmed pre-commit failure 503; wrapper ตรง contract | fault ระหว่าง storage/SQL/commit/response; update แข่ง delete ไม่คืนชีพ S1; UI refetch เมื่อ timeout |

TC03 เดิมคงรายวิชาและ PDF เสมอ มติผู้ใช้วันที่ 10 พฤศจิกายน 2569 ขยายให้เปลี่ยนได้ตามการเลือก กรณี metadata-only ยังใช้เกณฑ์เดิม เพิ่มกรณีแทนที่และย้ายวิชาโดยไม่เปลี่ยนรหัส TC เดิม ต้องปรับ Task96 และ fixtures ร่วมกันก่อนตรวจรับ

## 3 กรณีขยายสำหรับ PDF และ transaction

| รหัส | เหตุการณ์ | ผลคาดหวังที่ต้องพิสูจน์ |
| --- | --- | --- |
| D01 | ไม่มี file part และมีการแก้ไข metadata | file reference และ SHA-256 เดิมคงอยู่ |
| D02 | PDF ขนาด 15,000,000 bytes และ 15,000,001 bytes | ไฟล์แรกผ่านถ้า PDF valid; ไฟล์หลังได้ 413 PDF_TOO_LARGE ข้อมูลเดิมไม่เปลี่ยน |
| D03 | ไฟล์ว่าง/ปลอม, PDF เสีย/ไม่มีหน้า/เข้ารหัส | 422 PDF_INVALID หรือ PDF_UNREADABLE ตามชนิด ไม่มี file reference ใหม่ใน DB |
| D04 | เตรียม P2 ไม่สำเร็จ | 503 เมื่อ storage ล้มเหลว หรือ validation error ตามเหตุ DB/P1 คงเดิม |
| D05 | prepare P2 ผ่าน แต่ UPDATE หรือ commit ยืนยัน rollback | 503 DB/P1 คงเดิม P2 เป็น orphan ที่เก็บกวาดได้ |
| D06 | commit ผ่าน แต่ response หลุด | refetch ได้ค่าปัจจุบัน ห้าม retry อัตโนมัติและห้ามลบ P2 ที่ถูกอ้างอยู่ |
| D07 | commit คืน error ที่ยังไม่ทราบผล | ตรวจ connection ใหม่ เก็บ P1/P2 จนรู้ผล ไม่อ้างว่า rollback สำเร็จเพราะเรียก rollback อย่างเดียว |
| D08 | ลบ DB สำเร็จ แต่เก็บกวาดไฟล์ไม่ได้ | 204 รายการและไฟล์ผ่าน API ได้ 404 เก็บไฟล์ private ไว้ retry ไม่คืน Summary กลับมา |
| D09 | DELETE DB ล้มเหลวและยืนยัน rollback | 503 S1/P1 พร้อมอ่าน ห้ามลบไฟล์จริงก่อน DB commit |
| D10 | upload P2 ช้า แล้วอีกคำขอลบ S1 | ขั้น lock หลัง upload ตรวจไม่พบ ตอบ 404 ไม่ insert P2 ไม่มี record อ้าง |
| D11 | สองคำขอแก้พร้อมกัน รวม metadata-only แข่ง replace | serialize writer; ค่าสุดท้ายมาจาก commit ล่าสุด; metadata-only ไม่ย้อน file reference เก่า |
| D12 | process crash หลัง prepare หรือหลัง commit ก่อน cleanup | หลัง restart ค้น orphan ได้ ไม่ลบไฟล์ที่ DB อ้างหรืออยู่ใน active lease |
| D13 | เปิด PDF ขณะมีการแทนที่หรือลบ | stream ที่เปิดแล้วไม่ถูก collector ทำลายกลางทาง คำขอใหม่หลังลบได้ 404 |
| D14 | request รวมเกิน 16,000,000 bytes และ stream ไม่มี Content-Length | proxy และ Backend คุมขนาดตาม contract ที่ review แล้ว ใช้ error envelope ไม่มีไฟล์ผิดเงื่อนไขถูก publish |
| D15 | course_id รูปแบบผิด, ไม่มี, นอก CS และวิชา CS ว่าง | ผิดรูปแบบ 422, ไม่มี/นอก CS 404, CS ว่างผ่าน; course code ตรวจแบบไม่สนตัวพิมพ์ |
| D16 | target ต่างชนิดมี ID 101 เท่ากัน | ลบ Summary 101 ไม่ลบ Guide 101, รีวิวหรือ bookmark ของ Guide 101 |

เพิ่มการทดสอบ part ซ้ำ, สอง file parts, owner/user_id ที่แอบส่ง, string `null` ของ description, metadata Unicode และชื่อไฟล์ที่มี path/control characters ตรวจว่า DTO ตัดชื่อไฟล์อย่างปลอดภัยและไม่ส่ง storage path

## 4 ผลตรวจแบบและข้อแก้ในรุ่น 0.1

ตารางต่อไปนี้เป็น self-review จากเอกสารและโค้ดอ้างอิง ส่วนผลตรวจอิสระระบุแยกด้านล่าง ทั้งสองส่วนยังไม่ใช่การยอมรับจาก Frontend, Backend และ PO

ตรวจไฟล์ครบ 7 ไฟล์แล้ว ลิงก์ภายในถูกต้อง, UTF-8 ไม่มี replacement character, Mermaid inline ตรงกับต้นฉบับ `.mmd` ทั้ง 4 ไฟล์ และมี mapping TC01 ถึง TC08 ครบ ตรวจ syntax ทั้ง 4 ภาพผ่าน `mermaid.parse` จากแพ็กเกจที่มีในเครื่อง การ render ภาพด้วย Mermaid CLI หยุดที่ browser timeout จึงยังไม่ได้ตรวจภาพที่ render และไม่อ้างว่ามี visual verification แล้ว

| ข้อพบ | วิธีแก้ในแบบ | จุดตรวจต่อ |
| --- | --- | --- |
| Task94 v0.2 เป็น PUT JSON, metadata-only และ 10 MiB | ระบุข้อเสนอ multipart พร้อม course_id และ optional file, 15,000,000 bytes | ทีมอัปเดต contract, DTO, fixtures และ proxy limit |
| ลบไฟล์ก่อน SQL commit ทำให้ rollback แล้วไฟล์หาย | ลบเชิงระบบด้วย DB ก่อน เก็บกวาด private file หลัง commit | Task100 ทบทวน cleanup และ fault D08/D09 |
| rollback ไม่ย้อน object storage และไม่พิสูจน์ผล commit | immutable key ใหม่, เก็บไฟล์เมื่อ uncertain, refetch | ตรวจ D05 ถึง D07 กับ DB/storage จริง |
| ตรวจ owner ก่อน upload อย่างเดียวอาจใช้ข้อมูลเก่า | ตรวจซ้ำพร้อม lock ใน transaction และใส่ owner ใน write predicate | แข่ง update/delete D10/D11 |
| collector อาจลบไฟล์ใหม่ก่อน transaction commit | แยก active preparation ด้วย lease และตรวจ reference ก่อนเก็บกวาด | ตกลงกลไกกับ Task100 แล้วทดสอบ crash/restart |
| สร้าง DTO ด้วย lazy load หลัง commit อาจ error ทั้งที่เขียนสำเร็จ | เตรียมข้อมูล DTO ก่อน commit ไม่อ่าน DB เพิ่มเพื่อสร้าง success response | fault ใน DTO mapping และ response serialization |
| Summary model และแบบ Task100 ยังไม่อยู่ใน working tree | ระบุ logical fields ไม่สร้าง DDL หรือ ER ซ้ำ | จับคู่ชื่อคอลัมน์ FK และ storage interface เมื่อได้รับแบบ |

การตรวจอิสระโดย agent `review_task101` วันที่ 10 พฤศจิกายน 2569 พบสองจุดและแก้ในรุ่นนี้แล้ว ข้อความไทยรอบแผนภาพที่กลายเป็นเครื่องหมายคำถามถูกเขียนใหม่เป็น UTF-8 และเพิ่มการแยก preflight read Session ออกจาก write Session เพราะ SQLAlchemy autobegin ตั้งแต่ SELECT แรก ผู้ตรวจทดลองยืนยันว่า begin ซ้ำหลัง SELECT ใน Session เดียวเกิด InvalidRequestError จึงปิด read Session ก่อน prepare_pdf แล้วเปิด write Session ใหม่เพื่อ lock และอ่านค่าปัจจุบัน ผลตรวจนี้ไม่แทนการอนุมัติของทีม

### ปรับการนำเสนอในรุ่น 0.2

ตามข้อเสนอแนะของผู้ใช้ ลดเงื่อนไขซ้อนใน Sequence โดยให้ภาพแสดงเส้นทางสำเร็จเป็นหลัก รวม API, DTO และ Service เป็น lifeline เดียว และย้ายข้อผิดพลาดไปเป็นตารางใต้แต่ละภาพ คงทางเลือกเปลี่ยน PDF และยืนยัน/ยกเลิกลบในภาพ ไม่เปลี่ยน DAO, สิทธิ์หรือกติกา transaction ของรุ่น 0.1 ตรวจ Mermaid syntax และความตรงกันของ inline กับ `.mmd` ใหม่หลังแก้

## 5 DoD และ review ที่ยังต้องมีหลักฐาน

| ข้อของ Task101 | หลักฐานในชุดนี้ | สถานะ |
| --- | --- | --- |
| ทบทวนตาราง/ER และไม่สร้างซ้ำ | แบบ DAO ส่วน 1/2 อ้าง User/Course จริงและแยกข้อมูลที่ต้องใช้จาก Task100 | ตรวจของเดิมเท่าที่มีแล้ว รอแบบ Summary/ER จาก Task100 เพื่อเทียบจริง |
| DAO input/output/errors | แบบ DAO ส่วน 4 พร้อม SQL และ transaction boundary | จัดทำแล้ว รอทีมตรวจ |
| Sequence ทุก flow | my-list, read, update, delete/cancel พร้อม Mermaid source | จัดทำแล้ว |
| สิทธิ์ ข้อมูลผิด ไม่พบ บันทึกล้มเหลว | ตาราง error ใต้แต่ละ Sequence และในแบบ DAO | จัดทำแล้ว |
| ตรวจเทียบ contract/TC และ test levels | ส่วน 2/3/4 ของเอกสารนี้และรายการ contract delta | self-review แล้ว ยังไม่รันระบบ |
| รุ่นเอกสารและไฟล์แก้ไขได้ใน repo | Markdown กับ `.mmd` ใน `docs/U7/design` รุ่น 0.2 | จัดทำแล้ว |

ไม่ทำเครื่องหมายว่าทั้ง Task ผ่าน DoD ขณะ Task94/96 ยังไม่มีหลักฐานยืนยันฉบับที่ตรงมติใหม่ และยังไม่ได้เทียบกับแบบ Task100

| ผู้ตรวจตามบทบาท | ประเด็นที่ต้อง review | สถานะและหลักฐาน |
| --- | --- | --- |
| Frontend | multipart, description clear, optional file, 204 และ refetch เมื่อผลไม่แน่ชัด | รอตรวจ ยังไม่มีวันที่หรือผลอนุมัติ |
| Backend/ผู้ทำ Task100 | Summary mapping, SQL lock/FK, storage preparation และ cleanup, body limit | รอตรวจ ยังไม่มีวันที่หรือผลอนุมัติ |
| ผู้ดูแล Task94/96 และ PO | รับข้อเปลี่ยนตามมติล่าสุดเข้ารุ่นเอกสารกลางและ TC03 | รอตรวจ ยังไม่มีวันที่หรือผลอนุมัติ |

เมื่อมี review ให้บันทึกผู้ตรวจจริง วันที่ รุ่นเอกสาร ลิงก์หลักฐาน ข้อพบและผลแก้ที่นี่ ไม่ใช้ self-review หรือการตรวจไฟล์แทนการยอมรับร่วม ไม่มีการโพสต์ Trello หรือเปลี่ยนสถานะการ์ดจากการจัดทำเอกสารนี้
