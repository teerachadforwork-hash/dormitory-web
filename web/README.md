# บ้านสุข เรสซิเดนซ์

เว็บบริหารห้องเช่า พัฒนาเป็น Responsive Web (React/TypeScript) และ API (Express/TypeScript) โดยใช้ PostgreSQL ตามแบบฐานข้อมูลใน `../Rental_Database_PostgreSQL.sql`

## สิ่งที่ทำงานได้

- ระบบเข้าสู่ระบบด้วยบัญชีที่ผู้ดูแลสร้างไว้ ใช้รหัสผ่าน bcrypt, JWT ใน HTTP-only SameSite=Strict cookie, จำกัดความถี่ login, Helmet และตรวจ role/permission ฝั่ง API
- ภาพรวมและข้อมูลห้องจาก PostgreSQL จริง โดยสถานะมีผู้พัก/จองคำนวณจากช่วงสัญญาและการจอง ไม่แก้ทับสถานะเชิงปฏิบัติการของห้อง
- จัดการข้อมูลโครงการ อาคาร ชั้น และประเภทห้อง รวมถึงเพิ่มห้องและเปลี่ยนสถานะห้องผ่าน API
- เพิ่มและค้นรายชื่อผู้เช่า ระบบออก code ให้อัตโนมัติด้วย sequence ที่ปลอดภัยต่อผู้ใช้พร้อมกัน
- สร้างสัญญาเช่าและผู้เข้าพัก ตรวจสอบห้องและช่วงวันที่ใน transaction พร้อม lock ห้องเพื่อป้องกันการทำสัญญาทับซ้อน
- ย้ายห้องของสัญญาโดยเก็บช่วงห้องเดิม/ใหม่และข้อมูลมิเตอร์ส่งมอบ พร้อมตรวจห้องปลายทางและช่วงจองซ้อน; สิ้นสุดสัญญาได้โดยไม่ลบประวัติและไม่ทำรายการคืนเงินหรือชำระหนี้แทนอัตโนมัติ
- ตั้งค่าบัญชี ผังบัญชี รายการค่าบริการ อัตราค่าสาธารณูปโภค เครื่องมิเตอร์ และช่วงที่ผูกอัตรากับห้อง พร้อมตรวจโครงการและช่วงวันที่ซ้อน
- เปิดรอบบิล บันทึกและยืนยันค่ามิเตอร์อย่างแยกขั้นตอน (รองรับการระบุจำนวนรอบหมุนมิเตอร์) และสร้างใบแจ้งหนี้ฉบับร่างจากสัญญา ค่าบริการ และค่ามิเตอร์ที่ยืนยันแล้ว
- คำนวณภาษีและปัดเศษระดับรายการ พร้อมเก็บ snapshot อัตราและข้อมูลคำนวณในรายการใบแจ้งหนี้เพื่อให้ตรวจสอบย้อนหลังได้
- ตรวจและออกใบแจ้งหนี้ฉบับร่าง พร้อมตรวจยอดรายการและลงสมุดรายวันลูกหนี้/รายได้/ภาษีแบบสมดุลใน transaction เดียว
- พิมพ์ใบแจ้งหนี้และใบเสร็จจาก snapshot ที่บันทึกไว้เป็นเอกสาร A4 พร้อมรายละเอียดรายการ/การจัดสรร ภาษี ยอดรวม และช่องลงนาม
- บันทึกรับชำระเป็น pending ซึ่งไม่ลดหนี้; เมื่อผู้ใช้ยืนยัน ระบบตรวจยอดค้างและบัญชีอีกครั้ง ออกใบเสร็จและสมุดรายวัน; การยกเลิกรายการที่ยืนยันแล้วเก็บประวัติใบเสร็จและกลับรายการบัญชีแทนการลบ
- รับ/คืนเงินจอง เงินประกัน และเงินล่วงหน้า พร้อมตรวจยอดกองคงเหลือและลงบัญชี; ใช้เงินกองหักใบแจ้งหนี้เฉพาะสัญญาเดียวกันและไม่เกินยอดค้าง
- โอนประเภทเงินกอง (เช่น เงินจองเป็นเงินประกัน/ล่วงหน้า) จากการจองไปยังสัญญาของผู้เช่าคนเดียวกัน โดยล็อกต้นทาง/ปลายทาง ตรวจยอดคงเหลือ สร้างรายการ `transfer_out`/`transfer_in` ที่เชื่อมกัน และลงสมุดรายวันปรับบัญชีหนี้สินใน transaction เดียว
- บันทึกค่าใช้จ่ายเป็นร่างพร้อมคำนวณภาษีรวม/แยก/ไม่คิดภาษี, ลงบัญชีรายจ่าย/ภาษีซื้อ/สมุดเงินหลังตรวจบัญชี และยกเลิกรายการโดยสร้างสมุดรายวันกลับรายการแทนการลบ
- จัดการข้อมูลผู้จำหน่ายพื้นฐาน และผูกผู้จำหน่าย/เลขเอกสารภายนอกกับรายการค่าใช้จ่าย
- มอบหมายงานซ่อมย่อย บันทึกผู้จำหน่าย ผลงาน ต้นทุน และผู้รับผิดชอบ พร้อมบังคับบันทึกผลของงานย่อยก่อนปิดงานหลัก; การบันทึกต้นทุนนี้ยังไม่สร้างรายการรายจ่ายหรือใบแจ้งหนี้อัตโนมัติ
- พอร์ทัลผู้เช่าดูสัญญา/ใบแจ้งหนี้ของบัญชีที่ผูกไว้ พิมพ์ใบแจ้งหนี้ ส่งหลักฐานชำระเงิน และส่งคำขอแจ้งซ่อมหรือข้อร้องเรียนโดยตรวจสัญญาที่กำลังใช้งานฝั่ง API
- รายงานลูกหนี้คงค้าง ค่าใช้จ่าย และรายการสมุดรายวันที่ลงบัญชีแล้ว คำนวณจากข้อมูลจริงตามตัวกรองและส่งออก CSV โดยตรวจ permission แยก
- จัดการการจอง งานซ่อม และข้อร้องเรียนผ่าน API และหน้าจอที่บันทึกลง PostgreSQL จริง
- ป้อนข้อมูลผ่าน parameterized SQL และตรวจข้อมูลขาเข้าทั้งใน API และข้อจำกัดฐานข้อมูล

