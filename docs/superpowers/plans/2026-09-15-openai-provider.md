# OpenAI Provider Implementation Plan

**Goal:** Add OpenAI as a transcript-based AI summary provider using the Responses API, separate OpenAI credentials, and a preset-plus-custom model picker.

**Architecture:** Introduce a dedicated `OpenAIService` under the existing `BaseAIService` contract. Route it through the existing AI factory, reuse `TranscriptService`, and preserve the current summary storage and source-provenance paths. Keep Gemini video analysis and OpenRouter transcript summarization unchanged.

**Tech Stack:** TypeScript, React, Obsidian API `requestUrl`, OpenAI Responses API, esbuild, Node fixture scripts, ESLint

**Approved design:** `docs/superpowers/specs/2026-09-15-openai-provider-design.md`

**Worktree constraint:** The worktree already contains uncommitted OpenRouter model-picker changes in `src/main.ts`, `src/services/aiServiceError.ts`, `src/services/openRouterService.ts`, `src/types.ts`, `src/views/GoogleLikedVideoSettingTab.ts`, and `styles.css`, plus unrelated work in `src/views/LikedVideoView.tsx`. Preserve those edits and stage only OpenAI-provider hunks and files when preparing a commit or PR.

---

### Task 1: Extend the persisted provider contract

**Files:**
- Modify: `src/types.ts`
- Modify: `src/main.ts`

- [ ] Add `openai` to `AI_PROVIDERS` between `openrouter` and `gemini`, and add the `OpenAI` provider label.
- [ ] Add `OPENAI_MODEL_PRESETS` in this order: `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`. Add the corresponding literal type and `isOpenAIModelPreset` guard using the same pattern as the current OpenRouter picker.
- [ ] Add `openAIApiKey: string` and `openAIModel: string` to `ObsidianGoogleLikedVideoSettings`.
- [ ] Add empty-key and `gpt-5.6-luna` model defaults in `DEFAULT_SETTINGS`. Keep `aiProvider: 'openrouter'` unchanged.
- [ ] Confirm that `loadSettings()` accepts stored `openai`, fills absent OpenAI fields from defaults, preserves arbitrary custom OpenAI model IDs, and still replaces an invalid provider with the existing default. Do not add a settings migration or model validation that would discard custom IDs.

### Task 2: Lock the OpenAI service boundary with fixtures

**Files:**
- Create: `scripts/verifyOpenAIService.mjs`

- [ ] Create a Node verification driver that bundles the real TypeScript OpenAI service with esbuild into a temporary directory. Stub only `obsidian.requestUrl` and the transcript-service module at the esbuild boundary; do not add production-only test exports or hooks.
- [ ] Provide a fake transcript with a language name and multiple timed segments, capture outbound requests, and simulate OpenAI SSE and JSON responses.
- [ ] Before creating the service, run `node scripts/verifyOpenAIService.mjs` and confirm it fails because `src/services/openAIService.ts` does not exist.
- [ ] Specify assertions for the streaming summary path: Responses endpoint, bearer authorization, chosen model, `stream: true`, `store: false`, resolved preferred transcript language, timestamped transcript input, transcript-as-untrusted-source instruction, ignored lifecycle events, ordered `response.output_text.delta` accumulation, completed model, and `source: 'transcript'`.
- [ ] Specify assertions for non-streaming one-line completion: no transcript fetch, `stream: false`, `store: false`, prompt input, and ordered extraction of every assistant `output_text` content block even when it is not the first output item.
- [ ] Specify boundary assertions for malformed or irrelevant SSE payloads, a completed response with no output text, a transcript failure that prevents any OpenAI request, missing key, HTTP 400/401/403/429/500 mapping, and logical cancellation before a request is sent.

### Task 3: Implement the dedicated Responses API service

**Files:**
- Create: `src/services/openAIService.ts`

