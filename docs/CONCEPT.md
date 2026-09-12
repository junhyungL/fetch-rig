# Concept

What fetch-rig is, and the design premise everything else in this repo follows.

## What it is

fetch-rig is a **thin, predictable wrapper around the standard Fetch API** — not a new HTTP
abstraction layered on top of it. Every feature (cancellation, retry, progress, streaming) is
built from `fetch()`, `Request`, `Response`, `AbortController`, and `TransformStream` — the
platform's own primitives — rather than a parallel API that happens to use Fetch internally.

That's also why it runs identically everywhere Fetch does: browsers, Node.js 20+, Deno, Bun, and
Cloudflare Workers. There is no `XMLHttpRequest`, no DOM API, and no runtime-specific code path
anywhere in the implementation.

## Design principles

**Standards over invention.** Cancellation is `AbortController`/`AbortSignal`, not a bespoke
cancel-token class. Timeouts compose with `AbortSignal.timeout()`. There's no polyfill for either
— the minimum supported runtime (Node 20+) already has them natively.

**Explicit over implicit.** A request resolves to a `FetchResponse` — a thin `Response`
wrapper — never to already-parsed data. Auto-parsing the body based on a response header (the
`ofetch`-style `$fetch()` pattern) was considered and rejected: it would mean a server sending
the wrong `Content-Type` silently produces a wrongly-parsed value instead of a normal `.json()`
error, in exchange for saving one method call. The same principle shows up in retry: there's no
`retry` field on `FetchConfig` that implicitly reorders the middleware stack — `retry(options)`
is added to `middlewares` explicitly, at whatever position the caller chooses, so the stack
always reflects exactly what's running.

**Composability over configuration flags.** Cross-cutting concerns (auth refresh, logging, retry)
are middleware — plain functions wrapping a `next` that can be called any number of times — not
a growing list of boolean options on `FetchConfig`. This is what makes "retry a failed request"
and "re-run the rest of the chain after refreshing a token on 401" both simple to express, without
fetch-rig needing to special-case either one.

**Only what Fetch already provides.** Proxy configuration and XSRF-cookie handling are
deliberately out of scope: the former is a Node-only `undici` extension with no equivalent in the
Fetch standard, and the latter is a browser-only convention (read a cookie, echo it as a header)
that's easy to implement as a small middleware if an application needs it. Reaching outside Fetch
for either would compromise the "runs identically everywhere Fetch does" premise.

## Comparison

|  | Typical XHR-based client | fetch-rig |
| --- | --- | --- |
| Runtime | Browser only | Browser + Node 20+ + Deno/Bun/Workers |
| Cancellation | Custom cancel token | Standard `AbortController`/`AbortSignal` |
| Retry / auth-refresh | Interceptors (awkward recursive retry) | Middleware — `next()` callable any number of times |
| Streaming | Ad-hoc parsing, readers rarely cleaned up | `TransformStream` pipeline — breaking a `for await` loop cancels the underlying connection |
| Response handling | Often auto-parsed from a header guess | Always a `Response`-like object; you choose `.json()`/`.text()`/... |

## Where this leads

Two consequences follow directly from "thin and predictable":

- **Nothing is inferred that the caller didn't ask for.** No content-type sniffing into parsed
  data, no hidden retry, no silent reordering of a config object into a stack of behavior.
- **Every feature composes through the same two primitives** — middleware for the request path,
  `TransformStream` for the response body — rather than each feature getting its own bespoke
  mechanism.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how these principles are actually implemented.
