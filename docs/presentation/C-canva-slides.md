# C-canva-slides.md — ซับเท็กซ์ต่อสไลด์ (ฉบับแก้ไข รอบสอง, 2026-10-25)

**13 สไลด์ / ~18 นาที** (เว้นเผื่อ Q&A + demo ~2 นาที)

## การเปลี่ยนแปลงจากฉบับ 14 สไลด์

| เดิม | ใหม่ | เหตุผล |
|---|---|---|
| 9 (Sustainability) + 11 (Cost) | **9 รวมเป็นสไลด์เดียว** "Sustainability + Cost" | เสาเดียวกันทางกลไก (ทั้งคู่หลุดแขนงที่ "ตัด/ทำลายทรัพยากรเมื่อไม่ใช้") — ลดเวลา 1.4 นาที |
| 10→10, 12→11, 13→12, 14→13 | เลขใหม่เรียงตามลำดับ | เมื่อรวมสไลด์แล้วเหลือ 13 |
| ทั้งชุด | เวลารวม 19 → **~18 นาที** | วัดจากรายสไลด์ด้านล่าง |

ข้อเท็จจริงที่อัปเดตใหม่ทั้งชุด:
- **โดเมน https://eventide.creasy.club/** พร้อมใช้ + **Google sign-in และ Stripe ชำระเงินเปิดใช้แล้ว** (ยืนยันโดยทีม 2026-10-25; Route 53 zone ตรงจากการตรวจ DNS — platform ถูกทำลายเมื่อจบเซสชัน ต้อง `make up` ก่อนเดโมทุกครั้ง)
- ตัวเลขต้นทุนคำนวณใหม่แบบรายชิ้น (ดูสไลด์ 9) — ตัวเลข $0.27/hr + $1.10/session ใน SYSTEM-DESIGN §11 ไม่ลงตัวกับผลรวมองค์ประกอบ จึงไม่ใช้อีก
- k6 / HPA (สไลด์ 11): วัด 2026-09-07 · node t3.medium ครั้งวัด · แค่ read path `/api/events` · ห้ามปนกับ EKS GATE 2026-10-24

## กฎการออกแบบ (คงเดิม)

- **สร้างสี 6 เสา** ใช้เหมือนเดิมทุกสไลด์ — Operational Excellence (ฟ้า `#1F7BC0`), Performance Efficiency (ส้ม `#E8830C`), Reliability (เขียวสด `#2E9E3E`), Sustainability (เขียวอมฟ้า `#1FA88A`), Security (เทาเข้ม `#3D4451`), Cost Optimization (ม่วง `#7B4FD0`)
- สไลด์เสา 1 ต้น = ไฮไลต์เฉพาะ "ชิ้นสถาปัตยกรรมที่เกี่ยว" ด้วยเส้นขอบสีเสานั้น, ส่วนที่เหลือปรับความสว่าง ~40% — ใช้ไดอะแกรม as-built ชุดเดียวซ้ำทุกสไลด์ ไม่วาดใหม่
- ระวังเรื่องข้อมูลบนหน้าจอ: ห้ามให้ NLB DNS `*.elb.amazonaws.com` ปรากฏบนภาพถ่ายจริง (แคปแล้วปกด้วยป้าย "production host: eventide.creasy.club")
- ตัวเลขพูดแล้วต้องมีแหล่ง — ใช้ "[ไม่พบข้อมูล — ต้องยืนยัน]" ถ้าไม่พบไฟล์จริง

---

## สไลด์ 1/13 — หน้าปก (~0.5 นาที)

**Headline:** Eventide · เว็บขายตั๋วบน AWS ที่เปิดใช้จริง

**Body:**
- เว็บจริง: https://eventide.creasy.club/ — **Google sign-in และ Stripe ชำระเงินเปิดใช้แล้ว** (ยืนยันโดยทีม 2026-10-25)
- ชื่อทีม / รายชื่อสมาชิก / วิชา Cloud Computing 2026
- 7 images · 4 microservices · ราคา ~$50/งบทั้งเทอม

**Key number:** 7 images · 4 microservices · $50 budget cap

**Speaker notes:**
เปิดเปล่า: "Eventide ได้ deploy ไป EKS จริงด้วย Terraform และเว็บถูกเปิดใช้ที่ https://eventide.creasy.club/ — ระหว่างเซสชันที่ระบบถูกทำลายไว้ ต้องตั้งค่า `make up` ก่อนเดโมจึงเห็นเว็บ" (พฤติกรรม "ทำลายทุกคืน" เป็นข้อบังคับงบ)

