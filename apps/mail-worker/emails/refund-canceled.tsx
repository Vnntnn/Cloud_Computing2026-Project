import type { MailTemplates } from "@app/mail";
import { CtaButton, EventDetails, Greeting, Paragraph } from "./_components/blocks";
import { appUrl, baht } from "./_components/format";
import { MailLayout } from "./_components/layout";

type Props = MailTemplates["refund-canceled"];

export const subject = ({ order }: Props) => `การคืนเงินถูกยกเลิก: ${order.event.title}`;

/** Stripe cancelled the refund (e.g. a bank account was never provided for a transfer), so the money was not returned. */
export default function RefundCanceledEmail({ name, order, amount, url }: Props) {
  return (
    <MailLayout preview={`การคืนเงิน ${baht(amount)} ถูกยกเลิก`} heading="การคืนเงินถูกยกเลิก">
      <Greeting name={name} />
      <Paragraph>
        การคืนเงิน <strong>{baht(amount)}</strong> ถูกยกเลิก เงินจำนวนนี้จึงยังไม่ได้คืนให้คุณ
      </Paragraph>
      <EventDetails
        event={order.event}
        ticketType={order.ticketType}
        quantity={order.quantity}
        extra={[["ยอดที่ยังไม่ได้คืน", baht(amount)]]}
      />
      <Paragraph>กรุณาติดต่อผู้จัดงานพร้อมเลขคำสั่งซื้อเพื่อรับเงินคืนทางช่องทางอื่น</Paragraph>
      <CtaButton href={url}>ดูรายการ</CtaButton>
    </MailLayout>
  );
}

RefundCanceledEmail.PreviewProps = {
  name: "สมชาย ใจดี",
  order: {
    event: { title: "Bangkok Design Week 2026", venue: "ไปรษณีย์กลาง บางรัก กรุงเทพฯ", startsAt: "2026-11-14T11:00:00.000Z" },
    ticketType: "บัตรทั่วไป",
    quantity: 2,
  },
  amount: 1250,
  url: `${appUrl}/tickets/orders/01234567-89ab-cdef-0123-456789abcdef`,
} satisfies Props;
