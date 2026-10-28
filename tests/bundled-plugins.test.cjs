const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(`${__dirname}/../js/ckeditor5/ckeditor-classic-build/src/ckeditor.ts`, 'utf8');
const builtinMatch = source.match(/builtinPlugins\s*=\s*\[([\s\S]*?)\n\s*\];/);

test('selected GPL-compatible plugins are active in the shared editor build', () => {
  assert.ok(builtinMatch, 'Unable to locate the builtinPlugins declaration.');
  const builtinPlugins = builtinMatch[1];
  for (const name of [
    'AutoLink',
    'Bookmark',
    'Emoji',
    'IndentBlock',
    'Mention',
    'ShowBlocks',
    'TableCaption',
    'TextPartLanguage',
    'TodoList',
    'WordCount'
  ]) {
    assert.match(builtinPlugins, new RegExp(`\\b${name}\\b`), `${name} must be active in the shared build.`);
  }
});

test('FullPage and ImageInsert remain available without becoming default plugins', () => {
  assert.ok(builtinMatch, 'Unable to locate the builtinPlugins declaration.');
  assert.doesNotMatch(builtinMatch[1], /\bFullPage\b/);
  assert.doesNotMatch(builtinMatch[1], /\bImageInsert\b/);
  assert.match(source, /import \* as CKEditor from 'ckeditor5';/);
  assert.match(source, /\.CKEDITOR = CKEditor;/);
});

test('the self-hosted emoji database is valid and populated', () => {
  const definitions = JSON.parse(fs.readFileSync(`${__dirname}/../js/ckeditor5/emoji/16/en.json`, 'utf8'));
  assert.ok(definitions.length > 1000);
  assert.equal(typeof definitions[0].emoji, 'string');
  assert.ok(Array.isArray(definitions[0].shortcodes));
});
