/* global globalThis */
import assert from 'node:assert/strict';
import { builtinModules, createRequire } from 'node:module';
import Module from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-cache-ownership-'));
const outputPath = path.join(outputDirectory, 'main.cjs');

class FakeElement {
	constructor(tag = 'div', options = {}) {
		this.tag = tag;
		this.text = options.text ?? '';
		this.children = [];
		this.listeners = new Map();
		this.disabled = false;
	}

	createEl(tag, options = {}) {
		const element = new FakeElement(tag, options);
		this.children.push(element);
		return element;
	}

	createDiv(options = {}) {
		return this.createEl('div', options);
	}

	addEventListener(event, listener) {
		this.listeners.set(event, listener);
	}

	empty() {
		this.children = [];
	}

	findButton(text) {
		if (this.tag === 'button' && this.text === text) return this;
		for (const child of this.children) {
			const match = child.findButton(text);
			if (match) return match;
		}
		return null;
	}

	collectText() {
		return [this.text, ...this.children.flatMap((child) => child.collectText())].filter(Boolean);
	}
}

const modalHistory = [];
const notices = [];
const choiceLabels = {
	associate: 'Use existing data',
	replace: 'Replace with connected account',
	cancel: 'Cancel',
};

class FakeModal {
	constructor() {
		this.contentEl = new FakeElement();
		this.title = '';
	}

	setTitle(title) {
		this.title = title;
	}

	open() {
		this.onOpen();
		modalHistory.push({ title: this.title, text: this.contentEl.collectText() });
		const button = this.contentEl.findButton(choiceLabels[globalThis.modalChoice]);
		assert.ok(button, `Expected ${globalThis.modalChoice} button`);
		button.listeners.get('click')();
	}

	close() {
		this.onClose();
	}
}

class FakeNotice {
	constructor(message) {
		notices.push(String(message));
	}
}

const fallback = function () {};
const obsidian = new globalThis.Proxy({
	ItemView: class {},
	Menu: class {},
	Modal: FakeModal,
	Notice: FakeNotice,
	Platform: { isDesktop: true },
	Plugin: class {},
	PluginSettingTab: class {},
	Setting: class {},
	normalizePath: (value) => value,
	requestUrl: async () => ({ status: 200, json: {} }),
}, {
	get(target, property) {
		return property in target ? target[property] : fallback;
	},
});

globalThis.window = {
	localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
};
globalThis.document = { createElement: () => ({}) };
Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: { clipboard: {} },
});

try {
	await build({
		entryPoints: ['src/main.ts'],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		outfile: outputPath,
		external: ['obsidian', ...builtinModules],
		define: { 'process.env.NODE_ENV': '"production"' },
	});

	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (request === 'obsidian') return obsidian;
		return originalLoad.call(this, request, parent, isMain);
	};
	let PluginClass;
	try {
		PluginClass = createRequire(import.meta.url)(outputPath).default;
	} finally {
		Module._load = originalLoad;
	}

	const createPlugin = ({ ownerChannelId, hasData = true, identity = 'current-channel' }) => {
		const plugin = Object.create(PluginClass.prototype);
		plugin.app = {};
		plugin.ownershipWarnings = new Set();
		plugin.accountIdentityService = {
			getCurrentIdentity: async () => ({
				channelId: identity,
				channelTitle: 'Current channel',
			}),
			reset() {},
		};
		let owner = ownerChannelId;
		plugin.subscriptionService = {
			getSnapshot: () => hasData
				? { channels: [{ id: 'saved' }], videos: [], failedChannels: [] }
				: null,
			getOwnerChannelId: () => owner,
			setOwnerChannelId: async (nextOwner) => { owner = nextOwner; },
		};
		return { plugin, getOwner: () => owner };
	};

	globalThis.modalChoice = 'associate';
	let fixture = createPlugin({ ownerChannelId: null });
	assert.deepEqual(await fixture.plugin.prepareSubscriptionSync(), {
		ownerChannelId: 'current-channel',
		replaceExisting: false,
	});
	assert.equal(fixture.getOwner(), 'current-channel');
	assert.match(modalHistory.at(-1).title, /Connect existing subscriptions/);
	assert.ok(modalHistory.at(-1).text.includes('Use existing data'));

	globalThis.modalChoice = 'replace';
	fixture = createPlugin({ ownerChannelId: 'other-channel' });
	assert.deepEqual(await fixture.plugin.prepareSubscriptionSync(), {
		ownerChannelId: 'current-channel',
		replaceExisting: true,
	});
	assert.equal(fixture.getOwner(), 'other-channel');
	assert.match(modalHistory.at(-1).title, /Replace subscriptions/);
	assert.ok(modalHistory.at(-1).text.includes('Replacement happens only after data for the connected account is fetched successfully.'));
	assert.ok(modalHistory.at(-1).text.includes('AI summaries and Obsidian notes remain shared in this vault.'));

	globalThis.modalChoice = 'cancel';
	fixture = createPlugin({ ownerChannelId: 'other-channel' });
	assert.equal(await fixture.plugin.prepareSubscriptionSync(), null);
	assert.equal(fixture.getOwner(), 'other-channel');

	fixture = createPlugin({ ownerChannelId: 'other-channel' });
	await assert.rejects(
		fixture.plugin.requireSubscriptionCacheOwnership(),
		(error) => error.name === 'CacheOwnershipError' && /does not own/.test(error.message),
	);
	assert.equal(fixture.getOwner(), 'other-channel');

	globalThis.modalChoice = 'associate';
	fixture = createPlugin({ ownerChannelId: null });
	await fixture.plugin.requireSubscriptionCacheOwnership();
	assert.equal(fixture.getOwner(), 'current-channel');

	fixture = createPlugin({ ownerChannelId: 'other-channel' });
	const automaticContext = {
		cacheLabel: 'subscriptions',
		ownerChannelId: 'other-channel',
		hasData: true,
		assignOwner: async () => assert.fail('Automatic sync must not change the owner'),
	};
	assert.equal(await fixture.plugin.prepareCacheSyncOwnership(automaticContext, false), null);
	assert.equal(await fixture.plugin.prepareCacheSyncOwnership(automaticContext, false), null);
	assert.equal(notices.filter((notice) => notice.includes('Automatic subscriptions sync was skipped')).length, 1);

	console.log('PASS: unowned caches can be associated through the modal');
	console.log('PASS: account mismatch requires explicit replacement and keeps the old owner until success');
	console.log('PASS: mutations and automatic sync stop before mixing account-owned caches');
} finally {
	delete globalThis.modalChoice;
	await rm(outputDirectory, { recursive: true, force: true });
}
