# เปิดระบบบนเครื่องด้วย Docker

[กลับหน้าโครงการ](../../../README.md) · [สารบัญเอกสาร](../../README.md) · [ปิดระบบและเปิดกลับ](#stop-system)

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
git switch main
```

<a id="environment"></a>
### สร้างและตั้งค่าไฟล์ .env

สร้าง `.env` ไว้ที่ repository root ระดับเดียวกับ `compose.yaml` โดยคัดลอกจาก [.env.example](../../../.env.example) ถ้ามี `.env` เดิมอยู่แล้ว ให้แก้ไฟล์เดิม ไม่คัดลอกทับ

PowerShell บน Windows:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Bash บน macOS, Linux หรือ Git Bash:

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
```

จากนั้นเปิด `.env` ด้วย text editor ตรวจว่าชื่อไฟล์เป็น `.env` ไม่ใช่ `.env.txt` และกรอกค่าทีละบรรทัดในรูปแบบ `ชื่อตัวแปร=ค่า` โดยไม่ใส่คำสั่ง `export` หรือ `$env:` ลงในไฟล์

#### ค่าที่ต้องแก้ก่อนเปิดระบบ

สำหรับการสาธิตในเครื่อง ใช้ `TU_API_MODE=mock` และเปลี่ยน `MSSQL_SA_PASSWORD` จากข้อความตัวอย่างเป็นรหัสผ่านที่กำหนดเอง ส่วน `TU_API_URL` และ `TU_API_KEY` เว้นว่างได้

```dotenv
# แทนข้อความในเครื่องหมายคำพูดด้วยรหัสผ่าน SQL ที่ตั้งเอง
MSSQL_SA_PASSWORD='YOUR_OWN_SQL_PASSWORD'
TU_API_MODE=mock
TU_API_URL=
TU_API_KEY=
```

`YOUR_OWN_SQL_PASSWORD` เป็นข้อความให้แทนค่า ไม่ใช่รหัสผ่านสำหรับใช้งาน ตั้งรหัสผ่านให้ผ่านกติกาของ SQL Server โดยผสมตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ หากค่ามี `$` หรือ `#` ให้ครอบค่าด้วย single quotes เพื่อเก็บเป็นข้อความตามตัวอักษร และเลือกรหัสผ่านที่ไม่มี single quote เพื่อใส่ในรูปแบบนี้ได้ตรง ๆ

หากใช้ SQL volume เดิม ต้องใส่รหัสผ่านเดิมของ volume นั้น การแก้ตัวแปรนี้ไม่ได้เปลี่ยนรหัสผ่านในฐานข้อมูลที่สร้างแล้ว

#### ตัวแปรทั้งหมดในไฟล์ตัวอย่าง

| ตัวแปร | ค่าปริยายหรือวิธีกรอก |
| --- | --- |
| `MSSQL_SA_PASSWORD` | ต้องตั้งเอง ใช้กับ SQL Server และการเชื่อมต่อจาก Backend |
| `TU_API_MODE` | `mock` สำหรับสาธิต หรือ `real` สำหรับยืนยันบัญชีผ่าน TU API |
| `TU_API_URL` | เว้นว่างเมื่อใช้ mock ถ้าใช้ real ให้ใส่ URL ที่ผู้ดูแลแจ้ง |
| `TU_API_KEY` | เว้นว่างเมื่อใช้ mock ถ้าใช้ real ให้ใส่ key ที่ได้รับจากผู้ดูแล |
| `TU_API_TIMEOUT` | `5` เวลารอ TU API หน่วยวินาที |
| `AUTH_SESSION_TTL_SECONDS` | `28800` อายุ Session 8 ชั่วโมง ต้องเป็นจำนวนเต็มบวก |
| `PDF_STORAGE_ROOT` | `/app/data/pdfs` เป็น path ภายใน container คงค่านี้ได้สำหรับ Compose ปกติ |
| `PDF_SCAN_ORPHANS_ON_STARTUP` | `1` สำหรับ stack ปกติ ตั้ง `0` หากหลาย Backend ใช้ storage ร่วมกัน หรือย้ายฐานข้อมูลและ volume แยกกัน |
| `FRONTEND_HOST_PORT` | `5000` พอร์ตเปิดเว็บจากเครื่อง host |
| `BACKEND_HOST_PORT` | `8000` พอร์ต Backend และ API docs จากเครื่อง host |
| `SQLSERVER_HOST_PORT` | `1433` พอร์ต SQL Server จากเครื่อง host |

Compose กำหนด `DB_CONNECTION_STRING`, `DB_PASSWORD` และ `BACKEND_URL` ให้ services อยู่แล้ว จึงไม่ต้องสร้าง `backend/.env` หรือ `frontend/.env` เพิ่มเมื่อเปิดผ่าน Compose ตามคู่มือนี้

#### ถ้าต้องใช้ TU API จริง

เปลี่ยน `TU_API_MODE=real` แล้วกรอก `TU_API_URL` และ `TU_API_KEY` ด้วยค่าที่ได้รับจริงจากผู้ดูแล อย่านำชื่อบัญชีหรือรหัสผ่านนักศึกษาไปใส่แทน API key อ่านเงื่อนไขการเชื่อมต่อได้ที่ [การตั้งค่า TU API](../../U1/design/task11-tu-api-verification.md)

#### ตรวจไฟล์และเปิดระบบ

ตรวจว่า Compose อ่านค่าตั้งได้ โดยคำสั่งนี้ไม่แสดงค่ารหัสผ่านหรือ API key:

```bash
docker compose --env-file .env config --quiet
```

ถ้าไม่มีข้อผิดพลาดจึงเริ่มระบบตามหัวข้อถัดไป คำสั่งนี้ตรวจ configuration เท่านั้น ยังไม่ยืนยันว่ารหัสผ่าน SQL หรือการเชื่อมต่อ TU API ถูกต้อง

เมื่อแก้ `.env` หลังเปิดระบบแล้ว ให้ใช้ `docker compose --env-file .env up -d --build` เพื่อให้ค่าถูกนำไปใช้ใหม่ เก็บ `.env` ไว้ในเครื่องและไม่ commit ลง Git หากพอร์ตชน อ่านตัวอย่างในหัวข้อ Troubleshooting ด้านล่าง

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

<a id="stop-system"></a>
## ปิดระบบและเปิดกลับ

รันคำสั่งจาก repository root ที่มี `compose.yaml` เช่นเดียวกับตอนเปิดระบบ

### หยุดชั่วคราวโดยเก็บ containers และข้อมูลไว้

```bash
docker compose --env-file .env stop
```

เปิด containers เดิมกลับโดยไม่ build ใหม่:

```bash
docker compose --env-file .env start
```

### ปิดระบบหลังใช้งาน

หยุดและลบ containers กับ network ของ stack โดยเก็บ SQL และ PDF volumes ไว้:

```bash
docker compose --env-file .env down
```

เปิดระบบกลับด้วยข้อมูลเดิม:

```bash
docker compose --env-file .env up -d --build
```

ใช้รหัสผ่าน SQL เดิมใน `.env` เพื่อเชื่อมต่อกับ volume เดิม หลัง Backend เริ่มใหม่ต้อง Login อีกครั้ง เพราะ Session อยู่ในหน่วยความจำ

### ตรวจว่าปิดแล้ว

```bash
docker compose --env-file .env ps --all
```

หลัง `stop` containers จะแสดงสถานะหยุด ส่วนหลัง `down` จะไม่มี containers ของ stack นี้เหลืออยู่

การปิดตามปกติใช้ `stop` หรือ `down` โดยไม่ใส่ `--volumes` ส่วน `down --volumes` ลบข้อมูล SQL และไฟล์ PDF ด้วย ใช้เฉพาะเมื่อตั้งใจล้างระบบตาม [วิธีแก้ปัญหา](#troubleshooting)

หากเปิด stack ด้วย `-p` ชื่ออื่น ให้ใช้ชื่อเดียวกันตอนปิด เช่น `docker compose -p cs261-task122-demo --env-file .env -f compose.yaml -f infra/compose/tests/compose.task122.yaml down` โดยใช้ไฟล์ Compose ชุดเดียวกับตอนเปิด

## Existing Setup — เครื่องที่เคย clone แล้ว

อัปเดต branch และไฟล์ก่อนเริ่ม:

```bash
git switch main
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

<a id="troubleshooting"></a>
## Troubleshooting

### Backend เปิดไม่ขึ้นเพราะ LF และ CRLF

หาก Docker แจ้ง `exec /app/docker-entrypoint.sh: no such file or directory`, `bad interpreter` หรือข้อความที่มี `^M` ทั้งที่ไฟล์มีอยู่ ให้ตรวจ line ending ของ `backend/docker-entrypoint.sh` ไฟล์ shell ที่รันใน Linux container ต้องใช้ LF หากเป็น CRLF ตัว `\r` อาจติดไปกับชื่อ interpreter ในบรรทัด `#!/bin/sh`

ตรวจจาก repository root:

```bash
git ls-files --eol backend/docker-entrypoint.sh
```

ค่าที่ต้องการคือ `i/lf` และ `w/lf` โดย `i` เป็นไฟล์ใน Git index และ `w` เป็นไฟล์ในเครื่อง โครงการมี `.gitattributes` กำหนด `backend/docker-entrypoint.sh text eol=lf` อยู่แล้ว และ Dockerfile ปรับ CRLF เป็น LF ระหว่าง build อีกชั้น เพื่อรองรับ checkout บน Windows ที่ยังได้ CRLF หาก clone รุ่นเก่ามา ให้ดึงการแก้ล่าสุดแล้ว build image ใหม่ก่อน

แก้ใน VS Code โดยเปิดไฟล์ คลิก `CRLF` ที่มุมล่างขวา เลือก `LF` แล้วบันทึกเป็น UTF-8 โดยไม่มี BOM หรือใช้ PowerShell:

```powershell
$entrypointPath = Join-Path (Get-Location).Path 'backend/docker-entrypoint.sh'
$entrypointText = [System.IO.File]::ReadAllText($entrypointPath)
$entrypointText = $entrypointText.Replace("`r`n", "`n")
[System.IO.File]::WriteAllText($entrypointPath, $entrypointText, [System.Text.UTF8Encoding]::new($false))
```

จากนั้น build และ recreate Backend เพื่อให้ container ใช้ไฟล์ที่แก้แล้ว:

```bash
docker compose --env-file .env up -d --build backend frontend
docker compose ps
```

การ restart container เดิมอย่างเดียวไม่เปลี่ยนไฟล์ที่ COPY เข้า image ส่วนข้อความ Git ว่า `LF will be replaced by CRLF` ในไฟล์อื่นเป็นคำเตือนเรื่อง line ending ไม่ได้แปลว่าแอปเสียทุกครั้ง ให้ตรวจไฟล์ shell ที่ Linux ต้องรันก่อน ไม่ต้องเปลี่ยน `core.autocrlf` ทั้งเครื่อง

### SQL Server ไม่ healthy หรือ Backend ต่อฐานข้อมูลไม่ได้

ดูสถานะและ logs เพื่อแยกปัญหารหัสผ่านออกจากปัญหา startup อื่น:

```bash
docker compose ps
docker compose logs --tail=100 sqlserver backend
```

ถ้า logs ระบุ `Password validation failed` ให้แก้ `MSSQL_SA_PASSWORD` ใน `.env` ให้ผ่านกติกา SQL Server รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีอย่างน้อย 3 กลุ่มจากตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และสัญลักษณ์ อย่าใช้ข้อความ placeholder ใน `.env.example` เป็นรหัสผ่านจริง ดู [คู่มือ SQL Server container ของ Microsoft](https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-docker?view=sql-server-ver16)

ถ้า logs ระบุ `Login failed for user 'sa'` หลังเปลี่ยน `.env` ให้ตรวจว่าใช้ SQL volume เดิมหรือไม่ ค่า `MSSQL_SA_PASSWORD` ใช้ตั้งรหัสผ่านตอนสร้าง SQL Server ครั้งแรก การเปลี่ยน environment หรือ rebuild image ไม่เปลี่ยนรหัสผ่านที่เก็บอยู่ใน volume เดิม พฤติกรรมนี้อธิบายไว้ใน [คู่มือแก้ปัญหาของ Microsoft](https://learn.microsoft.com/en-us/sql/linux/sql-server-linux-docker-container-troubleshooting?view=sql-server-ver16)

กรณี init ครั้งแรกไม่ผ่านกติกา ไม่ได้หมายความว่า SQL Server ยอมรับรหัสผ่านที่อ่อนแอนั้น อาจเป็นการ initialize ที่ยังไม่เสร็จหรือมีข้อมูลจากรอบก่อน ต้องดู logs ประกอบ

#### หากต้องเก็บข้อมูลเดิม

ใส่รหัสผ่านเดิมที่ใช้สร้าง volume กลับใน `.env` แล้วรัน:

```bash
docker compose --env-file .env up -d --build
```

ถ้าต้องเปลี่ยนรหัสผ่านจริง ให้ผู้ดูแลเปลี่ยนรหัสผ่านใน SQL Server แล้วปรับ `.env` ให้ตรงกัน หากไม่ทราบรหัสผ่านเดิมและยังต้องใช้ข้อมูล ให้เก็บ volume ไว้เพื่อกู้คืน ห้ามใช้ขั้นตอนล้างด้านล่าง

#### เริ่มฐานข้อมูลใหม่สำหรับเครื่องสาธิตที่ยอมล้างข้อมูลได้

ใช้วิธีนี้เมื่อเพิ่งตั้งค่าเครื่อง ยังไม่มีข้อมูลที่ต้องเก็บ หรือยอมเริ่มระบบจากข้อมูล seed ใหม่ การล้างจะลบทั้งข้อมูล SQL และไฟล์ PDF ใน volumes ของ project ที่ระบุ รวมผู้ใช้ ผลงาน รีวิว และ bookmark ที่เคยเพิ่มไว้

1. แก้ `MSSQL_SA_PASSWORD` ใน `.env` ให้ถูกต้องก่อน
2. ตรวจว่าเป็น project สาธิตที่ต้องการล้าง:

```bash
docker compose -p cs261-group4 --env-file .env ps
docker volume ls --filter label=com.docker.compose.project=cs261-group4
```

3. เมื่อตรวจชื่อ project และยอมล้างข้อมูลทั้งหมดแล้ว ให้หยุด stack พร้อมลบ volumes จากนั้นสร้างใหม่:

```bash
docker compose -p cs261-group4 --env-file .env down --volumes
docker compose -p cs261-group4 --env-file .env up -d --build
docker compose -p cs261-group4 --env-file .env ps
```

`cs261-group4` คือชื่อ project ปริยายใน `compose.yaml` หากเคยเริ่มด้วย `-p` ชื่ออื่น ต้องใช้ชื่อนั้นให้ตรงทุกคำสั่ง ขั้นตอนนี้ล้าง SQL กับ PDF พร้อมกันเพื่อไม่ทิ้งไฟล์ที่ไม่มีข้อมูลอ้างอิงหลังสร้างฐานข้อมูลใหม่

การลบแค่ container หรือใช้ `docker compose down` โดยไม่มี `--volumes` ยังเก็บ volume เดิมไว้ จึงอาจกลับไปเจอรหัสผ่านเดิมอีก ไม่ต้องใช้ `docker system prune` หรือ `docker volume prune` ซึ่งอาจกระทบ project อื่น

หลังสร้างใหม่ รอ SQL Server และ Backend พร้อมแล้วจึง Login อีกครั้ง รายการเดิมที่ล้างไปจะไม่กลับมา เหลือเฉพาะข้อมูลที่ระบบ seed ตอนเริ่ม

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
