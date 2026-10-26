import { useSyncExternalStore } from "react";
import type { Msg, Params, Fn } from "./defineMessages";
import { account } from "./messages/account";
import { common } from "./messages/common";
import { dashboard } from "./messages/dashboard";
import { eventAdmin } from "./messages/eventAdmin";
import { pub } from "./messages/pub";
import { shared } from "./messages/shared";

export { defineMessages } from "./defineMessages";

export type Locale = "th" | "en";
export const locales: Locale[] = ["th", "en"];
/** BCP 47 tags for Intl: th-TH gives the Buddhist-era years the Thai UI uses. */
export const intlLocale: Record<Locale, string> = { th: "th-TH", en: "en-GB" };

const dictionaries = {
  th: { common: common.th, shared: shared.th, pub: pub.th, account: account.th, eventAdmin: eventAdmin.th, dashboard: dashboard.th },
  en: { common: common.en, shared: shared.en, pub: pub.en, account: account.en, eventAdmin: eventAdmin.en, dashboard: dashboard.en },
};

type Messages = typeof dictionaries.th;
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Msg ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Paths<Messages>;

const STORAGE_KEY = "locale";

function read(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "th";
  } catch {
    return "th";
  }
}

let current: Locale = read();
const listeners = new Set<() => void>();

export const getLocale = () => current;

export function setLocale(next: Locale) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // private window: the choice lasts until reload
  }
  document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export type Translate = (key: MessageKey, params?: Params) => string;

const translators = Object.fromEntries(
  locales.map((locale) => {
    const translate: Translate = (key, params) => {
      const lookup = (dict: unknown) =>
        key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
      const message = lookup(dictionaries[locale]) ?? lookup(dictionaries.th);
      if (typeof message === "function") return (message as Fn)(params ?? {});
      if (typeof message !== "string") return key;
      return params ? message.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? "")) : message;
    };
    return [locale, translate];
  }),
) as Record<Locale, Translate>;

/** Translate with the current language. For code that runs while rendering, outside a component (helpers, `columns(t)` factories); never at module top level. */
export const t: Translate = (key, params) => translators[current](key, params);

/** The translator of the current language. The component re-renders on a switch, and the function changes identity, so it is safe in memo/effect deps. */
export function useT(): Translate {
  return translators[useSyncExternalStore(subscribe, getLocale)];
}

export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale);
}
