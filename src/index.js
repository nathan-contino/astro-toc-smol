/**
 * astro-better-toc — generates "On This Page" TOC HTML from the final rendered page.
 *
 * See README for full setup instructions.
 *
 * Options:
 *   articleSelector  - CSS selector(s) for the content area to scan for headings.
 *                      Tried in order; falls back to the full document.
 *                      Default: ['article', 'main']
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { processFile, processHtml, resolveSelectors } from './process.js';

const WORKER_PATH = fileURLToPath(new URL('./worker.js', import.meta.url));

// below this many pages, starting workers costs more than it saves
const MIN_FILES_FOR_WORKERS = 64;

function walkHtml(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

// Rewrite each file's TOC in place, split across one worker per CPU.
function processFilesInWorkers(files, articleSelectors) {
  const workerCount = Math.max(1, Math.min(os.cpus().length, files.length));
  const chunkSize = Math.ceil(files.length / workerCount);
  const chunks = Array.from({ length: workerCount }, (_, i) => files.slice(i * chunkSize, (i + 1) * chunkSize))
    .filter(c => c.length > 0);
  return Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(WORKER_PATH, { workerData: { files: chunk, articleSelectors } });
    let done = false;
    w.on('message', () => { done = true; resolve(); });
    w.on('error', reject);
    // a worker that exits without reporting would otherwise hang the build
    w.on('exit', (code) => { if (!done) reject(new Error(`[astro-toc] worker exited with code ${code} before finishing`)); });
  })));
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
        if (files.length < MIN_FILES_FOR_WORKERS) {
          for (const file of files) processFile(file, articleSelectors);
        } else {
          await processFilesInWorkers(files, articleSelectors);
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
