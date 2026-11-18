# เปิดระบบบนเครื่องด้วย Docker

[กลับหน้าโครงการ](../../../README.md) · [สารบัญเอกสาร](../../README.md)

รันคำสั่งทั้งหมดจาก repository root ที่มี `compose.yaml` คู่มือนี้ครอบคลุมการตั้งค่าเครื่องใหม่ การอัปเดตระบบ และการแก้ปัญหาเบื้องต้น

## Fresh Setup — เครื่องใหม่

### สิ่งที่ต้องเตรียม

- Git
- Docker Desktop ที่เปิดใช้งาน Linux containers และ Docker Engine แล้ว
- RAM และพื้นที่ดิสก์เพียงพอสำหรับ SQL Server 2022

ไม่ต้องติดตั้ง Python, Node.js หรือ SQL Server บนเครื่อง host

### Clone และตั้งค่า

```bash
git clone https://github.com/Lilieay/cs261-group4-100001.git
cd cs261-group4-100001
git switch release
cp .env.example .env
```

เปิด `.env` แล้วกำหนด `MSSQL_SA_PASSWORD` เป็นรหัสผ่าน SQL Server ที่ไม่ซ้ำกับบัญชีอื่นและผ่านข้อกำหนดความซับซ้อนของ SQL Server เก็บไฟล์นี้ไว้ในเครื่อง ห้าม commit รหัสผ่านหรือ TU API key

ค่าเริ่มต้น `TU_API_MODE=mock` ใช้บัญชีสาธิตโดยไม่ต้องตั้งค่า TU API หากต้องใช้ Login จริง ให้ตั้ง `TU_API_MODE=real`, `TU_API_URL` และ `TU_API_KEY` ตามค่าที่ได้รับจากผู้ดูแล

### เริ่มระบบด้วยคำสั่งเดียว

จากโฟลเดอร์ที่มี `compose.yaml`:

```bash
docker compose up -d --build
```

Compose สร้าง Frontend/Backend images และดึง SQL Server image จากนั้นเริ่ม SQL Server, รอ healthcheck, แล้วให้ Backend สร้าง database และตารางที่ยังไม่มี พร้อม seed รายวิชา demo และแนวข้อสอบตัวอย่าง ก่อนเปิด API ส่วน Frontend จะเริ่มหลัง Backend healthcheck ผ่าน

ตรวจสถานะ:

```bash
docker compose ps
```

ควรเห็น containers 3 ตัว: `sqlserver`, `backend` และ `frontend` สถานะ backend/frontend ควรเป็น `healthy`/`running` ตาม healthcheck ที่กำหนด

### Default-port URLs

- หน้า Login: <http://localhost:5000/login.html>
- Backend health: <http://localhost:8000/>
- API docs: <http://localhost:8000/docs>
- SQL Server (ถ้าต้องเชื่อมจาก host): `localhost,1433`

## Existing Setup — เครื่องที่เคย clone แล้ว

อัปเดต branch และไฟล์ก่อนเริ่ม:

```bash
git switch release
git pull --ff-only
```

เก็บ `.env` เดิมไว้ แล้วรันคำสั่งเดียวกัน:

```bash
docker compose up -d --build
```

ถ้ามี volume เดิม ต้องใช้ `MSSQL_SA_PASSWORD` เดิมที่ใช้สร้าง SQL Server volume นั้น การ init ใช้ `CREATE DATABASE IF MISSING` และ ORM `create_all`; seed จะ reuse รายวิชา/แนวข้อสอบของชุดตัวอย่างที่ตรงกัน ไม่มีการ drop database, ล้างตาราง หรือ reset volume และข้อมูลที่ผู้ใช้เพิ่มไว้จะยังอยู่

Initialization จัดการข้อมูล seed ตามกติกาของแต่ละ service: แนวข้อสอบ seed ที่มีชื่อและผู้เผยแพร่ตรงกับชุด `test` จะถูกปรับ fields ให้ตรงกับ dataset ปัจจุบันทุกครั้งที่เริ่มระบบ ส่วนรายวิชาที่ seed ไว้มี snapshot ตรวจการแก้ไข หากพบว่ารายวิชาที่ระบบ seed และบันทึก ownership ไว้ถูกแก้ ระบบจะหยุด initialization เพื่อไม่เขียนทับข้อมูลที่เปลี่ยนไป ข้อมูลที่ผู้ใช้สร้างเองซึ่งไม่ใช่รายการ seed จะไม่ถูกลบหรือ refresh โดย seed startup

## Manual Docker Workflow

ทำทีละขั้นเพื่อศึกษา Docker ได้ โดยแต่ละคำสั่งใช้ startup และ seed logic ชุดเดียวกับคำสั่งเริ่มระบบแบบครั้งเดียว:

```bash
docker compose build
docker compose up -d sqlserver
docker compose up -d backend
docker compose up -d frontend
docker compose ps
```

`docker compose up -d backend` จะรอ SQL Server healthy ตาม dependency จากนั้น Backend จะ initialize database ภายใน Backend container เดิม หากสำเร็จจึงเริ่ม FastAPI; หากล้มเหลว Uvicorn จะไม่เริ่ม Frontend รอ Backend healthy ก่อนเริ่มเช่นกัน ไม่มี init หรือ seed container แยก

