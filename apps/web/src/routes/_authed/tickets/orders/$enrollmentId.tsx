import { usePageTitle } from "@/hooks/use-page-title";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, ChevronRight, CircleCheckBig, CircleX, Clock, CreditCard, Hourglass, Mail, MapPin, QrCode, RefreshCw, TicketX, Undo2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { EnrollmentStatusBadge } from "@/components/enrollment-status-badge";
import { PayButton } from "@/components/pay-button";
import { RefundStatusBadge } from "@/components/refund-status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { paymentClient } from "@/lib/api";
import { cn } from "cn";
import { useT, type Translate } from "@/i18n";
import { problemMessage } from "@/lib/auth-errors";
import { enrollmentQueryOptions, enrollmentsKey, type Enrollment } from "@/lib/enrollments";
import { formatBaht, formatDateRange, formatDateTime, formatPrice } from "@/lib/format";
import { isRefundOpen } from "@/lib/refunds";

// `paid`: Stripe sent the buyer back after paying; the webhook may not have confirmed it yet
export const Route = createFileRoute("/_authed/tickets/orders/$enrollmentId")({
  validateSearch: z.object({ paid: z.unknown().optional() }),
  component: OrderPage,
});

const POLL_MS = 2_000;
const POLL_FOR_MS = 30_000;

function OrderPage() {
  const t = useT();
  const { enrollmentId } = Route.useParams();
  const { paid } = Route.useSearch();
  // back from Stripe: check again until the webhook confirms it, for a while
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), POLL_FOR_MS);
    return () => clearTimeout(timer);
  }, []);
  const polling = !!paid && !gaveUp;
  const { data: order, isPending, isError } = useQuery({
    ...enrollmentQueryOptions(enrollmentId),
    refetchInterval: (query) => (polling && query.state.data?.status === "awaiting_payment" ? POLL_MS : false),
  });
  usePageTitle(order ? t("common.pageTitle.order", { event: order.event.title }) : undefined);

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4" aria-busy="true" aria-label={t("account.tickets.order.loading")}>
        <Skeleton className="h-56" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TicketX />
          </EmptyMedia>
          <EmptyTitle>{t("account.tickets.order.notFound.title")}</EmptyTitle>
          <EmptyDescription>{t("account.tickets.order.notFound.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link to="/tickets" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft data-icon="inline-start" />
            {t("account.tickets.back")}
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  const confirming = polling && order.status === "awaiting_payment";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4">
      <Link to="/tickets" className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}>
        <ArrowLeft data-icon="inline-start" />
        {t("account.tickets.back")}
      </Link>
      <OrderStatus order={order} confirming={confirming} afterPayment={!!paid} />
      <OrderSummary order={order} />
      {order.status === "confirmed" && order.total > 0 && <RefundCard order={order} />}
    </div>
  );
}

