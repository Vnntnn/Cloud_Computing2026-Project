# E-canva-ai-prompt.md — Prompt สำหรับ Canva AI สร้างสไลด์ชุด Eventide

วิธีใช้:
1. เปิดไฟล์ Canva เดิมที่มีสไลด์/ธีมอยู่แล้ว (สไลด์ 1 หรือทั้งเด็ค)
2. ก๊อป "Prompt ที่ 1 (Style Lock)" ให้ Canva AI (chat/Magic Design) ก่อนหนึ่งครั้ง
3. ก๊อป Prompt ต่อสไลด์ (ข้อ 2–14) ทืมเดียวต่อสไลด์
4. ช่องภาพ `[SLOT]` ทุกจุดให้วางภาพจริงตาม `D-image-checklist.md` เอง (AI จะใส่ placeholder ให้)

---

## Prompt ที่ 1 — Style Lock (ก๊อปทั้งก้อน)

```
ใช้สไตล์เดิมของไฟล์นี้ต่อ ตามกฎนี้เคร่งครัด:

[ธีม]
- ฟอนต์ไทย: Google Sans Thai / Sarabun — หัวข้อหนา, ตัวเลขใช้เติมเด่นแบบ Georgia/mono เพื่อเน้นตัวเลข
- พื้นหลังขาว/ครีมอ่อน เส้นคุมเส้นกราฟิกเดิม — ไม่เปลี่ยนธีม เปลี่ยนเฉพาะเนื้อหา
- ระบบสี 6 เสา (ใช้ทุกหน้าในหัวเสา ป้ายเสมอ):
  OpEx #1F7BC0 · Perf #E8830C · Reliability #2E9E3E · Sustainability #1FA88A · Security #3D4451 · Cost #7B4FD0

[กฎรูปหน้า]
- 1 จุดสนใจหลัก/หน้า + ไอคอนไม่เกิน 4 ตัว จาก lucide/glyph เดิม
- Headline ไม่เกิน 8 คำ, bullet แต่ละข้อไม่เกิน 12 คำ, ตัวเลขเด่น ("Key number") มุมขวาบนสั้น ๆ
- คุมข้อความ: ห้ามเกิน 5 bullet ต่อหน้า, ห้ามทิ้งข้อความให้ล้นกรอบ — auto-fit ให้ชัดในกรอบเสมอ
- ภาพถ่ายจริงตำแหน่งมุมขวาต้องยังน่าอ่าน — อย่าทำเลเยอร์ปิดทับภาพจนอ่านไม่ออก
- Footer เลขหน้า + ป้ายเสาถ้าหน้าเป็นเสา
```

---

## Prompt 2 ตอนเริ่ม — เด็คภาพรวม (สร้างเด็ค 13 หน้าพร้อมกัน)

```
สร้างสไลด์ 13 หน้าเป็นภาษาไทยตามโครงนี้ พอดีวัตติสต์ที่ใช้ (สร้างโทนเดิมของไฟล์):

1 ปก | 2 ปัญหาและโซลูชัน | 3 ข้อจำกัด | 4 สถาปัตยกรรม ★แกน
5 แผนที่ 6 เสา | 6 OpEx | 7 Perf | 8 Reliability
9 Sustainability+Cost | 10 Security | 11 ผลทดสอบ | 12 ข้อจำกัด/ทางต่อ | 13 สรุป

ทุกหน้ารักษากฎใน Style Lock ข้างบน: headline 8 คำ, bullets 12 คำ, key number ขวาบน
เนื้อหาต่อหน้าเป็นไปตามโครงในข้อ 3 ด้านล่างเท่านั้น
```

---

## Prompt ต่อสไลด์ (ตอน AI ทำทีละหน้า / แก้ทีละหน้า)

### 2.1 — สไลด์ 1 (ปก)

```
สไลด์ปก ธีมเดิม ครึ่งขวาเป็น [SLOT: โฮมเพจเว็บจริง]
Headline: "Eventide · เว็บขายตั๋วบน AWS ที่เปิดใช้จริง"
Bullets:
- เว็บจริง: https://eventide.creasy.club/
- Google sign-in + Stripe ชำระเงิน เปิดใช้แล้ว
- ชื่อทีม / รายชื่อสมาชิก / วิชา Cloud Computing 2026
Key number: 7 images · 4 microservices · $50 cap
ไอคอน: k8s, AWS, Terraform (แถบล่าง)
```

### 2.2 — สไลด์ 2 (ปัญหาและโซลูชัน)