- [ ] Define the Responses API URL as `https://api.openai.com/v1/responses` and create `OpenAIService extends BaseAIService` with service name `OpenAI`, source `transcript`, a private model, and the preferred transcript language.
- [ ] For summary generation, reuse `transcriptService.getTranscript(videoId, signal, preferredLanguage)`. Convert `TranscriptServiceError` to the existing `AIServiceError('transcript_error', message)` and allow abort errors to retain their existing cancellation semantics.
- [ ] Format transcript segments as `[${segment.start}s] ${segment.text}` joined by newlines.
- [ ] Build the streaming body with the selected model, `stream: true`, `store: false`, the configured summary prompt plus transcript-grounding and prompt-injection instructions in `instructions`, and the language-labelled timestamped transcript in `input`.
- [ ] Build authorization headers with `Content-Type: application/json` and `Authorization: Bearer <OpenAI key>`.
- [ ] Parse a streaming chunk only when it is a record with `type === 'response.output_text.delta'` and a string `delta`; ignore all other event types and malformed JSON.
- [ ] Build one-line completion requests with the same endpoint, selected model, `stream: false`, `store: false`, and the supplied prompt as `input`. This path must not call `TranscriptService`.
- [ ] Parse completed response data from `unknown`: scan every output item, accept assistant message content blocks with `type === 'output_text'` and string text, and join their text in order without assuming index zero contains the answer.
- [ ] Map 401 to `invalid_key`, 400 and 403 to `request_rejected` with model and provider context, 429 to `rate_limit`, and all other statuses to the existing unknown HTTP error form.
- [ ] Keep the implementation dependency-free and compatible with the current `BaseAIService`; do not introduce the OpenAI SDK, a generalized provider adapter, conversation state, tools, background mode, or reasoning settings.
- [ ] Run `node scripts/verifyOpenAIService.mjs` and expect exit 0 with a named pass message.

### Task 4: Route OpenAI through the existing summary flows

**Files:**
- Modify: `src/services/aiServiceFactory.ts`

- [ ] Import `OpenAIService` and make the factory branches exhaustive for the validated provider union: construct OpenRouter with its key/model/language, OpenAI with its key/model/language, and Gemini with its key.
- [ ] Resolve `transcriptLanguage === 'auto'` through Obsidian `getLanguage()` for both transcript-based providers without changing Gemini.
- [ ] Update `getActiveApiKey` so each provider returns its own stored key. Provider switching must never reuse another provider's credential.
- [ ] Extend the verification driver or add a focused factory section that proves all three providers select the correct service/key and that OpenAI receives the resolved transcript language. Prefer the existing driver unless a separate file materially simplifies module stubbing.

### Task 5: Add provider-specific settings UI

**Files:**
- Modify: `src/views/GoogleLikedVideoSettingTab.ts`
- Modify: `styles.css`

- [ ] Add `OpenAI API Key` and `OpenAI Model ID` to the AI-section search aliases.
- [ ] Update the transcript-language description to state that it controls both OpenRouter and OpenAI transcript summaries.
- [ ] Update the provider description: OpenRouter and OpenAI summarize transcripts, while Google Gemini analyzes the video directly.
- [ ] Replace the current two-way provider conditional with explicit `gemini`, `openrouter`, and `openai` UI branches. Each branch renders only that provider's key/model controls.
- [ ] Add a masked OpenAI key field stored in `openAIApiKey`, with a link or description directing users to the official OpenAI API-key page.
- [ ] Add the OpenAI preset dropdown backed by `OPENAI_MODEL_PRESETS`, followed by `Custom`. Store the effective model ID in `openAIModel`.
- [ ] When a preset is selected, save immediately and hide the custom row. When `Custom` is selected, reveal and focus the custom input without replacing the stored value. Treat every non-preset stored value as custom so existing values are never discarded.
- [ ] Give the OpenAI custom row its own class and include it in the existing stacked, full-width custom-model styling without renaming or overwriting the uncommitted OpenRouter class.
- [ ] Re-render the settings tab after provider changes so the correct controls appear. Do not clear inactive provider settings.

### Task 6: Update current user-facing provider documentation

**Files:**
- Modify: `src/components/FeatureIntroModal.tsx`
- Modify: `README.md`

- [ ] Update the Google-credential migration notice to say that Gemini, OpenRouter, and OpenAI API keys remain in the plugin's existing settings storage. Do not imply that the new OpenAI key uses Obsidian `SecretStorage`.
- [ ] Update the README feature list, AI Summary setup steps, descriptions, and provider bullets to include OpenAI.
- [ ] Describe OpenRouter and OpenAI as transcript-based and Gemini as direct video analysis. Document the OpenAI API key and model picker without adding unsupported privacy, pricing, or live-streaming claims.
- [ ] Leave `docs/ai-summary-feature.md` unchanged in this task. It is already historical and Gemini-only despite existing OpenRouter support; modernizing that entire internal document is a separate documentation project.

