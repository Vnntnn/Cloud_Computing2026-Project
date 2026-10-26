# (B) วิเคราะห์ 6 เสาหลัก — AWS Well-Architected

สีของเสา: OpEx=ฟ้า · Perf=ส้ม · Reliability=เขียวสด · Sustainability=เขียวอมฟ้า · Security=เทาเข้ม · Cost=ม่วง

## B.1 Operational Excellence (ฟ้า)

- ความหมายในโปรเจกต์นี้: ระบบให้ระดับ Ops ที่ทำให้ทีมเล็ก (1 คน) จัดการ microservices บน EKS ได้ทุกวันโดยไม่กลายเป็นงาน manual
- ทำได้จริง: Terraform root เดียวทั้ง infra (apply/destroy ซ้ำได้) · Helm chart เดียวใช้ทั้ง k3d และ EKS · make deploy = build 7 images + 4 Secrets + migrate hook · CI 3 jobs (check / images / deploy) ใน .github/workflows/ci.yml
- หลักฐานผลจริง: EKS GATE 2026-10-24 สร้างคลัสเตอร์จากศูนย์และ deploy สำเร็จ; k3d parity GATE ผ่าน; db-migrate hook รันก่อน rollout ทุก deploy
- ตรงกับหลัก AWS: Operate as code · Frequent, small, reversible changes · Anticipate failure
- ช่องว่าง: ไม่มี alerting/runbook ตอนเกิดเหตุ · Container Insights ปิดทั้งแต่แรก (lab ปฏิเสธ AttachRolePolicy, 2026-09-07) · ไม่มี rollback rehearsal และ helm --atomic ยังไม่ตรวจ
- ระดับความมั่นใจ: **ครบถ้วน** (ในระดับโปรเจกต์เรียน)

## B.2 Performance Efficiency (ส้ม)

- ความหมาย: รองรับผู้ใช้พร้อมกันด้วย cache, autoscale, และทางเลือก runtime ที่เบา
- ทำได้จริง + ตัวเลข (วัด 2026-09-07 บน EKS, node 2×t3.medium, path GET /api/events เท่านั้น): HPA ของ service `event` — CPU target 60%, min 2, max 8 — 2→3→5→7→8 กลับ 8→6→4→2 · k6 98,500 requests, 226.4 req/s, p95 430.56 ms, ผ่าน 99.89% (fail 0.10%) · Redis cache (event detail 5 นาที, session introspect 60 วินาที) · WebSocket live seats (recount ทุก 250 ms + resync 30 วินาที) · Bun compile รูปเล็ก
- ตรงกับหลัก AWS: Match supply with demand · "Stop guessing capacity" (ประมาณจำนวน pod/node 30+ ก่อน แล้ววัดจริงด้วย k6)
- ช่องว่าง: load test กระแสหลักเฉพาะ read path /api/events ยังไม่ทดลอง booking path · ไม่มี CDN · Redis ไม่ได้ persist
- ระดับความมั่นใจ: **ครบถ้วน** (มีตัวเลขเอาไว้โต้แย้งได้)

## B.3 Reliability (เขียวสด)

- ความหมาย: ระบบต้องกู้คืนได้ เมื่อ pod ตาย/hold หมดอายุ/เมลล้มโดยไม่มีคนกดปุ่ม
- ทำได้จริง: node กระจาย 3 AZ · HPA · NLB L4 · liveness probe ห้ามแตะ DB (กัน DB blip ทำ pod รีสตาร์ททั้งเว็บ) · SQS retry + DLQ (5 ครั้ง) · effectiveStatus() อ่านสด ทำที่นั่งคืนทันทีโดยไม่ต้องมี cron · Stripe /checkout/verify ปิดเหตุที่ webhook เสีย (self-heal) · nightly rebuild = ซ้อม recovery ทุกวัน (วัด 2026-09-07: make down 8m56s / make up 16m37s / 25 resources, จำนวนตรงโครงปัจจุบัน — ต่างกันแค่ขั้นหลังจบเป็น db-migrate hook)
- ตรงกับหลัก AWS: Automatically recover · Test recovery procedures (rebuild จากศูนย์ทุก session คือ rehearsal) · Horizontal scaling
- ช่องว่าง (พูดตรง): RDS multi_az=false และ backup=0 · ไม่มี Chaos Testing / kill instance / บังคับ DB failover · ไม่มี RTO/RPO · Redis เดี่ยวไม่มี HA
- ระดับความมั่นใจ: **บางส่วน** — กลไกอยู่ แต่การพิสูจน์ด้วยการทำลายระบบยังหายไป

## B.4 Sustainability (เขียวอมฟ้า)

- ความหมาย: บริโภค resource เฉพาะเท่าที่จำเป็น — ที่นี่พิสูจน์ด้วยการทำลายเมื่อไม่ใช้
- ทำได้จริง: make down จบทุกเซสชัน (platform อยู่เฉพาะตอนใช้) · node เล็กที่สุดที่พอ (t3.small) · HPA ย่อลงเมื่อโหลดลด (evidence กลับ 8→2) · dev ใช้ k3d + MinIO + ElasticMQ ในเครื่อง ไม่กิน AWS ตอนไม่ได้เดโม · images เล็ก (Bun slim/compile) ลดแบนด์วิดท์ push
- ตรงกับหลัก AWS: Match supply with demand · Maximize utilization · Sustainable building blocks
- ช่องว่าง: ไม่มี automation ตั้งเวลา teardown · ไม่วัดและรายงานเมตริก sustainability · region us-east-1 (ไม่วิเคราะห์ปริมาณ carbon)
- ระดับความมั่นใจ: **บางส่วน** — อนุรักษ์ด้วยการจัดการต้นทุนเป็นหลัก ยังไม่มีเมตริก

