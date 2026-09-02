# astro-toc-smol

Astro integration + component that generates a full **"On This Page"** table-of-contents, server-side, with active-link scroll spy at runtime.

TOC entries are built from the **final rendered HTML** rather than from MDX frontmatter or the AST, so headings produced by imported components, conditional blocks, or non-MDX pages are all captured correctly. No layout shift, no client-side generation.

## Installation

```sh
npm install astro-toc-smol
```

## Setup

### 1. Register the integration

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';
import astroToc from 'astro-toc-smol';

export default defineConfig({
  integrations: [astroToc()],
});
```

### 2. Add the `<TOC>` component to your layout

Place it inside an element with `data-toc-aside`. The component hides that ancestor automatically when the page has no headings to list.

```astro
---
// layouts/Base.astro
import TOC from 'astro-toc-smol/TOC.astro';
---

<aside data-toc-aside>
  <p>On this page</p>
  <TOC />
</aside>
```

The `<TOC>` component renders the `<nav>` placeholder that the integration fills, and includes the scroll spy script that highlights the active entry as the user scrolls.

### 3. Mark pages that need a TOC

The integration only processes pages that contain the `data-server-toc` placeholder rendered by `<TOC>`. Because `<TOC>` always renders the placeholder, any page that uses a layout containing `<TOC>` will get a TOC automatically.

To skip the TOC on a specific page, omit `<TOC>` from that page's layout slot, or wrap it in a condition:

```astro
{!frontmatter.disableTOC && <TOC />}
```

## Component props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `maxDepth` | `number` | `4` | Deepest heading level to include (2 = h2 only, 4 = h2–h4). |
| `class` | `string` | — | CSS classes applied to the `<nav>` container. |

```astro
<TOC maxDepth={3} class="overflow-y-auto max-h-screen" />
```

## Integration options

```ts
astroToc({
  // CSS selector(s) for the content area to scan for headings.
  // The first selector that matches an element is used; falls back to
  // the full document if none match.
  // Default: ['article', 'main']
  articleSelector: ['article.my-content', 'main'],
})
```

`articleSelector` accepts a string or an array of strings tried in order.

## Page structure requirements

The integration scans for `h2`–`h6` elements (and `[data-toc-type="api"]` markers, see below) inside the element matched by `articleSelector`. Headings outside that element — navigation, footers, sidebars — are ignored.

A minimal layout that works with the default `['article', 'main']` selector:

```html
<body>
  <article>
    <!-- page content with headings -->
  </article>

  <aside data-toc-aside>
    <TOC />
  </aside>
</body>
```

## Duplicate heading IDs

When the same heading text appears more than once (e.g. "Request Headers" in multiple API sections), the integration deduplicates the IDs in the output HTML — `request-headers`, `request-headers-1`, `request-headers-2` — and generates matching unique TOC links, so each entry navigates to the right place.

## API endpoint markers

If your content includes `[data-toc-type="api"]` elements, they appear in the TOC as children of the preceding heading, rendered with a coloured HTTP method badge:

```html
<!-- in page content -->
<div
  data-toc-type="api"
  data-toc-method="GET"
  data-toc-text="/api/users"
  id="get-api-users"
></div>
```

```html
<!-- generated TOC entry -->
<a href="#get-api-users" class="block font-mono text-xs ...">
  <span class="font-bold text-blue-600">GET</span>
  <span>/api/users</span>
</a>
```

## Controlling depth

Pass `maxDepth` to `<TOC>` or set `data-max-depth` directly on the placeholder:

```astro
<TOC maxDepth={3} />
<!-- equivalent raw HTML -->
<nav id="toc-container" data-server-toc data-max-depth="3"></nav>
```

Default is `4` (h2–h4 and API markers one level below their enclosing heading).

## Generated markup

The TOC is a nested `<ul>` list. Active entries (managed by the scroll spy) receive an `active` class on their `[data-widget="scroll-spy-item"]` wrapper:

```html
<ul id="toc-list" class="space-y-3 pt-4" data-widget="scroll-spy">
  <li>
    <div class="group" data-widget="scroll-spy-item">
      <a href="#overview" class="block font-medium text-slate-600 text-sm ...">Overview</a>
    </div>
    <ul class="space-y-2 ml-4 pt-2" data-widget="scroll-spy">
      <li>
        <div class="group" data-widget="scroll-spy-item">
          <a href="#details" class="...">Details</a>
        </div>
      </li>
    </ul>
  </li>
</ul>
```

The classes on `<a>` and `<ul>` elements are Tailwind utility classes. If you are not using Tailwind, you can target the `data-widget` attributes for styling instead.