```
ครึ่งซ้าย: 4 การ์ดบทบาท Guest / user / organizer / admin · ขวาบน [SLOT: event-detail จาก production]
Headline: "ขายตั๋วต้องไม่ขายเกิน โกงไม่ได้ ระบบไม่พัง"
Bullets:
- ปัญหา: ขายเกินโควตา, อนุมัติ, จ่ายแล้วได้ตั๋ว, ระบบล้น
- 4 บทบาท (นับ Guest) ใช้สิทธิ์ต่างกันชัด
- กันขายเกิน: lock แถว + seat_holds ใน PostgreSQL
- จ่ายผ่าน Stripe Checkout (เปิดแล้ว) · เมลผ่าน SQS
- service 4 ตัว: auth 3001 / event 3002 / regis 3003 / payment 3004
Key number: 4 บทบาท · 1 บัญชี
ไอคอน: lock, clock, ticket, mail
```

### 2.3 — สไลด์ 3 (ข้อจำกัด)

```
ซ้าย: "$50" ตัวหนาใหญ่ตัวเดียวครองพื้น · ขวา: ตาราง 2 คอลัมน์ "อยากใช้ → ข้อจำกัดจริง" 5 แถว
Headline: "ตีกรอบ $50: ทุกข้อจำกัดมีเหตุผลจากการ probe"
ตาราง:
- IAM Role/OIDC/AttachRolePolicy → ถูกปฏิเสธ
- CloudFront → SCP ปฏิเสธ
- NAT gateway → งบ $50 ไม่ไหว
- ทุก session 4 ชม. → S3/ข้อมูลถอย → make deploy ทุกเซสชัน
- แต่มีโดเมนแล้ว → eventide.creasy.club (ต้อง make up ต่อเซสชัน)
Key number: $50 cap · 4 ชม./เซสชัน
ไอคอน: money-off, key, globe
```

### 2.4 — สไลด์ 4 (สถาปัตยกรรม as-built) — ★เอกสารหลัก

```
ไดอะแกรม as-built เต็มแผ่น (จออีกใบจาก docs/): [SLOT: eventide-aws-as-built.png]
Headline: "แผนที่จริง: Terraform → EKS → RDS/S3/SQS"
ติด label ด้วยเส้นเชื่อมน้อยว่า " Traffic: NLB (TLS/ACM) → ingress-nginx → Ingress (API/files) "
โซนใหญ่ในภาพ:
- Terraform 1 root: EKS + RDS + NLB + SQS + ECR + S3 (+ Route 53)
- 7 images: web / auth / event / regis / payment / mail-worker / db-migrate
- Postgres = RDS db.t3.micro นอกคลัสเตอร์ / Redis = pod ใน chart
- CI: main → ECR → helm upgrade (migrate ก่อนทุกครั้ง)
Key number: 25 resources ตั้งครั้งไม่เปลี่ยน
```

### 2.5 — สไลด์ 5 (แผนที่ 6 เสา)

```
วาด temple เสา 6 ต้น กลุ่ม 2: 
- เสาเข้มทึบ 3 ต้น "ครบถ้วน": OpEx (#1F7BC0) · Perf (#E8830C) · Cost (#7B4FD0)
- เสาสีอ่อน 3 ต้น "บางส่วน": Reliability (#2E9E3E) · Security (#3D4451) · Sustainability (#1FA88A)
แต่ละต้นติด tag: ทำซ้ำได้ / มีเลข k6 / คุม $50 / ไม่มี chaos-RTO / ไม่มี WAF / ไม่มีเมตริก
Headline: "ตรวจ 6 เสา: ครบถ้วน 3 · บางส่วน 3"
ฟุตเทอร์: หน้า 6–10 คือ 1 เสา = 1 สไลด์ (หน้า 9 รวม 2 เสา)
```

### 2.6 — สไลด์ 6 (OpEx ฟ้า)

```
ป้ายเสาหัวหน้า: "เสา 1: Operational Excellence" สีฟ้า #1F7BC0
ขวากลาง [SLOT: terminal logs make deploy]
Headline: "ทำซ้ำได้ทั้งระบบ ไม่ต้องมีทีม ops"
Bullets:
- แพลตฟอร์มทั้งก้อนเป็น code ตรวจได้จาก git
- make deploy ชุดเดียวจบ: 7 images → k8s Secrets → helm upgrade
- reshape migrate ตาม Helm pre-upgrade hook (db-migrate)
- CI: test + build ทุก PR, push main deploy เอง
- ช่องว่าง: ไม่มี runbook เชิงที่เรียกจากทีม ops
Key number: 1 คำสั่ง deploy
ไอคอน: Terraform, Helm, GitHub
```