**ขอบเขตที่ยังไม่เสร็จ:** รายงานปฏิบัติการ/บริหารอื่นนอกเหนือจากรายงานการเงินที่ระบุ การแนบหลักฐานในพอร์ทัลเป็นการส่งไฟล์ให้เจ้าหน้าที่ตรวจเท่านั้น ไม่ได้ยืนยันการรับชำระหรือสร้างรายการรับเงินอัตโนมัติ

การรับชำระและออกใบแจ้งหนี้ต้องเลือกบัญชีลูกหนี้/ภาษี/เงินรับล่วงหน้าให้ตรงกับผังบัญชีกิจการ ผู้ดูแลระบบได้รับ permission ของระบบที่มีอยู่; การเรียก `npm run admin:create` ซ้ำสำหรับบัญชีผู้ดูแลเดิมจะ sync permission โดยไม่เปลี่ยน credentials แต่จะปฏิเสธชื่อผู้ใช้ที่มีอยู่และไม่ได้ผูก role ผู้ดูแล ต้องสร้างผังบัญชี สมุดเงิน และรายการค่าบริการก่อนใช้งาน workflow การเงิน มีการทดสอบ API พอร์ทัลกับ PostgreSQL จริงแล้ว แต่ยังไม่ใช่การตรวจรับระบบรับเงินจริงหรือการทดสอบความพร้อม production

การเปิดใช้พอร์ทัล: bootstrap permission `tenant.portal` แล้วสร้างบทบาทผู้เช่าที่มี permission นี้ จากนั้นสร้างบัญชีผู้ใช้และผูกกับผู้เช่าในหน้า “ผู้ใช้และสิทธิ์” ผู้ใช้เห็นเฉพาะสัญญาที่ตนเป็นผู้ทำสัญญา ใบแจ้งหนี้ของตน และเรื่องที่ผูกกับสัญญาเหล่านั้น; บัญชีที่ไม่มี customer link จะใช้งานพอร์ทัลไม่ได้

หลักฐานชำระเงินรับเฉพาะ PDF/JPEG/PNG/WebP ขนาดไม่เกิน 5 MiB และตรวจลายเซ็นไฟล์ก่อนบันทึก จำกัด 5 ไฟล์ต่อใบแจ้งหนี้ ไฟล์ถูกเก็บใน `private-uploads/` (หรือ path ที่กำหนดด้วย `ATTACHMENT_STORAGE_PATH`) ซึ่งต้องอยู่นอก public web root และมีการสำรอง/จำกัดสิทธิ์ระบบไฟล์อย่างเหมาะสม การจัดเก็บในเครื่องนี้ยังไม่มี antivirus scanning หรือ object storage; ก่อนใช้งาน production ควรเพิ่มการสแกนไฟล์และย้ายไป private object storage พร้อมนโยบาย retention/backup