**คำถามกรรมการที่ควรเตรียม:** ทำไมเลือก EKS ไม่ใช้ ECS/Lambda?
- ตอบ: โจทย์บังคับ microservices กลุ่มคลัสเตอร์ + lab ปฏิเสธไม่ให้ระบุ (`aws_eks_*` สร้างได้) ที่ docs/PROJECT-KNOWLEDGE-BASE.md

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ครึ่งขวา | ภาพหลัก | screenshot เว็บจริงจาก https://eventide.creasy.club/ (ไม่ใช้ภาพ `*.elb.amazonaws.com`) | เว็บ production ต้อง `make up` เสียก่อน | ~50% | "เว็บจริง (2026-10 วันเดโม)" | ต้องแคปเพิ่ม |
| มุมซ้ายบน | โลโก้/ไอคอน | Eventide logo | วาดใน Canva | เล็ก | — | ต้องวาดใหม่ |
| แถบล่าง | ไอคอน 3 ตัว | k8s, AWS, Terraform | Canva elements | เล็ก | — | วาดใน Canva |

---

## สไลด์ 2/13 — ปัญหาและโซลูชัน (~1.5 นาที)

**Headline:** ขายตั๋วต้องไม่ขายเกิน โกงไม่ได้ ระบบไม่พัง

**Body:**
- ปัญหา: ขายเกินโควตา, ผ่านการอนุมัติ, จ่ายแล้วไม่ได้ตั๋ว, ระบบล้นเมื่อ hotchg เรียกตัวเองผิด
- **4 บทบาท** (นับ Guest): เอื่อยแบบเย็นกลุ่มและกลุ่มแท้กลุ่มที่กรรมการคุ้นเคย (Guest / user / organizer / admin)
- อุดกันขายเกินตรงจุดเสี่ยงสุด (enroll): `SELECT … FOR UPDATE` + `seat_holds`
- จ่ายผ่าน Stripe Checkout — **เปิดใช้แล้ว** (ยืนยันโดยทีม 2026-10-25) · เมลผ่าน SQS + mail-worker
- 4 microservices แยก process ต่าง port: auth 3001 / event 3002 / regis 3003 / payment 3004

**Key number:** 4 บทบาท ที่คุมพฤติกรรมทั้งเว็บ · พวงที่สำคัญคือ seat-guarantee

**Speaker notes:**
เล่าแบบเรื่องเล่า: ที่นั่งต้องถือ tag เดียวกันไม่ว่าใคร "cold-check" กันขายเกินที่จุดที่เสี่ยงสุด คือ enroll ซึ่งล็อกแถว ticket_types ใน postgreSQL ก่อนนับที่นั่ง — Guest ยังเข้า web ได้ แต่ไม่มีสิทธิ์อื่น

**คำถามกรรมการ:** กันขายเกินยังไง?
- ตอบ: tx ล็อกแถว ticket_types (`SELECT … FOR UPDATE`) + ตาราง `seat_holds` + maxPerUser — พิสูจน์ด้วย test "concurrent enrollments never take more seats than the quota" (apps/registration/test/enrollment.test.ts)

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ซ้ายกลาง | ภาพหลัก | 4 การ์ดบทบาท Guest / user / organizer / admin | Canva | ~35% | "4 บทบาท 1 บัญชี" | วาดใน Canva |
| ขวาบน | ภาพจริง | screenshot event-detail หน้าตั๋วครบทุกประเภท | ต้องแคปผ่านเว็บ production (เตรียมบัญชี test ใช้รับรู้เห็นจริง) | ~30% | "first_come / approval / invite" | ต้องแคปเพิ่ม |
| กรอบล่าง | ไอคอน | lock, clock, ticket, mail | Canva | เล็ก | — | วาดใน Canva |

---

## สไลด์ 3/13 — ข้อจำกัด Learner Lab (~1.5 นาที)

**Headline:** ตีกรอบ $50: ทุกข้อจำกัดมีเหตุผลจากการ probe

**Body:**
- งบ $50 เข้มงวด เก็นบัญชีถูกระงับ → destroy/rebuild ทุกเซสชัน
- เซสชัน 4 ชม. หมดอายุ: S3 ใช้ session creds → `make deploy` ทุกเซสชัน
- IAM ถูกปฏิเสธ: ไม่สร้าง IAM Role / OIDC / ติด policy / CloudFront
- ไม่มี NAT gateway — default VPC, subnets pin 3 AZ us-east-1
- โดเมนมีแล้ว: zone `eventide.creasy.club` ทำงานที่ Route 53 (ทำงานแบบ delegated จาก Cloudflare) — ACM ติด NLB อัตโนมัติทุก `make up`

**Key number:** $50 cap · 4 ชม./เซสชัน · rebuild จากศูนย์ 25 รายการ

**Speaker notes:**
สไลด์นี้ป้องกันคำถาม "ทำไมไม่ใช้ X" — ทุกข้อมีหลักฐานระบุเอกสารใน docs/lab-probe-2026-09-0{6,7}.txt และ docs/PROJECT-KNOWLEDGE-BASE.md; ขอเน้นแถวสุดท้าย: โดมีนมีแล้ว (ต่างจากแพะ 2026-10-24 ที่ยังไม่มี) แต่หลังจบเซสชัน platform ถูกทำลาย ทำให้ทุกครั้งต้อง `make up` + ACM แนบใหม่ตามระบบย่อ

