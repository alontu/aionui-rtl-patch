# AionUi RTL Patch

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: stable](https://img.shields.io/badge/status-stable-brightgreen.svg)]()
[![No source edits](https://img.shields.io/badge/AionUi%20source-untouched-blue.svg)]()

Hebrew right-to-left (RTL) support for the
[iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) WebUI **without
modifying its source files** — so the patch keeps working after you update
`aionui-web` to a new release.

> Works for any language with Hebrew/Arabic/Persian content too — the patch
> uses the standard Unicode bidirectional algorithm's first-strong-character
> rule, so each paragraph picks its own direction based on its own content.

---

## What it does

- Hebrew agent responses → right-aligned, with the visual quote bar / bullet
  / number marker on the right side
- English responses → unchanged (left-aligned)
- Mixed Hebrew + English in the same response → Unicode bidi flow per
  paragraph (English-first paragraphs stay LTR, Hebrew-first paragraphs flip
  to RTL)
- Sidebar / menu / English UI labels → unchanged

## How it works (one-paragraph version)

A tiny pure-Node reverse proxy (no `npm install` required) sits in front of
`aionui-web`. It injects a CSS and JS file into every HTML response. The JS
walks the DOM — including the Shadow DOM that AionUi uses for markdown
rendering — and sets `dir="auto"` plus an inline `direction: <ltr|rtl>
!important` on every block element that contains Hebrew text, choosing
direction by the first-strong-character rule. WebSocket upgrades pass through
untouched, so chat streaming keeps working.

For the gory details (why each layer is necessary, including the
`adoptedStyleSheets` requirement to survive AionUi's re-renders), see the
[Architecture](#architecture) section below.

---

## Prerequisites

- An existing **AionUi WebUI** install you can already reach in a browser
  (see [WebUI Configuration Guide](https://github.com/iOfficeAI/AionUi/wiki/WebUI-Configuration-Guide)).
- **Node.js 16+** on the same host (Node 18 / 20 / 22 / 24 all work; only the
  standard library is used). Check with `node --version`.
- **Linux with `systemd --user`** is the supported install path. macOS /
  Windows work too if you run the proxy by hand with `node proxy.js`.

You do **NOT** need:

- Any `npm install`
- Any reverse proxy in front (the proxy itself is the reverse proxy)
- Any changes to your AionUi data dir or `aionui-backend.db`

## Install

### Quick install (Linux + systemd)

Download the latest release tarball from the
[Releases page](https://github.com/alontu/aionui-rtl-patch/releases), then:

```bash
tar xzf aionui-rtl-patch-*.tar.gz
cd aionui-rtl-patch
./install.sh
```

The installer:

1. Copies `proxy.js`, `rtl.css`, `rtl.js` to `~/.local/share/aionui-rtl-patch/`
2. Installs the systemd `--user` service `aionui-rtl-proxy.service`
3. Prints the **two manual steps you still need to do**:
   - Re-bind your existing `aionui-webui.service` to loopback (see next
     section)
   - Start the proxy (`systemctl --user start aionui-rtl-proxy.service`)

### From source (git clone)

```bash
git clone https://github.com/alontu/aionui-rtl-patch.git
cd aionui-rtl-patch
./install.sh
```

### Environment overrides

```bash
INSTALL_DIR=/opt/aionui-rtl-patch \
EXTERNAL_PORT=25808 \
INTERNAL_PORT=25807 \
INSTALL_SYSTEMD=yes \
NODE_BIN=/usr/bin/node \
./install.sh
```

Defaults are sensible — most users don't need to set anything.

### Re-binding `aionui-web` to loopback (required)

The proxy listens on `EXTERNAL_PORT` (25808) and forwards to `INTERNAL_PORT`
(25807). Your existing `aionui-web` must move to the internal port.

Edit `~/.config/systemd/user/aionui-webui.service` and change the `ExecStart`
line:

**Before:**

```
ExecStart=/path/to/aionui-web start --no-open --remote --port 25808
```

**After:**

```
ExecStart=/path/to/aionui-web start --no-open --port 25807
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user restart aionui-webui.service
systemctl --user start    aionui-rtl-proxy.service
```

Browse to the same URL you used before — the proxy is transparent.

### Without systemd (testing / non-Linux)

```bash
INSTALL_SYSTEMD=no ./install.sh
node ~/.local/share/aionui-rtl-patch/proxy.js
```

Env vars (defaults shown):

| Var | Default | Meaning |
|---|---|---|
| `RTL_LISTEN_HOST` | `::` | Bind address. Use `127.0.0.1` for loopback-only. |
| `RTL_LISTEN_PORT` | `25808` | Public port (the one your browser hits). |
| `RTL_UPSTREAM_HOST` | `127.0.0.1` | Where `aionui-web` listens. |
| `RTL_UPSTREAM_PORT` | `25807` | The internal `aionui-web` port. |
| `RTL_ASSET_DIR` | `<proxy.js dir>` | Where `rtl.css` and `rtl.js` are read from. |

## Verifying it works

After hard-reloading the AionUi tab (Ctrl+Shift+R), open the browser DevTools
console. You should see:

```
[aionui-rtl] v8 loaded — JS-enforced direction, walking
[aionui-rtl] initial — marked N rtl-forced: M ltr-forced: K shadowsTreated: ...
```

Three helpers available in the console:

```js
aionuiRtl.debug()    // current state (marked counts, shadow hosts, dir-set tally)
aionuiRtl.reapply()  // force a re-walk (rarely needed)
aionuiRtl.disable()  // persist off in localStorage, reload
aionuiRtl.enable()   // persist on, reload
```

Per-tab disable: append `?nortl=1` to the URL.

## Customizing the look

Edit `~/.local/share/aionui-rtl-patch/rtl.css` and hard-reload your browser.
No service restart needed. The current rules:

- Pull Heebo from Google Fonts for Hebrew typography
- Apply `text-align: start !important` and `unicode-bidi: plaintext` to
  anything marked with `[data-aionui-rtl]`
- Use a monospace stack inside `pre/code/kbd/samp`

Tweak freely.

### Privacy note: Google Fonts

`rtl.css` includes a `@import url('https://fonts.googleapis.com/...')` line
that loads the Heebo font from Google's CDN. This means every user of the
patch makes one request to `fonts.googleapis.com` on first load — Google can
log the user's IP. If that's a concern in your environment, comment out the
`@import` line; the patch falls back to `system-ui` which renders Hebrew
acceptably on most modern systems. Or self-host Heebo and rewrite the
`@import` to a local URL.

## Updating AionUi

When iOfficeAI releases a new version, update normally:

```bash
curl -fsSL https://github.com/iOfficeAI/AionUi/releases/latest/download/install-web.sh | bash
systemctl --user restart aionui-webui.service
```

The patch keeps working because it only depends on the position of `</head>`
in the served HTML and on semantic HTML / ARIA selectors (`p`, `li`,
`textarea`, `[contenteditable]`, etc.) — not on AionUi class names.

## Uninstall

```bash
./uninstall.sh
```

Stops + removes the proxy service and deletes the patch dir. It does NOT
revert your `aionui-webui.service` — put `--remote` back and restore the
original port (the uninstaller prints the recipe).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser shows nothing different after install | Soft reload served cached HTML | Hard-reload (Ctrl+Shift+R) |
| `[aionui-rtl] disabled via localStorage` in console | A previous `aionuiRtl.disable()` is persisted | `aionuiRtl.enable()` then reload |
| Proxy returns 502 | Can't reach internal `aionui-web` | Confirm `ss -tlnp \| grep 25807` shows it listening on `127.0.0.1:25807` |
| Some element doesn't pick up RTL | Walker hasn't seen it yet (rare) | `aionuiRtl.reapply()` |
| Hebrew quote bar / list markers on wrong side | Patch version is <1.0.2 | Update to latest release |

## Architecture

For maintainers / contributors. Every layer here exists because the prior
layer wasn't enough.

| Layer | Purpose |
|---|---|
| HTML-rewriting reverse proxy | Inject CSS + JS before `</head>` without touching AionUi files |
| Inline `<script>` patching `attachShadow` at parse time | AionUi's deferred module would otherwise race our deferred script and miss the first shadow root |
| `adoptedStyleSheets` instead of `<style>` children inside shadow roots | AionUi clears its shadow root content on every markdown re-render; adopted sheets survive that, `<style>` children don't |
| Content-driven DOM walker (semantic selectors only) | AionUi class names change between versions; semantic tags (`p`, `li`, `blockquote`, `[role="textbox"]`...) don't |
| Mark enclosing `<blockquote>` and `<ul>`/`<ol>` containers when marking inner `<p>`/`<li>` | The quote bar / list markers are positioned by the parent container's direction, not the inner paragraph's |
| **JS-forced inline `direction: <ltr\|rtl> !important`** on each marked block | AionUi's author CSS forces `direction: ltr` with high specificity; even `direction: revert !important` doesn't beat it. Inline `!important` does. |
| WebSocket `/ws` upgrade passthrough via raw TCP pipe | AionUi uses WebSockets for chat streaming — must be transparent |

The proxy and the JS combined are ~250 lines. No npm dependencies.

## Contributing

Issues and PRs welcome. Useful contributions:

- Reports of breakage after a new AionUi release (please include browser
  console output of `aionuiRtl.debug()` and a screenshot)
- New RTL/locale tweaks (Arabic, Persian — these should already mostly work,
  but the strong-character detection regex could be tightened)
- Self-hosted Heebo (eliminates the Google Fonts request)

## License

[MIT](LICENSE) — Copyright (c) 2026 Tuval.

## Disclaimer

This patch is a defensive UX layer for [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi).
AionUi itself ships under its own license; this repository is not affiliated
with the AionUi project.
