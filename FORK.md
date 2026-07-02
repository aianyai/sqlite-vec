# `@aiany/sqlite-vec` — a fork of `sqlite-vec`

This is a fork of [`asg017/sqlite-vec`](https://github.com/asg017/sqlite-vec),
maintained at [`aianyai/sqlite-vec`](https://github.com/aianyai/sqlite-vec) and
published on npm under the [`@aiany`](https://www.npmjs.com/org/aiany) scope.

It exists for one purpose: **to ship a `windows-arm64` build of the loadable
extension**, alongside the rest of the desktop platform matrix, as npm packages.

> The GitHub org is `aianyai`; the npm scope is `@aiany`. They intentionally
> differ.

## Why this fork exists

Upstream `sqlite-vec` does not build or publish a `windows-arm64` artifact — its
release CI never targets that platform, and there is no `sqlite-vec-windows-arm64`
npm package. Any Node.js / Electron app that loads the extension through
`getLoadablePath()` therefore throws `Unsupported platform` on Windows on ARM.

A downstream Electron app (Cherry Studio v2, on `better-sqlite3` + `sqlite-vec`)
needs vector search on Windows ARM64. This fork fills that gap until upstream
supports the platform, at which point consumers can switch back with a one-line
dependency change (see [Reverting to upstream](#reverting-to-upstream)).

## What is different from upstream

The delta is deliberately minimal. The core extension is upstream, untouched,
except for one narrowly-scoped correctness fix.

1. **Adds a `windows-arm64` target.** A new `build-windows-aarch64-extension`
   job cross-compiles `vec0.dll` for ARM64 from an x64 Windows runner. It sets up
   the MSVC cross toolset with `TheMrMilchmann/setup-msvc-dev` (`arch: amd64_arm64`
   — host x64, target ARM64), then runs the same `cl.exe` command as the x86_64
   job. (Plain `arch: arm64` would select the ARM64-hosted compiler, which cannot
   run on the x64 runner.)

2. **Publishes under the `@aiany` npm scope.** The output is `@aiany/sqlite-vec`
   (the loader) plus one `@aiany/sqlite-vec-<os>-<arch>` package per platform
   (six total, including `windows-arm64`). The package shape mirrors upstream so
   downstreams can switch back to upstream `sqlite-vec` by name alone.

3. **Custom npm packaging (`scripts/pack-npm.mjs`) replaces `sqlite-dist`.**
   `sqlite-dist` (upstream's release tool) cannot emit scoped package names — it
   writes each tarball with a bare file-create and only a single-level directory
   create, so the `/` in `@aiany/...` points at a nonexistent nested path and the
   build crashes. `pack-npm.mjs` generates the loader and per-platform packages
   itself (it can `mkdir -p` freely). The generated loader
   (`index.cjs` / `index.mjs` / `index.d.ts`) is a faithful copy of
   `sqlite-dist`'s current npm template — the `require.resolve` /
   `import.meta.resolve` based resolver, which resolves scoped packages
   correctly (a plain `__dirname/../<name>` join would double the scope).

4. **Slim release workflow.** `.github/workflows/release.yaml` builds the six
   desktop platforms and publishes only npm, via OIDC Trusted Publishing.
   Everything unrelated to that goal (pip / gem / cargo / datasette, plus the
   android / ios / wasm / cosmopolitan targets) was removed.

5. **One source fix (`sqlite-vec.c`).** The MSVC ARM64 software
   `__builtin_popcountl` fallback took a 32-bit `unsigned int`, but its only
   caller (`distance_hamming_u64`) passes a 64-bit value — so the high 32 bits
   were truncated, undercounting the hamming distance on MSVC ARM64. The
   parameter was widened to `u64`. This block compiles only under MSVC + ARM, so
   every other platform is byte-for-byte unaffected.

## What is NOT changed

- The extension's public API, SQL surface, and runtime behavior are upstream's.
- The five platforms upstream already ships (Linux x64/arm64, macOS x64/arm64,
  Windows x64) compile with the exact same commands and runners as upstream's
  release workflow — their binaries are equivalent.
- The base is upstream `v0.1.10-alpha.4` (see `VERSION`); the fork only adds its
  own revision suffix on top (see [Versioning](#versioning)).

## Versioning

Releases are tagged `<upstream-version>.aiany.<n>` — e.g. `0.1.10-alpha.4.aiany.2`
is upstream `0.1.10-alpha.4`, fork revision `2`. This keeps the upstream base
visible in the version string and, per semver, sorts *after* upstream
`0.1.10-alpha.4` but *before* a hypothetical upstream `0.1.10-alpha.5` — so the
fork can ship its own revisions on a given upstream base without ever colliding
with upstream's version line. Packages are published under the `alpha` dist-tag.

Pin an exact version. Check what is published with:

```bash
npm view @aiany/sqlite-vec versions
```

## Using it

Node.js:

```bash
npm install @aiany/sqlite-vec
```

```js
import { getLoadablePath } from "@aiany/sqlite-vec";
db.loadExtension(getLoadablePath());
```

Consumers that import the package as `sqlite-vec` can redirect to this fork via a
pnpm override, without touching application code:

```yaml
# pnpm-workspace.yaml
overrides:
  sqlite-vec: npm:@aiany/sqlite-vec@0.1.10-alpha.4.aiany.2
```

## Reverting to upstream

When upstream ships `windows-arm64`, remove the override (or swap the dependency
back to `sqlite-vec`) and bump the version. No application code changes are
required — the loader API (`getLoadablePath`, `load`) is identical.

## Relationship to upstream

This fork tracks upstream and carries the smallest possible delta. Please report
extension bugs and request features upstream at
[`asg017/sqlite-vec`](https://github.com/asg017/sqlite-vec); this fork owns only
the packaging and `windows-arm64` concerns described above.

## License

Same as upstream: `MIT OR Apache-2.0`. See [LICENSE-MIT](./LICENSE-MIT) and
[LICENSE-APACHE](./LICENSE-APACHE).
