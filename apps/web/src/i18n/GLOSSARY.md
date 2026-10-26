# Eventide localization glossary

Thai is the primary language and English is equal. Use these terms in every
namespace (`common`, `shared`, `pub`, `account`, `dashboard`, `eventAdmin`) and
in hard-coded fallbacks. If a term is missing, add it here first.

English spelling: British with `-ize` (organizer, organization, cancelled,
colour), to match the `en-GB` date format. API enums, DB fields and route ids
keep their code names (`enrollment`, `canceled`, ...); this table is only about
what the user reads.

## Terms

| Concept | English | Thai | Notes |
|---|---|---|---|
| Event | event | อีเวนต์ | never "อีเว็นต์" |
| Event page | event page | หน้าอีเวนต์ | |
| Explore page | Explore | สำรวจ / สำรวจอีเวนต์ | |
| Category | category | หมวดหมู่ | not "ประเภท" (that is ticket type) |
| Venue | venue | สถานที่ | |
| Draft | Draft | ฉบับร่าง | |
| Public event | Public | สาธารณะ | |
| Invite-only event | Invite only | เฉพาะผู้ได้รับเชิญ | |
| Suspended event | Suspended | ถูกระงับ | same verb as accounts |
| Publish | publish | เผยแพร่ | |
| Happening now | Happening now | กำลังจัดอยู่ตอนนี้ | short form in tight spots: กำลังจัด |
| Organizer | organizer | ผู้จัดงาน | |
| Organizer application | organizer application / Apply | คำขอเป็นผู้จัดงาน / สมัครเป็นผู้จัดงาน | not "request" in English; the Thai noun stays คำขอ |
| Admin | admin | ผู้ดูแลระบบ | |
| User (role) | user | ผู้ใช้ | |
| Attendee | attendee | ผู้เข้าร่วม | not "participant" / "guest" |
| Buyer | buyer | ผู้ซื้อ | the account that placed the order |
| Ticket | ticket | ตั๋ว | counter: ใบ |
| Ticket type | ticket type | ประเภทตั๋ว | |
| Ticket kind: first come | First come, first served | มาก่อนได้ก่อน | |
| Ticket kind: approval | Requires approval | ต้องได้รับอนุมัติ | |
| Ticket kind: invite | Invite only | เฉพาะผู้ได้รับเชิญ | |
| Register (action) | register / Registration | ลงทะเบียน / การลงทะเบียน | never "enroll" / "enrollment" in UI text |
| Order (the record) | order | รายการสั่งซื้อ | one order = 1+ tickets, one buyer; the `enrollment` in code |
| Join request | Request to join | ขอเข้าร่วม | for approval-type tickets |
| Approve / reject | Approve / Reject | อนุมัติ / ปฏิเสธ | actions. Statuses: Approved / Rejected = อนุมัติแล้ว / ไม่อนุมัติ |
| Pending approval | Awaiting approval | รออนุมัติ | |
| Awaiting payment | Awaiting payment | รอชำระเงิน | |
| Confirmed | Confirmed | ยืนยันแล้ว | |
| Expired | Expired | หมดเวลา | |
| Cancelled | Cancelled | ยกเลิกแล้ว | |
| Seat hold | seat hold / hold seats | จองที่นั่ง / การจองที่นั่ง | 10 minutes at enroll, 30 minutes at Stripe |
| Sold out | Sold out | หมด / ตั๋วหมดแล้ว | |
| Quota | quantity | จำนวนตั๋ว | not "quota" |
| Per-account limit | per account | ต่อบัญชี | |
| Registration form | registration form | แบบฟอร์มลงทะเบียน | |
| Question | question | คำถาม | |
| Invitation | invitation / invitee | คำเชิญ / ผู้ได้รับเชิญ | |
| Refund | refund | คืนเงิน (verb), การคืนเงิน (noun) | |
| Refund policy | refund policy | นโยบายการคืนเงิน | |
| Payment | pay / payment | ชำระเงิน / การชำระเงิน | not "จ่าย" |
| Check-in | check-in / check in | เช็กอิน | not "เช็คอิน" |
| Sign up | Sign up | สมัครสมาชิก | |
| Sign in | Sign in | เข้าสู่ระบบ | not "log in" |
| Sign out | Sign out | ออกจากระบบ | not "log out" |
| Account | account | บัญชี | |
| Profile | profile | โปรไฟล์ | |
| Suspend (account) | suspend / reinstate | ระงับ / ยกเลิกการระงับ | never "ban" in English UI |
| Dashboard | dashboard | แดชบอร์ด | |
| Link (URL) | link | ลิงก์ | slug is "link" in UI, "slug" only in parentheses |
| Cover image | cover image | ภาพปก | |
| Save / discard | Save / Discard | บันทึก / ยกเลิกการเปลี่ยนแปลง | |
| Dismiss a dialog | Cancel | ยกเลิก | when the confirm button itself cancels something ("Cancel order"), use "Back" / กลับ or "Keep ..." / เก็บ... instead, so two "Cancel"s never sit side by side |
| Try again | Try again | ลองอีกครั้ง | |
| Loading | Loading | กำลังโหลด | |
| Under review | Under review | รอพิจารณา | organizer applications; never "รอตรวจสอบ" |
| Attendees (dashboard tab) | Attendees | ผู้เข้าร่วม | the dashboard tab and page title; the `participants` key keeps its name |
| Orders (dashboard list) | orders | รายการสั่งซื้อ | the empty state says "No registrations yet" / ยังไม่มีการลงทะเบียน |
| Reject (action, button, dialog, toast) | Reject | ปฏิเสธ | the status label is ไม่อนุมัติ |
| Reinstate an event | Reinstate event | ยกเลิกการระงับ | one "Suspended → reinstate" pair covers accounts and events |
| Cancel an invitation (dismiss button) | Keep invitation | เก็บคำเชิญไว้ | the confirm button cancels, so the dismiss button must not also say "Cancel" |
| Table action column | Manage | จัดการ | the header of the last (sticky) column in every data table |
| Service names | Accounts and sign-in / Events / Registration / Payments | บริการบัญชีและการเข้าสู่ระบบ / อีเวนต์ / ลงทะเบียน / ชำระเงิน | `/status` page |

