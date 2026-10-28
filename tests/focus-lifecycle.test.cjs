const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('contextual editor UI does not blur a collapsed CiviCRM field', async () => {
  let focusChange;
  let sourceUpdates = 0;
  const events = [];
  const source = {name: 'intro_text', preset: 'civievent', value: '<p>Intro</p>'};
  const editorElement = {
    setAttribute() {},
    addEventListener() {},
    querySelector() { return null; }
  };
  const editor = {
    sourceElement: source,
    config: {get() { return false; }},
    ui: {
      view: {element: editorElement},
      focusTracker: {
        on(event, callback) {
          assert.equal(event, 'change:isFocused');
          focusChange = callback;
        }
      }
    },
    model: {
      document: {
        selection: {},
        on() {}
      }
    },
    editing: {view: {document: {on() {}}}},
    updateSourceElement() { sourceUpdates += 1; },
    on() {}
  };
  const wrappers = new WeakMap();
  const $ = item => {
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
        trigger(name, args) {
          events.push({name, args});
          return this;
        }
      });
    }
    return wrappers.get(item);
  };
  $.Deferred = () => ({resolve() {}, reject() {}});
  $.extend = Object.assign;
  $.isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  const ClassicEditor = {create() { return Promise.resolve(editor); }};
  const CRM = {
    $,
    _: {},
    wysiwyg: {},
    ckeditor5: {},
    config: {locale: 'en_US', CKEditor5UploadMode: 'none'}
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

  CRM.wysiwyg._create(source);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof focusChange, 'function');

  focusChange({}, 'isFocused', true);
  assert.equal(sourceUpdates, 0, 'Moving focus into a link balloon must not blur the CiviCRM field');
  assert.equal(events.filter(event => event.name === 'blur').length, 0);

  focusChange({}, 'isFocused', false);
  assert.equal(sourceUpdates, 1, 'Leaving the complete editor synchronizes the source field');
  assert.equal(events.filter(event => event.name === 'blur').length, 1);
  assert.equal(events.filter(event => event.name === 'change').length, 1);
});