### 2.7 — สไลด์ 7 (Perf ส้ม)

```
ป้ายเสาหัวหน้า: "เสา 2: Performance Efficiency" สีส้ม #E8830C
กลาง [SLOT: กราฟ HPA 2→8→2]
Headline: "เครื่องจริงทดสอบแล้ว: 226 req/s ขึ้นเคลื่อน"
Bullets:
- k6 (2026-09-07, node t3.medium): 98,500 req, 226.4 req/s
- ผ่าน 99.89% (fail 0.10%) · p95 430.56 ms
- HPA ของ `event`: CPU 60%, min 2, max 8 — ขยายและลดเอง
- Redis cache ลดการถาม RDS: session 60 วิ, event 5 นาที
- จำแนก: booking path ยังไม่ได้ load test (read path เท่านั้น)
Key number: 226.4 req/s · p95 430.56 ms
ไอคอน: bolt, gauge
```

### 2.8 — สไลด์ 8 (Reliability เขียวสด)

```
ป้ายเสาหัวหน้า: "เสา 3: Reliability" สีเขียวสด #2E9E3E
ขวากลาง: ไดอะแกรมเรียบ "pod ตาย → k8s สร้างใหม่" + RDS เป็นเงาเทา
Headline: "pod ล้ม = ระบบช่วยตัวเอง / DB ล้ม = ยังไม่กันได้"
Bullets:
- health probe ไม่แตะ RDS (กัน restart พากัน)
- ซ้อมกู้คืนทุกเซสชัน: down 8m56s / up 16m37s / 25 resources
- RDS: multi_az=false, backup=0 → ไม่มี backup จึงกู้ไม่ได้ (RPO ไม่มีขอบเขต)
- SQS + DLQ: เมล retry 5 ครั้งแล้วแตกคิว DLQ
- Availability/RTO/RPO: [ไม่พบข้อมูล] — ไม่มีการวัด
Key number: down 8m56s / up 16m37s (2026-09-07) = rebuild ≠ RDS RTO
```

### 2.9 — สไลด์ 9 (Sustainability + Cost) — ป้าย 2 สี

```
ป้ายหัวหน้า: "Sustainability #1FA88A + Cost #7B4FD0" ลูกโ shift/ 2 สี
กลาง: การ์ดตัวเลขรายชิ้น 3 ใบ + node
Headline: "จ่ายเมื่อใช้ ล้างเมื่อเลิก: ต้นทุนคำนวณแยกชิ้น"
การ์ด (แยกเป็นการ์ดเด่น 3 ใบ):
- EKS control plane $0.100/ชม [คำนวณ]
- NLB $0.023/ชม · RDS db.t3.micro $0.018/ชม (รวม storage)
- node 2×t3.small $0.0416/ชม (ปกติ) หรือ 2×t3.medium $0.083/ชม (ครั้ง load test)
- รวมขึ้นเคลื่อน: $0.18/ชม ($0.23 ตอน load test) — เซสชัน 4 ชม ≈ $0.73–0.90
- ไว้ค้างคืน: ~$3.40/วัน (EKS 2.40 + NLB 0.54 + RDS 0.43 — EC2 lab ปิดให้)
Bullets ขวา:
- make down จบทุกเซสชัน — ตัดต้นทุนค้างทั้งก้อน
- ตัดแต่แรก: NAT, CloudFront, RDS-per-service, Prometheus
- ยังไม่มีค่าจาก credit meter → ห้ามพูด "$25 actual"
Key number: $0.18/ชม · ~$3.40/วันค้างคืน
ไอคอน: dollar, recycle
```

### 2.10 — สไลด์ 10 (Security เทาเข้ม)

```
ป้ายเสาหัวหน้า: "เสา 4: Security" สีเทาเข้ม #3D4451
ขวากลาง: แผนภาพทีละชั้น NLB(ACM) → ingress → auth-guard → RDS/S3 policy
Headline: "ความปลอดภัยแยกชั้น: cookie + IAM + HTTPS"
Bullets:
- Better Auth เก็บ secret เท่าตัว (ไม่ลงโค้ด)
- ทุก service ผ่าน auth-guard: introspect + cache 60 วิ
- RBAC (user/organizer/admin + Guest) + ownership macro
- S3: เปิดอ่านเฉพาะ public/* (ทดสอบจริง 200/403)
- HTTPS + ACM ที่ NLB · Google + Stripe เปิดใช้แล้ว
Key number: 1 ช่องทางเข้า ตรวจ cookie ทุกคำขอ
ไอคอน: lock, shield, key, s3
```

