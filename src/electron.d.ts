declare module 'electron' {
	export const shell: {
		openExternal(url: string): Promise<void>;
	};
}
