import { MarkdownView } from 'obsidian';
import type { App, Editor, TFile } from 'obsidian';

export type AppendNoteContentOptions = {
	readonly text: string;
	readonly skipIfContains?: string;
};

function findEditableEditor(app: App, file: TFile): Editor | null {
	const activeEditor = app.workspace.activeEditor;
	if (
		activeEditor?.file === file
		&& activeEditor.editor !== undefined
		&& (!(activeEditor instanceof MarkdownView) || activeEditor.getMode() === 'source')
	) {
		return activeEditor.editor;
	}

	let matchingEditor: Editor | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (matchingEditor !== null) return;
		const view = leaf.view;
		if (
			view instanceof MarkdownView
			&& view.file === file
			&& view.getMode() === 'source'
		) {
			matchingEditor = view.editor;
		}
	});
	return matchingEditor;
}

export interface NoteContentEdit {
	from: number;
	to: number;
	text: string;
}

export async function readNoteContent(app: App, file: TFile): Promise<string> {
	return findEditableEditor(app, file)?.getValue() ?? app.vault.read(file);
}

export async function editNoteContent(
	app: App,
	file: TFile,
	getEdit: (content: string) => NoteContentEdit | null,
): Promise<boolean> {
	const editor = findEditableEditor(app, file);
	if (editor) {
		const edit = getEdit(editor.getValue());
		if (!edit) return false;
		editor.replaceRange(edit.text, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
		return true;
	}

	let edited = false;
	await app.vault.process(file, content => {
		const edit = getEdit(content);
		if (!edit) return content;
		edited = true;
		return content.slice(0, edit.from) + edit.text + content.slice(edit.to);
	});
	return edited;
}

export async function appendNoteContent(
	app: App,
	file: TFile,
	options: AppendNoteContentOptions,
): Promise<boolean> {
	const editor = findEditableEditor(app, file);
	if (editor !== null) {
		if (
			options.skipIfContains !== undefined
			&& editor.getValue().includes(options.skipIfContains)
		) {
			return false;
		}

		const lastLine = editor.lastLine();
		editor.replaceRange(options.text, {
			line: lastLine,
			ch: editor.getLine(lastLine).length,
		});
		return true;
	}

	let appended = false;
	await app.vault.process(file, (data) => {
		if (
			options.skipIfContains !== undefined
			&& data.includes(options.skipIfContains)
		) {
			return data;
		}
		appended = true;
		return data + options.text;
	});
	return appended;
}
