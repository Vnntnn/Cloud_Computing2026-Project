# (A) รายงานสรุปโปรเจกต์ — Eventide (as-built, รอบสอง)

ทุกข้ออ้างอิงไฟล์จริง · ตรวจสอบครั้งใหม่วันที่ 2026-10-25

## 1. Executive Summary

- Eventide = เว็บขายตั๋วอีเวนต์แบบ microservices (Bun + ElysiaJS + React 19 + TanStack + shadcn/ui)
- 7 workloads บน EKS 1.33: auth, event, registration, payment, mail-worker, web, db-migrate (hook) + Redis เป็น pod
- **เว็บใช้จริง: https://eventide.creasy.club/** — Route 53 zone ทำงานแล้ว (ตรวจ DNS 2026-10-25: zone eventide.creasy.club delegate จาก Cloudflare, SOA จาก awsdns) · ก่อนเดโมต้องรัน `make up` ระบบชุดทุกครั้ง (งบทุกคืน destroy แล้วนำกลับมา)
- สภาพแวดล้อม: AWS Learner Lab, us-east-1, budget $50 ตายตัว, เครดิตว่าง 4 ชม. หลังจากแต่ละเซสชัน → ทำลายและสร้างใหม่ตามเซสชัน
- ผ่าน EKS GATE 2026-10-24: deploy จากศูนย์: health × 4, sign-up + cookie session, S3 200/403 ตามสิทธิ์, เมลผ่าน SQS → mail-worker, make admin, HPA metrics live (docs/TODO.md §0.6)
- ผลทดสอบ: k6 (วัด 2026-09-07, node t3.medium, read path/`GET /api/events` เท่านั้น): 98,500 requests, 226.4 req/s, ผ่าน 99.89% (fail 0.10%), avg 316.7 ms, p95 430.6 ms; HPA ของ `event` 2→3→5→7→8 กลับ 8→6→4→2 (docs/autoscaling-evidence.txt — ไฟล์ไม่มี date, วันที่วัดได้ถูกบอกจะยืนยันเป็นคำถามค้าง)
- ยังไม่ติดตั้ง: Chaos Testing, CloudFront / Shield / WAF / EventBridge / ElastiCache / X-Ray / GuardDuty และตัวเลข Availability / RTO / RPO [ไม่พบข้อมูล — ต้องยืนยัน]

## 2. ปัญหา / เป้าหมาย / ขอบเขต / บทบาท

- ปัญหา: ขายตั๋วรองรับผู้ซื้อพร้อมกันโดยไม่ขายเกินโควตา + กระบวนการอนุมัติ ชำระเงิน ตรวจตั๋ว และบทบาท admin
- เป้าหมาย infra: IaC ที่ rebuild ได้ทุกวัน + evidence ทดสอบ (k6, HPA) + ค่าใช้จ่ายอยู่ใต้ $50
- กลไกกันขายเกิน: ล็อกแถว ticket_types (`SELECT ... FOR UPDATE`) + seat_holds ใน PostgreSQL (10 นาที) + นับ seatsTaken = active holds + active enrollments + maxPerUser
- **4 บทบาท** (นับ Guest): Guest (ดูเว็บสาธารณะ) / user=Attendee / organizer (จำกัดโดย ownership macro) / admin - แปลงสิทธิ์งานใน repo (AGENTS.md §Roles)
- ขอบเขตที่ตัดออก (docs/REPORT.md §2 — draft เก่า เป็นเหตุผลที่ตัดสินใจเท่านั้น): BFF/API gateway, Prometheus+Grafana, RDS หลาย instance, ห้องรอ/คิวรอ, CloudFront (lab deny), cert-manager

## 3. สถาปัตยกรรม (as-built)

