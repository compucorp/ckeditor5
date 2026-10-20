const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('preview parser initializes separately from CiviCRM addVars data', () => {
  const buttons = ['bold', '|', 'italic'];
  const CRM = {vars: {ckeditor5Admin: {buttons}}};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/admin-preset-config.js`, 'utf8'), {CRM});
  assert.equal(typeof CRM.ckeditor5Admin.parse, 'function');
  assert.deepEqual(CRM.vars.ckeditor5Admin.buttons, buttons);
  const config = CRM.ckeditor5Admin.parse({custom_toolbar: true, toolbar_items: JSON.stringify(buttons)});
  assert.deepEqual(JSON.parse(JSON.stringify(config)), {toolbar: {items: buttons}});
});

test('toolbar picker reads the button catalogue exported by addVars', () => {
  const appended = [];
  const rendered = new Error('Picker initialized');
  const source = {val: () => '[]'};
  const picker = {};
  const root = {
    length: 1,
    find(selector) {
      if (selector === '[name="toolbar_items"]') return source;
      if (selector === '#ck5-button') return picker;
      if (selector === '#ck5-toolbar') return {};
      // Stop after populating the picker, before unrelated DOM behavior.
      throw rendered;
    }
  };
  const $ = value => {
    if (typeof value === 'function') return value();
    if (value === '.ck5-presets') return root;
    if (value === '<option>') return {
      val(name) { this.name = name; return this; },
      text(label) { this.label = label; return this; },
      appendTo(target) { assert.equal(target, picker); appended.push([this.name, this.label]); }
    };
    throw new Error('Unexpected DOM operation');
  };
  const CRM = {$, ts: () => text => text, vars: {ckeditor5Admin: {buttons: ['bold', '|']}}};
  assert.throws(() => vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/admin-presets.js`, 'utf8'), {CRM}), error => error === rendered);
  assert.deepEqual(appended, [['bold', 'bold'], ['|', 'Separator']]);
});

test('feature options produce nested CKEditor configuration', () => {
  const CRM = {ckeditor5Admin: {}};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/admin-preset-config.js`, 'utf8'), {CRM});
  const config = CRM.ckeditor5Admin.parse({
    custom_find_replace: true,
    find_replace_ui: 'dropdown',
    custom_fullscreen: true,
    fullscreen_menu_bar: false,
    fullscreen_ungrouped_toolbar: true,
    custom_table_layout: true,
    external_table_type: 'auto',
    strip_content_table_figure: false,
    custom_html_ruleset: true,
    html_ruleset: 'presentation',
    custom_upload_mode: true,
    upload_mode: 'none',
    custom_fonts: true,
    fonts: 'default\nArial, sans-serif',
    custom_qa: true,
    qa_enabled: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(config)), {
    findAndReplace: {uiType: 'dropdown'},
    fullscreen: {
      menuBar: {isVisible: false},
      toolbar: {shouldNotGroupWhenFull: true}
    },
    table: {tableLayout: {stripFigureFromContentTable: false}},
    civiHtmlRuleset: 'presentation',
    civiUploadMode: 'none',
    fontFamily: {
      options: ['default', 'Arial, sans-serif'],
      supportAllValues: true
    },
    civiHtmlQa: {enabled: true}
  });
});

test('layout table options and the shared color palette coexist', () => {
  const CRM = {ckeditor5Admin: {}};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/admin-preset-config.js`, 'utf8'), {CRM});
  const config = CRM.ckeditor5Admin.parse({
    custom_table_layout: true,
    external_table_type: 'content',
    strip_content_table_figure: true,
    custom_palette: true,
    palette: '#112233 | Brand'
  });
  assert.equal(config.table.tableLayout.preferredExternalTableType, 'content');
  assert.equal(config.table.tableLayout.stripFigureFromContentTable, true);
  assert.equal(config.table.tableProperties.backgroundColors[0].color, '#112233');
});
