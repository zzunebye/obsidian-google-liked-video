import { en } from "./en";
import { ko } from "./ko";
import { getLocale } from "./locale";
import type { Locale, TranslationArgs, TranslationDictionary, TranslationKey } from "./types";

const dictionaries: Readonly<Record<Locale, TranslationDictionary>> = { en, ko };

export function t<K extends TranslationKey>(key: K, ...args: TranslationArgs<K>): string;
export function t(key: TranslationKey, params?: TranslationArgs<"videos.count">[0]): string {
	const message = dictionaries[getLocale()][key];
	if (typeof message === "string") return message;
	if (!params) throw new TypeError(`Missing translation parameters: ${key}`);
	return message(params);
}

export { getLocale, getFormatLocale } from "./locale";
export type { Locale, TranslationKey } from "./types";
