# เอกสารโครงการ

[กลับหน้าโครงการ](../README.md) · [แผนภาพแต่ละ U](#story-diagrams) · [เอกสารตาม Story](#story-documents) · [API Contract](shared/api-contract/task94-api-contract.md) · [เปิดระบบด้วย Docker](shared/runbooks/local-development.md) · [ตั้งค่า .env](shared/runbooks/local-development.md#environment) · [ปิดระบบ](shared/runbooks/local-development.md#stop-system)

เอกสารแบ่งตาม User Story U1–U10 และประเภทงาน ส่วน API Contract ที่ใช้ร่วมกันอยู่ใน `shared/` รายงานและหลักฐานแต่ละรอบเก็บไว้ตาม Task เดิม

## เอกสารกลาง

- [API Contract U6–U10](shared/api-contract/task94-api-contract.md)
- [ไฟล์ Word ของ API Contract](shared/api-contract/task94-api-contract.docx)
- [ผลทบทวน API Contract](shared/api-contract/task94-review.md)
- [Fixtures และวิธีตรวจสอบ](shared/api-contract/fixtures/README.md)

<a id="story-diagrams"></a>
## แผนภาพสำหรับใช้อธิบาย

- [Dataflow และ UML Sequence Diagram ครบ U1–U10](shared/diagrams/README.md)


เปิดคำอธิบาย flow หรือเลือกดูภาพแต่ละประเภทจากตารางได้โดยตรง

| Story | แผนภาพและคำอธิบาย | UML Sequence Diagram | Dataflow Diagram |
| --- | --- | --- | --- |
| U1 | [คำอธิบาย U1](U1/design/u1-diagrams.md) | [Sequence](U1/design/diagrams/u1-sequence.png) | [Dataflow](U1/design/diagrams/u1-dataflow.png) |
| U2 | [คำอธิบาย U2](U2/design/u2-diagrams.md) | [Sequence](U2/design/diagrams/u2-sequence.png) | [Dataflow](U2/design/diagrams/u2-dataflow.png) |
| U3 | [คำอธิบาย U3](U3/design/u3-diagrams.md) | [Sequence](U3/design/diagrams/u3-sequence.png) | [Dataflow](U3/design/diagrams/u3-dataflow.png) |
| U4 | [คำอธิบาย U4](U4/design/u4-diagrams.md) | [Sequence](U4/design/diagrams/u4-sequence.png) | [Dataflow](U4/design/diagrams/u4-dataflow.png) |
| U5 | [คำอธิบาย U5](U5/design/u5-diagrams.md) | [Sequence](U5/design/diagrams/u5-sequence.png) | [Dataflow](U5/design/diagrams/u5-dataflow.png) |
| U6 | [คำอธิบาย U6](U6/design/u6-diagrams.md) | [Sequence](U6/design/diagrams/u6-sequence.png) | [Dataflow](U6/design/diagrams/u6-dataflow.png) |
| U7 | [คำอธิบาย U7](U7/design/u7-diagrams.md) | [Sequence](U7/design/diagrams/u7-sequence.png) | [Dataflow](U7/design/diagrams/u7-dataflow.png) |
| U8 | [คำอธิบาย U8](U8/design/u8-diagrams.md) | [Sequence](U8/design/diagrams/u8-sequence.png) | [Dataflow](U8/design/diagrams/u8-dataflow.png) |
| U9 | [คำอธิบาย U9](U9/design/u9-diagrams.md) | [Sequence](U9/design/diagrams/u9-sequence.png) | [Dataflow](U9/design/diagrams/u9-dataflow.png) |
| U10 | [คำอธิบาย U10](U10/design/u10-diagrams.md) | [Sequence](U10/design/diagrams/u10-sequence.png) | [Dataflow](U10/design/diagrams/u10-dataflow.png) |

<a id="story-documents"></a>
## เอกสารตาม User Story

| Story | ข้อกำหนด | ออกแบบ | พัฒนาและวิธีใช้งาน | ทดสอบ | หลักฐาน |
| --- | --- | --- | --- | --- | --- |
| [U1](U1/) | [ข้อกำหนด](U1/requirements/) | [ออกแบบ](U1/design/) | [วิธีใช้งาน](U1/runbooks/) | [ผลทดสอบ](U1/testing/) | [ภาพและหลักฐาน](U1/assets/) |
| [U2](U2/) | [ข้อกำหนด](U2/requirements/) | [ออกแบบ](U2/design/) | [วิธีใช้งาน](U2/runbooks/) | [ผลทดสอบ](U2/testing/) | [ภาพและหลักฐาน](U2/assets/) |
| [U3](U3/) | [ข้อกำหนด](U3/requirements/) | [ออกแบบ](U3/design/) | [วิธีใช้งาน](U3/runbooks/) | [ผลทดสอบ](U3/testing/) | [ภาพและหลักฐาน](U3/assets/) |
| [U4](U4/) | [ข้อกำหนด](U4/requirements/) | [ออกแบบ](U4/design/) | [วิธีใช้งาน](U4/runbooks/) | [ผลทดสอบ](U4/testing/) | [ภาพและหลักฐาน](U4/assets/) |
| [U5](U5/) | [ข้อกำหนด](U5/requirements/) | [ออกแบบ](U5/design/) | [วิธีใช้งาน](U5/runbooks/) | [ผลทดสอบ](U5/testing/) | [ภาพและหลักฐาน](U5/assets/) |
| [U6](U6/) | [ข้อกำหนด](U6/requirements/) | [ออกแบบ](U6/design/) | [พัฒนา](U6/implementation/) | [ผลทดสอบ](U6/testing/) | [ภาพและหลักฐาน](U6/assets/) |
| [U7](U7/) | [ข้อกำหนด](U7/requirements/) | [ออกแบบ](U7/design/) | [พัฒนา](U7/implementation/) | [ผลทดสอบ](U7/testing/) | [ภาพและหลักฐาน](U7/assets/) |
| [U8](U8/) | [ข้อกำหนด](U8/requirements/) | [ออกแบบ](U8/design/) | [พัฒนา](U8/implementation/) | [ผลทดสอบ](U8/testing/) | [ภาพและหลักฐาน](U8/assets/) |
| [U9](U9/) | [ข้อกำหนด](U9/requirements/) | [ออกแบบ](U9/design/) | [พัฒนา](U9/implementation/) | [ผลทดสอบ](U9/testing/) | [ภาพและหลักฐาน](U9/assets/) |
| [U10](U10/) | [ข้อกำหนด](U10/requirements/) | [ออกแบบ](U10/design/) | [พัฒนา](U10/implementation/) | [ผลทดสอบ](U10/testing/) | [ภาพและหลักฐาน](U10/assets/) |

## การจัดเก็บ

- `requirements/` ข้อกำหนด กติกา และ Test Cases ที่ตกลงไว้
- `design/` แบบหน้าจอ แบบข้อมูล DAO และลำดับการทำงาน
- `implementation/` รายละเอียดการพัฒนา
- `runbooks/` ขั้นตอนเปิดระบบและตรวจการทำงาน
- `testing/` แผนทดสอบ ผล Unit/API/Integration/System และผลตรวจรับ
- `assets/` ภาพ JSON และหลักฐานประกอบ แยกตาม Task และรอบทดสอบเมื่อมีหลายรอบ

เก็บรายงานกับหลักฐานเดิมไว้ ไม่ย้ายหลักฐานเก่าหรือเปลี่ยนชื่อไฟล์ที่มีลิงก์อ้างอิงภายนอก เมื่อเพิ่มเอกสารให้ใช้หมวดที่ตรงกับหน้าที่และอ้างอิงหลักฐานด้วยลิงก์สัมพันธ์จากเอกสารนั้น
