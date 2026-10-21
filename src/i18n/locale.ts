import { getLanguage } from "obsidian";
import type { Locale } from "./types";

export function resolveLocale(language: string): Locale {
	return language.trim().toLowerCase().split(/[-_]/)[0] === "ko" ? "ko" : "en";
}

const localeAtPluginLoad = resolveLocale(getLanguage());

export function getLocale(): Locale {
	return localeAtPluginLoad;
}

export function getFormatLocale(): string {
	return localeAtPluginLoad === "ko" ? "ko-KR" : "en-US";
}
