import { getFrontMatterInfo } from 'obsidian';
import type { NoteContentEdit } from './noteEditingUtils';

const SUMMARY_START = '<!-- geulo:ai-summary:start -->';
const SUMMARY_END = '<!-- geulo:ai-summary:end -->';

export type SummaryNoteRegion =
	| { kind: 'empty' }
	| { kind: 'legacy'; text: string }
	| { kind: 'marked'; from: number; to: number; text: string };

export function getSummaryNoteRegion(content: string): SummaryNoteRegion {
	const from = content.indexOf(SUMMARY_START);
	const end = content.indexOf(SUMMARY_END);
	if (from >= 0 && end > from
		&& content.indexOf(SUMMARY_START, from + SUMMARY_START.length) === -1
		&& content.indexOf(SUMMARY_END, end + SUMMARY_END.length) === -1
		&& (from === 0 || content[from - 1] === '\n')
		&& /^\r?\n/.test(content.slice(from + SUMMARY_START.length))
		&& content[end - 1] === '\n'
		&& /^(?:\r?\n|$)/.test(content.slice(end + SUMMARY_END.length))) {
		const to = end + SUMMARY_END.length;
		return { kind: 'marked', from, to, text: content.slice(from, to) };
	}
	// Older notes have no reliable end boundary; never infer it from Markdown headings.
	return content.includes('geulo:ai-summary:') || content.includes('## AI Summary')
		? { kind: 'legacy', text: content }
		: { kind: 'empty' };
}

export function createSummaryNoteBlock(summary: string, asBlockquote = false, includeHeading = true): string {
	if (!summary.trim() || summary.includes('geulo:ai-summary:')) {
		throw new Error('This summary cannot be saved as a managed note section. Copy its text instead.');
	}
	const content = summary.trim();
	const formatted = asBlockquote
		? content.split(/\r?\n/).map(line => line ? `> ${line}` : '>').join('\n')
		: content;
	return `${SUMMARY_START}\n${includeHeading ? '# AI Summary\n' : ''}${formatted}\n${SUMMARY_END}`;
}

export function getSummaryNoteEdit(content: string, block: string, expected: SummaryNoteRegion): NoteContentEdit | null {
	const current = getSummaryNoteRegion(content);
	if (expected.kind === 'empty' && current.kind === 'empty') {
		return { from: content.length, to: content.length, text: `\n\n${block}\n` };
	}
	if (expected.kind === 'marked' && current.kind === 'marked' && expected.text === current.text) {
		return { from: current.from, to: current.to, text: block };
	}
	if (expected.kind === 'legacy' && current.kind === 'legacy' && expected.text === content) {
		return { from: getFrontMatterInfo(content).contentStart, to: content.length, text: `${block}\n` };
	}
	return null;
}
