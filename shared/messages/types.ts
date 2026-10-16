/** A locale must provide the same keys and interpolation arguments as Chinese. */
export type TranslationOf<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => TranslationOf<R>
  : T extends string ? string
  : T extends RegExp ? RegExp
  : T extends object ? { readonly [K in keyof T]: TranslationOf<T[K]> }
  : T;
