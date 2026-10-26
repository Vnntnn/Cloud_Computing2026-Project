# D-image-checklist.md — รวมภาพที่ต้องหา/ทำ (ฉบับสไลด์ 13 หน้า, รอบสอง 2026-10-25)

เรียงตามสไลด์ใหม่ ✓ · สถานะมี 3 แบบ: พร้อมใช้ / ต้องแคปเพิ่ม / ต้องวาดใหม่

## กฎการใส่ภาพจากการแคป production (ใหม่)

1. **แคปจาก https://eventide.creasy.club/ ได้** (ต้อง `make up` ใน session ที่ถ่าย) — ห้ามให้ในภาพปรากฏ: credentials, NLB DNS `*.elb.amazonaws.com`, ข้อมูลส่วนตัวผู้ใช้ (ชื่อ-เมลจริง), Stripe dashboard, AWS Billing/ใบรายการ credit
2. แคปแชต/บันทึก CLI: ปิดช่องที่มี ARN/เบอร์บัญชี ด้วยกล่องสีเทา
3. ALT text ของภาพจริง: ระบุเสาที่เกี่ยว + "อ้างอิง docs/…path"

## กลุ่ม 1: ทำก่อน (ต้องแคปเพิ่ม / ต้องวาดใหม่)

| # | สไลด์ | ชื่อภาพ | แหล่ง | สถานะ | งานที่ทำ |
|---|---|---|---|---|---|
| 1 | 1 | หน้าเว็บจริง (โฮมเพจ) | https://eventide.creasy.club/ | ต้องแคปเพิ่ม | แคปใน session ที่ make up แล้ว, ปิดข้อมูลส่วนตัวทั้งหมด |
| 2 | 1 | Eventide logo | วาดใน Canva | ต้องวาดใหม่ | วาดเล็กมุมซ้ายบน |
| 3 | 2 | screenshot event detail (ตั๋ว 3 แบบ) | production เว็บ | ต้องแคปเพิ่ม | ใช้บัญชี test แสดง first_come/approval/invite ครบในเฟรมเดียว |
| 4 | 3 | หน้า AWS Lab (แสดง credit ต่างเพดาน $50) | AWS console | ต้องแคปเพิ่ม | ปิดโคน Account ID/ชื่อ account ที่เห็นในแคป |
| 5 | 4 | ไดอะแกรม as เดิมเต็ม | docs/architecture/aws/eventide-aws-as-built.png | พร้อมใช้ | ปรับความสว่าง 2-3 ใน slide pillar |
| 6 | 6 | terminal logs make deploy | session log | ต้องแคปเพิ่ม | ให้เห็น 7 images + helm release ทั้งหมด |
| 7 | 7/11 | กราฟ HPA 2→8→2 | วาดจาก docs/autoscaling-evidence.txt | ต้องวาดใหม่ | ติด label CPU target 60%, จุดปรับ pod ทุก step |
| 8 | 8 | pod ล้ม -> k8s สร้างใหม่ | Canva | ต้องวาดใหม่ | แยกขภาพ pod / RDS หลัง (RDS เป็นเงาเทา) |
| 9 | 9 | การ์ดต้นทุนรายชิ้น | วาดใน Canva จากตาราง cost | ต้องวาดใหม่ | ใช้ตัวเลขในสไลด์ 9 เท่านั้น ($0.100/$0.023/$0.018/$0.0416) |
| 10 | 9 | วงจร make up → เดโม → make down | Canva | ต้องวาดใหม่ | 4 ขั้นพร้อมไอคอน |
| 11 | 10 | ชั้นความปลอดภัย: NLB(ACM) → ingress → auth-guard → DB/S3 policy | canva ย้อมที่สีเทาเข้ม | ต้องวาดใหม่ | ใช้ AI moment visual ที่เหมาะ; RDS จาก resp "ต้องวาดใหม่" แจ้งเหตุผลข้อนี้ |
| 12 | 11 | kubectl pod count logs (HPA scale up/down) | session log | ต้องแคปเพิ่ม | ตัด NLB DNS และ internal IP ทุกจอออกให้หมด |
| 13 | 12 | ตาราง "ทำแล้ว/ยังไม่ทำ + เหตุผล" | Canva จาก docs/PROJECT-KNOWLEDGE-BASE | ต้องวาดใหม่ | แถว Container Insights ต้องบอก "ปิดเพราะ lab ปฏิเสธ AttachRolePolicy" |
| 14 | 13 | as-built ย่อ + 6 ไอคอนเสา | eventide-aws-as-built.png + Canva | พร้อมใช้ | วางได้เลย (6 ไอคอน 6 สี) |

## กลุ่ม 2: จะดึงมาเป็นรอง (ถ้ามีที่ว่าง)

| สไลด์ | ภาพ | แหล่ง | สถานะ |
|---|---|---|---|
| 4 | ไดอะแกรม design ตาม seed (เสนอแผน) | docs/architecture/aws/AWS_Diagram_Tool.jpg | พร้อมใช้ |
| 11 | HPA event history text | docs/autoscaling-evidence.txt | พร้อมใช้ (คัดจอบ text) — พร้อมใช้ |

## คำถามค้างที่รอยืนยัน (ต้องตัดสินใจก่อนเดโม 2026-10-25)

1. **โจทย์วัด k6 จริง วันที่ 2026-09-07 หรือไม่?** ไฟล์ evidence ยังไม่มี date stamp — ให้ยืนยันตามที่ทำ
2. **ต้นทุน แค่ $0.18/$0.23/ชม. ห้ามแต่งตาม SETUP**
3. **ไปกลับไปที่โผนผลรวม $25 actual** ห้ามพูดหากไม่มี credit meter
4. วันที่ถ่าย production screenshot ต้องเป็นก่อนวันเดโม (ต้อง make up เว็บก่อนทุกครั้ง)
