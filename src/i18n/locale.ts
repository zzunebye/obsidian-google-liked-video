import { getLanguage } from "obsidian";
import type { Locale } from "./types";

export function resolveLocale(language: string): Locale {
	const languageCode = language.trim().toLowerCase().split(/[-_]/)[0];
	if (languageCode === "ko") return "ko";
	if (languageCode === "zh") return "zh";
	return "en";
}

const localeAtPluginLoad = resolveLocale(getLanguage());

export function getLocale(): Locale {
	return localeAtPluginLoad;
}

export function getFormatLocale(): string {
	if (localeAtPluginLoad === "ko") return "ko-KR";
	return localeAtPluginLoad === "zh" ? "zh-CN" : "en-US";
}
