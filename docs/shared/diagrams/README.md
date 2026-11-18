# แผนภาพสำหรับอธิบาย U1 ถึง U10

แต่ละ Story มี UML Sequence Diagram และ Dataflow Diagram พร้อมภาพ PNG สำหรับนำเสนอ แผนภาพใช้สัญลักษณ์และสีตาม U6 จาก output เดิม ภาพ U6 และ Word ต้นฉบับคงเดิม ส่วนภาพใหม่มี SVG สำหรับแก้ไข

| Story | เรื่อง | แผนภาพและคำอธิบาย |
| --- | --- | --- |
| U1 | เข้าสู่ระบบด้วยบัญชี TU | [เปิดชุด U1](../../U1/design/u1-diagrams.md) |
| U2 | ค้นหาและเปิดรายวิชา CS | [เปิดชุด U2](../../U2/design/u2-diagrams.md) |
| U3 | ดูรายการ กรอง และอ่านแนวข้อสอบ | [เปิดชุด U3](../../U3/design/u3-diagrams.md) |
| U4 | เผยแพร่แนวข้อสอบ | [เปิดชุด U4](../../U4/design/u4-diagrams.md) |
| U5 | ดู แก้ไข และลบแนวข้อสอบของตน | [เปิดชุด U5](../../U5/design/u5-diagrams.md) |
| U6 | เผยแพร่และเปิดอ่านสรุป PDF | [เปิดชุด U6](../../U6/design/u6-diagrams.md) |
| U7 | จัดการสรุป PDF ของตน | [เปิดชุด U7](../../U7/design/u7-diagrams.md) |
| U8 | แสดง เพิ่ม แก้ไข และลบรีวิว | [เปิดชุด U8](../../U8/design/u8-diagrams.md) |
| U9 | บันทึกแนวข้อสอบหรือสรุป PDF | [เปิดชุด U9](../../U9/design/u9-diagrams.md) |
| U10 | ดู เปิด และนำผลงานที่บันทึกออก | [เปิดชุด U10](../../U10/design/u10-diagrams.md) |

## วิธีอ่าน

Sequence อ่านจากบนลงล่าง นักศึกษาเป็น actor สีเหลือง View เป็น boundary สีฟ้า Controller เป็น control สีฟ้า เส้นทึบหัวลูกศรทึบคือคำขอ เส้นประคือผลตอบกลับ และแท่งสีแสดงช่วงทำงาน Controller รวม Router, Service และ DAO เพื่อใช้เล่า flow โดยไม่เพิ่ม lifeline ทุกชั้น คำขอจากหน้าเว็บยังผ่าน Node proxy ตามโค้ดจริง

Dataflow ใช้กล่อง entity สีเหลือง process สีม่วงพร้อมเลขงาน และ data store ที่มีรหัส D ลูกศรระบุข้อมูล ไม่ใช่ลำดับเวลา D ที่วาดซ้ำหมายถึงแหล่งเก็บข้อมูลเดิม เช่น D1 SQL Server ส่วน U1 ใช้ D2 เป็น Session ในหน่วยความจำ; U6/U7/U10 ใช้ D2 เป็น PDF ส่วนตัว โดยขอบเขตของ D อยู่ภายในแต่ละ Story

ภาพเน้นเส้นทางสำเร็จและข้อมูลที่เกี่ยวข้อง รายละเอียด validation, error, transaction และกรณีทางเลือกให้อ่านเอกสารออกแบบเดิมที่ลิงก์จากแต่ละ Story ไม่ใช้ภาพนี้แทนผลทดสอบหรือผลตรวจรับ

## สร้างภาพใหม่

ข้อมูลสำหรับ U1–U5 และ U7–U10 อยู่ใน [story-diagrams.json](story-diagrams.json) สร้าง SVG ด้วยคำสั่งจาก repository root:

```powershell
python scripts/render_story_diagrams.py
```

สร้าง PNG พร้อม SVG ด้วย Chrome บนเครื่องที่มีฟอนต์ Leelawadee UI หรือ Tahoma:

```powershell
python scripts/render_story_diagrams.py --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe'
```

U6 ใช้ต้นฉบับและไม่ถูกเขียนทับโดยสคริปต์นี้

## ไฟล์ที่ย้ายจาก output

ไฟล์ทุกไฟล์ใน output เดิมมีสำเนาที่ตรงกันใน docs ตรวจจาก [รายการไฟล์และ SHA256](output-migration.json) รายงาน Task123 Word ตรงกับไฟล์ที่มีอยู่แล้ว ส่วน Task120 Word มีเนื้อไฟล์ต่างกัน จึงเก็บฉบับจาก output เป็น `task120-u6-docker-integration-output.docx` แยกจากรายงานเดิม

- [Task120 ฉบับจาก output](../../U6/testing/task120-u6-docker-integration-output.docx)
- [แผน Integration Task123](../../U9/testing/task123-u9-integration-plan.md)
- [รายงาน Integration Task123](../../U9/testing/task123-u9-docker-integration.docx)