### 2.11 — สไลด์ 11 (ผลทดสอบ)

```
กลาง: กราฟหลัก HPA 2→3→5→7→8 กลับ 8→6→4→2 กำกับ CPU 60%
ขวาบน: badge 3 ใบ "226.4 req/s · fail 0.10% · p95 430 ms"
ขวาล่าง [SLOT: kubectl pod-count logs — ปิด NLB DNS/IP ก่อนถ่าย]
Headline: "วัดจริงสองครั้ง: load test กับ GATE เดโม"
Bullets:
- ครั้ง 1 (2026-09-07, node t3.medium, GET /api/events): 98,500 req, 226.4 req/s
- fail 0.10% (checks 198/197,000 · http 99/98,500)
- HPA `event`: CPU 60%, min 2 max 8 — เห็นทั้งขึ้นและลง
- ครั้ง 2 (2026-10-24): EKS GATE deploy จากศูนย์ผ่านครบหมวด (ไม่ใช่ load test)
- CI test กัน oversell + idempotent checkout (script ชื่อเจาะ)
Key number: 226.4 req/s · fail 0.10% · CPU 60%
```

### 2.12 — สไลด์ 12 (ข้อจำกัดและทางต่อไป)

```
ขวากลาง: ตาราง "ทำแล้ว (เขียว) / ยังไม่ทำ (ส้ม)" โต้ตอบ 6 แถว
Headline: "ไม่ได้ทำเพราะอะไร และเติมคืนได้เมื่อไร"
แถว:
✓ domain eventide.creasy.club + ACM — ใช้ได้จริง
✓ Google sign-in + Stripe — เปิดแล้ว (ยืนยันทีม 2026-10-25)
✗ Container Insights — ปิด: AttachRolePolicy ถูกปฏิเสธ (2026-09-07) → ใช้ kubectl top + HPA log
✗ Chaos Testing / RTO / RPO — ไม่พบข้อมูลวัด
✗ platform ถูกทำลายทุกคืน — ตามข้อจำกัดงบ, make up ก่อนเดโม
Key number: 2 เด้งแขวนสู่ thing-เติม: dns.tf รองรับHTTPS แนบ ACM
ไอคอน: flag, road
```

### 2.13 — สไลด์ 13 (สรุป)

```
ขวากลาง: ภาพ as-built ย่อ + 6 ไอคอนเสา 6 สี แสดงสถานะเสา (แข็ง=ทึบ, บางส่วน=โปร่ง)
Headline: "ระบบจริงขึ้น EKS จริง มีเว็บให้เปิดจริง"
Bullets:
- rebuild ซ้ำได้ทุกชิ้น: 25 resources ทุก apply
- เว็บใช้ได้จริง: https://eventide.creasy.club/ (make up ก่อนเซสชัน)
- Google sign-in + Stripe: เปิดใช้แล้ว
- เสาแข็ง OpEx·Perf·Cost — ยังเผา Reliability, Sustain, Security(บาง)
- งบพอ: $0.18/ชม ขึ้นเคลื่อน ล้างตอนจบเซสชัน
Key number: 226.4 req/s · $0.18/ชม · https พร้อม
ไอคอน: Q&A
```

---

## ข้อห้าม (แนบท้ายทุกครั้งเมื่อ AI เริ่มขยายเนื้อหาเอง)

```
ห้ามสอดแทรกตัวเลข/ความจริงที่ไม่อยู่ในโครงที่ให้ ห้าม up-sell ฟีเจอร์ที่ repo ไม่มี (multi-AZ ไม่มี, chaos ไม่มี, RTO ไม่มี)
ห้ามใส่ AWS service ที่ไม่มีจริง: CloudFront, Shield, WAF, EventBridge, ElastiCache, X-Ray, GuardDuty
ห้ามใส่ภาพที่แสดง NLB DNS *.elb.amazonaws.com" / credentials / ข้อมูลส่วนตัวผู้ใช้
หากไม่รู้: ใส่ "[ไม่พบข้อมูล — ต้องยืนยัน]" แทนตัวเลข
```

สถานะภาพจริงที่ต้องหา → ดูรายการครบใน `D-image-checklist.md` (กลุ่ม 1 ทำก่อน)