**คำถามกรรมการ:** ถ้าเป็น production ต้องเติมอะไร?
- ตอบ: IRSA (แทนจับ session creds), NAT gateway, CloudFront, monitoring แบบ alert ไปที่มือถือ

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ซ้าย | ตัวเลขใหญ่ | "$50" เด่นที่สุดของสไลด์ | Canva text | ~40% สูง | "งบเพดาน" | วาดใน Canva |
| ขวา | ตาราง 2 คอลัมน์ | "อยากใช้ → ข้อจำกัดจริง" 5 แถว | Canva จาก lab-probe | ~50% | "จากการ probe จริง 2026-09-06/07" | วาดใน Canva |
| กรอบล่าง | ไอคอน | money-off, key, globe | Canva | เล็ก | — | วาดใน Canva |

---

## สไลด์ 4/13 — สถาปัตยกรรม As-Built (~2 นาที) ★สไลด์แกน

**Headline:** แผนที่จริง: Terraform → EKS → RDS/S3/SQS

**Body:**
- Terraform 1 root: EKS + RDS + NLB + SQS + ECR + S3 (+ Route 53 ที่ dns.tf)
- 7 images: web, auth, event, regis, payment, mail-worker, db-migrate (+ Redis เป็น pod ล้วน ๆ ใน chart)
- traffic: NLB (TLS จาก ACM) → ingress-nginx NodePort → Ingress 2 ชุด (API / files→S3)
- Postgres = RDS db.t3.micro หนึ่ง instance นอกคลัสเตอร์ / Redis = pod ในคลัสเตอร์
- CI: push สาขา main → GitHub Actions → ECR → helm upgrade (migrate รันก่อนทุกครั้ง)

**Key number:** 25 resources เท่ากันทุกครั้งที่สร้างชุดเดิม (modules/platform 23 + 2 helm releases)

**Speaker notes:**
ใช้ไดอะแกรม as-built เป็นภาพหลักและนำมาใช้ต่อในทุกสไลด์เสา — จุดขาย: ออกแบบตามข้อจำกัดจริง เพิ่มเติมเองแบบให้กรรมการถามว่า "ทุกชุดในแผนภาพเกิดจากการ apply ได้แน่หรือไม่" ตอบตรง ๆ: ของระดับ infra (NLB/RDS/SQS ฯลฯ) มี .tf รองรับ, แหล่ง pods (รวม Redis) ใหญ่หลังจากไฟล์ Helm เพราะ Helm เป็นตัว deploy (เพื่อความสม่ำเสมอ ไม่ลืมในขณะถาม) — พูดว่า "สิ่งที่ระบุด้วย infra ล้วนย้อนกลับใน git หมด" ข้อความแบบนั้น

**คำถามกรรมการที่ควรเตรียม:**
- ทำไมใช้ RDS ตัวเดียว ไม่แยกฐานข้อมูลราย service? - ตอบ: (1) ต้นทุน — db.t3.micro ทำ RDS ต่อ service ไม่ทันจริง ≈87 connections ของ single micro ต้องระวังทุก instance (DB_POOL_MAX=4/pod) จึงปฏิเสธแบบเดิม; (2) โมเดลเกม: services ใช้ table กันข้าม (ผู้ซื้อ = FK โยง users กรองอย่างแยกเฉพาะชุด) จึงโยงกันถึงที่, (3) ง่ายต่อ migrate: hook เดียวกัน ไม่ต้อง sync หลาย DB

- Session พังถ้า pod ตาย? - auth-guard ทำ introspection แล้ว cache Redis 60 วินาที การ reconnect จะทำงานต่อเอง

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| เต็มพื้น | ภาพหลัก | ไดอะแกรม as-built เต็มสไลด์ (แสดง RDS อยู่นอกคลัสเตอร์ + Route 53 ถ้ามี) | `docs/architecture/aws/eventide-aws-as-built.png` | ~70% | "As-Built (ของจริง)" | พร้อมใช้ ★ |
| มุมขวาล่าง | สติกเกอร์ | Terraform + Helm + k8s | Canva | เล็ก | — | วาดใน Canva |

---

## สไลด์ 5/13 — แผนที่ 6 เสา (~1 นาที)

**Headline:** ตรวจ 6 เสา: ครบถ้วน 3 · บางส่วน 3

**Body:**
- **ครบถ้วน** (มีของ + มีหลักฐาน): OpEx · Perf · Cost
- **บางส่วน** (กลไกอยู่ แต่ยังพิสูจน์/วัดไม่ครบ): Reliability · Security · Sustainability
- ทุกข้อคุยได้: ข้อดีให้ไฟล์, ข้อเสียบอกพร้อมทางแก้ที่ตัดไว้ทำไม
- สไลด์ที่ 6–10 = 1 เป้ามี 1 ต้น (สไลด์ 9 รวม 2 เสา Sustainability + Cost)

**Key number:** ตารางแบ่ง 2 กลุ่ม ตาม B ยกมาตรฐานจาก B.1–B.7

