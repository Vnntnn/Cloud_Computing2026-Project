import type { CSSProperties } from "react";

/** The entrance delay (ms) of an element with the `.reveal` class (effects.css): hero text and controls arrive in order, nothing waits on it. */
export const reveal = (ms: number) => ({ "--d": ms }) as CSSProperties;
