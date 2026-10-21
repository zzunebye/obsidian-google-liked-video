import type { en } from "./en";

export type Locale = "en" | "ko" | "zh";
export type TranslationKey = keyof typeof en;
export type TranslationDictionary = {
	readonly [K in TranslationKey]: typeof en[K];
};
export type TranslationArgs<K extends TranslationKey> =
	typeof en[K] extends (...args: infer A) => string ? A : [];