**Speaker notes:**
สไลด์บอกกรรมการว่าเราให้ประเมินตัวเองเป็น "ครบถ้วน/บางส่วน" ไม่ใช่เปอร์เซ็นต์ เที่ยงธรรมเพราะ 6 เสาใช้มาตรฐานต่างกัน ติดคำตอบของกลุ่ม "บางส่วน" ไว้เลย เช่น "ไม่มี chaos / RTO — เตรียมเลื่อนเป็นตัวเต็มเชิงวิศวกรรม repo ได้" — ห้ามทำเป็น % (ไม่มีข้อมูลให้เอาตั้งเดิมทำ)

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| แนวนอนกลาง | ภาพหลัก | temple เสา 6 ต้น 2 กลุ่ม: 3 สีเข้มทึบ (ครบถ้วน) เทียบ 3 สีอ่อน (บางส่วน มี "สลักประกอบ" ระบุช่องว่าง) | Canva วาดตาม B.1–B.7 | ~60% | "แบ่งตามระดับความมั่นใจใน B" | วาดใน Canva ★ |
| ใต้เสา | ป้าย tag สั้น | OpEx "ทำซ้ำได้" · Perf "มีเลข k6" · Cost "คุม $50" · Reliability "ไม่มี chaos/RTO" · Security "ไม่มี WAF/GuardDuty" · Sustainability "ไม่มีเมตริก" | Canva | เล็ก | — | วาดใน Canva |

---

## สไลด์ 6/13 - Operational Excellence (ฟ้า #1F7BC0) (~1.4 นาที)

**Headline:** ทำซ้ำได้ทั้งระบบ ไม่ต้องมีทีม ops

**Body:**
- แพลตฟอร์มทั้งก้อนเป็น code ที่ git ตรวจได้ ( Terraform + charts )
- `make deploy` รันชุดเดียวจบ: สร้าง 7 images ที่ ECR → อัปเดต k8s Secrets → helm upgrade
- migrate รันก่อน pods ทุกครั้งผ่าน Helm pre-upgrade hook (`db-migrate`)
- CI: test + build ทุก PR, push main เปิด deploy เอง (เมื่อ credentials หมดอายุ job ข้ามเอง)
- ช่องว่าง: ไม่มี runbook ที่เป็นทางการ [ไม่พบข้อมูล — ต้องยืนยัน]

**Key number:** 3 นาที `helm upgrade` ทำงานทุกส่วน (อ้าง ci.yml + scripts/deploy.sh)

**Speaker notes:**
หัวใจเสานี้คือ "ผู้ดูแลคนเดียวทำซ้ำได้" — ทุกขั้นเป็นไฟล์ที่อ่านได้แม้โดยกรรมการ: Terraform สำหรับแพลตฟอร์ม, Helm สำหรับ pods, Makefile เป็นหน่วยของมนุษย์ ทำให้ rollout ไม่หิวของคำนิยามง่าย ๆ: `db-migrate` hook คือ merge หนึ่งครั้ง = ระบบถูก update ตาม

**คำถามกรรมการที่ควรเตรียม:** ถ้าลืม `make down` เกิดอะไรขึ้น?
- ตอบ: ต่ำในวันถัดไป session หรือ lab auto-stop จะตัด EC2 (แต่ EKS + RDS + NLB คิดเงินต่อ ~$3.40/วัน) — สรุปเป็นความเสี่ยงเวลา

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ขวากลาง | ภาพหลัก | terminal แสดง logs make deploy ที่ push 7 images + helm success สำเร็จ | session log | 45% | "1 คำสั่ง = deploy ทั้งเคลสเตอร์" | ต้องแคปเพิ่ม |
| ใต้ภาพ | ไอคอน | Terraform, Helm, GitHub | canva elements | เล็ก | - | วาดใน canva |

---

## สไลด์ 7/13 - Performance Efficiency (ส้ม #E8830C) (~1.4 นาที)

**Headline:** เครื่องจริงทดสอบแล้ว: 226 req/s ขึ้นเคลื่อน

**Body:**
- k6 (วัด 2026-09-07): 98,500 requests, 226.4 req/s, ผ่าน 99.89%, p95 430.56 ms
- HPA ของ service `event` (apps/event) ขยายด้วยตัวเอง 2→8 pods ตามพิโกรธ CPU >60% (และกลับลงเอง)
- cache: session 60 วินาที (auth-guard), event detail 5 นาที (Redis) - ลดการถาม RDS ซ้ำ
- WebSocket แจ้งที่นั่งสด: นับใหม่รอยละ 250 ms + resync 30 วิ (deployment ยกมาจาก repo)
- ตัวเลขมาจาก node t3.medium + test เฉพาะ read path `/api/events` - booking path ยังไม่ได้ทดสอบ

**Key number:** 226.4 req/s p95 430.56 ms HPA 60% CPU target

**Speaker notes:**
ขอเน้นคำล้อ: "ตัวเลขนี้วัดจริง 2026-09-07 บน EKS (node t3.medium)" - มาจากไฟล์ `docs/autoscaling-evidence.txt` ซึ่งกรรมการสามารถไปตรวจได้ - ยืนยันเองแล้วว่า test เป็นแค่ GET /api/events ฉะนั้น booking ยังต้อง scale ด้วยวิธีอื่น: ใช้ lock ใน DB ป้องกัน, ยังไม่วัดตัวเลขของ path นั้น; ทดสอบได้อีกขั้นหลังเทอม

