import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { registrationClient } from "./api";
import { availabilityQueryOptions, type Availability } from "./enrollments";

type Seats = Pick<Availability, "ticketTypeId" | "confirmed" | "reserved" | "pending" | "held" | "remaining">;

// reconnect after 1s, 2s, 4s… up to this
const MAX_RETRY_MS = 30_000;

/**
 * The availability with pushed seats. sold_out follows the seats, unless the viewer can't enroll
 * for another reason, or their own running hold took the last seats (keep in step with
 * getAvailability in apps/registration, which decides that).
 */
export function withLiveSeats(availability: Availability, seats: Seats): Availability {
  const seatsDecide = availability.state === "open" || availability.state === "sold_out";
  const holding = !!availability.hold && Date.parse(availability.hold.expiresAt) > Date.now();
  return {
    ...availability,
    ...seats,
    state: seatsDecide ? (seats.remaining === 0 && !holding ? "sold_out" : "open") : availability.state,
  };
}

/**
 * Keeps the event's seats in its availability query current over the registration service's
 * live socket (the viewer's own state still comes from the GET). Reconnects with backoff, except
 * when the service refuses the event (close codes 4xxx), which the GET already shows.
 */
export function useLiveSeats(eventId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!eventId) return;
    const { queryKey } = availabilityQueryOptions(eventId);
    let socket: { close(): unknown } | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;

    const apply = (seats: Seats[]) => {
      const current = queryClient.getQueryData(queryKey);
      // the GET hasn't answered yet; it brings its own counts
      if (!current) return;
      const known = new Set(current.map((availability) => availability.ticketTypeId));
      if (seats.length !== current.length || seats.some((seat) => !known.has(seat.ticketTypeId))) {
        // a ticket type was added or removed: the list and the viewer's state for it come from the GETs
        void queryClient.invalidateQueries({ queryKey });
        void queryClient.invalidateQueries({ queryKey: ["ticket-types"] });
        return;
      }
      queryClient.setQueryData(
        queryKey,
        current.map((availability) =>
          withLiveSeats(availability, seats.find((seat) => seat.ticketTypeId === availability.ticketTypeId)!),
        ),
      );
    };

    const connect = () => {
      const live = registrationClient.api.regis.events({ eventId }).availability.live.subscribe();
      live.subscribe(({ data }) => {
        attempts = 0;
        apply(data);
      });
      live.on("close", (event) => {
        if (stopped || event.code >= 4000) return;
        retry = setTimeout(connect, Math.min(MAX_RETRY_MS, 1000 * 2 ** attempts++));
      });
      socket = live;
    };

    // one tick later, so the throwaway first mount of React's StrictMode (development) is cleaned up before it ever opens a socket;
    // closing a socket that is still connecting is reported as an error by Firefox
    retry = setTimeout(connect, 0);
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [eventId, queryClient]);
}
