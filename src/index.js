/**
 * astro-toc-smol — generates "On This Page" TOC HTML from the final rendered page.
 *
 * See README for full setup instructions.
 *
 * Options:
 *   articleSelector  - CSS selector(s) for the content area to scan for headings.
 *                      Tried in order; falls back to the full document.
 *                      Default: ['article', 'main']
 */

import { parse } from 'node-html-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function walkHtml(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// HTTP method → Tailwind color classes (matches API.astro methodColors)
// ---------------------------------------------------------------------------

const METHOD_COLORS = {
  GET:    'text-blue-600 dark:text-blue-400',
  POST:   'text-green-600 dark:text-green-400',
  PUT:    'text-orange-600 dark:text-orange-400',
  PATCH:  'text-teal-600 dark:text-teal-400',
  DELETE: 'text-red-600 dark:text-red-400',
};

function methodColor(method) {
  return METHOD_COLORS[(method || '').toUpperCase()] || 'text-yellow-600 dark:text-yellow-400';
}

// ---------------------------------------------------------------------------
// TOC HTML builder — mirrors the clientToc buildTOC() logic in TOC.astro
// ---------------------------------------------------------------------------

/**
 * @param {Array<{id, text, depth, isApi, method}>} headings  flat ordered list
 * @param {number} minDepth  shallowest depth present in the list
 * @param {number} maxDepth  deepest depth to include
 */
function buildTocHtml(headings, minDepth, maxDepth) {
  if (!headings.length) return '';

  /**
   * @param {Array} toc  slice of the heading list for the current branch
   * @param {number} depth  heading depth being processed at this level
   */
  function buildLevel(toc, depth) {
    if (depth > maxDepth) return '';

    const levelItems = toc.filter(h => h.depth === depth);
    if (!levelItems.length) return '';

    const isTop = depth === minDepth;
    const classes = isTop ? 'space-y-2 pt-4' : 'space-y-2 ml-4 pt-2';
    const idAttr = isTop ? ' id="toc-list"' : '';
    let html = `<ul${idAttr} class="${classes}" data-widget="scroll-spy">`;

    for (let i = 0; i < levelItems.length; i++) {
      const h = levelItems[i];
      const next = levelItems[i + 1];

      const start = toc.findIndex(x => x.id === h.id) + 1;
      const end = next ? toc.findIndex(x => x.id === next.id) : toc.length;
      const children = toc.slice(start, end);

      html += '<li><div class="group" data-widget="scroll-spy-item">';

      if (h.isApi) {
        html += `<a href="#${esc(h.id)}" class="block font-mono text-xs text-slate-600 dark:text-slate-400 dark:group-[.active]:text-indigo-400 dark:hover:!text-slate-100 group-[.active]:text-indigo-600 hover:text-slate-800 transition-colors break-all">`;
        html += `<span class="font-bold pr-1 uppercase text-[10px] ${methodColor(h.method)}">${esc(h.method || '')}</span>`;
        html += ` <span>${esc(h.text)}</span></a>`;
      } else {
        html += `<a href="#${esc(h.id)}" class="block font-medium text-slate-600 text-sm dark:text-slate-400 dark:group-[.active]:text-indigo-400 dark:hover:!text-slate-100 group-[.active]:text-indigo-600 hover:text-slate-800 transition-colors">${esc(h.text)}</a>`;
      }

      html += '</div>';
      if (children.length) html += buildLevel(children, depth + 1);
      html += '</li>';
    }

    html += '</ul>';
    return html;
  }

  return buildLevel(headings, minDepth);
}

// ---------------------------------------------------------------------------
// Auto-ID generation for headings that bypass rehype-slug
// (i.e. headings inside .astro components)
// ---------------------------------------------------------------------------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Assign IDs to every heading in `els` that lacks one, and deduplicate any
 * headings that share an existing ID (e.g. MDX partials processed independently
 * by rehype-slug that each emit the same id="request-body").
 * Mutates the element's `id` attribute in the parsed HTML tree.
 */
