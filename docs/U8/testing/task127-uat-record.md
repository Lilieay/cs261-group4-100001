# Task127 — ขั้นตอนและบันทึก UAT ของ U8

**สถานะการตรวจรับ: PO รับ U8**

| รายการ | ผลจริง |
| --- | --- |
| PO ตาม Task97 | จะโอ๋ — โมริ |
| ผู้ทดสอบที่ร่วมกับ PO | โมริ |
| รอบตรวจยืนยัน (วันเวลา) | 17 พฤศจิกายน 2569 เวลา 22:37–22:39 น. (Asia/Bangkok) |
| SHA ระบบที่รันรอบตรวจยืนยัน | [6591b5b4d64fecfb9ec9b03bac43a9452ea81e3e](https://github.com/Lilieay/cs261-group4-100001/commit/6591b5b4d64fecfb9ec9b03bac43a9452ea81e3e) |
| Environment และ auth mode | Chrome 157.0.8103.79, Docker 29.8.2, SQL Server 16.0.4305.5, PDF volume จริง และ TU mock |
| มติรับ/รับโดยมีเงื่อนไข/ไม่รับ | รับ |
| หลักฐานและข้อบกพร่อง | [ผลรอบตรวจยืนยัน 18/18](../assets/task127/uat-6591b5b/system-results.json) และลิงก์ภาพรายเคสด้านล่าง |

[ผล System/E2E 18 เคส](task127-u8-system-report.md) เป็นหลักฐานประกอบการตรวจรับ

## ขั้นตอนและผลรอบตรวจยืนยันผ่าน Chrome

เปิดชุด Task127 ตามรายงาน แยก browser profile ของ owner/R/X หรือใช้พอร์ต A/B/C ตามคู่มือ สร้าง Guide และ PDF ตัวอย่างโดย owner ผ่านเมนูอัปโหลด ใช้ชื่อ `UAT-U8-<วันเวลา>` เก็บ IDs และไฟล์ที่ใช้ไว้เป็นหลักฐาน UAT ไม่ใช้ fixture ที่ System สร้างแล้วลบทิ้ง

หากไม่มี PDF ตัวอย่าง สร้างไฟล์ที่ parser อ่านได้ใน backend แล้วคัดลอกออกมาเลือกในฟอร์ม:

```powershell
docker compose --env-file .env -p $task127Project exec -T backend python -c "from pypdf import PdfWriter; w=PdfWriter(); w.add_blank_page(width=144,height=144); w.write('/tmp/u8-uat.pdf')"
docker cp "${task127Project}-backend-1:/tmp/u8-uat.pdf" ./u8-uat.pdf
```

ทำแต่ละข้อทั้ง Guide และ PDF บันทึก actual และหลักฐานเอง ถ้าขั้นตอนใดทำผ่าน UI ไม่ได้ ให้ผู้ทดสอบช่วยส่งคำขอจากขั้นตอน System ที่รันกับ API จริง แล้วบันทึกวิธีนั้นให้ชัด ห้ามใช้ผล mock แทนการสังเกตระบบ

| TC | ให้ PO ตรวจ | Guide | PDF | actual/หลักฐาน/ผู้ตรวจ |
| --- | --- | --- | --- | --- |
| TC01 | R ให้ 5 ดาวพร้อมข้อความ โหลดใหม่ และ X อ่านรีวิวเดียวกันได้ | ผ่าน | ผ่าน | ให้ 5 ดาวพร้อมข้อความ โหลดใหม่และ Login ใหม่ยังเห็นรีวิวเดิม บัญชี X อ่านได้ · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC01.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC01.png) |
| TC02 | 1/5 ดาวโดยไม่ใส่ข้อความได้ เริ่มรีวิวใหม่ก่อนแต่ละคะแนน | ผ่าน | ผ่าน | ให้ 1 และ 5 ดาวโดยเว้นข้อความได้ ค่า comment เป็น null และคงอยู่หลังโหลดใหม่ · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC02-1-stars.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC02-1-stars.png) |
| TC03 | ไม่เลือกคะแนน/คะแนนไม่ถูกต้องต้องไม่สร้างหรือเปลี่ยนรีวิวเดิม | ผ่าน | ผ่าน | ฟอร์มไม่ส่ง POST เมื่อไม่เลือกดาว API ปฏิเสธคะแนนผิดรูปแบบด้วย 422 และ SQL คงเดิม · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC03.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC03.png) |
| TC04 | R แก้ดาว ข้อความ และล้างข้อความได้ โดยไม่เกิดรีวิวซ้ำ | ผ่าน | ผ่าน | แก้คะแนน แก้ข้อความ และล้างข้อความได้ ยังใช้ review ID เจ้าของ และผลงานเดิม · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC04.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC04.png) |
| TC05 | ยกเลิกแล้วคงอยู่ ยืนยันลบเฉพาะของ R รีวิวของ X/เนื้อหายังอยู่ | ผ่าน | ผ่าน | หลังยืนยันลบ GET ไม่มี ID ของ R หน้าแสดงเฉพาะรีวิวของ X และผลงานยังอยู่ · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC05.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC05.png) |
| TC06 | X แก้หรือลบของ R ไม่ได้ ต้อง Login และไม่สวมชื่อคนอื่น | ผ่าน | ผ่าน | คำขอแก้หรือลบของบัญชี X ได้ 403 คำขอไม่มี token หรือหมดอายุได้ 401 · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC06.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC06.png) |
| TC07 | เจ้าของเพิ่มรีวิวงานตนเองไม่ได้ | ผ่าน | ผ่าน | เจ้าของไม่มีปุ่มเพิ่มรีวิว คำขอเพิ่มได้ 403 และข้อมูลคงเดิม · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC07.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC07.png) |
| TC08 | หนึ่งคนหนึ่งรีวิวต่อผลงาน เพิ่มซ้ำต้องไม่เปลี่ยนรีวิวเดิม | ผ่าน | ผ่าน | เพิ่มซ้ำได้ 409 รีวิวยังมีหนึ่งรายการและข้อมูลเดิมคงอยู่ · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC08.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC08.png) |
| TC09 | ไม่พบผลงาน/SQL บันทึกไม่ได้ ต้องแจ้งเหตุและไม่แจ้งสำเร็จลวง | ผ่าน | ผ่าน | SQL ปฏิเสธการเขียนได้ 503 หลังแก้ล้ม GET และหน้าเว็บแสดงรีวิวเดิม ทดสอบ 404 แล้ว error code ตรงชนิด · [Guide](../assets/task127/uat-6591b5b/guide-U8-TC09.png) · [PDF](../assets/task127/uat-6591b5b/summary-U8-TC09.png) |

SQL failure ให้ใช้เฉพาะ project ทดสอบและผู้ทดสอบที่รับผิดชอบเปิด/คืน trigger ตามสคริปต์ ไม่จำลองกับฐานใช้งานจริง หลังจบลบเฉพาะผลงาน UAT ที่บันทึก ID/ชื่อ/เจ้าของไว้ ตรวจไฟล์และข้อมูลผู้อื่นก่อน–หลัง แล้วกรอกมติ พร้อมชื่อ PO/ผู้ทดสอบ วันเวลา SHA และหลักฐานจริง ถ้ามีข้อแก้ไขให้เชื่อม defect กับผล Retest ก่อนปิดงาน