### Task 7: Run automated verification

**Files:**
- Verify: every changed source, style, documentation, and fixture file

- [ ] Run `node scripts/verifyOpenAIService.mjs`; expect the named pass message and exit code 0.
- [ ] Run the existing transcript regression suite with `node scripts/verifyTranscriptService.mjs`; expect exit code 0 so shared transcript behavior is unchanged.
- [ ] Run `npm run build`; expect strict TypeScript checking and the production esbuild bundle to exit 0.
- [ ] Run ESLint on `src/types.ts`, `src/main.ts`, `src/services/openAIService.ts`, `src/services/aiServiceFactory.ts`, `src/views/GoogleLikedVideoSettingTab.ts`, `src/components/FeatureIntroModal.tsx`, and `scripts/verifyOpenAIService.mjs`; expect zero errors. If the repository's ESLint configuration does not lint `.mjs`, record that limit rather than changing lint scope.
- [ ] Run `git diff --check` on the OpenAI-provider paths.
- [ ] Use `rg` to confirm both OpenAI request bodies contain `store: false`, no OpenAI SDK dependency was introduced, and all user-facing provider lists that previously named only Gemini and OpenRouter now include OpenAI where current behavior is described.
- [ ] Inspect the staged or path-filtered diff and confirm no unrelated hunk from `src/views/LikedVideoView.tsx` or the existing OpenRouter model-picker work was reverted or accidentally included.

### Task 8: Exercise the Obsidian surface

**Files:**
- Manual QA: installed Geulo plugin in the current test vault

- [ ] Reload the plugin and enable AI Summary. Confirm the provider dropdown lists OpenRouter, OpenAI, and Google Gemini in the specified order.
- [ ] Switch through all providers and verify only the active provider controls are visible. Set values for each, switch away and back, reopen settings, and confirm all provider-specific values persist independently.
- [ ] Select each OpenAI preset and verify immediate persistence. Select `Custom`, enter a long model ID, verify the full-width field, switch providers, reopen settings, and confirm the custom value remains selected and intact.
- [ ] Clear the OpenAI key and attempt generation. Confirm the existing summary surface shows an OpenAI-specific missing-key error.
- [ ] With a fixture or live-accessible transcript, exercise generation, stop, regenerate, persistence, reload, deletion, and the `Transcript based` source label. Confirm Gemini summaries continue to show `Video based` and existing OpenRouter summaries remain unchanged.
- [ ] Exercise one-line summary generation through OpenAI and confirm it uses the completed summary without a second transcript fetch.
- [ ] Inspect the debug console for uncaught exceptions, React errors, or malformed SSE parse noise.

### Task 9: Verify the live OpenAI boundary when credentials are available

**Files:**
- Live QA only; do not persist credentials or response content in repository artifacts

- [ ] Using a user-provided test key already configured in Obsidian, generate one short transcript summary with `gpt-5.6-luna` and one one-line completion. Confirm both complete and are locally persisted with the expected model/source metadata.
- [ ] Confirm the outbound bodies use `store: false` without logging the API key, transcript, or generated content.
- [ ] If no test key is available, do not invent live coverage. Report that build, fixtures, and Obsidian UI were verified separately and that live OpenAI acceptance, account access, quota, and model availability remain unverified.

### Task 10: Prepare an isolated handoff

**Files:**
- Review: OpenAI-provider implementation paths only

- [ ] Re-read the approved design and confirm every decision is represented in the final diff: dedicated Responses service, transcript input with timestamps, `source: 'transcript'`, `store: false`, separate key/model settings, approved presets, custom model preservation, unchanged default provider, and no unrelated provider refactor.
- [ ] Stage only the OpenAI-provider file additions and exact OpenAI hunks in shared dirty files. Use patch staging where the existing OpenRouter edits overlap.
- [ ] Record automated, Obsidian, and live-provider validation as separate evidence. Do not describe fixture or build results as live OpenAI or native-Obsidian proof.