การสร้างใบแจ้งหนี้ร่างไม่ทำ prorate สัญญาที่ไม่ครอบคลุมรอบบิลเต็ม และข้ามรอบที่ค่ามิเตอร์ยังไม่ถูกยืนยัน อัตรา tiered รองรับใน API แต่ยังไม่มีฟอร์มตั้งค่าใน UI ทั้งนโยบายภาษีและหลักผังบัญชีต้องตั้งให้ตรงกับกิจการก่อนใช้งานจริง

## ความต้องการ

- Node.js 22 หรือใหม่กว่า
- PostgreSQL ที่สร้างฐานข้อมูลเปล่าและผู้ใช้แอปไว้แล้ว

## ติดตั้งและเริ่มต้น

1. ติดตั้ง PostgreSQL 17 หรือใหม่กว่าและเริ่ม PostgreSQL service
2. ใน PowerShell เปิดโฟลเดอร์ `web` แล้วติดตั้ง dependencies:

   ```powershell
   Set-Location 'D:\Dormitry-web\web'
   npm install
   ```

3. ตั้งค่าฐานข้อมูลและบัญชีผู้ดูแลอัตโนมัติ (สคริปต์จะถามชื่อผู้ดูแล PostgreSQL และรับรหัสผ่านใน secure prompt โดยไม่บันทึกรหัสผ่านนั้น):

   ```powershell
   .\scripts\setup-local-postgres.ps1
   ```

   สคริปต์สร้าง/ปรับรหัสผ่าน role `rental_app`, สร้างฐานข้อมูล `rental_web` หากยังไม่มี, ตรวจ schema ก่อนติดตั้งเพื่อไม่รันซ้ำ, สร้าง `.env` และสร้างบัญชีผู้ดูแลให้ ระบบจะแสดง username/password ของบัญชีผู้ดูแลหนึ่งครั้งใน PowerShell จดเก็บไว้ก่อนปิดหน้าต่าง หากพบ `.env` เดิมหรือ schema ที่ดูไม่สมบูรณ์ สคริปต์จะหยุดโดยไม่เขียนทับ/ติดตั้งซ้ำ

4. เริ่ม API และเว็บสำหรับพัฒนา:

   ```powershell
   npm run dev
   ```

   เมื่อ API เริ่มทำงานแล้ว ตรวจการเชื่อมต่อฐานข้อมูลได้ที่ `http://127.0.0.1:3000/api/health` ซึ่งควรตอบสถานะพร้อมใช้งาน หากเชื่อมต่อไม่ได้ ให้ตรวจว่า PostgreSQL service กำลังทำงาน, port ตรงกัน, role/password ถูกต้อง และฐานข้อมูล `rental_web` มีอยู่ จากนั้นเข้าสู่เว็บด้วยบัญชีผู้ดูแลที่สร้างไว้

   Vite แสดง URL เว็บ (ปกติ `http://localhost:5173`) และ Express API ใช้ `http://127.0.0.1:3000` เว็บ proxy `/api` ให้ API อัตโนมัติ
7. เข้าสู่ระบบ แล้วเปิดเมนู **ตั้งค่าข้อมูล** เพื่อสร้างโครงการ อาคาร ชั้น และประเภทห้องก่อนเพิ่มห้อง

## ตรวจสอบ

```powershell
npm run lint
npm run build
npm test
```

Build จะตรวจ TypeScript ทั้งฝั่งเว็บและเซิร์ฟเวอร์ API; `npm test` รัน unit/schema tests และ API integration tests (ส่วน API integration จะข้ามเมื่อไม่ได้กำหนด `DATABASE_URL`) ไม่มีการใช้ข้อมูลตัวอย่างหรือ seed ข้อมูลธุรกิจอัตโนมัติ ระบบตอบข้อผิดพลาดเมื่อยังไม่ได้กำหนดฐานข้อมูลหรือยังไม่มี schema

