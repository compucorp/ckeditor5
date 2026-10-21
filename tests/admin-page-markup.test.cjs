const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('admin preset copy does not inject raw style elements', () => {
  const files = [
    'CRM/Ckeditor5/Form/Presets.php',
    'templates/CRM/Ckeditor5/Form/Presets.tpl',
  ];

  files.forEach(file => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /<\/?style(?:\s|>)/i, file);
  });
});
