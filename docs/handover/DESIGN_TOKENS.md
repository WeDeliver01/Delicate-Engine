# Delicate Courier — Design Tokens (system-wide)

Pulled from the existing quote-generator frontend (`frontend/app/globals.css`) so
the booking portal, both dashboards, and every new screen are uniform with the
main site. Do not introduce new colours or fonts; use these.

## Colour

| Token                     | Hex       | Use                                   |
| ------------------------- | --------- | ------------------------------------- |
| `--color-ink`             | `#0A0A0A` | Primary text                          |
| `--color-brand-pink`      | `#E84A8A` | Primary action, headers, active state |
| `--color-brand-pink-soft` | `#F7A8CE` | Soft fills, table headers, badges     |
| `--color-brand-purple`    | `#7C5CFF` | Secondary accent, links               |
| `--color-brand-yellow`    | `#F4C430` | Highlights, section icons             |
| `--color-surface`         | `#F8F6F3` | Page / card background                |
| `--color-line`            | `#ECEAE6` | Borders, dividers                     |
| `--color-muted`           | `#86817A` | Secondary text, helper labels         |

## Type

| Token            | Family         | Use                                     |
| ---------------- | -------------- | --------------------------------------- |
| `--font-display` | Manrope        | Headings, section titles, numbers       |
| `--font-sans`    | Be Vietnam Pro | Body, form labels, inputs               |
| `--font-mono`    | JetBrains Mono | Waybills, references, amounts (tabular) |

Loaded already from Google Fonts in `globals.css`. Reuse the same `@import`.

## Notes for the booking UI

- The ShipLogic screenshots are structural reference only. Build Delicate's own
  layout on these tokens, not a copy of their look.
- Amounts and references render in `--font-mono` with tabular numerals (the
  `.font-mono` rule already sets `font-feature-settings: 'tnum' 1`).
- Status chips use `--color-brand-pink-soft` fills with `--color-ink` text, the
  same chip styling already used in the quote generator.
