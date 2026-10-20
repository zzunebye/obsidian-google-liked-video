import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

// Render real playlist cards with local fixtures; no YouTube requests or vault writes.
const result = await build({
	stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
		import React from "react";
		import { createRoot } from "react-dom/client";
		import { PlaylistCard } from "./src/ui/PlaylistCard";
		const titles = ["Backend from first principles: a very long playlist title", "긴 한글 재생목록 제목과 설명이 있는 목록", "Empty playlist"];
		createRoot(document.getElementById("root")).render(<div className="playlists-grid">{titles.map((title, i) => <PlaylistCard key={i}
			playlist={{id:String(i),title,description:"A long playlist description for testing narrow panes.",itemCount:i ? 0 : 123456,publishedAt:"2026-10-20",isOwnedByUser:i === 1,isUnavailable:i === 0,thumbnailUrl:i === 0 ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%237654b5'/%3E%3C/svg%3E" : undefined}}
			isPinned={i === 0} onPlaylistSelect={() => {globalThis.selectedPlaylist = String(i);}} onTogglePin={() => {globalThis.pinnedPlaylist = String(i);}}
		/> )}</div>);
	` },
	bundle: true, write: false, jsx: "automatic", format: "iife",
	plugins: [{name:"obsidian-menu-fixture", setup(builder) {
		builder.onResolve({filter:/^obsidian$/}, () => ({path:"obsidian",namespace:"fixture"}));
		builder.onLoad({filter:/.*/,namespace:"fixture"}, () => ({contents:"export class Menu {}"}));
	}}],
});
const css = await readFile("styles.css", "utf8");
const html = `<!doctype html><meta charset="utf-8"><style>
:root { --background-primary:#fff; --background-secondary:#f5f5f5; --background-modifier-border:#ddd; --background-modifier-hover:#eee; --background-modifier-border-hover:#999; --text-normal:#222; --text-muted:#666; --text-faint:#777; --text-accent:#7654b5; --interactive-accent:#7654b5; --font-ui-small:13px; }
* {box-sizing:border-box;} body {margin:0;padding:12px;font:14px system-ui;background:var(--background-primary);color:var(--text-normal);} button {font:inherit;} button:focus-visible {outline:2px solid var(--interactive-accent);} ${css}
</style><div id="root"></div><script>${result.outputFiles[0].text}</script>`;
createServer((request,response) => {
	response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
	response.end(html);
}).listen(0,"127.0.0.1",function () {console.log(`Playlist fixture: http://127.0.0.1:${this.address().port} (stop with Ctrl+C)`);});