function assignMissingIds(els) {
  // Pass 1: count how many times each ID appears in the DOM
  const idCount = Object.create(null);
  for (const el of els) {
    const id = el.getAttribute('id');
    if (id) idCount[id] = (idCount[id] || 0) + 1;
  }

  // allIds tracks every ID that will exist in the final HTML (for collision avoidance)
  const allIds = new Set(Object.keys(idCount));

  function claimId(base) {
    if (!allIds.has(base)) { allIds.add(base); return base; }
    let n = 1;
    while (allIds.has(`${base}-${n}`)) n++;
    const id = `${base}-${n}`;
    allIds.add(id);
    return id;
  }

  // Pass 2a: deduplicate elements that share an existing ID (second+ occurrence gets a new unique id)
  // Pass 2b: assign IDs to elements that have none
  const dupSeen = Object.create(null); // how many times we've already processed each duplicate base

  for (const el of els) {
    if (el.hasAttribute('data-toc-type')) continue; // API markers always have explicit ids

    const existingId = el.getAttribute('id');
    if (existingId) {
      if (idCount[existingId] <= 1) continue; // unique — keep as-is
      // Duplicate: first occurrence keeps original, subsequent get new unique ids
      const n = dupSeen[existingId] || 0;
      dupSeen[existingId] = n + 1;
      if (n === 0) continue; // first occurrence — original id is already in allIds
      let counter = n;
      while (allIds.has(`${existingId}-${counter}`)) counter++;
      const newId = `${existingId}-${counter}`;
      allIds.add(newId);
      el.setAttribute('id', newId);
    } else {
      const text = el.text.replace(/#/g, '').trim();
      if (!text) continue;
      const base = slugify(text);
      if (!base) continue;
      el.setAttribute('id', claimId(base));
    }
  }
}

// ---------------------------------------------------------------------------
// Heading extraction
// ---------------------------------------------------------------------------

/**
 * Extract ordered headings from a parsed HTML root, scoped to the article.
 * Mirrors the rawHeadings extraction logic in the clientToc script.
 */
function extractHeadings(root, articleSelectors, maxDepth) {
  let article = null;
  for (const sel of articleSelectors) {
    article = root.querySelector(sel);
    if (article) break;
  }
  // Fallback: scan the whole document (noisy but better than nothing)
  if (!article) article = root;

  const els = article.querySelectorAll('h2, h3, h4, h5, h6, [data-toc-type="api"]')
    .filter(el => !el.closest('[data-toc-ignore]'));

  // Assign IDs to any heading that doesn't have one yet
  assignMissingIds(els);

  let lastDepth = 2;
  const headings = [];

  for (const el of els) {
    const isApi = el.hasAttribute('data-toc-type');
    const id = el.getAttribute('id');
    if (!id) continue;

    let depth;
    if (isApi) {
      depth = lastDepth + 1; // nest API anchors as children of their enclosing heading
    } else {
      depth = parseInt(el.tagName[1], 10);
      lastDepth = depth;
    }

    if (depth > maxDepth) continue;

    // Strip the trailing "#" appended by rehype-autolink-headings
    const text = isApi
      ? (el.getAttribute('data-toc-text') || '')
      : el.text.replace(/#/g, '').trim();

    if (!text) continue;

    headings.push({
      id,
      text,
      depth,
      isApi,
      method: isApi ? el.getAttribute('data-toc-method') : null,
    });
  }

  return headings;
}

// ---------------------------------------------------------------------------
// Vite plugin
// ---------------------------------------------------------------------------

function resolveSelectors(opts) {
  return opts.articleSelector
    ? (Array.isArray(opts.articleSelector) ? opts.articleSelector : [opts.articleSelector])
    : ['article', 'main'];
}

function processHtml(html, articleSelectors) {
  if (!html.includes('data-server-toc')) return null;

  try {
    const root = parse(html);
    const placeholders = root.querySelectorAll('nav[data-server-toc]');
    if (!placeholders.length) return null;

    // Use the first placeholder's maxDepth for heading extraction.
    const maxDepth = parseInt(placeholders[0].getAttribute('data-max-depth') || '4', 10);
    const headings = extractHeadings(root, articleSelectors, maxDepth);

    if (!headings.length) {
      // No headings — hide any inline TOC details elements so they don't show empty.
      let changed = false;
      for (const el of root.querySelectorAll('[data-toc-inline]')) {
        el.setAttribute('hidden', '');
        changed = true;
      }
      return changed ? root.toString() : null;
    }

    const minDepth = Math.min(...headings.map(h => h.depth));
    const tocHtml = buildTocHtml(headings, minDepth, maxDepth);

    for (const placeholder of placeholders) {
      placeholder.removeAttribute('data-server-toc');
      placeholder.removeAttribute('data-max-depth');
      placeholder.set_content(tocHtml);
    }

    return root.toString();
  } catch (err) {
    console.warn(`[astro-toc] Failed to process HTML: ${err.message}`);
    return null;
  }
}

function viteAstroToc(articleSelectors) {
  return {
    name: 'astro-toc',
    // Runs during `astro build` — Vite does NOT call this in dev mode for
    // SSR-rendered pages, so dev mode is handled by the server middleware below.
    transformIndexHtml(html) {
      return processHtml(html, articleSelectors) ?? undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Astro integration
// ---------------------------------------------------------------------------

export { processHtml };

export default function astroToc(opts = {}) {
  const articleSelectors = resolveSelectors(opts);

  return {
    name: 'astro-toc',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [viteAstroToc(articleSelectors)],
          },
        });
      },

      // Build-time support: transformIndexHtml is only called for Vite's own
      // HTML entry points, NOT for Astro's SSG-generated pages.  We walk the
      // dist directory after the build and apply the same transformation.
      'astro:build:done': async ({ dir }) => {
        const distDir = dir instanceof URL ? fileURLToPath(dir) : String(dir);
        const files = walkHtml(distDir);
        for (const file of files) {
          try {
            const html = fs.readFileSync(file, 'utf-8');
            const transformed = processHtml(html, articleSelectors);
            if (transformed) fs.writeFileSync(file, transformed, 'utf-8');
          } catch (err) {
            console.warn(`[astro-toc] build:done failed for ${file}: ${err.message}`);
          }
        }
      },

      // Dev-mode support: Vite's transformIndexHtml is not called for Astro's
      // SSR-rendered pages during `astro dev`.  We intercept each HTML response
      // and apply the same transformation.
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(function astroTocDev(req, res, next) {
          // Skip Astro/Vite internal asset requests — they're never HTML pages.
          const url = req.url || '';
          if (
            url.startsWith('/_astro/') ||
            url.startsWith('/@') ||
            /\.(js|ts|css|png|jpg|jpeg|gif|svg|woff2?|ico|json|xml)(\?|$)/i.test(url)
          ) {
            return next();
          }

          const chunks = [];
          const origWrite = res.write.bind(res);
          const origEnd = res.end.bind(res);

          res.write = function (chunk, encoding) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf-8'));
            return true;
          };

          res.end = function (chunk, encoding) {
            // Restore originals immediately so error-handler re-entrant calls
            // (e.g. Astro's handle500Response after a successful 200) hit the
            // real functions, not our wrapper.
            res.write = origWrite;
            res.end = origEnd;

            if (chunk) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf-8'));
            }

            const html = Buffer.concat(chunks).toString('utf-8');

            // Fast-bail for non-HTML and pages without a TOC placeholder.
            if (html.trimStart().startsWith('<') && html.includes('data-server-toc')) {
              const transformed = processHtml(html, articleSelectors);
              if (transformed) {
                const buf = Buffer.from(transformed, 'utf-8');
                if (!res.headersSent) {
                  res.setHeader('Content-Length', buf.length);
                  res.removeHeader('Content-Encoding');
                }
                return origEnd(buf);
              }
            }

            // No transformation — flush buffered content unchanged.
            origWrite(Buffer.concat(chunks));
            origEnd();
          };

          next();
        });
      },
    },
  };
}