## Known words to avoid (fix on sight)

| Do not write | Write |
|---|---|
| enroll, enrollment, enrolled (UI text) | register, registration, registered; "order" for the record |
| participant(s) | attendee(s) |
| log in, log out, login (as a verb) | sign in, sign out |
| ban, banned (UI text) | suspend, suspended |
| request (for an organizer application) | application / apply |
| ยื่นคำขอ, ยื่นใบสมัคร | ส่งคำขอ |
| เช็คอิน, อีเว็นต์ | เช็กอิน, อีเวนต์ |
| ไม่สามารถ ... ได้ | ... ไม่ได้ |
| ...เรียบร้อย on a toast | ...แล้ว ("บันทึกแล้ว", "ลบแล้ว") |
| QR Code | QR code |
| คำสั่งซื้อ | รายการสั่งซื้อ |
| ประเภท (for category) | หมวดหมู่ |

## Both languages

- Server errors: show them with `problemMessage(error)` (looked up by problem
  `code` in `shared.problems`) and Better Auth errors with `authErrorMessage()`.
  Never render the backend's Thai `detail` or an `Error.message` directly. A new
  backend error code needs a `shared.problems` entry in both languages.
- Do not translate user-generated content (event titles, descriptions, names).
- Every key exists in `th` and `en`; nothing may rely on the Thai fallback in
  `i18n/index.ts`.

## English style

1. Sentence case everywhere: buttons, labels, titles, tabs. Product names and
   proper nouns keep their case (Eventide, Google, Stripe, PromptPay).
2. No trailing period on labels, buttons, toast titles, field errors,
   placeholders or one-clause hints. Any string with two or more sentences, and
   dialog, alert and empty-state bodies, end with a period on every sentence.
3. Errors say what happened, then how to fix it: "Couldn't upload the image.
   Try a JPG, PNG or WebP under 5 MB." Never blame the user, never write
   "Error:" or "Invalid ..." alone.
4. Buttons start with a verb and name the object when it is not obvious:
   "Create event", "Send request". Use the same verb for the same action across
   a flow (Delete, not Remove/Erase; Remove only for detaching something such as
   a photo or link).
5. Use "you" and "your", contractions ("can't", "doesn't"), and plain words
   ("sign in", not "authenticate"). No exclamation marks.
6. Plurals go through a function (`n === 1 ? ... : ...`); never "(s)".
7. Placeholders start with "e.g." and show a realistic example.
8. Dates, times and amounts are formatted with `Intl`; do not hand-write them
   into strings.

## Thai style

1. Short, polite-neutral product voice: no ครับ/ค่ะ, no stiff formal forms
   ("ท่าน", "โปรด", "ดำเนินการ" for simple verbs). "กรุณา" is fine in a
   field prompt ("กรุณากรอกชื่อ"); drop it in running copy and in errors that
   already say what to do ("ลองใหม่อีกครั้ง", "ติดต่อผู้ดูแลระบบ").
2. No trailing period or ฯ on labels and buttons. Write numbers as Arabic digits
   and keep the unit: "5 MB", "10 นาที", "3 ใบ".
3. Errors say what happened, then what to do: "อัปโหลดรูปไม่สำเร็จ ลองใช้ไฟล์ JPG
   หรือ PNG ที่ไม่เกิน 5 MB". Use "ไม่ได้" / "ไม่สำเร็จ" instead of "ล้มเหลว".
4. Same verb for the same action: ลบ (delete), ยกเลิก (cancel/dismiss), บันทึก
   (save), เพิ่ม (add), แก้ไข (edit), ส่ง (send), ชำระเงิน (pay).
5. Keep loanwords people actually say (อีเวนต์, แดชบอร์ด, โปรไฟล์, QR code,
   เช็กอิน) and spell them one way. Latin acronyms and product names stay Latin.
6. Thai has no spaces between words: break clauses with a space where a reader
   would pause, and keep labels under about 20 characters in tight UI (tabs,
   badges, table headers).
7. Sentences in running copy use a space, not a comma or period, between short
   clauses ("ลงทะเบียนเสร็จแล้ว ตั๋วจะส่งไปที่อีเมลของคุณ"). Use "คุณ" for the
   user, not "ท่าน"; omit the pronoun when the sentence is clear without it.
8. Repeated words use ๆ with no space ("เร็วๆ นี้"); do not mix "อีเวนต์" with
   "อีเว็นต์".