## API ที่เปิดใช้

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/health` (ตรวจสุขภาพ API และ PostgreSQL)
- `GET /api/lookups`, `POST /api/properties`, `/api/buildings`, `/api/floors`, `/api/room-types`
- `GET /api/rooms`, `POST /api/rooms`, `PATCH /api/rooms/:id/status`
- `GET /api/customers`, `POST /api/customers`
- `GET /api/contracts`, `POST /api/contracts`
- `POST /api/contracts/:id/move-room`, `POST /api/contracts/:id/end` (ต้องมี `contracts.update`; ย้ายห้องเริ่มวันถัดไปและสิ้นสุดสัญญาไม่รองรับวันที่อนาคต)
- `POST /api/accounts`, `/api/bank-accounts`, `/api/charges`, `/api/utility-tariffs`, `/api/meters`, `/api/room-utility-tariffs` (ต้องมี `settings.manage`)
- `GET /api/billing-periods`, `POST /api/billing-periods`
- `GET /api/meters`, `GET /api/meter-readings`, `POST /api/meter-readings`, `PATCH /api/meter-readings/:id/verify`
- `POST /api/billing-periods/:id/generate-invoices` สร้าง invoice แบบ draft; `GET /api/invoices`; `GET /api/invoices/:id/print-data` ข้อมูลสำหรับพิมพ์; `POST /api/invoices/:id/issue` ออกบิลและลงบัญชี
- `GET/POST /api/payments`, `POST /api/payments/:id/confirm`, `POST /api/payments/:id/void`
- `GET /api/receipts/:id/print-data` ข้อมูลใบเสร็จสำหรับพิมพ์ (ต้องมี `payments.read`)
- `GET/POST /api/fund-transactions` สำหรับรับ/คืนเงินกองและหักใบแจ้งหนี้ (ต้องมี `funds.read` หรือ `funds.confirm`)
- `POST /api/fund-transactions/transfer` สำหรับโอนประเภทเงินกองจากการจองไปยังสัญญาของผู้เช่าคนเดียวกัน พร้อมปรับบัญชีหนี้สิน (ต้องมี `funds.confirm`)
- `POST /api/fund-transactions/:id/reverse` กลับรายการเงินกองและรายการโอนเป็นคู่ พร้อมสมุดรายวันกลับรายการ (ต้องมี `funds.confirm`)
- `GET/POST /api/expenses`, `POST /api/expenses/:id/post`, `POST /api/expenses/:id/void` (ต้องมี `expenses.read`, `expenses.create` หรือ `expenses.post`)
- `POST /api/suppliers` (ต้องมี `settings.manage`; รายชื่อแสดงใน `/api/lookups`)
- `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`
- `GET /api/admin/roles`, `POST /api/admin/roles`, `PATCH /api/admin/roles/:id/permissions` (ทุก endpoint ต้องมี `users.manage`; ป้องกันไม่ให้ปิดสิทธิ์ผู้จัดการคนสุดท้าย)
- `GET /api/admin/customers` สำหรับผูกบัญชีพอร์ทัลกับผู้เช่า (ต้องมี `users.manage`)
- `GET /api/portal`, `GET /api/portal/invoices/:id/print-data`, `POST /api/portal/invoices/:id/evidence`, `GET /api/portal/attachments/:id`, `POST /api/portal/maintenance-requests`, `POST /api/portal/complaints` (ต้องมี `tenant.portal`; ใบแจ้งหนี้/ไฟล์ถูกจำกัดตาม customer ของบัญชี)
- `GET /api/reports/receivables`, `GET /api/reports/receivables.csv`
- `GET /api/reports/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD&status=posted|draft|void|all` และ `.csv` (ต้องมี `reports.read` หรือ `reports.export`)
- `GET /api/reports/journal-entries?from=YYYY-MM-DD&to=YYYY-MM-DD` และ `.csv` แสดงเฉพาะสมุดรายวันที่ลงบัญชีแล้ว (ต้องมี `reports.read` หรือ `reports.export`)
- `GET/POST /api/bookings`, `PATCH /api/bookings/:id/status`
- `GET/POST /api/maintenance-requests`, `PATCH /api/maintenance-requests/:id/status`, `POST /api/maintenance-requests/:id/jobs`
- `PATCH /api/maintenance-requests/:id/jobs/:jobId` บันทึกผลซ่อม/ต้นทุนจริงและผู้รับผิดชอบ (ต้องมี `maintenance.update`)
- `GET/POST /api/complaints`, `PATCH /api/complaints/:id/status`

การเปลี่ยน schema ต้นฉบับต้องทำเป็น migration ที่ตรวจสอบย้อนหลังได้ก่อนใช้งานจริง แทนการแก้ฐานข้อมูล production โดยตรงจากเครื่องนักพัฒนา
