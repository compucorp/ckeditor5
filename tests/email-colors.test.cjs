const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function getConfig(useElFinder, customConfig) {
  let result;
  const item = {};
  const wrapped = {
    0: item, length: 1,
    hasClass: () => false,
    attr: () => undefined,
    addClass() { return this; },
    trigger() { return this; }
  };
  const $ = () => wrapped;
  $.Deferred = () => ({resolve() {}, reject() {}});
  $.extend = Object.assign;
  $.isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value).constructor.name === 'Object');
  const ClassicEditor = {create(config) {
    assert.equal(config.attachTo, item);
    result = config;
    return {then() {}};
  }};
  const CRM = { $,
    _: {},
    wysiwyg: {},
    config: {locale: 'en_US', ELFinderLocation: useElFinder ? '/elfinder.js' : null,
      CKEditor5CustomConfig: customConfig}
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/wysiwyg/crm.ckeditor5.js`, 'utf8'), {
    CRM, ClassicEditor, window: {ClassicEditor}
  });
  CRM.wysiwyg._create(item);
  return JSON.parse(JSON.stringify(result));
}

for (const useElFinder of [false, true]) {
  test(`hex palettes and custom pickers with ${useElFinder ? 'elFinder' : 'Base64'}`, () => {
    const config = getConfig(useElFinder);
    for (const key of ['fontColor', 'fontBackgroundColor']) {
      assert.equal(config[key].colorPicker.format, 'hex');
      assert.equal(config[key].columns, 5);
      assert.equal(config[key].documentColors, 5);
      assert.ok(config[key].colors.every(({color}) => /^#[0-9A-F]{6}$/.test(color)));
    }
    for (const key of ['tableProperties', 'tableCellProperties']) {
      assert.equal(config.table[key].colorGridColumns, 5);
      assert.equal(config.table[key].colorPicker.format, 'hex');
      for (const palette of ['borderColors', 'backgroundColors']) {
        assert.ok(config.table[key][palette].every(({color}) => /^#[0-9A-F]{6}$/.test(color)));
        assert.equal(config.table[key][palette].find(({label}) => label === 'Red').color, '#E64D4D');
      }
    }
    assert.ok(config.table.contentToolbar.includes('tableCellProperties'));
  });
}

test('explicit site configuration still overrides the defaults', () => {
  const config = getConfig(false, {fontColor: {colors: ['#123456'], colorPicker: false}});
  assert.deepEqual(config.fontColor, {colors: ['#123456'], colorPicker: false});
});
