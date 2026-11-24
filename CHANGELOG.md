# Changelog

## 0.4.4

- Add an Open Gateway Model Management command link to the native extension settings description; reuse the existing single panel and retain the command-palette entry.
- Clarify that the retained legacy interval setting is not consumed; actual automatic refresh is configured per provider in the panel.
- Preserve provider data, templates, SecretStorage and startup/refresh behavior; opening the entry adds no detection or apply action.
- Add manifest and isolated-host single-panel regressions, and synchronize the host version assertion.

## 0.4.3

- Prefill new providers with messages, 1000000 context and 256000 output tokens; leave maximum input and default effort unset.
- Enable tool, vision and thinking template switches with low/medium/high/xhigh/max effort candidates, without claiming verified support.
- Preserve saved templates/overrides and explicit template confirmation; add default, persistence and UI regression coverage.

## 0.4.2

- Append /v1 to base URLs when missing; avoid duplication and normalize trailing slashes.
- Use the same normalization for discovery, probing, generated Copilot URLs and saved-provider address comparisons.
- Add loopback HTTP and URL normalization regression tests.

## 0.4.1

- Lower the installation engine range to VS Code ^1.80.0, including 1.135.0; older host versions are not all individually certified.
- Build for Node 16.17 and bundle HTTP/structured-clone fallbacks for missing extension-host globals.
- Preserve Webview progress/cancellation when native progress notifications are unavailable.
- Check Copilot native group commands before creating configuration, without plaintext-key fallback.
- Add compatibility range, HTTP redirect-safety and missing-command/progress regression tests.

## 0.4.0

- Recover extension-owned Copilot entries after remote refresh/restart when their endpoint matches the bound gateway.
- Keep true same-ID manual entries with a different endpoint protected from overwrite.
- Report concrete conflicting model IDs instead of a generic sync failure.
- Add endpoint ownership recovery regressions.

## 0.3.8

- Treat an already-removed managed Copilot group as clean during provider deletion.
- Continue rejecting same-name ambiguity and changed secret references.
- Add regression coverage for missing-group cleanup.

## 0.3.7

- Add confirmed deletion of the active provider, disable refresh before cleanup and remove extension-owned model entries and stored key.
- Preserve unowned models, unrelated settings, Copilot groups and their independent secret references.
- Retain disabled records on failure with stage-specific errors and retry support; choose another active provider after deletion.
- Add deletion, restart, failure, scoped cleanup and UI regression coverage.

## 0.3.6

- Remove discovery source and provider ID controls; consistently use OpenAI-compatible /models discovery, including legacy stored sources.
- Merge Detect/Cancel into one state-aware toolbar button; retain cancellation when reopening the panel or running per-model detection.
- Preserve individual model API protocols, user limits and existing detection behavior.
- Add UI toggle and legacy discovery migration regressions.

## 0.3.5

- Preserve completed model results when another model triggers batch cancellation, authentication failure or rate limiting.
- Apply eligible models independently; preview skipped models and reasons instead of aborting the entire batch.
- Keep stale/incomplete/default-effort safeguards, and display persistent application outcomes beside the model list.
- Add batch-detect-to-top/row-apply regression tests using loopback HTTP and isolated Copilot JSON files.

## 0.3.4

- Unified per-model pipelined detection: reuse current protocol checks, compare alternatives only when needed, run efforts once.
- New numeric preferences: global concurrency 1–128 (default 32), per-model 1–32 (default 8), timeout 1–600 seconds; preserve saved preferences.
- Reduce main actions to Sync / Detect / Cancel / Apply / Remove; apply and remove respect filter scope and explicit confirmations.
- Distinguish policy-omitted checks from failures/skips; incremental indexed result rendering and throttled progress notifications.
- Add same-coverage loopback performance benchmark, unified runner and five-action UI regressions.

## 0.3.3

- Opt-in three-protocol comparison with nine bounded text/tool/image requests per model and isolated result matrices.
- Share per-model concurrency across protocols, preserve text gates, cancellation and no-retry rate-limit handling.
- Recommend capability-complete protocols before latency; retain current protocol within 20% and never auto-apply incomplete comparisons.
- Confirm protocol-only application, preserve limits, reject stale configuration and unverified explicit reasoning defaults.
- Add protocol scoring, loopback HTTP, scheduler and Webview regressions and isolated host verification.

## 0.3.2

- Keep limit edits on save/sync failure; explicit acknowledgements, inline errors and draft protection.
- Persist local model/template settings before Copilot sync and expose pending sync errors and retry.
- Save templates independently of model discovery; accept K/M token units and display effective input budget.
- Preserve partial gateway limit metadata; preview and apply all available gateway maxima without guessing unknown limits.
- Add limit persistence/restart, isolated JSON write and Webview regression tests; show active version in panel.

## 0.3.1

- Fair bounded request scheduler: default global concurrency 4, per-model cap 2, text-first gate and configurable timeouts.
- Incremental Webview results, real processed/skipped progress, local elapsed timers and cancellable VS Code notifications.
- Wire local detection preferences; preserve forms and expanded result details during progress updates.
- Stop new requests on authentication/rate-limit errors without retry; cancellation also aborts in-flight work after a rate limit.
- Add xhigh/max candidates without asserting verified support or automatically changing reasoning settings.
- Add scheduler, cancellation, timeout, DOM regression tests and loopback HTTP benchmark; isolated VS Code host harness.

## 0.3.0

- Default full probes for text, function-call structure, synthetic image recognition and each declared/candidate reasoning effort.
- Per-capability results, bounded probe budgets, cancellation and opt-in application of positive tool/vision results.
- Reasoning effort defaults via native model settings; preserve independent input/output/context metadata.
- One-click full detection, add-all and remove-all with explicit filter scope.
- Mock protocol tests and real-host batch/default-setting verification.

## 0.2.0

- Fixed extension activation: statically bundle the jsonc-parser ESM implementation.
- Default to general /models discovery without OpenCode dependencies.
- Add multiple gateways, user templates and per-model capability overrides.
- Add explicit model selection/removal; refresh never re-adds removed models.
- Locate the active VS Code profile using its native model configuration document.
- Add secure group ownership, JSONC updates, locks, bounded backups and Windows file-busy retries.
- Verify real extension-host panel creation and model selection/removal against a local mock gateway.

## 0.1.0

- Added a VS Code Webview for `url_base`, API Key, provider source and sync interval.
- Added OpenCode metadata conversion and OpenAI-compatible `/models` fallback.
- Added incremental Copilot custom endpoint synchronization with SecretStorage-backed setup.
- Added manual, fee-warning model probes with per-model status.
