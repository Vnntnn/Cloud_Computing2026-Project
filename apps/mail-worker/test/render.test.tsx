import { describe, expect, test } from "bun:test";
import type { MailMessage, MailTemplate, MailTemplates } from "@app/mail";
import { renderMail, templates } from "../src/render";

const previewProps = <K extends MailTemplate>(template: K) =>
  (templates[template].default as unknown as { PreviewProps: MailTemplates[K] }).PreviewProps;

const renderWith = async <K extends MailTemplate>(template: K, props: Partial<MailTemplates[K]>) => {
  const rendered = await renderMail({ template, props: { ...previewProps(template), ...props } });
  if (!rendered) throw new Error(`no template ${template}`);
  return rendered;
};

describe("every template", () => {
  for (const template of Object.keys(templates) as MailTemplate[]) {
    test(template, async () => {
      const mail = await renderWith(template, {});
      expect(mail.subject.length).toBeGreaterThan(0);
      expect(mail.html).toContain('lang="th"');
      expect(mail.html).toContain('src="cid:logo@eventide"');
      // mail clients don't read oklch or rem
      expect(mail.html).not.toContain("oklch(");
      expect(mail.html).not.toMatch(/\d(\.\d+)?rem\b/);
      expect(mail.text.length).toBeGreaterThan(0);
      expect(mail.attachments).toEqual([expect.objectContaining({ cid: "logo@eventide" })]);
      expect(await Bun.file(mail.attachments[0]!.path).exists()).toBe(true);
    });
  }
});

test("an unknown template renders nothing", async () => {
  const message = { to: "a@example.com", template: "nope", props: {} } as unknown as MailMessage;
  expect(await renderMail(message)).toBeNull();
});

test("user input is escaped", async () => {
  const mail = await renderWith("enrollment-rejected", { name: "<i>x</i>", reason: "เต็มแล้ว <b>" });
  expect(mail.html).toContain("เต็มแล้ว &lt;b&gt;");
  expect(mail.html).toContain("&lt;i&gt;x&lt;/i&gt;");
  expect(mail.html).not.toContain("<b>");
});

test("times are in Thailand's zone", async () => {
  const event = { ...previewProps("ticket").event, startsAt: "2026-11-14T17:30:00.000Z" };
  const mail = await renderWith("ticket", { event });
  // 17:30 UTC is 00:30 the next day in Bangkok
  expect(mail.text).toContain("15 พฤศจิกายน พ.ศ. 2569 เวลา 00:30");
});

describe("refunds", () => {
  const orderNumber = "0a1b2c3d-0000-4000-8000-000000000000";

  for (const template of ["refund-system", "order-cancelled"] as const) {
    test(`${template} made by hand asks for the order number and bank account`, async () => {
      const mail = await renderWith(template, { manual: true, orderNumber });
      expect(mail.text).toContain(`เลขคำสั่งซื้อ: ${orderNumber}`);
      expect(mail.text).toContain("refunds@eventide.example");
      expect(mail.text).not.toContain("5–10 วันทำการ");
      expect(mail.subject).toContain("วิธีรับเงินคืน");
    });

    test(`${template} through Stripe says when the money arrives`, async () => {
      const mail = await renderWith(template, { manual: false, orderNumber });
      expect(mail.text).toContain("5–10 วันทำการ");
      expect(mail.text).not.toContain(orderNumber);
    });
  }

  test("amounts are in baht", async () => {
    const mail = await renderWith("order-cancelled", { amount: 62.5, percent: 50, total: 125 });
    expect(mail.text).toContain("฿62.50 (50% ของ ฿125)");
  });

  test("a duplicate payment keeps the order", async () => {
    const mail = await renderWith("refund-system", { reason: "duplicate" });
    expect(mail.text).toContain("คำสั่งซื้อยังใช้ได้ตามปกติ");
  });
});

describe("account links", () => {
  test("an invitee without an account is asked to sign up", async () => {
    const mail = await renderWith("event-invitation", { name: null });
    expect(mail.text).toContain("กรุณาสมัครสมาชิกด้วยอีเมล");
    expect(mail.text).toContain("สมัครสมาชิกและดูอีเวนต์");
  });

  test("an invitee with an account is greeted and asked to sign in", async () => {
    const mail = await renderWith("event-invitation", { name: "guest" });
    expect(mail.text).toContain("สวัสดีคุณ guest");
    expect(mail.text).toContain("กรุณาเข้าสู่ระบบด้วยอีเมล");
  });

  test("a ticket links to its page", async () => {
    const mail = await renderWith("ticket", { url: "https://eventide.example/tickets/t1", hasAccount: false });
    expect(mail.html).toContain('href="https://eventide.example/tickets/t1"');
    expect(mail.text).toContain("สมัครสมาชิกและดูตั๋ว");
  });
});

test("a cancelled refund says the money was not returned, and never that it is refunded or on its way", async () => {
  const mail = await renderWith("refund-canceled", { amount: 450 });
  expect(mail.subject).toContain("การคืนเงินถูกยกเลิก");
  expect(mail.text).toContain("ยังไม่ได้คืน");
  expect(mail.text).toContain("ติดต่อผู้จัดงาน");
  expect(mail.text).not.toContain("คืนเงินแล้ว");
  expect(mail.text).not.toContain("กำลังดำเนินการ");
  expect(mail.html).toContain("450");
});
