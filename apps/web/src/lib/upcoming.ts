import { useQuery } from "@tanstack/react-query";
import { publicEventsQueryOptions } from "./events";
import { isValidDate } from "./format";

/** The home page asks for this one page of events. The hero and the sections below read the same query, so it is one request. */
export const upcomingQuery = publicEventsQueryOptions({ page: 1, pageSize: 6 });

/** How many events the hero's programme lists. */
const LINEUP = 3;

const readable = (e: { startsAt: string; endsAt: string }) => isValidDate(e.startsAt) && isValidDate(e.endsAt);

/**
 * The upcoming events, split in two: `lineup` is the first few (soonest first, as the API sends them) and goes in the hero;
 * `rest` is everything else and fills the section below. An event whose dates don't parse never makes the lineup, and
 * comes last in `rest`, so no big tile shows "—" for a date.
 */
export function useUpcoming() {
  const query = useQuery(upcomingQuery);
  const items = query.data?.items;
  const lineup = items?.filter(readable).slice(0, LINEUP);
  const rest = items?.filter((e) => !lineup?.includes(e)).sort((a, b) => Number(readable(b)) - Number(readable(a)));
  return { ...query, lineup, rest, unavailable: query.isError || (!!items?.length && !lineup?.length) };
}