- **Image** คือแม่แบบที่ได้จาก build; **container** คือ process ที่รันจาก image
- `docker compose build` สร้าง Frontend และ Backend images ส่วน `docker compose up` สร้างและรัน containers; `--build` สั่ง build ก่อนรัน
- **Healthcheck/dependency** ให้ Compose รอ SQL Server และ Backend พร้อมก่อนเริ่ม service ถัดไป
- **Database initialization** สร้าง database เมื่อยังไม่มี แล้วสร้างเฉพาะ ORM tables ที่ยังไม่มี
- **Seed data** ใช้ CourseSeedService ชุด `demo` และ GuideSeedService ชุด `test` ภายใน transaction เดียวกัน; รายวิชาที่ตรงกับ seed จะ reuse ส่วนแนวข้อสอบ seed เดิมจะ refresh fields ให้ตรง dataset เมื่อเริ่มระบบ รายวิชา seed ที่ถูกแก้จนไม่ตรง snapshot อาจทำให้ initialization ล้มเหลว ข้อมูลผู้ใช้ที่ไม่ใช่รายการ seed จะถูกเก็บไว้
- **Volume** `sqlserver_data` เก็บไฟล์ฐานข้อมูลนอก container การ recreate หรือ rebuild containers จึงไม่ลบข้อมูล

## Demo Account & URLs

เมื่อใช้ `TU_API_MODE=mock`:

| Username | Password |
|---|---|
| `6800000000` | `0000000000000` |

หน้าเว็บและ API ใช้ URL พอร์ตปริยายตามหัวข้อ Fresh Setup ด้านบน บัญชีนี้ใช้สำหรับ mock demo เท่านั้น ไม่ใช่บัญชี TU จริง

ผู้ใช้ที่ Login สำเร็จถูกเก็บใน SQL Server ส่วน token เก็บในหน่วยความจำของ Backend เมื่อเริ่ม Backend ใหม่ต้อง Login ใหม่ ปุ่ม Logout จะยกเลิก token และอายุ Session ปริยายคือ 8 ชั่วโมง ปรับได้ด้วย `AUTH_SESSION_TTL_SECONDS`

ตรวจการใช้งานหลังเริ่มระบบ:

1. Login แล้วค้นหา CS261 เปิดรายวิชา กรองปี ภาคเรียน และช่วงสอบ แล้วเปิดอ่านแนวข้อสอบ
2. เผยแพร่รายการ แล้วตรวจหน้าอ่าน หน้ารายวิชา และหน้าแนวข้อสอบของฉันหลัง reload
3. แก้ไขรายการของตนเองและย้ายรายวิชา ตรวจว่าหน้าต่าง ๆ ใช้ข้อมูลล่าสุด
4. บันทึกแนวข้อสอบแล้วนำออกจากรายการที่บันทึก โดยต้นฉบับยังอยู่
5. ทดลองยกเลิกลบและยืนยันลบรายการของตนเอง แล้วตรวจว่าเปิดอ่านรายการที่ลบไม่ได้
6. Logout แล้วตรวจว่าส่วนที่ต้อง Login เข้าใช้ไม่ได้

ขั้นตอนนี้เป็นการตรวจเบื้องต้น ดูกรณี PDF รีวิว และผลตรวจรับครบแต่ละ U ได้จาก [สารบัญเอกสาร](../../README.md)

## Troubleshooting

**SQL Server ไม่ healthy หรือ Backend init ไม่สำเร็จ**

```bash
docker compose ps
docker compose logs --tail=100 sqlserver backend
```

ตรวจว่า Docker Engine ทำงาน, `.env` มีรหัสผ่านที่ถูกต้อง และถ้าใช้ volume เดิมรหัสผ่านตรงกับ volume นั้น Backend จะไม่เปิด API หากเชื่อมต่อหรือ initialize ไม่สำเร็จ

**พอร์ต 1433, 8000 หรือ 5000 ถูกใช้อยู่**

กำหนดพอร์ต host ที่ว่างใน `.env` แล้วรัน `docker compose up -d` อีกครั้ง:

```dotenv
FRONTEND_HOST_PORT=5001
BACKEND_HOST_PORT=8001
SQLSERVER_HOST_PORT=1434
```

ตัวแปรเหล่านี้เปลี่ยนเฉพาะพอร์ตบน host; พอร์ตภายใน containers ยังคงเป็น 5000, 8000 และ 1433 ตามลำดับ ใช้ URL `localhost:5001` สำหรับ Frontend และ `localhost:8001` สำหรับ Backend เมื่อกำหนดค่าตัวอย่างนี้

**ดู logs แบบต่อเนื่อง**

```bash
docker compose logs -f backend
```

กด `Ctrl+C` เพื่อหยุดดู logs โดยไม่หยุด containers

**Restart หลังแก้ `.env` หรือ source**

```bash
docker compose up -d --build
```

Compose จะ recreate services ที่จำเป็นและรัน initialization แบบ idempotent อีกครั้ง การเริ่มใหม่ไม่ลบ volume ใช้ `docker compose down` เพื่อหยุดและลบ containers/network โดยเก็บข้อมูลไว้ ห้ามใช้ `docker compose down -v` กับฐานข้อมูลที่ต้องการเก็บ

## Additional Documentation

- [Backend และ Login runbook](../../U1/runbooks/task16-backend-docker-runbook.md)
- [การตั้งค่า TU API](../../U1/design/task11-tu-api-verification.md)
- [Course seed runbook](../../U2/runbooks/task26-course-seed-data.md)
- [Guide seed runbook](../../U3/runbooks/task41-guide-seed-data.md)
- [Task60 isolated Docker test runbook](../../U4/runbooks/task60-docker-runbook.md)
- [Task60 UI–API test report](../../U4/testing/task60-ui-api-test-report.md)
- [Task60 API–DAO test report](../../U4/testing/task60-api-dao-test-report.md)
- [Task60 system test report](../../U4/testing/task60-system-test-report.md)
- [Task81 Docker integration report](../../U5/testing/task81-docker-integration-test-report.md)
- [Task82 deletion test report](../../U5/testing/task82-delete-my-guides-test-report.md)