**คำถามกรรมการที่ควรเตรียม:**
- ทดสอบใน production/จริงหรือไม่? - ทดสอบเป็นพื้นฐาน ไม่มีของระดับ global, ใช้ CPU 60-80%(high) + สั่งจาก SPAs ที่ไม่สวยแยกไว้น้อย

- ผลคำตอบที่จบไม่ 100%? - 15.0%(ค่าเดิม)-แสดง 0.10% fail (198/197,000)ระบุที่มามาจาก check ที่เสียในไฟล์ evidence

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| กลางสไลด์ | กราฟหลัก | แผนภาพมุม `HPA นับ pod: 2-3-5-7-8 แล้วกลับ 8-6-4-2` แกนสองตัวเลข CPU วัด | canva วาดจาก docs/autoscaling-evidence.txt | 45% | "HPA ทำงานจริง วัด 2026-09-07" | ต้องวาดใหม่ |
| ขวาบน | badge | 226 req/s · p95 430 ms | canva text | เล็ก | - | วาดใน canva |
| ขวาล่าง | ไอคอน | bolt, gauge | canva | เล็ก | - | วาดใน canva |

---

## สไลด์ 8/13 - Reliability (เขียวสด #2E9E3E) (~1.4 นาที)

**Headline:** pod ล้ม = ระบบช่วยตัวเอง / DB ล้ม = ยังไม่กันได้

**Body:**
- k8s health probe: daemon ตรวจ endpoint HTTP ที่ไม่แตะ RDS (กัน blip ระเบิดเป็น restart ทั้งคลัสเตอร์) [ไม่มี chaos ทดสอบ]
- ซ้อมกู้คืนทุกเซสชัน: `make down` 8m56s · `make up` 16m37s · 25 resources จากศูนย์ (วัด 2026-09-07 ใน REPORT.md; จำนวน resource ตรงกับโครงปัจจุบัน ขั้นที่ต่าง: migrate ย้ายเป็น db-migrate hook)
- RDS: multi_az=false + backup=0 → "ไม่มี backup จึงกู้ข้อมูลไม่ได้ (RPO ไม่มีขอบเขต)"
- SQS + DLQ: เมลส่งไม่สำเร็จ retry แล้วแตกคิว DLQ (5 ครั้ง)
- Availability %, RTO, RPO: **[ไม่พบข้อมูล]** ไม่มีการวัดจริง

**Key number:** rebuild จากศูนย์ ~25 นาที (ลบ 8m56s + ขึ้น 16m37s) - แต่ไม่ใช่ RTO ของ RDS

**Speaker notes:**
สไลด์ซื่อสัตย์สุดของชุด: กลไก k8s ระดับ pod กันได้ ลองที่ระดับ data ยังไม่มี ตัวเลข rebuild ตาม REPORT §; ย้ำแบบจับต้องได้: จำนวน 25 resources ตรงกับโครงปัจจุบัน (module รวม 25) แต่ barcode ที่ต่างคือขั้นตอนหลัง apply ย้ายเป็น db-migrate hook แทน db-bootstrap เดิม - และย้ำให้ชัด: ตัวเลขชุดนี้คือความเร็ว rebuild platform ทั้งก้อน ไม่ใช่ RTO ของ RDS

**คำถามกรรมการที่ควรเตรียม:**
- RDS โดนแล้วระบบเป็นอย่างไร? - ทุก service พังทันที (health ตั้งไม่ให้แตะ RDS เพื่อไม่ดึง pod ทั้งหมดสู่ restart จากนั้น)
- ปรับแก้ที่ไหนก่อน? - เปิด backup_retention ก่อน (ถูกกว่า multi-AZ) แล้วจึง multi-AZ = true

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ขวากลาง | ภาพหลัก | ไดอะแกรมเรียบ: pod ตาย arrow k8s เปิดใหม่ + RDS เป็นเงาเทาแสดงว่ายังไม่มีกลไกกู้ | canva | 45% | "pod self-heal / RDS ยังไม่มีเขียนตาม" | วาดใน canva |
| ขวาล่าง | ป้ายเลข | "down 8m56s / up 16m37s / 25 resources (2026-09-07)" | canva text | เล็ก | - | วาดใน canva |

---

## สไลด์ 9/13 - Sustainability + Cost (เขียวอมฟ้า #1FA88A + ม่วง #7B4FD0) (~2 นาที) [รวม 2 เสา]

**Headline:** จ่ายเมื่อใช้ ล้างเมื่อเลิก: ต้นทุนที่คำนวณแยกชิ้น

**Body:**
- **ต้นทุนต่อชั่วโมง (คำนวณจากราคาแยกรายชิ้น, us-east-1):**
  · EKS control plane **$0.100/ชม.** (ปิดไม่ได้ — ลบกลายเป็นตัวตัด) `[คำนวณ]`
  · NLB **$0.023/ชม.** · RDS db.t3.micro **$0.018/ชม.** (รวม storage 20 GB) `[คำนวณ]`
  · node 2 × **t3.small** ($0.021/ชม. ต่อตัว) = $0.0416/ชม. ขึ้นเคลื่อน หรือสูงสุด 2 × **t3.medium** = $0.083/ชม. (ครั้ง load test)
