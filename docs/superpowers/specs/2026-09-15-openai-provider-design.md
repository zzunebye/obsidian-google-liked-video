# OpenAI Provider Design

## Goal

Add OpenAI as a third AI summary provider without changing the behavior of the existing OpenRouter and Gemini providers. OpenAI summaries use the shared YouTube transcript path, preserve source provenance, and expose separate OpenAI credentials and model selection in the plugin settings.

## Decisions

- Add a dedicated `OpenAIService` that extends the existing `BaseAIService`.
- Use the OpenAI Responses API at `POST https://api.openai.com/v1/responses`.
- Treat OpenAI as a transcript-based provider, like OpenRouter. It does not receive or analyze the YouTube video itself.
- Reuse the shared transcript cache and fetch a transcript only when one is not already available.
- Send timestamped transcript segments so the model retains the sequence and source position of each statement.
- Persist OpenAI summaries with the existing `source: 'transcript'` metadata.
- Set `store: false` on every OpenAI Responses API request. Geulo does not use response retrieval or multi-turn continuation, so server-side response state provides no product benefit.
- Preserve `openrouter` as the default provider for existing and new installations.

## Provider Settings

Add `openai` to the provider union and label it `OpenAI`. Add two independent settings:

- `openAIApiKey`, initially empty.
- `openAIModel`, initially `gpt-5.6-luna`.

When OpenAI is selected, show only the OpenAI API key and model controls. The model dropdown contains, in order:

1. `gpt-5.6-luna`
2. `gpt-5.6-terra`
3. `gpt-5.6-sol`
4. `Custom`

The custom-model behavior follows the existing OpenRouter model picker: preset values are saved immediately, any non-preset stored value is treated as custom, and entering custom mode preserves the stored model ID. Provider switching must not clear credentials or model selections belonging to another provider.

## Architecture

### Provider routing

`createAIService` gains an explicit OpenAI branch that constructs `OpenAIService` with the OpenAI API key, selected model, and resolved transcript language. `getActiveApiKey` returns the key belonging to the selected provider. Gemini remains the final explicit branch rather than becoming an implicit fallback for unknown values.

### OpenAI service

`OpenAIService` owns only OpenAI-specific behavior:

- Responses API URL and authorization headers.
- OpenAI request bodies for streaming summaries and non-streaming text completions.
- OpenAI streaming-event and completed-response parsing.
- OpenAI HTTP status mapping.

It depends on the existing `TranscriptService` for transcript retrieval and on `BaseAIService` for request execution, timeout handling, logical cancellation, SSE processing, result construction, and the text-completion workflow.

No generalized OpenAI-compatible adapter or transcript-provider base class is introduced. The OpenRouter Chat Completions payload and OpenAI Responses payload are different enough that a small dedicated service keeps the change narrower and easier to verify.

## Data Flow

For a video summary:

1. The summary UI selects the configured provider through `createAIService`.
2. `OpenAIService` requests the preferred transcript from `TranscriptService`.
3. `TranscriptService` returns a cached transcript when available and fetches it otherwise.
4. The service formats each segment as `[<start>s] <text>`.
5. The configured summary prompt is sent as the response instruction. The timestamped transcript is sent as untrusted source material in the input, with an explicit instruction not to follow commands found inside the transcript or invent visual details absent from it.
6. The request sets the selected model, `stream: true`, and `store: false`.
7. `response.output_text.delta` events are accumulated and delivered through the existing summary callbacks.
8. The completed result records the selected model and `source: 'transcript'`, then follows the existing local summary-storage path.

For one-line summary generation, the same service sends a non-streaming Responses API request with `store: false` and extracts text from the response output items. It does not fetch or resend the video transcript because the existing one-line prompt already contains the completed summary.

## Response Parsing

Streaming parsing accepts only JSON SSE payloads whose `type` is `response.output_text.delta` and whose `delta` is a string. Other Responses API lifecycle events are ignored.

Non-streaming parsing must not assume that the first output item contains the answer. It scans response output items for assistant message content blocks with `type: 'output_text'`, joins their text in order, and returns an empty string when no output text exists so the existing caller can handle the failure.

Runtime boundary data is parsed from `unknown` with type guards. The implementation must not use `any`, `@ts-ignore`, or `@ts-expect-error`.

## Error Handling and Cancellation

- Transcript failures become the existing `AIServiceError('transcript_error', message)` and prevent the OpenAI request from being sent.
- HTTP 401 maps to `invalid_key`.
- HTTP 400 and 403 map to `request_rejected` while preserving the OpenAI error message.
- HTTP 429 maps to `rate_limit`.
- Other HTTP failures use the existing unknown-error path with status context.
- Missing API keys use the existing `no_api_key` behavior with `OpenAI` as the service name.
- Logical cancellation remains unchanged: Obsidian `requestUrl` cannot abort the underlying network request, but an aborted UI operation stops delivery of the result and prevents follow-up work.

## Storage and Privacy

The local summary schema does not change. OpenAI results use the existing `SummarySource` value `transcript`, so the UI and persisted summary continue to describe how the content was generated independently of the currently selected provider.

`store: false` disables Responses API application-state storage for later response retrieval. It does not promise zero retention by itself: OpenAI's standard abuse-monitoring retention and organization-level data controls remain governed by the API account's OpenAI data settings. OpenAI documents that API data is not used to train models unless the account explicitly opts in to sharing.

References:

- [Create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI model catalog](https://developers.openai.com/api/docs/models/all)

## Compatibility and Scope

- Existing stored provider, Gemini key, OpenRouter key, OpenRouter model, summaries, and source labels remain valid.
- Invalid stored provider values continue to fall back to the plugin default during settings loading.
- Existing summaries require no migration.
- The current uncommitted OpenRouter model-picker work must be preserved and integrated rather than overwritten because the OpenAI settings touch the same type and settings-view files.
- This change does not add direct video analysis, conversation history, Responses API retrieval, tools, background mode, reasoning controls, token controls, provider-key migration, or a generalized provider SDK.

## Validation

### Static and fixture validation

- Add a focused verification script for OpenAI request-body construction, `store: false`, timestamped transcript input, streaming delta parsing, non-streaming output scanning, transcript failure short-circuiting, and status-to-error mapping.
- Run `npm run build` for strict TypeScript checking and the production bundle.
- Run ESLint on every changed source and verification file.
- Review the final diff to confirm that unrelated dirty work was not changed or staged.

### Obsidian manual QA

- Enable AI Summary and verify that OpenAI appears alongside OpenRouter and Google Gemini.
- Switch among all three providers and verify that only the active provider's controls appear and that saved credentials and model selections survive switching and reopening settings.
- Verify each OpenAI preset, the custom input, long custom model IDs, and preservation of an existing non-preset value.
- Without an OpenAI key, verify the provider-specific missing-key message.
- Generate, stop, regenerate, persist, reload, and delete an OpenAI summary and verify the `Transcript based` source label.
- Verify one-line summary generation through the OpenAI provider.

### Live-provider boundary

Fixture validation, the production build, and Obsidian UI checks do not prove that a live OpenAI account accepts the selected model or request. When a test API key is available, perform one live summary and one live one-line completion without recording the key, transcript, or generated content in logs or repository artifacts. If no key is available, report live OpenAI verification as not performed.
