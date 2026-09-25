# Services — Model / Provider / Endpoint

Read this when: switching services, wiring a new account, or debugging a
service failure.

Three layers (`services/providers/`):

- **Model** = what you ask (request shape + limits). Out-of-range parameters
  are REFUSED with a reason — never silently clamped (H3: 4–15 integer
  seconds; H3-Max: 5–15 with its own resolutions; FAL: published
  size/quality cells).
- **Provider** = how one service fulfills it (HTTP map / ComfyUI graph).
  `deployment` records the CORS posture: `direct` | `proxy` | `self-hosted`.
- **Endpoint** = one configured instance. `storyflow.runtime.json` binds
  capabilities (`video.generate`, `image.generate`, `llm-chat`,
  `asr.transcribe`) to endpoints.

Resolution law: a binding names exactly one route; one unbound candidate
auto-selects; several unbound candidates REFUSE naming them all. A failed
request never retries another account.

## Credentials

Slots (`minimax`, `fal`, `gemini`, `deepseek`, `asr`) live in the app's
SESSION memory — saves and exports strip them. Crossing sessions = an
encrypted credential file (settings → 凭证库). Profiles reference
`credential: {slot}`; they never contain values. You never handle keys.

## Switching a service

Edit `storyflow.runtime.json` only:

```json
{
  "format": "storyflow.runtime@1",
  "endpoints": {
    "minimax.intl": { "use": "minimax", "config": { "baseUrl": "https://api.minimax.io" }, "credential": { "slot": "minimax" } }
  },
  "bindings": { "video.generate": "minimax.intl" }
}
```

No code change; the next run uses it. Built-in providers: `minimax`,
`comfy` (self-hosted H3 workflows), `fal`, `gemini`, `deepseek`, `asr`
(OpenAI-compatible word timestamps). Adding one: copy
`services/providers/testing.ts`, implement capabilities + `supports()`,
register in `defaultRegistry()`, bind. Full guide: `services/providers/README.md`.

## Failure semantics

Errors surface verbatim (余额不足/invalid key show as themselves). No
fallback, no auto-retry across accounts. Transient transport errors retry
once only for providers marked `transientRetry`.