- **รวมขึ้นเคลื่อน: $0.18/ชม.** (ตกแต่งจริง t3.small), **$0.23/ชม.** ตอนวัด load test — เทียบ 4 ชม. เซสชัน ≈ **$0.73–0.90**
- **ไว้ทิ้งค้างคืน: ~$3.40/วัน** (EKS $2.40 + NLB $0.54 + RDS $0.43 — lab ปิด EC2 ให้เอง) `[คำนวณ, ตรงกับ SYSTEM-DESIGN §11]`
- ปิดยกกล่อง: `make down` จบทุกเซสชัน — platform=false ตัดค่าค้างทั้งก้อน, ตัด NAT / CloudFront / RDS ต่อ service / Prometheus ตั้งแต่ตั้ง
- ยอมเก็บยังไม่เทคแคร์: ยังไม่มีค่าจาก credit meter วัดจริง → ห้ามขาย "$25 actual"

**Key number:** $0.18/ชม. (ขึ้นเคลื่อนปกติ) · ~$3.40/วัน (ค้างคืน)

**Speaker notes:**
จุดต่างจากครั้งก่อน: เคยยกตัวเลข $0.27/hr + $1.10/session จาก SYSTEM-DESIGN §11 มาแบบตรง ๆ — ที่บัจจุบันยกคนละเต็ม รุปผลรวมรายชิ้นไม่ลงตัวกับบันทึกเดิม จึงเปลี่ยนเป็นคำนวณเองที่มีองค์ประกอบรายชิ้นแนบไว้; หน้าสนุกไม่เชิงคำนวณ: "การปิดระดับ Sustainability และประหยัดเงินใช้คำสั่งเดียวกัน คือ make down" กลไกทั้งสองเสาเป็นตัวเดี่ยว เลยไม่ waste สไลด์

**คำถามกรรมการที่ควรเตรียม:**
- ค่าใช้จ่ายต่อเทอมเป็นเท่าไร? - ตอบ: [ไม่พบข้อมูล — ไม่มีค่าวัดจาก credit meter] ตามประมาณเทอมที่คำนวณอยู่ในระดับ สิบเครื่องต่อ 4-ชม. หลายครั้ง
- ตกหล่นราคาถูกที่จากการทำงานใหม่ - คำตอบ: HPA ยังช่วยแต่ต้องขึ้น node ที่อุดตันตมต่อ instance

🖼️ **Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| กลาง | ภาพหลัก | ฝาสตัวเลข 3 ใบ: $0.100 (EKS) + $0.023 (NLB) + $0.018 (RDS) = $0.14 ขั้นต่ำ + node | canva วาด, ตัวเลขรายชิ้น | 45% | "ทำลายวัตถุระบบสาธารณะไม่เคยลืม" | วาดใน canva |
| กรอบล่าง | ไอคอน | dollar, drift, recycle | canva | เล็ก | - | วาดใน canva |

---

## สไลด์ 10/13 - Security (เทาเข้ม #3D4451) (~1.4 นาที)

**Headline:** ความปลอดภัยแยกชั้น: cookie + IAM + HTTPS

**Body:**
- auth (Better Auth) แยก service เดียว คนเดียวที่ถือ BETTER_AUTH_SECRET ไม่ลงโค้ด
- ทุก service ผ่าน auth-guard: introspection สด + cache 60 วินาทีใน Redis; แบน/เปลี่ยนบทบาท = ระงับ session ทันที (databaseHooks)
- RBAC (user / organizer / admin + Guest) + ownership macro: organizer แตะเฉพาะงานตัวเอง
- S3 policy เปิดอ่านเฉพาะ key `public/*` (ทดสอบจริง 200/403) · RDS ต่อได้เฉพาะจาก node SG, ไม่ publicly accessible
- HTTPS ทำงานผ่าน domain `eventide.creasy.club` + ACM ที่ NLB (ตรวจ DNS 2026-10-25) · **Google sign-in + Stripe webhook เปิดใช้แล้ว** (ยืนยันโดยทีม 2026-10-25)

**Key number:** 1 ช่องทางเข้า (NLB) ตรวจ cookie ทุกคำขอ

**Speaker notes:**
กรรมการมักถามเรื่องข้อมูลผู้ใช้ - จุดขาย: session ถูกตรวจสดทุกคำขอ (auth-guard), ไฟล์ใน S3 มีเพียง prefix public เท่านั้นที่เปิดให้อ่าน และ HTTPS ทำงานผ่าน ACM ที่ NLB ตามที่ dns.tf กับ modules/platform (nlb.tf TLS listener, route53.tf ALIAS) ออกแบบไว้ - เสานี้ยังมีช่องว่างจริง ๆ อยู่ที่: ไม่มี WAF/Shield/GuardDuty/X-Ray และเครดิต session ของ pod หมดอายุเองทุกเซสชัน (trade-off ของ lab)

