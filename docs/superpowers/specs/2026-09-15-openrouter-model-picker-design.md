# OpenRouter Model Picker Design

## Goal

Make the OpenRouter model setting easy to choose from common model IDs while preserving support for any custom OpenRouter model ID and showing long custom IDs without truncation.

## Design

- Replace the free-form `Model ID` control with a dropdown containing these presets, in order:
  - `deepseek/deepseek-v4.1-flash`
  - `openai/gpt-5.6-luna`
  - `google/gemini-3.8-flash`
  - `Custom`
- Continue to persist the effective model ID in the existing `openRouterModel` setting. No service or settings-schema change is needed.
- Treat a stored value that matches a preset as that preset. Treat every other stored value, including an existing legacy model ID, as `Custom` so it remains editable and is never discarded.
- When a preset is selected, save its model ID immediately and hide the custom input.
- When `Custom` is selected, show a `Custom model ID` setting directly below the dropdown. Preserve the current stored value when entering custom mode rather than replacing it with an empty value.
- Give the custom setting a dedicated class and switch that row to a stacked layout. Its text input spans the available settings width so a complete model ID is visible.
- Keep the OpenRouter service unchanged because it already reads the effective string from `openRouterModel`.

## Error Handling

- Ignore unexpected dropdown values instead of persisting them.
- Preserve any non-preset stored value as a custom model ID for backward compatibility.
- Keep the existing free-form behavior for custom input; OpenRouter remains the boundary that validates whether the model ID exists and is usable.

## Validation

- Run the production build, which includes TypeScript type checking and bundling.
- In Obsidian, verify that each preset can be selected and persisted.
- Select `Custom` and verify that the custom input appears below the dropdown at full width.
- Enter a long model ID and verify that it is visible without the narrow right-column truncation shown in the original UI.
- Reload the settings with a non-preset stored value and verify that `Custom` is selected with the stored value intact.
