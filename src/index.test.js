import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processHtml } from './index.js';

function wrap(body) {
  return `<!DOCTYPE html><html><body><article class="fusion-article"><section>${body}</section></article><nav data-server-toc data-max-depth="4"></nav></body></html>`;
}

// extract href values from TOC links in document order
function tocLinks(html) {
  const nav = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/);
  if (!nav) return [];
  const hrefs = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(nav[1])) !== null) hrefs.push(m[1]);
  return hrefs;
}

// extract id attributes from heading elements (h2-h6) in document order
function headingIds(html) {
  const ids = [];
  const re = /<h[2-6][^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}

// extract ALL id attributes from any element in the document
function allIds(html) {
  const ids = [];
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}

// -------------------------------------------------------------------------
// Basic: unique headings, no deduplication needed
// -------------------------------------------------------------------------
test('unique headings produce correct TOC links', () => {
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="foo">Foo</h3>
    <h3 id="bar">Bar</h3>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');
  const links = tocLinks(result);
  assert.ok(links.includes('#request'), 'missing #request');
  assert.ok(links.includes('#foo'), 'missing #foo');
  assert.ok(links.includes('#bar'), 'missing #bar');
});

// -------------------------------------------------------------------------
// Duplicate IDs: two sections both have "Request Headers" with same id
// -------------------------------------------------------------------------
test('duplicate heading IDs are deduplicated', () => {
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="section-a">Section A</h3>
    <h4 id="request-headers">Request Headers</h4>
    <h3 id="section-b">Section B</h3>
    <h4 id="request-headers">Request Headers</h4>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');

  const ids = headingIds(result);
  const rhIds = ids.filter(id => id.startsWith('request-headers'));
  assert.equal(rhIds.length, 2, `expected 2 request-headers IDs, got: ${JSON.stringify(rhIds)}`);
  assert.equal(new Set(rhIds).size, 2, `IDs not unique: ${JSON.stringify(rhIds)}`);

  const links = tocLinks(result);
  const rhLinks = links.filter(l => l.startsWith('#request-headers'));
  assert.equal(rhLinks.length, 2, `expected 2 request-headers links, got: ${JSON.stringify(rhLinks)}`);
  assert.equal(new Set(rhLinks).size, 2, `TOC links not unique: ${JSON.stringify(rhLinks)}`);
});

// -------------------------------------------------------------------------
// TOC link must match the heading ID in the same section
// -------------------------------------------------------------------------
test('each section TOC link matches the heading ID in that section', () => {
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="section-a">Section A</h3>
    <h4 id="request-headers">Request Headers</h4>
    <h3 id="section-b">Section B</h3>
    <h4 id="request-headers">Request Headers</h4>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');

  const ids = headingIds(result);
  const links = tocLinks(result);

  // every TOC link must have a matching heading ID in the output HTML
  for (const link of links) {
    const id = link.slice(1);
    assert.ok(ids.includes(id), `TOC link ${link} has no matching heading id="${id}" in output`);
  }
});

// -------------------------------------------------------------------------
// Change-password scenario: 3x Request Headers + 3x Request Body with same IDs
// -------------------------------------------------------------------------
test('change-password scenario: 3 duplicate Request Headers/Body pairs', () => {
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="change-password-with-a-change-password-id">Change Password With a Change Password ID</h3>
    <h4 id="request-parameters">Request Parameters</h4>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h3 id="change-password-with-a-login-id">Change Password With a Login ID</h3>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h3 id="change-password-with-a-jwt">Change Password With a JWT</h3>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h2 id="response">Response</h2>
    <h3 id="response-body">Response Body</h3>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');

  const ids = headingIds(result);
  const links = tocLinks(result);

  // all 3 request-headers IDs must be unique
  const rhIds = ids.filter(id => id.startsWith('request-headers'));
  assert.equal(rhIds.length, 3, `expected 3 request-headers IDs, got: ${JSON.stringify(rhIds)}`);
  assert.equal(new Set(rhIds).size, 3, `heading IDs not unique: ${JSON.stringify(rhIds)}`);

  // all 3 request-body IDs must be unique
  const rbIds = ids.filter(id => id.startsWith('request-body'));
  assert.equal(rbIds.length, 3, `expected 3 request-body IDs, got: ${JSON.stringify(rbIds)}`);
  assert.equal(new Set(rbIds).size, 3, `heading IDs not unique: ${JSON.stringify(rbIds)}`);

  // all TOC links must be unique
  assert.equal(new Set(links).size, links.length, `duplicate TOC links: ${JSON.stringify(links)}`);

  // every TOC link must resolve to a heading in the output
  for (const link of links) {
    const id = link.slice(1);
    assert.ok(ids.includes(id), `TOC link ${link} has no matching heading id="${id}"`);
  }
});

// -------------------------------------------------------------------------
// API anchors: must appear as children of their enclosing heading, not siblings
// -------------------------------------------------------------------------
test('API anchors nest as children of their enclosing h3', () => {
  // The bug: data-toc-type="api" elements previously got depth = lastDepth (3),
  // making them h3-level siblings and cutting off the h4 children of the h3.
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="section-a">Section A</h3>
    <div data-toc-type="api" id="api-1" data-toc-text="/api/foo" data-toc-method="POST">POST /api/foo</div>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h3 id="section-b">Section B</h3>
    <div data-toc-type="api" id="api-2" data-toc-text="/api/bar" data-toc-method="GET">GET /api/bar</div>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');

  const links = tocLinks(result);

  // request-headers links must be unique
  const rhLinks = links.filter(l => l.startsWith('#request-headers'));
  assert.equal(rhLinks.length, 2, `expected 2 #request-headers links, got: ${JSON.stringify(rhLinks)}`);
  assert.equal(new Set(rhLinks).size, 2, `request-headers links not unique: ${JSON.stringify(rhLinks)}`);

  // verify the nav TOC HTML nests API+h4 entries inside the h3 <li>
  // a simplified check: both request-headers links must appear AFTER their section's API link
  const apiIdx1 = links.indexOf('#api-1');
  const apiIdx2 = links.indexOf('#api-2');
  const rh1Idx = links.indexOf(rhLinks[0]);
  const rh2Idx = links.indexOf(rhLinks[1]);
  assert.ok(apiIdx1 >= 0, 'api-1 link missing');
  assert.ok(apiIdx2 >= 0, 'api-2 link missing');
  // section A's request-headers must come after api-1 and before api-2
  assert.ok(rh1Idx > apiIdx1, 'section A request-headers must follow api-1');
  assert.ok(rh1Idx < apiIdx2, 'section A request-headers must come before section B api');
});

// -------------------------------------------------------------------------
// Change-password full scenario with API anchors, duplicate heading IDs
// -------------------------------------------------------------------------
test('change-password with API anchors: all links unique and correctly ordered', () => {
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="change-password-with-a-change-password-id">Change Password With a Change Password ID</h3>
    <div data-toc-type="api" id="post-api-change-password-1" data-toc-text="/api/user/change-password" data-toc-method="POST">POST /api/user/change-password</div>
    <div data-toc-type="api" id="post-api-change-password-2" data-toc-text="/api/user/change-password/{id}" data-toc-method="POST">POST /api/user/change-password/{id}</div>
    <h4 id="request-parameters">Request Parameters</h4>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h3 id="change-password-with-a-login-id">Change Password With a Login ID</h3>
    <div data-toc-type="api" id="post-api-change-password-3" data-toc-text="/api/user/change-password" data-toc-method="POST">POST /api/user/change-password</div>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h3 id="change-password-with-a-jwt">Change Password With a JWT</h3>
    <div data-toc-type="api" id="post-api-change-password-4" data-toc-text="/api/user/change-password" data-toc-method="POST">POST /api/user/change-password</div>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h2 id="response">Response</h2>
    <h3 id="response-body">Response Body</h3>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');

  const hIds = headingIds(result);
  const aIds = allIds(result);
  const links = tocLinks(result);

  // all 3 request-headers links must be unique
  const rhLinks = links.filter(l => l.startsWith('#request-headers'));
  assert.equal(rhLinks.length, 3, `expected 3 #request-headers links, got: ${JSON.stringify(rhLinks)}`);
  assert.equal(new Set(rhLinks).size, 3, `request-headers links not unique: ${JSON.stringify(rhLinks)}`);

  // all links must resolve to an element with that id in the output
  for (const link of links) {
    const id = link.slice(1);
    assert.ok(aIds.includes(id), `TOC link ${link} has no matching id="${id}" element`);
  }

  // change-password-id section's request-headers must come before change-password-login-id's
  const cpIdIdx = links.indexOf('#change-password-with-a-change-password-id');
  const cpLoginIdx = links.indexOf('#change-password-with-a-login-id');
  const cpJwtIdx = links.indexOf('#change-password-with-a-jwt');
  const rh1Idx = links.indexOf(rhLinks[0]);
  const rh2Idx = links.indexOf(rhLinks[1]);
  const rh3Idx = links.indexOf(rhLinks[2]);
  // Each section's request-headers must appear after that section's h3
  assert.ok(rh1Idx > cpIdIdx, 'first request-headers must follow change-password-id');
  assert.ok(rh1Idx < cpLoginIdx, 'first request-headers must precede change-password-login-id');
  assert.ok(rh2Idx > cpLoginIdx, 'second request-headers must follow change-password-login-id');
  assert.ok(rh2Idx < cpJwtIdx, 'second request-headers must precede change-password-jwt');
  assert.ok(rh3Idx > cpJwtIdx, 'third request-headers must follow change-password-jwt');
});

// -------------------------------------------------------------------------
// Change-password scenario: already-unique IDs (rehype-slug deduplicated)
// This is the state after fix 1 where headings are in the main MDX file
// -------------------------------------------------------------------------
test('change-password scenario: pre-deduplicated IDs still produce correct TOC', () => {
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="change-password-with-a-change-password-id">Change Password With a Change Password ID</h3>
    <h4 id="request-parameters">Request Parameters</h4>
    <h4 id="request-headers">Request Headers</h4>
    <h4 id="request-body">Request Body</h4>
    <h3 id="change-password-with-a-login-id">Change Password With a Login ID</h3>
    <h4 id="request-headers-1">Request Headers</h4>
    <h4 id="request-body-1">Request Body</h4>
    <h3 id="change-password-with-a-jwt">Change Password With a JWT</h3>
    <h4 id="request-headers-2">Request Headers</h4>
    <h4 id="request-body-2">Request Body</h4>
    <h2 id="response">Response</h2>
    <h3 id="response-body">Response Body</h3>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');

  const ids = headingIds(result);
  const links = tocLinks(result);

  // all TOC links must be unique
  assert.equal(new Set(links).size, links.length, `duplicate TOC links: ${JSON.stringify(links)}`);

  // every TOC link must resolve to a heading in the output
  for (const link of links) {
    const id = link.slice(1);
    assert.ok(ids.includes(id), `TOC link ${link} has no matching heading id="${id}"`);
  }

  // the 3 request-headers links must point to the 3 correct IDs
  const rhLinks = links.filter(l => l.startsWith('#request-headers'));
  assert.equal(rhLinks.length, 3, `expected 3 #request-headers links, got: ${JSON.stringify(rhLinks)}`);
  assert.deepEqual(
    rhLinks.sort(),
    ['#request-headers', '#request-headers-1', '#request-headers-2'],
    'wrong request-headers link set',
  );
});

// -------------------------------------------------------------------------
// buildLevel nesting correctness:
// JWT "Request Headers" link must NOT be #request-headers (first section's id)
// -------------------------------------------------------------------------
test('JWT section Request Headers link points to the JWT heading, not the first section', () => {
  const html = wrap(`
    <h2 id="request">Request</h2>
    <h3 id="change-password-with-a-change-password-id">Change Password With a Change Password ID</h3>
    <h4 id="request-headers">Request Headers</h4>
    <h3 id="change-password-with-a-jwt">Change Password With a JWT</h3>
    <h4 id="request-headers">Request Headers</h4>
  `);
  const result = processHtml(html, ['article.fusion-article section']);
  assert.ok(result, 'processHtml returned null');

  const links = tocLinks(result);
  const rhLinks = links.filter(l => l.startsWith('#request-headers'));
  assert.equal(rhLinks.length, 2, `expected 2 #request-headers links, got: ${JSON.stringify(rhLinks)}`);
  assert.equal(rhLinks[0], '#request-headers', 'first link should be #request-headers');
  assert.notEqual(rhLinks[1], '#request-headers', `JWT link must not be #request-headers, got: ${rhLinks[1]}`);
});