**คำถามกรรมการที่ควรเตรียม:**
- secret เก็บไหน? - Secrets Manager (`eventide/*`) → deploy.sh สร้าง k8s Secret แยกตามหน้าที่ (auth / payment / mail-worker / common)
- token ของ pod ใช้อะไร? - session credentials ของ lab (S3 + SQS) หมดอายุทุกเซสชัน เลยต้อง `make deploy` ทุกครั้ง

**รูปภาพ - Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ขวากลาง | ภาพหลัก | ชั้นความปลอดภัยทีละขั้น: NLB (ACM) -> ingress -> auth-guard -> RDS/S3 bucket policy | canva วาดจาก architecture | 50% | "ประตูเดียว ตรวจ cookie ทุกคำขอ" | ต้องวาดใหม่ |
| ขวาล่าง | ไอคอน | lock, shield, key, s3 | canva | เล็ก | - | วาดใน canva |

---

## สไลด์ 11/13 - Test Results (~1.5 นาที)

**Headline:** วัดจริงสองครั้ง: load test กับ GATE เดโม

**Body:**
- **ครั้งวัดที่ 1 วันที่ 2026-09-07 (load test):** node 2 x t3.medium, path เดียว GET /api/events
  · k6: 98,500 requests, 200 VU, 226.4 req/s, avg 316.74 ms, p95 430.56 ms
  · fail = 0.10% (checks 198/197,000, http 99/98,500) - ผ่าน 99.89%
  · HPA ของ `event`: CPU target 60%, min 2 max 8 - เห็นทั้ง 2->8 และ 8->6->4->2
- **ครั้งที่ 2 อีกสิ่ง (ไม่ใช่ load):** EKS GATE 2026-10-24 - deploy จากศูนย์ผ่านครบหมวด (health, session, S3, เมล, admin, HPA metrics live)
- เก็บติดว่า: booking path (enroll/checkin) ยังไม่เคย load test - กัน oversell พิสูจน์ที่ test ไม่ใช่ load test

**Key number:** 226.4 req/s · fail 0.10% · HPA target 60% CPU

**Speaker notes:**
ให้แยกสองหลักฐานให้ชัด (1) load test 2026-09-07 สร้างเป็นตัวเลขประสิทธิภาพ เก็บใน docs/autoscaling-evidence.txt ที่ node t3.medium ทดที่ GET /api/events เท่านั้น (2) EKS GATE 2026-10-24 ทดสอบเจาะที่ความสามารถ deploy + ผ่าน user story ไม่ใช่ตัวเลขโหลด หลักการ HPA: เมื่อ CPU เฉลี่ยของ pods เกิน target 60% จะเพิ่มจำนวน replicas; ต่ำกว่า target ไปหนึ่งช่วงจะลดลง — เห็นทั้งข้า้ก้าน (2->8) และข้า้ลง (8->2) เครื่องวัดคือ metrics-server (deploy ด้วย kubelet-insecure-tls)

**คำถามกรรมการที่ควรเตรียม:**
- ปัญหาที่เจรในเซสชัน test นี้? - เริ่มหน้า 10 มี warning "failed to get cpu utilization" ช่วงแรก (metrics-server ยังไม่แห้ง) ช่วงหลังมาแล้ว เป็นข้อมูลจริง [ยืนยันใหม่ตามข้อ]
- booking path ยังไม่โดน load test - ตอบ: ยอมรับ จะต้องนำไป test เดิมเพิ่ม (POST /enroll, /checkin)

**รูปภาพ - Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| กลางซ้าย | กราฟหลัก | ขั้น pod HPA 2-3-5-7-8 กลับ 8-6-4-2 กำกับ CPU 60% | วาดใหม่ใน canva จาก docs/autoscaling-evidence.txt | 50% | "HPA วัดจริง 2026-09-07" | ต้องวาดใหม่ |
| ขวาบน | badge 3 ใบ | 226.4 req/s, fail 0.10%, p95 430 ms | canva text | เล็ก | - | วาดใน canva |
| ขวาล่าง | screenshot | kubectl logs สองจังหวะ: pod เพิ่ม/ลด (ตัด NLB DNS ออกก่อนใส่) | ถ่ายจาก session จริง | เล็ก | - | ต้องแคปเพิ่ม |

---

## สไลด์ 12/13 - ข้อจำกัดและทางต่อไป (~1.5 นาที)

**Headline:** ไม่ได้ทำเพราะอะไร และเติมคืนได้เมื่อไร

**Body:**
- Container Insights: ตั้ง **ปิด** ตั้งแต่ต้นเลย เพราะ CloudWatch agent ต้องขอ attach policy ที่ lab ปฏิเสธ (ยืนยันตั้งแต่ 2026-09-07) — ใช้ `kubectl top` + HPA log แทน
- ไม่มี Chaos Testing, ไม่ได้วัด RTO/RPO และ Availability (คิดว่าไม่พอเวลา + งบ RDS)
- เดิม "ไม่มีโดเมน" ไม่ใช่ข้อจำกัดแล้ว: dns.tf ถูก apply เป็น zone `eventide.creasy.club` (ตรวจ DNS 2026-10-25) — แต่ทุกเซสชันเริ่มเดโมต้อง `make up` ก่อน เว็บจึงออนไลน์