function OrderStatus({ order, confirming, afterPayment }: { order: Enrollment; confirming: boolean; afterPayment: boolean }) {
  const t = useT();
  const toEvent = (
    <Link to="/events/$slug" params={{ slug: order.event.slug }} className={buttonVariants({ variant: "outline" })}>
      <ArrowLeft data-icon="inline-start" />
      {t("account.tickets.order.status.backToEvent")}
    </Link>
  );
  const status: { icon: typeof Clock; title: string; description: string; actions?: React.ReactNode } = (() => {
    switch (order.status) {
      case "confirmed":
        return {
          icon: CircleCheckBig,
          title: order.ticketType.kind === "approval" ? t("account.tickets.order.status.approved") : t("account.tickets.order.status.registered"),
          description: t("account.tickets.order.status.confirmedDescription"),
          actions: (
            <Link to="/tickets" className={buttonVariants({ variant: "sun", size: "lg" })}>
              <QrCode data-icon="inline-start" />
              {t("account.tickets.order.status.viewTickets")}
            </Link>
          ),
        };
      case "pending":
        return {
          icon: Hourglass,
          title: t("account.tickets.order.status.requestSent"),
          description: t("account.tickets.order.status.requestSentDescription"),
          actions: toEvent,
        };
      case "awaiting_payment":
        if (confirming) {
          return {
            icon: CreditCard,
            title: t("account.tickets.order.status.confirmingPayment"),
            description: t("account.tickets.order.status.confirmingPaymentDescription"),
          };
        }
        return {
          icon: CreditCard,
          title: afterPayment ? t("account.tickets.order.status.paymentNotConfirmed") : t("account.tickets.order.status.awaitingPayment"),
          description: afterPayment
            ? t("account.tickets.order.status.paymentNotConfirmedDescription")
            : t("account.tickets.order.status.payBy", {
                when: order.expiresAt ? formatDateTime(order.expiresAt) : t("account.tickets.order.status.payByFallback"),
              }),
          // back from Stripe, checking comes first: paying again isn't what they need
          actions: (
            <div className="flex flex-wrap justify-center gap-2">
              <PayButton enrollmentId={order.id} variant={afterPayment ? "outline" : "default"} />
              <VerifyPaymentButton enrollmentId={order.id} variant={afterPayment ? "default" : "outline"} />
            </div>
          ),
        };
      case "rejected":
        return {
          icon: CircleX,
          title: t("account.tickets.order.status.rejected"),
          description: t("account.tickets.order.status.rejectedDescription"),
          actions: toEvent,
        };
      case "expired":
        return {
          icon: Clock,
          title: t("account.tickets.order.status.expired"),
          description: t("account.tickets.order.status.expiredDescription"),
          actions: toEvent,
        };
      case "cancelled":
        return { icon: Undo2, ...cancelledStatus(t, order), actions: toEvent };
    }
  })();

  // what the order came to, said by the panel's colour first: ink for tickets in hand, red for a loss, grey while it waits
  const good = order.status === "confirmed";
  const bad = order.status === "rejected" || order.status === "cancelled" || order.status === "expired";
  return (
    <section className={cn("flex flex-col items-center gap-6 rounded-md px-6 py-12 text-center sm:py-14", good ? "bg-dusk text-dusk-foreground dark:ring-1 dark:ring-dusk-foreground/15" : bad ? "bg-destructive/10" : "bg-muted")}>
      <span
        className={cn(
          "flex size-16 items-center justify-center rounded-full",
          good ? "bg-sun text-sun-foreground" : bad ? "bg-destructive/15 text-destructive" : "bg-background text-primary dark:text-chart-2",
        )}
      >
        {confirming ? <Spinner className="size-7" /> : <status.icon className="size-8" />}
      </span>
      <div className="flex max-w-lg flex-col gap-2">
        <h1 className="text-3xl leading-[1.25] font-bold tracking-tight text-balance sm:text-4xl sm:leading-[1.25]">{status.title}</h1>
        <p className={cn("text-base", good ? "text-dusk-foreground/85" : "text-muted-foreground")}>{status.description}</p>
      </div>
      {status.actions}
    </section>
  );
}

/** Has the payment service ask Stripe, for a payment the webhook hasn't confirmed (e.g. it never arrived). */
function VerifyPaymentButton({ enrollmentId, ...props }: { enrollmentId: string } & React.ComponentProps<typeof Button>) {
  const t = useT();
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: async () => {
      const { data, error } = await paymentClient.api.payment.checkout.verify.post({ enrollmentId });
      if (error) throw error;
      return data;
    },
    onSuccess: ({ status }) => {
      if (status === "confirmed") {
        toast.add({
          type: "success",
          title: t("account.tickets.order.verify.confirmed"),
          description: t("account.tickets.order.verify.confirmedHint"),
        });
      } else if (status === "awaiting_payment") {
        toast.add({
          type: "info",
          title: t("account.tickets.order.verify.notFound"),
          description: t("account.tickets.order.verify.notFoundHint"),
        });
      }
      // anything else (e.g. the hold ran out) shows on the page itself
    },
    onError: (error) => toast.add({ type: "error", title: problemMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: enrollmentsKey }),
  });
  return (
    <Button {...props} disabled={verify.isPending || props.disabled} onClick={() => verify.mutate()}>
      {verify.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      {t("account.tickets.order.verify.button")}
    </Button>
  );
}

/** What happened to a cancelled order's money, by the state of the refund that cancelled it. */
function cancelledStatus(t: Translate, order: Enrollment) {
  const refund = order.refunds.at(-1);
  const title = refund?.initiatedBy === "organizer" ? t("account.tickets.order.cancelled.byOrganizer") : t("account.tickets.order.cancelled.byYou");
  if (!refund) return { title, description: t("account.tickets.order.cancelled.noRefund") };
  const amount = formatBaht(refund.amount);
  switch (refund.status) {
    case "succeeded":
    case "pending":
      return {
        title,
        description: t(refund.status === "succeeded" ? "account.tickets.order.cancelled.refunded" : "account.tickets.order.cancelled.refunding", { amount }),
      };
    case "requires_action":
      return {
        title,
        description: t("account.tickets.order.cancelled.requiresAction", { amount, orderId: order.id }),
      };
    case "failed":
    case "canceled":
      return { title, description: t("account.tickets.order.cancelled.failed", { amount }) };
  }
}

