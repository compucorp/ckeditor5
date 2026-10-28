const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('elFinder is admitted by the CiviCRM modal dialog focus trap', async () => {
  let coreCalls = 0;
  const dialogPrototype = {
    _allowInteraction(event) {
      coreCalls += 1;
      return event.allowedByCore === true;
    }
  };
  const wrappers = new WeakMap();
  const $ = item => {
    if (item && item.withinElFinder !== undefined) {
      return {
        closest(selector) {
          return {length: selector === '.dialogelfinder' && item.withinElFinder ? 1 : 0};
        }
      };
    }
    if (!wrappers.has(item)) {
      wrappers.set(item, {
        0: item,
        length: 1,
        attr(name) {
          if (name === 'data-preset') return item.preset;
          if (name === 'name') return item.name;
          if (name === 'id') return item.id;
        },
        hasClass() { return false; },
        addClass() { return this; },
        removeClass() { return this; },
        trigger() { return this; }
      });
    }
    return wrappers.get(item);
  };
  $.ui = {dialog: {prototype: dialogPrototype}};
  $.Deferred = () => ({resolve() {}, reject() {}});
  $.extend = Object.assign;
  $.isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  const fileRepository = {};
  const editor = {
    sourceElement: {name: 'html_message', preset: 'civimail', value: '<p>Message</p>'},
    config: {get() { return false; }},
    commands: {get() { return {isEnabled: true}; }},
    plugins: {get(name) {
      if (name === 'FileRepository') return fileRepository;
      if (name === 'Notification') return {showWarning() {}};
      throw new Error(`Unexpected plugin: ${name}`);
    }},
    locale: {t(value) { return value; }},
    ui: {
      view: {element: {setAttribute() {}, addEventListener() {}}},
      focusTracker: {on() {}}
    },
    model: {document: {selection: {}, on() {}}},
    updateSourceElement() {},
    execute() {},
    on() {}
  };
  const ClassicEditor = {create() { return Promise.resolve(editor); }};
  const CRM = {
    $,
    _: {},
    wysiwyg: {},
    ckeditor5: {},
    url() { return '/civicrm/ckeditor5/image-manager'; },
    config: {
      locale: 'en_US',
      CKEditor5UploadMode: 'elfinder',
      CKEditor5CanBrowseFiles: true
    }
  };
  const window = {
    ClassicEditor,
    location: {href: 'https://example.test/civicrm', origin: 'https://example.test'}
  };

  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/wysiwyg/crm.ckeditor5.js`, 'utf8'), {
    CRM,
    ClassicEditor,
    window,
    URL,
    Promise,
    Object,
    Array,
    Set,
    WeakMap,
    console
  });

  CRM.wysiwyg._create(editor.sourceElement);
  await new Promise(resolve => setImmediate(resolve));

  const installedAllowInteraction = dialogPrototype._allowInteraction;
  assert.equal(installedAllowInteraction({target: {withinElFinder: true}}), true);
  assert.equal(coreCalls, 0, 'elFinder interactions must bypass the parent modal focus trap');
  assert.equal(installedAllowInteraction({target: {withinElFinder: false}, allowedByCore: true}), true);
  assert.equal(coreCalls, 1, 'all other interactions must retain CiviCRM core behavior');

  CRM.wysiwyg._create({...editor.sourceElement, name: 'html_message_2'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialogPrototype._allowInteraction, installedAllowInteraction, 'the shim must only be installed once');
});
