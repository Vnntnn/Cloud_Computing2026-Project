import { queryOptions } from "@tanstack/react-query";
import { CircleCheckBig, CircleX, Clock, CreditCard, Hourglass, Undo2, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import { registrationClient } from "./api";
import { retryUnlessClientError } from "./events";

export type EnrollmentStatus = "pending" | "awaiting_payment" | "confirmed" | "rejected" | "expired" | "cancelled";

type BadgeVariant = "secondary" | "default" | "outline" | "destructive";

export const enrollmentStatusInfo: Record<EnrollmentStatus, { label: string; icon: LucideIcon; variant: BadgeVariant }> = {
  pending: { get label() { return t("shared.enrollmentStatus.pending"); }, icon: Hourglass, variant: "outline" },
  awaiting_payment: { get label() { return t("shared.enrollmentStatus.awaiting_payment"); }, icon: CreditCard, variant: "secondary" },
  confirmed: { get label() { return t("shared.enrollmentStatus.confirmed"); }, icon: CircleCheckBig, variant: "default" },
  rejected: { get label() { return t("shared.enrollmentStatus.rejected"); }, icon: CircleX, variant: "destructive" },
  expired: { get label() { return t("shared.enrollmentStatus.expired"); }, icon: Clock, variant: "outline" },
  cancelled: { get label() { return t("shared.enrollmentStatus.cancelled"); }, icon: Undo2, variant: "outline" },
};

export const enrollmentsKey = ["enrollments"] as const;

export const availabilityQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: [...enrollmentsKey, "availability", eventId],
    queryFn: async () => {
      const { data, error } = await registrationClient.api.regis.events({ eventId }).availability.get();
      if (error) throw error;
      return data;
    },
    retry: retryUnlessClientError,
  });

export type Availability = NonNullable<
  Awaited<ReturnType<ReturnType<typeof registrationClient.api.regis.events>["availability"]["get"]>>["data"]
>[number];

export const enrollmentDetailKey = (enrollmentId: string) => [...enrollmentsKey, "detail", enrollmentId] as const;

export const enrollmentQueryOptions = (enrollmentId: string) =>
  queryOptions({
    queryKey: enrollmentDetailKey(enrollmentId),
    queryFn: async () => {
      const { data, error } = await registrationClient.api.regis.enrollments({ id: enrollmentId }).get();
      if (error) throw error;
      return data;
    },
    retry: retryUnlessClientError,
  });

export type Enrollment = NonNullable<
  Awaited<ReturnType<ReturnType<typeof registrationClient.api.regis.enrollments>["get"]>>["data"]
>;

export const eventEnrollmentsKey = (eventId: string) => [...enrollmentsKey, "event", eventId] as const;

export const eventEnrollmentsQueryOptions = (
  eventId: string,
  query: { page?: number; pageSize?: number; q?: string; status?: EnrollmentStatus; ticketTypeId?: string },
) =>
  queryOptions({
    queryKey: [...eventEnrollmentsKey(eventId), query],
    queryFn: async () => {
      const { data, error } = await registrationClient.api.regis.events({ eventId }).enrollments.get({ query });
      if (error) throw error;
      return data;
    },
  });

export const myTicketsQueryOptions = queryOptions({
  queryKey: [...enrollmentsKey, "mine"],
  queryFn: async () => {
    const { data, error } = await registrationClient.api.regis.tickets.mine.get();
    if (error) throw error;
    return data;
  },
});

export type MyTicket = NonNullable<
  Awaited<ReturnType<typeof registrationClient.api.regis.tickets.mine.get>>["data"]
>["tickets"][number];

export const ticketQueryOptions = (ticketId: string) =>
  queryOptions({
    queryKey: [...enrollmentsKey, "ticket", ticketId],
    queryFn: async () => {
      const { data, error } = await registrationClient.api.regis.tickets({ id: ticketId }).get();
      if (error) throw error;
      return data;
    },
    retry: retryUnlessClientError,
  });

/** "Somchai Jaidee" → first name "Somchai", last name "Jaidee"; the account's own fields win when set. */
export function splitName(user: { name: string; firstName?: string | null; lastName?: string | null }) {
  const [first = "", ...rest] = user.name.trim().split(/\s+/);
  return { firstName: user.firstName?.trim() || first, lastName: user.lastName?.trim() || rest.join(" ") };
}
