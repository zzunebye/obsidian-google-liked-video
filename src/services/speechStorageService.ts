import { normalizePath } from 'obsidian';
import type { DataAdapter } from 'obsidian';

export class SpeechStorageService {
	private readonly directory: string;

	constructor(private readonly adapter: DataAdapter, manifestDir: string) {
		this.directory = normalizePath(`${manifestDir}/speech-cache`);
	}

	async getKey(text: string): Promise<string> {
		const input = JSON.stringify([1, 'mp3', text]);
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
		return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
	}

	async read(key: string): Promise<Blob | null> {
		const path = this.path(key);
		if (!await this.adapter.exists(path)) return null;
		const bytes = await this.adapter.readBinary(path);
		return bytes.byteLength ? new Blob([bytes], { type: 'audio/mpeg' }) : null;
	}

	async write(key: string, audio: Blob): Promise<void> {
		if (!await this.adapter.exists(this.directory)) {
			try { await this.adapter.mkdir(this.directory); }
			catch (error: unknown) { if (!await this.adapter.exists(this.directory)) throw error; }
		}
		await this.adapter.writeBinary(this.path(key), await audio.arrayBuffer());
	}

	async remove(key: string): Promise<void> {
		const path = this.path(key);
		if (await this.adapter.exists(path)) await this.adapter.remove(path);
	}

	private path(key: string): string {
		return normalizePath(`${this.directory}/${key}.mp3`);
	}
}
