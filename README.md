# Eventide

เว็บไซต์ขายและจัดการตั๋วอีเวนต์ สร้างเป็น monorepo ของ microservices บน [Bun](https://bun.com)

- **หน้าเว็บ** เป็น React SPA ที่เรียก service ผ่าน Eden Treaty จึงได้ type จาก backend ถึง frontend โดยไม่ต้องเขียน API client เอง
- **แต่ละโดเมนเป็น service ของตัวเอง** (auth, event, registration, payment) แยก process และ port แต่ใช้ Postgres ก้อนเดียวกัน
- **งานที่ไม่ต้องรอ** อย่างการส่งอีเมล ส่งผ่านคิว SQS ให้ worker ทำ ไฟล์เก็บใน S3

## ความสามารถ

| บทบาท | ทำอะไรได้ |
|---|---|
| ผู้ใช้ (`user`) | ค้นหาอีเวนต์ตามคำค้น หมวดหมู่ หรือผู้จัดงาน, ลงทะเบียนและชำระเงิน, ดูตั๋วพร้อม QR code, แก้โปรไฟล์, สมัครเป็นผู้จัดงาน |
| ผู้จัดงาน (`organizer`) | สร้างอีเวนต์ (ปก, แกลเลอรี, รายละเอียดแบบ rich text, ตั้งเวลาเผยแพร่), สร้างประเภทตั๋วและแบบฟอร์มลงทะเบียน, เชิญผู้เข้าร่วมทางอีเมล, อนุมัติหรือปฏิเสธการลงทะเบียน, ดูรายชื่อผู้เข้าร่วม ทำได้เฉพาะอีเวนต์ของตัวเอง |
| ผู้ดูแลระบบ (`admin`) | จัดการทุกอีเวนต์และหมวดหมู่, ระงับอีเวนต์หรือบัญชี, จัดการบัญชีผู้ใช้, อนุมัติใบสมัครผู้จัดงาน |

**ประเภทตั๋ว** มีสามแบบ:

- `first_come`: มาก่อนได้ก่อนตามโควตา
- `approval`: ผู้จัดอนุมัติทีละคน
- `invite`: เฉพาะอีเมลที่ได้รับเชิญ

ตั๋วฟรีหรือมีราคาก็ได้ ตั๋วที่มีราคาจ่ายผ่าน Stripe Checkout ถ้าเงินเข้าหลังที่นั่งหมด ระบบจะคืนเงินให้เอง

**ยังไม่เสร็จ:** เช็คอินผู้เข้าร่วม และหน้าคำขอคืนเงินใน dashboard

## สถาปัตยกรรม

```mermaid
flowchart LR
  B["Browser"] --> V["apps/web<br/>Vite :5173"]
  V -->|"/api/auth"| A["auth :3001"]
  V -->|"/api/events"| E["event :3002"]
  V -->|"/api/regis"| R["registration :3003"]
  V -->|"/api/payment"| P["payment :3004"]
  V -->|"/files"| S3[("S3 / MinIO")]
  E -.->|"ตรวจ session"| A
  R -.->|"ตรวจ session"| A
  P -.->|"ตรวจ session"| A
  E & R & P -.->|"cache session 60s"| RD[("Redis")]
  P <--> ST["Stripe"]
  A & E & R & P --> PG[("Postgres")]
  A & E & R & P --> Q[["SQS mail-queue"]]
  Q --> M["mail-worker"] --> G["Gmail SMTP"]
```

- **Routing:** ตอน dev, Vite proxy แต่ละ path prefix ไปยัง port ของ service นั้น
- **Session:** service อื่นตรวจ session โดยส่ง cookie ไปถาม `apps/auth` แล้ว cache คำตอบใน Redis 60 วินาที รายละเอียดอยู่ใน [docs/auth.md](docs/auth.md)

| Workspace | Port | Prefix | หน้าที่ |
|---|---|---|---|
| `apps/web` | 5173 | | React SPA |
| `apps/auth` | 3001 | `/api/auth` | Better Auth: บัญชี, session, บทบาท, การระงับ, ใบสมัครผู้จัดงาน |
| `apps/event` | 3002 | `/api/events` | อีเวนต์, หมวดหมู่, รูปภาพ, คำเชิญ, ประเภทตั๋วและแบบฟอร์ม |
| `apps/registration` | 3003 | `/api/regis` | ที่นั่งว่าง, การลงทะเบียน (อนุมัติ / ปฏิเสธ), ตั๋วของฉัน |
| `apps/payment` | 3004 | `/api/payment` | Stripe Checkout, webhook, การคืนเงิน |
| `apps/mail-worker` | | | อ่านคิว `mail-queue` แล้วส่งอีเมลผ่าน Gmail |

| Package | หน้าที่ |
|---|---|
| `@app/db` | Drizzle schema, migration และ client ที่ทุก service ใช้ร่วมกัน |
| `@app/auth-guard` | บทบาทและสิทธิ์ (ใช้ใน web ด้วย), plugin `authGuard` ของ Elysia |
| `@app/mail` | สัญญาของคิวอีเมล: `enqueueMail()` และ `parseMailMessage()` |
| `@app/storage` | อัปโหลดไฟล์ลง S3 พร้อมตรวจชนิดและขนาดไฟล์ |
| `@app/tickets` | ออกตั๋วร่วมกันระหว่าง registration และ payment |

**Stack:**

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | React 19, Vite, TanStack Router / Query / Form / Table, shadcn/ui บน Base UI, Tailwind CSS 4 |
| Backend | ElysiaJS 2, Better Auth |
| ข้อมูล | Drizzle ORM บน Postgres 18, Redis 8 |
| ไฟล์และคิว | S3 (MinIO ตอน dev), SQS (ElasticMQ ตอน dev) |
| ภายนอก | Stripe, Gmail SMTP ผ่าน Nodemailer |

## เริ่มต้นใช้งาน

ต้องมี [Bun](https://bun.com) 1.4 ขึ้นไป และ Docker (พร้อม Compose)

```sh
bun install
cp .env.example .env        # ทุก workspace อ่าน .env ที่ root
```

เปิด `.env` แล้วใส่ `BETTER_AUTH_SECRET` (สร้างด้วย `openssl rand -base64 32`) ค่าอื่นใช้ค่าเริ่มต้นได้เลย

```sh
bun run infra:up            # Postgres, Redis, ElasticMQ, MinIO
bun run db:migrate
bun run dev                 # web + ทุก service + mail worker
```

1. เปิด http://localhost:5173 แล้วสมัครสมาชิก
2. ตั้งบัญชีแรกเป็นผู้ดูแลระบบ แล้ว reload หน้าเว็บ:

   ```sh
   cd apps/auth && bun run admin:promote you@example.com
   ```

3. สร้างหมวดหมู่ที่ `/dashboard/categories` ก่อน เพราะอีเวนต์ทุกอันต้องมีหมวดหมู่

หน้า `/status` แสดงสถานะของทุก service

### ตัวเลือกเสริม

ส่วนนี้ไม่ต้องตั้งก็รันได้

| ฟีเจอร์ | ตั้งค่า | ถ้าไม่ตั้ง |
|---|---|---|
| เข้าสู่ระบบด้วย Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect URI: `http://localhost:5173/api/auth/callback/google`) | มีแค่อีเมลและรหัสผ่าน |
| ชำระเงิน | `STRIPE_SECRET_KEY` (sandbox key) และ `STRIPE_WEBHOOK_SECRET` จาก `bun run stripe:listen` ดูขั้นตอนใน [docs/stripe.md](docs/stripe.md) | ตั๋วฟรีใช้ได้ แต่ตั๋วที่มีราคาจ่ายเงินไม่ได้ |
| ส่งอีเมลจริง | `GMAIL_USER`, `GMAIL_APP_PASSWORD` ([App Password](https://myaccount.google.com/apppasswords)) | mail worker พิมพ์อีเมลลง log แทนการส่ง |

### บริการในเครื่อง

| บริการ | ที่อยู่ | หมายเหตุ |
|---|---|---|
| Postgres 18 | `localhost:5432` | `bun run db:studio` เปิด Drizzle Studio |
| Redis 8 | `localhost:6379` | |
| ElasticMQ (SQS) | API `:9324`, UI http://localhost:9325 | คิว `mail-queue` และ `mail-dlq` |
| MinIO (S3) | API `:9000`, console http://localhost:9001 | login `minioadmin` / `minioadmin`, bucket `event-assets` |

`bun run infra:down` หยุดบริการ และ `bun run infra:reset` ล้างข้อมูลทั้งหมดแล้วเริ่มใหม่

## คำสั่งที่ใช้บ่อย

```sh
bun run dev                         # ทุก app พร้อมกัน
bun run --filter @app/event dev     # app เดียว

bun run db:generate                 # สร้าง migration จาก schema ที่แก้ (packages/db/drizzle/)
bun run db:migrate                  # รัน migration

bun run --filter @app/web lint      # oxlint
bun run --filter @app/web build     # tsc -b && vite build
```

**Type check:** รัน `bun check` จาก**ใน** workspace เช่น `cd apps/web && bun check` อย่ารันที่ root เพราะ tsconfig ที่ root ไม่มี DOM lib และ alias `@/*` จึงรายงาน error ที่ไม่มีจริงใน `apps/web`

## การทดสอบ

ใช้ `bun test` ชุดทดสอบที่ต้องใช้ฐานข้อมูลหรือ Redis ต้อง `bun run infra:up` ก่อน แล้วรันจากใน workspace:

```sh
cd apps/event && bun run test       # หรือ apps/auth, apps/registration, apps/payment,
                                    # packages/auth-guard, packages/storage
bun test test/event.test.ts         # ไฟล์เดียว
bun test -t "pattern"               # เฉพาะเทสต์ที่ชื่อตรง
```

## โครงสร้างโปรเจกต์

```
apps/
  web/            React SPA (TanStack Router แบบ file-based ใน src/routes/)
  auth/           Better Auth
  event/          อีเวนต์ หมวดหมู่ คำเชิญ ประเภทตั๋ว
  registration/   การลงทะเบียนและตั๋ว
  payment/        Stripe
  mail-worker/    ส่งอีเมลจากคิว
packages/
  db/  auth-guard/  mail/  storage/  tickets/
infra/
  elasticmq/      ค่าตั้งคิวของ ElasticMQ สำหรับ docker-compose
  terraform/      root เดียว: ECR, S3, SQS, secrets, DNS + modules/platform (EKS, RDS, NLB) สลับด้วย var.platform
  aws.env.example ที่วาง credential ของ Learner Lab (copy เป็น aws.env)
  helm/eventide/  Helm chart ของทั้งระบบ (ใช้ชุดเดียวกันทั้ง k3d และ EKS)
scripts/          tf-init.sh · deploy.sh · teardown.sh · k3d-up.sh · admin.sh · check-lab.sh
load/k6/          load test สำหรับ HPA
docs/             เอกสารออกแบบ + รายงาน
```

แต่ละ service จัดโค้ดเป็น `src/routes/<feature>/{index,model,service}.ts`: controller, schema ของ request/response และ business logic

## เอกสาร

- [docs/auth.md](docs/auth.md): การยืนยันตัวตน บทบาท และการตรวจสิทธิ์ข้าม service
- [docs/tickets.md](docs/tickets.md): ประเภทตั๋ว วงจรการลงทะเบียน การล็อกที่นั่ง และการชำระเงิน
- [docs/stripe.md](docs/stripe.md): ตั้งค่า Stripe ตั้งแต่ sandbox จนถึง webhook บน production
- [docs/storage.md](docs/storage.md): การอัปโหลดและเก็บไฟล์
- [CLAUDE.md](CLAUDE.md): ข้อตกลงในการเขียนโค้ดของโปรเจกต์ทั้งหมด

## Deploy (k3d / AWS)

ระบบ deploy ขึ้น EKS บน AWS Academy Learner Lab ด้วย Terraform + Helm และรัน chart ชุดเดียวกันบน k3d ในเครื่องได้

### สถาปัตยกรรมบน AWS

![สถาปัตยกรรม AWS ของ Eventide](docs/architecture/aws/eventide-aws-as-built.png)

(ไฟล์ [SVG](docs/architecture/aws/eventide-aws-as-built.svg) ซูมได้ชัดกว่า, [แหล่งที่มาแก้ไขได้ `.drawio`](docs/architecture/aws/eventide-aws-as-built.drawio), [คำอธิบายและวิธี generate ใหม่](docs/architecture/aws/README.md))

- **ขอบ:** Route 53 → ALB (TLS ด้วย ACM) + **WAF** (โหมด block: Common, KnownBadInputs, IP reputation, rate limit) → ingress-nginx
- **เครือข่าย:** VPC เฉพาะของระบบ `10.20.0.0/16` แบ่งเป็น public subnet (ALB, NAT gateway), private tier **edge** ที่ไม่มี route ออก internet (ingress-nginx, event, registration, web), private tier **egress** ที่ออกผ่าน NAT (auth, payment, mail-worker) และ data subnet
- **ข้อมูล:** RDS PostgreSQL ผ่าน **RDS Proxy**, **ElastiCache Redis** (TLS + AUTH), S3, SQS + DLQ
- **VPC endpoint:** S3 (gateway) และ ecr.api, ecr.dkr, sts, ec2, sqs, secretsmanager (interface) ให้ tier edge เรียก AWS ได้โดยไม่ต้องมี NAT
- **สังเกตการณ์:** CloudWatch alarm 15 ตัว + dashboard `eventide` แจ้งเตือนผ่าน SNS
- **ข้อจำกัดของ Learner Lab:** single-AZ, ไม่มี CloudFront (ใช้ ALB + WAF แทน), database ถูกสร้างใหม่ทุก session (`make up` / `make down`), pod ใช้ credential ของ session (ไม่มี IRSA)

```sh
make k3d          # k3d + ingress-nginx + chart ทั้งระบบ (ใช้ Postgres/MinIO/ElasticMQ จาก docker compose) → http://localhost:8080
make k3d-down

cp infra/aws.env.example infra/aws.env   # ครั้งเดียว แล้ววาง credential จาก Learner Lab (AWS Details → AWS CLI) ทุก session
make deploy       # คำสั่งเดียวจบ: จาก account ว่าง/ที่เพิ่ง reset จนระบบใช้งานได้ (ดูหัวข้อ "หลัง reset lab" ด้านล่าง)
make redeploy     # เฉพาะแอป บน platform ที่รันอยู่แล้ว: build 7 images → ECR, k8s Secrets, helm upgrade (migrate ก่อน), roll out
make admin EMAIL=you@example.com   # ตั้ง admin คนแรก หลังสมัครผ่านหน้าเว็บ
# ทีละขั้น (make deploy เรียกให้เองตามลำดับ):
make mirror       # คัดลอก image ของ ingress-nginx / metrics-server เข้า ECR (tier edge ไม่มี internet ดึงจาก registry.k8s.io ไม่ได้)
make up           # terraform apply ทั้งหมด (VPC/ECR/S3/SQS/DNS + NAT, endpoints, EKS 2 tier, RDS + Proxy, ElastiCache, ALB + WAF, alarms) — root เดียว state เดียว
bash scripts/check-lab.sh   # ตรวจสิทธิ์ของ lab (ไม่จำเป็นต่อ make deploy)
make secrets      # คัดลอก Google/Gmail/Stripe จาก .env ไปเป็น Secrets Manager (รันซ้ำหลังเติม Stripe)
make ci-creds DEPLOY=1   # เก็บ credential ของ session นี้เป็น GitHub secrets → push เข้า main แล้ว deploy ขึ้น AWS อัตโนมัติ
make down         # terraform apply -var platform=false (ลบ EKS, NAT, endpoints, RDS + Proxy, ElastiCache, ALB, WAF, alarms; เก็บ VPC, ECR/S3/SQS/DNS) — ทำทุกครั้งก่อนจบ session
```

### หลัง reset lab

Start Lab → วาง credential ใหม่ใน `infra/aws.env` → `make deploy` เท่านั้น สคริปต์ `scripts/bootstrap.sh` ทำให้ตามลำดับ:
ตรวจเครื่องมือ/Docker/credential → state ของ Terraform → ชั้นถาวร (VPC, ECR, S3, SQS, secrets, Route 53 zone, ขอ ACM cert) →
ชี้ NS ที่ Cloudflare และรอ cert เป็น `ISSUED` → คัดลอก image ที่ tier edge ต้องใช้เข้า ECR → `terraform apply` ตัว platform →
build/push/deploy แอป → ทดสอบ health ทั้ง 4 service ถ้าเริ่มจากศูนย์ใช้เวลาราว 30–40 นาที

- **ขั้นเดียวที่อาจต้องทำมือ:** reset ลบ Route 53 zone จึงได้ name server ชุดใหม่ ต้องเปลี่ยน NS ที่ Cloudflare ตาม ใส่
  `CLOUDFLARE_API_TOKEN` ใน `infra/aws.env` (สิทธิ์ Edit zone DNS เฉพาะ zone หลัก) แล้วสคริปต์เปลี่ยนให้เอง ถ้าไม่ใส่ สคริปต์จะพิมพ์ NS 4 ตัวให้
  วางแล้วรอจนเปลี่ยนเสร็จ (หรือจบด้วย exit 3 ถ้าไม่ได้รันใน terminal ให้วางแล้วรัน `make deploy` ซ้ำ)
- ฐานข้อมูลใหม่ทุก session: สมัครผ่านหน้าเว็บ แล้วรัน `make admin EMAIL=…`
- ไม่ทำให้อัตโนมัติ: การวาง credential และ `make down` ตอนจบ session

รายละเอียด: [docs/SYSTEM-DESIGN.md](docs/SYSTEM-DESIGN.md) (สถาปัตยกรรม, §1.1 สรุปสิ่งที่เปลี่ยนตอน merge v2),
[docs/PROJECT-KNOWLEDGE-BASE.md](docs/PROJECT-KNOWLEDGE-BASE.md) (เหตุผลของการตัดสินใจ, ข้อจำกัดของ lab),
[docs/TODO.md](docs/TODO.md) (checklist และ GATE), [CLAUDE.md](CLAUDE.md) (ส่วน Cloud infrastructure)
