# CHANGELOG

## v1.0.3 (2026-07-08)

- Fix: bullet points / sentences that **start with English** but contain mostly
  Hebrew content now correctly render RTL. Previously, the first-strong-
  character rule (mirroring HTML5 `dir="auto"` semantics) would pick LTR
  because the leading word was English, causing the Hebrew runs inside the
  same line to flow in visually-reversed reading order.
- The direction detector now uses a **majority-of-strong-characters** rule:
  the element resolves to RTL when Hebrew (or Arabic/Persian) strong
  characters outnumber Latin strong characters, and LTR otherwise.
- Handles all four cases correctly:
  - Pure English bullets → LTR
  - Pure Hebrew bullets → RTL
  - Hebrew sentence with embedded English terms ("AI", "npm install", ...) → RTL
  - English sentence with a Hebrew word or two ("The word 'שלום' means hello") → still LTR

## v1.0.2 (2026-06-07)

- Hebrew blockquotes, numbered lists, and bullet lists now render with the
  quote bar / list markers on the **right side** (RTL). Previous versions
  right-aligned the text correctly but kept the bar/markers on the left
  because AionUi's stylesheet forced `direction: ltr` on those containers.
- Fix: the patch now computes direction in JavaScript using the first-strong-
  character rule (mirrors HTML5 `dir="auto"` semantics) and applies it as an
  inline `direction: <ltr|rtl> !important` style on each marked element.
  Inline `!important` beats AionUi's author CSS, regardless of selector
  specificity or whether they use `!important` themselves.
- English-first content (e.g. a quote starting with "AI") correctly stays
  LTR — the per-element direction follows the first strong character in that
  element's content, exactly like the HTML `dir="auto"` attribute is meant
  to behave.
- Two new diagnostic fields in `aionuiRtl.debug()`: `stats.dirSetRTL` and
  `stats.dirSetLTR` (count of elements where direction was forced).

## v1.0.1 (2026-06-07)

- Hebrew blockquotes (markdown `> text`) now render with the visual quote bar
  on the **right side** (RTL) instead of the left. Uses CSS logical
  properties (`border-inline-start`, `padding-inline-start`) so the side
  flips automatically with content direction — English quotes continue to
  show on the left, Hebrew ones flip to the right.
- The DOM walker now also marks the enclosing `<blockquote>` when it marks an
  inner `<p>` / `<li>` / etc., so the CSS can reach the quote container's
  border styling.

## v1.0.0 (2026-06-07)

- Initial public release.
- Shadow-DOM-aware DOM walker for AionUi markdown rendering.
- `Element.prototype.attachShadow` early monkey-patch via inline `<script>`.
- `adoptedStyleSheets` injection so styling survives AionUi re-renders.
- Content-driven block-ancestor marking via `dir="auto"` + semantic selectors.
- Hebrew typography via Heebo from Google Fonts.
- WebSocket `/ws` upgrade passthrough.
- systemd `--user` install + plain `node proxy.js` fallback.
