import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../web/src/lib/markdown.js';
test('assistant markdown renders tables but cannot inject HTML or JavaScript links',()=>{
  assert.match(renderMarkdown('| Before | After |\n|---|---|\n| 100 | 50 |'),/<table>/);
  const html=renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1))');
  assert.doesNotMatch(html,/<script|<img|href="javascript:/);
});