**Key number:** เลิกพูด 'ไม่มี HTTPS' — ข้อจำกัดที่เหลือจริง: ทำลายทุกคืนตามงบ

**Speaker notes:**
ข้อสรุป: ข้อจำกัดจริงเหลือเท่านี้ - ระบบถูกทำลายทุกคืน (งบ) และ monitoring ลึกยังไม่เปิด ต้องพูดว่า "เรารู้วิธีเปิด แต่ lab ไม่อนุญาต" ไม่ใช่ "เราไม่รู้" ทุกข้อยังไม่ทำควรพูดแบบตรง ๆ พร้อมทางแก้ที่ชั้นด้านบน

**คำถามกรรมการที่ควรเตรียม:**
- ย้ายระบบไปยังเว็บ production ต้องทำอะไรอีก? - ตอบ: ทุกอย่างใน repo สร้างซ้ำได้ (make up + make deploy) ระดับนี้ใช้จริงได้และ dns.tf แนบให้ทำงานต่อ

- HPA ตั้งเวลาไว้หรือ trigger ทุกเมตริก? - ตอบ: ทำงานอัตโนมัติตาม metric CPU ไม่ต้องตั้งเวลา

**รูปภาพ - Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ขวากลาง | ภาพหลัก | ตาราง 2 คอลัมน์: ทำแล้ว (เขียว) vs ยังไม่ทำ (ส้ม) ป้ายเหตุผลสั้นรายแถว | จาก docs/PROJECT-KNOWLEDGE-BASE ข้อจำกัด + dns.tf | 50% | "ทุกข้อยังไม่ทำต้องมีเหตุผล" | วาดใน canva |
| ขวาล่าง | ไอคอน | flag, road, traffic-cone | canva | เล็ก | - | วาดใน canva |
## สไลด์ 13/13 - สรุป (~1 นาที)

**Headline:** ระบบจริงขึ้น EKS จริง มีเว็บให้เปิดจริง

**Body:**
- ทั้ง platform rebuild ซ้ำได้ทุกชิ้น: modules/platform = 25 resources ตรงทุกครั้งที่ apply
- เว็บใช้ได้จริง: https://eventide.creasy.club/ (ต้อง `make up` ตอนเริ่มเซสชัน) · Google sign-in + Stripe ชำระเงิน: เปิดใช้แล้ว
- เสาแข็ง: OpEx · Perf · Cost - เสาที่ยังเผา: Reliability (ไม่มี chaos/RTO), Sustainability (ไม่มีเมตริก), Security (ไม่มี WAF/GuardDuty)
- งบพอ: $0.18/ชม. ขึ้นเคลื่อน ล้างหมดตอนจบเซสชันทุกครั้ง

**Key number:** 226.4 req/s ทดสอบจริง · $0.18/ชม. · https พร้อม

**Speaker notes:**
ปิดด้วยประโยคเดียว: "ไม่ใช่ demo กระดาษ — ระบบ deploy ขึ้น AWS จริง มีเว็บเปิดใช้จริง" ให้ยกสามของแข็ง: HTTPS ผ่าน ACM, เมลส่งผ่าน SQS/DLQ, auto-scaling ด้วย HPA ทำงานจริง

**คำถามกรรมการที่ควรเตรียม:** ถ้าผู้ใช้โตเป็นแสน จะเพิ่ม resource อะไรแรก?
- ตอบ: RDS ขึ้น class ก่อน (db.t3.micro สูญสุดที่ ~87 connections) -> ตามด้วย cache/CDN -> แล้วจึงคิด replicas

**รูปภาพ - Visual Plan**
| ตำแหน่ง | ประเภท | เนื้อหา | แหล่ง | ขนาด | แคปชัน | สถานะ |
|---|---|---|---|---|---|---|
| ขวากลาง | ภาพหลัก | ไดอะแกรม as-built ย่อ + 6 ไอคอนเสาใช้สี 6 สี | eventide-aws-as-built.png + canva | 55% | "ระบบเดียวตรวจได้ทุกเสา" | พร้อมใช้ |
| ขวาล่าง | ไอคอน | Q&A | canva | เล็ก | - | วาดใน canva |

---

## สรุป

- รวมเวลา 13 สไลด์ = **18 นาที** ยังเว้นเผื่อ Q&A/demo
- สไลด์ใหม่เทียบเดิม: สไลด์ 5 แยกกลุ่มตาม B (ครบถ้วน 3 / บางส่วน 3) · สไลด์ 9 รวม Sustainability + Cost เดิม · เปลี่ยนเรื่องโดเมน/ต้นทุน/k6 ทั้งชุด
- ข้อความเรื่อง domain/https/Google/Stripe ทุกจุดใช้คำว่า 'เปิดใช้แล้ว ยืนยันโดยทีม 2026-10-25'
