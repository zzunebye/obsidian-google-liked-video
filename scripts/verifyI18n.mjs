import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadI18n(language) {
	globalThis.geuloTestLanguage = language;
	const bundle = await build({
		entryPoints: ["src/i18n/index.ts"],
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		plugins: [{
			name: "obsidian-language",
			setup(builder) {
				builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
				builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
					contents: "export function getLanguage() { return globalThis.geuloTestLanguage; }",
					loader: "js",
				}));
			},
		}],
	});
	return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${encodeURIComponent(language)}`);
}

for (const language of ["ko", "ko-KR", " KO_kr ", "en", "ja", ""]) {
	const api = await loadI18n(language);
	const korean = language.trim().toLowerCase().startsWith("ko");
	assert.equal(api.getLocale(), korean ? "ko" : "en");
	assert.equal(api.getFormatLocale(), korean ? "ko-KR" : "en-US");
	assert.equal(api.t("common.refresh"), korean ? "새로고침" : "Refresh");
	assert.equal(api.t("settings.videoDisplay"), korean ? "영상 표시" : "Video display");
	assert.equal(api.t("videos.empty"), korean ? "영상을 찾을 수 없습니다" : "No videos found");
	for (const count of [0, 1, 12]) {
		assert.equal(api.t("videos.count", { count }), korean ? `영상 ${count}개` : `${count} videos`);
	}
	globalThis.geuloTestLanguage = korean ? "en" : "ko";
	assert.equal(api.getLocale(), korean ? "ko" : "en", "Language stays fixed until plugin reload");
}

delete globalThis.geuloTestLanguage;
console.log("i18n verification passed");
