import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

// Real shared cards and tags, with vault/provider actions replaced by local fixtures.
const mocks = new Map([
	["obsidian", `export class Menu {} export class TFile {} export class Notice {} export const moment = () => ({format: () => "Oct 20, 2026"});`],
	["obsidian-daily-notes-interface", `export const getDailyNote = () => null; export const getAllDailyNotes = () => []; export const createDailyNote = () => null;`],
	["../store/pluginContext", `export const usePlugin = () => globalThis.cardFixture.plugin;`],
	["../debug", `export const debugLogger = {error:console.error};`],
	["src/services/summaryNoteService", `export const saveSummaryToNote = async () => {};`],
	["src/utils/noteEditingUtils", `export const appendNoteContent = async () => {};`],
	["src/ui/VideoInfoModal", `export class VideoInfoModal {}`],
	["./SummarySection", `export const SummarySection = () => null;`],
	["./VideoCommentsModal", `export class VideoCommentsModal { constructor() {globalThis.cardFixture.comments = true;} open() {} }`],
	["./AddToPlaylistModal", `export class AddToPlaylistModal {}`],
	["./TranscriptWorkspace", `export const useTranscriptWorkspace = () => ({openTranscript: () => {globalThis.cardFixture.transcript = true;}});`],
]);
const result = await build({
	stdin: {resolveDir:process.cwd(),loader:"tsx",contents:`
		import React from "react";
		import {createRoot} from "react-dom/client";
		import {VideoCard} from "./src/ui/VideoCard";
		const plugin = {settings:{enableAISummary:true,showVideoTags:true},summaryStorage:{subscribe:() => () => {},getOneLineSummary:id => id === "liked" ? "핵심 내용을 다시 찾기 위한 짧은 요약 미리보기입니다." : null}};
		globalThis.cardFixture = {plugin};
		const root=createRoot(document.getElementById("root"));
		function render(){root.render(<div className="fixture-cards">{["liked","subscription","playlist"].map((source,i)=><VideoCard key={source} id={source} source={source}
			videoInfo={{id:source,snippet:{title:i===1 ? "길고 긴 한글 제목과 채널명이 좁은 pane에서 표시되는 방식을 확인합니다" : "Backend from first principles: building reliable systems",channelTitle:i===1 ? "아주 긴 채널 이름과 다양한 기술 이야기" : "Example channel",channelId:"channel",publishedAt:"2026-10-20",thumbnails:{medium:{url:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%235b6e8a'/%3E%3C/svg%3E"}},tags:i===2 ? [] : ["architecture","backend systems","design"]},contentDetails:{duration:"PT12M30S"},statistics:{viewCount:"123456",likeCount:1234,commentCount:"56"}}}
			url="https://example.com" noteExists={false} isLiked={source==="liked"}
			sortMetric={source==="subscription" ? {kind:"averageViewsPerDay",value:1234} : undefined}
			onUnlike={()=>{cardFixture.unliked=true;}} onLike={()=>{cardFixture.liked=true;}} onChannelClick={()=>{cardFixture.channel=true;}}
			onTagClick={()=>{cardFixture.tag=true;}} onLinkClick={()=>{cardFixture.opened=true;}} onAddToDailyNote={async()=>{}} />)}</div>);}
		globalThis.setCardAi = value => {plugin.settings.enableAISummary=value;render();}; render();
	`},
	bundle:true,write:false,format:"iife",jsx:"automatic",
	plugins:[{name:"card-fixtures",setup(builder){
		builder.onResolve({filter:/.*/},args=>mocks.has(args.path)?{path:args.path,namespace:"fixture"}:undefined);
		builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:mocks.get(args.path),loader:"tsx",resolveDir:process.cwd()}));
	}}],
});
const css=await readFile("styles.css","utf8");
const html=`<!doctype html><meta charset="utf-8"><style>
:root {--background-primary:#fff;--background-primary-alt:#f8f8f8;--background-secondary:#f0f0f0;--background-modifier-hover:#eee;--background-modifier-border:#ddd;--background-modifier-border-hover:#999;--text-normal:#222;--text-muted:#666;--text-faint:#777;--text-accent:#7654b5;--interactive-accent:#7654b5;--font-interface:system-ui;}
*{box-sizing:border-box}body{margin:0;padding:12px;font:14px system-ui;color:var(--text-normal);background:var(--background-primary)}button{font:inherit}.fixture-cards{display:grid;gap:16px} ${css}
</style><div id="root"></div><script>${result.outputFiles[0].text}</script>`;
createServer((request,response)=>{response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});response.end(html);})
	.listen(0,"127.0.0.1",function(){console.log(`Video cards: http://127.0.0.1:${this.address().port} (stop with Ctrl+C)`);});
