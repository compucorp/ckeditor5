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

test('the CKEditor 5 settings control occupies its own row below the editor selector', () => {
  const source = fs.readFileSync(path.join(root, 'templates/CRM/Admin/Form/Preferences/Ckeditor5.tpl'), 'utf8');
  const hook = fs.readFileSync(path.join(root, 'ckeditor5.php'), 'utf8');
  assert.match(source, /id="ckeditor5-config-control"/);
  assert.match(source, /\.css\('flex-wrap', 'wrap'\)/);
  assert.match(source, /'flex-basis': '100%'/);
  assert.match(source, /\.insertAfter\(editor\)/);
  assert.match(source, /control\.toggle\(/);
  assert.doesNotMatch(source, /appendTo\(\$\('#editor_id'\)\.parent\(\)\)/);
  assert.match(hook, /display:inline-flex;align-items:center;justify-content:center/);
  assert.match(hook, /white-space:nowrap/);
});

test('preset administration does not add a separate navigation item', () => {
  const hook = fs.readFileSync(path.join(root, 'ckeditor5.php'), 'utf8');
  const menu = fs.readFileSync(path.join(root, 'xml/Menu/ckeditor5.xml'), 'utf8');
  assert.doesNotMatch(hook, /function ckeditor5_civicrm_navigationMenu/);
  assert.match(menu, /<path>civicrm\/admin\/ckeditor5<\/path>/);
});
