# Task127 — ข้อบกพร่องและ Retest

วันที่ 17 พฤศจิกายน 2569 รอบ System แก้ตาม review ที่ SHA `a945503` ไม่พบ product defect ที่ผิด U8-TC01–TC09 จากกรณีที่รันทั้ง Guide และ PDF ผล 18/18 ผ่าน ไม่ได้สรุปว่าไม่มีข้อบกพร่องทุกกรณี และยังไม่ใช่มติ PO

| รายการ | ประเภท | สิ่งที่พบและแก้ | ผลตรวจซ้ำ |
| --- | --- | --- | --- |
| RUN-01 | ค่าตั้งการรัน Unit/API | เริ่มจาก root ทำให้ import app ไม่ได้ และ config DB/PDF root ไม่แยกจากการรันอื่น ปรับ cwd เป็น backend ใช้ placeholder driver ที่ไม่เชื่อม DB และ PDF root ว่าง ไม่แก้แอปเพื่อให้ผ่าน | 106 ผ่าน, 1 warning; Frontend regression 9 ผ่าน |
| TRACE-01 | ความละเอียดรายงาน | รอบแรก actual เป็นข้อความสรุป เพิ่ม review IDs, SQL rows, rating/comment และค่าที่เห็นจริงลง JSON | รัน System ทั้งชุดใหม่ที่ a9073ac ผ่าน 18/18 และ cleanup ผ่าน |
| UAT | การตรวจรับ | ยังไม่มี session ทดสอบกับ PO หรือมติรับรอง | รอดำเนินการ ไม่ปิด Task127 |
| REVIEW-01 | ชุดทดสอบ | เพิ่มการยืนยัน project/port/TTL ของ backend-expiring ก่อน Login | Guard/cleanup tests 11 ผ่าน |
| REVIEW-02 | การคืน fixture | DELETE ล้มหนึ่งรายการต้องไม่หยุดรายการที่เหลือ และไม่กลบ error ต้นเหตุ | ตรวจ helper ด้วยการจำลอง failure พร้อม IDs ค้างและ error ทุกเฟส; System cleanup จริงผ่าน |
| REVIEW-03 | หลักฐาน TC05 | ตรวจ GET 200 ไม่มี ID ของ R/มี ID ของ X และ UI หลังโหลดใหม่มีรีวิว X เท่านั้น | ทั้ง Guide/PDF ผ่าน เก็บ actual IDs และภาพรอบใหม่ |
| REVIEW-04 | หลักฐาน TC09 | ตรวจ payload หลัง PUT 503 และรีวิวเดิมหลังปิดฟอร์ม ตรวจ 404 code ตรงเหตุ | ทั้ง Guide/PDF ผ่าน เก็บ refreshedReview/missingCodes ใน JSON |

หาก UAT พบ defect ให้เพิ่ม ID, TC/ชนิดผลงาน, ขั้นตอนทำซ้ำ, expected/actual, หลักฐาน, ผู้รับผิดชอบ, SHA แก้ไข และผล Retest ตามจริง ไม่เปลี่ยนเกณฑ์ TC เพื่อทำให้ผลผ่าน