## B.5 Security (เทาเข้ม)

- ความหมาย: identity + การแบ่งสิทธิ์ให้ทุกบทบาท และการปิดทางเข้าที่ไม่จำเป็น
- ทำได้จริง: Better Auth cookie session + server-side introspection; การเปลี่ยนบทบาท/แบน ระงับ session ทันทีด้วย databaseHooks · RBAC (user/organizer/admin) + ownership macro (organizer แตะเฉพาะงานตนเอง) · S3 bucket policy เปิดเฉพาะ public/* (ทดสอบจริง 200/403) · RDS ต่อได้เฉพาะจาก node SG, ไม่ publicly accessible · Secrets ผ่าน Secrets Manager + k8s Secret per-service (ESO ปิด เหตุผลบันทึกไว้) · ใช้ Stripe sandbox; live key ถูกปฏิเสธถ้าไม่ prod
- ตรงกับหลัก AWS: Strong identity foundation · Least privilege · Protect data in transit — **HTTPS มีแล้ว**: zone `eventide.creasy.club` (ตรวจ DNS 2026-10-25) + ACM ที่ NLB (dns.tf + modules/platform/nlb.tf)
- ช่องว่าง (ต้องพูดตรง): ไม่มี WAF/Shield/GuardDuty/X-Ray · เครดิต session ใน k8s Secret หมดอายุเอง (trade-off ยอมรับได้ในสภาพ lab) · ยังไม่เปิด rate-limit ตาม Better Auth (ต้องยืนยัน) · Google sign-in + Stripe ชำระเงิน: **เปิดใช้แล้ว** (ยืนยันโดยทีม 2026-10-25 — จุดแข็งที่เพิ่มล่าสุด)
- ระดับความมั่นใจ: **บางส่วน** — identity/ระดับสิทธิ์แข็ง network/TLS ยัง open

## B.6 Cost Optimization (ม่วง)

- ความหมาย: ระบบทุกข้อมูลกลุ่มอยู่ใน $50 ตายตัว ต้องมีวินัยทั้งการตั้งค่าตัวเอง
- ทำได้จริง + ตัวเลข (คำนวณใหม่รายชิ้น 2026-10-25, แก้ตัวเลขเก่าที่ไม่ลงตัวกับผลรวม): EKS control plane $0.100/ชม. · NLB $0.023/ชม. · RDS db.t3.micro $0.018/ชม. (รวม storage 20GB) · node 2×t3.small $0.0416/ชม. (ปกติ) หรือ 2×t3.medium $0.083/ชม. (ครั้ง load test) → **รวม $0.18/ชม. ขึ้นเคลื่อน ($0.23/ชม. ตอน load test)** · ค้างคืน ~$3.40/วัน (EKS 2.40 + NLB 0.54 + RDS 0.43 — EC2 ให้ lab ปิดเอง; ตรงกับ SYSTEM-DESIGN §11) · เซสชัน 4 ชม. ≈ $0.73–0.90 ไม่ใช่ $1.10 เดิม · ตัด NAT gateway และ Prometheus/Grafana ตั้งแต่ต้น · ritual check-lab.sh + ดูเครดิตต้น/ท้ายเซสชัน
- ตรงกับหลัก AWS: Adopt consumption model · Stop spending on undifferentiated heavy lifting (RDS ตัวเดียวแทน 4, ไม่มี NAT) · Measure efficiency (รู้ตัวเลขจ่ายก่อน/หลัง)
- ช่องว่าง: ไม่มี budget alert อัตโนมัติ (อาจตั้งไม่ได้ในห้องเรียน) · ค่า Data Transfer OUT ของ S3/NLB ยังไม่โดนวัดแยก · ตัวเลขทั้งหมดเป็นคำนวณจากราคาออนดีมานด์ ยังไม่มีค่าที่มาจาก credit meter — ห้ามโยงเป็น '$25 actual'
- ระดับความมั่นใจ: **ครบถ้วน** — ต้นทุนถูกออกแบบเป็นตัวเลขเดิม

## B.7 ตาราง Matrix: เสา x บริการ/กลไก

| เสา | บริการ/กลไกสำคัญ | จุดแข็ง/จุดอ่อน |
|---|---|---|
| OpEx (ฟ้า) | Terraform + Helm + CI 3 jobs + k3d parity | แข็ง — deploy ระดับ production-reproducible |
| Perf (ส้ม) | HPA (target 60%) + Redis cache + WebSocket + k6 evidence | แข็ง — มีตัวเลขวัดจริง 2026-09-07 (read path เท่านั้น) |
| Reliability (เขียวสด) | probe/SQS DLQ/hold expiry/rebuild-ritual | บางส่วน — กลไกมีอยู่แต่ **ยังไม่ทำ chaos test + Multi-AZ + ไม่มี backup** |
| Sustainability (เขียวอมฟ้า) | make down, HPA, local dev | บางส่วน — อนุรักษ์ดี แต่ยังไม่มีเมตริก |
| Security (เทาเข้ม) | Better Auth + RBAC + S3 policy + SG | บางส่วน — app-level แข็ง, network/HTTPS ยังระงับ |
| Cost (ม่วง) | Cost model + teardown ritual | แข็งที่สุด — ทุกตัวเลขคำนวณรายชิ้นได้ (ยังไม่มี credit-meter วัดจริง) |

สรุปกลุ่ม: **ครบถ้วน** = Cost · OpEx · Performance — **บางส่วน** = Reliability (ไม่มี chaos/RTO) · Sustainability (ไม่มีเมตริก) · Security (ไม่มี WAF/GuardDuty)