Traffic: Browser → (DNS ผ่าน Route 53) → Terraform NLB (TLS ทำที่ NLB ด้วย ACM เมื่อ dns แนบ; ก่อนหน้านั้นเป็น TCP passthrough ที่ :443) → ingress-nginx NodePort → แยกเส้นทางตาม prefix:
- `/` → web (SPA + Bun server ทำ Open Graph tags)
- `/api/auth` → auth (Better Auth, cookie session)
- `/api/events` → event (งาน, ticket types, OG images, Redis cache 5 นาที)
- `/api/regis` → registration (seat availability, enrollments, tickets, check-in, WebSocket live feeds)
- `/api/payment` → payment (Stripe Checkout, webhook, refunds)
- `/files/*` → Ingress เข้าดึงตรงจาก S3 (bucket policy เปิดให้อ่านเฉพาะ public/*)

Data / Async:
- **RDS PostgreSQL db.t3.micro** หนึ่ง instance หนึ่ง database `eventide` — run นอกคลัสเตอร์ (multi_az=false, backup=0 ตั้งใน rds.tf พูดตรง)
- **Redis pod** ในคลัสเตอร์ (ไม่ใช่ ElastiCache): cache get-session 60 วินาที + channel `seats:changed` ประกาศที่นั่งสด
- SQS mail-queue + DLQ: visibility 30 s, long-poll 10 s, maxReceiveCount=5
- Migration: Helm pre-upgrade hook `db-migrate` ทุก deploy

External: Stripe (checkout/webhook/refund) + Gmail SMTP (ไม่มี key = dry-run log)

## 4. ตารางบริการ AWS ใช้จริง

| บริการ | หน้าที่ | เหตุผลที่เลือก | Config สำคัญ |
|---|---|---|---|
| EKS | รัน pods หลัก 7 | โจทย์ microservices + autoscaling | 1.33, node group 2 x **t3.small** (min 2 / max 4; ตอน load test ที่ t3.medium), raw aws_eks_* เพราะ module ชุมชนถูก lab ปิด |
| RDS PostgreSQL | ฐานข้อมูลกลาง service | ลดต้นทุน + schema เดียวต่อ DB ไม่แยก | db.t3.micro, multi_az=false, backup=0, DB_POOL_MAX=4/pod, sslmode=require |
| S3 | เก็บรูปงาน / หน้าไฟล์ | แบ่งเหมาะ upload/read | bucket event-assets; policy อ่านเฉพาะ public/* |
| SQS | async เมล + DLQ | keep mail retry | visibility 30 s, long poll 10 s, maxReceiveCount 5 |
| ELB (NLB) | ประตูสาธารณะ | อยู่ใน Terraform state (ไม่แนบ Service type LoadBalancer) | TCP :80 → NodePort; :443 = TLS listener ที่ใช้ ACM (มี dns) หรือ passthrough |
| Route 53 + ACM | โอมากน + รับ TLS | dns.tf กำหนด assume wildcard | zone `eventide.creasy.club`; เห็นจาก DNS วันที่ 2026-10-25 (SOA จาก awsdns) |
| Secrets Manager | เก็บคีย์ Google/Stripe/Gmail | แยกข้อมูลลับออกจาก git | 3 secrets: google-oauth / stripe / gmail — **Google + Stripe เปิดใช้งานแล้ว** (ยืนยันโดยทีม 2026-10-25) |
| ECR | เก็บ 7 images | ส่งมอบรูปเดียวทุกเซสชัน | ทุก session ผ่าน deploy.sh |
| CloudWatch | Container Insights (ปิดทั้งแต่แรก) | lab ปฏิเสธ AttachRolePolicy (ยืนยัน 2026-09-07) | enable_container_insights=false ใน terraform vars — ใช้ kubectl top + HPA log แทน |
| จาก seed ที่ยังไม่มีของจริง | — | — | CloudFront / Shield / WAF / EventBridge / ElastiCache / X-Ray / GuardDuty / VPC endpoints |

## 5. เส้นทางการใช้งานหลัก (จาก AGENTS.md + docs/tickets.md)

1. ซื้อตั๋ว first_come: เปิดหน้างาน → POST /ticket-types/:id/hold เก็บที่นั่ง 10 นาที (บัญชีเดียวต่อประเภทตั๋ว; ขอซ้ำได้แต่ได้ตัวเดิม) → เลือกจำนวน + กรอกฟอร์ม → enroll() ล็อกแถว ticket_types นับ seatsTaken ตัดโควตา → pending/awaiting_payment (35 นาที) → POST /checkout สร้าง Stripe session → webhook หรือ POST /checkout/verify → confirmed → ออกตั๋ว (QR) + เมลผ่านคิว
2. ชำระเงิน → refund: คืนเงินทั้งออร์เดอร์ตาม policy percent, ยกเลิก enrollment คืนที่นั่ง
3. ถ้าไม่จ่ายในเวลา: สถานะอ่านสดด้วย effectiveStatus() — ที่นั่งคืนทันทีโดยไม่ต้องมี job ตัดอายุ

## 6. การทดสอบและผลลัพธ์

| การประเมิน | ผลจริงที่มี log บันทึก |
|---|---|
| k6 + HPA (load test GET /api/events, 2026-09-07, node t3.medium) | 98,500 req, 226.4 req/s, ผ่าน 99.89% (fail 0.10%), avg 316.7 ms, p95 430.6 ms, 200 VU; HPA (event, CPU 60%, min 2 max 8) 2→8 กลับ 8→2 (docs/autoscaling-evidence.txt — booking path ยังไม่ได้ load test) |
| Rebuild จากศูนย์ (2026-09-07) | `make down` 8m56s (25 destroyed) → `make up` 16m37s (25 รายการ: module 23 + 2 helm) — จำนวนตรงโครงปัจจุบัน, ขั้นหลังจบยังต่างจากเดิม (เดิม db-bootstrap ปัจจุบัน db-migrate hook) — rebuild platform ทั้งชุด ไม่ใช่ RTO ของ RDS |
| EKS GATE 2026-10-24 | deploy จากศูนย์: 7 images, 4 Secrets, migrate hook, health × 4, S3 200/403, เมลผ่าน SQS, make admin, HPA metrics live (docs/TODO.md §0.6) — ไม่ใช่การวัดโหลด |
| bun test + CI (.github/workflows/ci.yml) | test anti-oversell: "concurrent enrollments never take more seats than the quota" + "concurrent holds never take more seats than the quota" (apps/registration/test/), idempotent checkout: "only the buyer pays; an open session is reused" (apps/payment/test/checkout.test.ts) + smoke test หลัง deploy จาก scripts/deploy.sh |
| k3d parity | local cluster ใช้ chart เดียวกัน (docs/TODO.md §0.6) |
| Chaos Testing / kill instance / บังคับ DB failover | ไม่มีใน repo (ตรวจ docs/ ทุกชุดไม่พบ) [ยืนยันแล้วว่าไม่ทำ] |
| Availability % / RTO / RPO | ไม่มีตัวเลขที่วัดและบันทึกไว้ [ไม่พบข้อมูล] |

## 7. โดเมน/HTTPS/ระบบเสริม (สถานะวันที่ 2026-10-25)

| หัวข้อ | สถานะ | หลักฐาน |
|---|---|---|
| Route 53 zone `eventide.creasy.club` | **ใช้งานแล้ว** (zone delegate จาก Cloudflare; ตรวจผ่าน DNS-over-HTTPS) | DNS SOA จาก awsdns; dns.tf |
| A/ALIAS record → NLB | ไม่มีอยู่วันนี้ (platform ถูกทำลาย ทุกครั้งต้อง make up ใหม่) | dns auto.tfvars (ไม่ได้ commit) |
| ACM cert | สร้างร่วมกับ zone (dns.tf), NLB TLS listener ใน nlb.tf | ต้องยืนยันอีกชั้นหลัง make up |
| Google sign-in | **เปิดใช้งานแล้ว** | ยืนยันโดยทีม 2026-10-25 (Better Auth รองรับอยู่ที่ apps/auth) |
| Stripe payment / webhook | **เปิดใช้งานแล้ว** | ยืนยันโดยทีม 2026-10-25 — endpoint https://eventide.creasy.club/api/payment/webhook |