function OrderSummary({ order }: { order: Enrollment }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{order.event.title}</CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-4 shrink-0" />
            {formatDateRange(order.event.startsAt, order.event.endsAt)}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="size-4 shrink-0" />
            {order.event.venue}
          </span>
        </CardDescription>
        <CardAction>
          <EnrollmentStatusBadge enrollment={order} className="items-end" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span>
            {order.ticketType.name} × {order.quantity}
          </span>
          <span className="font-semibold tabular-nums">{formatPrice(order.total)}</span>
        </div>
        {order.refunds.map((refund) => (
          <div key={refund.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <Undo2 className="size-4 text-muted-foreground" />
              {t("account.tickets.order.summary.refundPercent", { percent: refund.percent })}
              <RefundStatusBadge status={refund.status} />
              <span className="text-xs text-muted-foreground">{formatDateTime(refund.createdAt)}</span>
            </span>
            <span className="tabular-nums">−{formatBaht(refund.amount)}</span>
          </div>
        ))}
        <Separator />
        <ol className="flex flex-col gap-2" aria-label={t("account.tickets.order.summary.attendees")}>
          {order.tickets.map((ticket) => {
            const row = (
              <>
                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {ticket.firstName} {ticket.lastName}
                  </span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Mail className="size-3.5 shrink-0" />
                    {ticket.email}
                  </span>
                </span>
              </>
            );
            return (
              <li key={ticket.id}>
                {order.status === "confirmed" ? (
                  <Link
                    to="/tickets/$ticketId"
                    params={{ ticketId: ticket.id }}
                    className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors hover:bg-muted"
                  >
                    {row}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 py-1.5">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
        <span className="text-xs text-muted-foreground">
          {t("account.tickets.order.summary.registeredAt", { date: formatDateTime(order.createdAt) })}
        </span>
      </CardContent>
    </Card>
  );
}

/** A confirmed paid order: what its refund policy gives back, and the button that cancels it for that. */
function RefundCard({ order }: { order: Enrollment }) {
  const t = useT();
  const terms = order.refundTerms;
  const open = terms !== null && isRefundOpen(terms);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Undo2 className="size-5" />
          {t("account.tickets.order.refund.title")}
        </CardTitle>
        <CardDescription>
          {!terms
            ? t("account.tickets.order.refund.none")
            : open
              ? t("account.tickets.order.refund.open", {
                  deadline: formatDateTime(terms.deadline),
                  amount: formatBaht(terms.amount),
                  percent: terms.percent,
                  total: formatPrice(order.total),
                })
              : t("account.tickets.order.refund.closed", { deadline: formatDateTime(terms.deadline) })}
        </CardDescription>
        {open && (
          <CardAction>
            <RefundButton order={order} terms={terms} />
          </CardAction>
        )}
      </CardHeader>
    </Card>
  );
}

function RefundButton({ order, terms }: { order: Enrollment; terms: NonNullable<Enrollment["refundTerms"]> }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const refund = useMutation({
    mutationFn: async () => {
      const { data, error } = await paymentClient.api.payment.refunds.post({ enrollmentId: order.id });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.add({
        type: "success",
        title: t("account.tickets.order.refund.done"),
        description: t("account.tickets.order.refund.doneHint", { amount: formatBaht(data.amount) }),
      });
      setOpen(false);
    },
    // e.g. the deadline passed meanwhile
    onError: (error) => toast.add({ type: "error", title: problemMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: enrollmentsKey }),
  });

  return (
    <AlertDialog open={open} onOpenChange={(next) => !refund.isPending && setOpen(next)}>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        <Undo2 data-icon="inline-start" />
        {t("account.tickets.order.refund.button")}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Undo2 />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("account.tickets.order.refund.dialogTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("account.tickets.order.refund.dialogDescription", {
              amount: formatBaht(terms.amount),
              percent: terms.percent,
              total: formatPrice(order.total),
              quantity: order.quantity,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={refund.isPending}>
            <ArrowLeft data-icon="inline-start" />
            {t("account.tickets.order.refund.back")}
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={refund.isPending} onClick={() => refund.mutate()}>
            {refund.isPending ? <Spinner data-icon="inline-start" /> : <Undo2 data-icon="inline-start" />}
            {t("account.tickets.order.refund.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
