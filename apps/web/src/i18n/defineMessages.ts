export type Params = Record<string, string | number>;
export type Fn = (params: Params) => string;
export type Msg = string | Fn;
type Tree = { [key: string]: Msg | Tree };
type Shape<T> = { [K in keyof T]: T[K] extends Msg ? Msg : Shape<T[K]> };

/** `th` decides the keys; `en` must have the same shape (tsc fails on a missing one). A leaf is a string with `{param}`s, or a function for plurals. */
export const defineMessages = <T extends Tree>(th: T, en: Shape<T>) => ({ th, en });
