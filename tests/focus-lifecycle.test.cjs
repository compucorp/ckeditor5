const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('contextual editor UI does not blur a collapsed CiviCRM field', async () => {
  let focusChange;
  let modelChange;
  let sourceInput;
  let sourceUpdates = 0;
  const events = [];
  const source = {name: 'intro_text', preset: 'civievent', value: '<p>Intro</p>'};
  const editorElement = {
    setAttribute() {},
    addEventListener(event, callback) {
      if (event === 'input') sourceInput = callback;
    },
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
        on(event, callback) {
          if (event === 'change:data') modelChange = callback;
        }
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
    setTimeout,
    clearTimeout,
    console
  });

  CRM.wysiwyg._create(source);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof focusChange, 'function');
  assert.equal(typeof modelChange, 'function');

  modelChange();
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(sourceUpdates, 1, 'Editing keeps the source element current');
  assert.equal(events.filter(event => event.name === 'change').length, 0,
    'Editing must not emit a CiviCRM change event while the editor remains focused');

  assert.equal(typeof sourceInput, 'function');
  sourceInput({
    target: {
      matches(selector) {
        return selector.includes('.ck-source-editing-area textarea');
      }
    }
  });
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(sourceUpdates, 2, 'Source editing keeps the source element current');
  assert.equal(events.filter(event => event.name === 'change').length, 0,
    'Source editing must not emit a CiviCRM change event while the editor remains focused');

  focusChange({}, 'isFocused', true);
  assert.equal(sourceUpdates, 2, 'Moving focus into a link balloon must not blur the CiviCRM field');
  assert.equal(events.filter(event => event.name === 'blur').length, 0);

  focusChange({}, 'isFocused', false);
  assert.equal(sourceUpdates, 3, 'Leaving the complete editor synchronizes the source field');
  assert.equal(events.filter(event => event.name === 'blur').length, 1);
  assert.equal(events.filter(event => event.name === 'change').length, 1);
});

test('destroying or replacing an editor cancels pending delayed source updates', async () => {
  const createdEditors = [];
  const source = {name: 'intro_text', preset: 'civievent', value: '<p>Initial</p>'};
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
        val(next) {
          if (arguments.length === 0) return item.value;
          item.value = next;
          return this;
        },
        hasClass() { return false; },
        addClass() { return this; },
        removeClass() { return this; },
        trigger() { return this; }
      });
    }
    return wrappers.get(item);
  };
  $.Deferred = () => ({resolve() {}, reject() {}});
  $.extend = Object.assign;
  $.isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function createMockEditor(initialData) {
    let currentData = initialData;
    let modelChange;
    let focusChange;
    const destroyHandlers = [];
    const editor = {
      state: 'ready',
      sourceElement: source,
      updateCalls: 0,
      config: {get() { return false; }},
      ui: {
        view: {
          element: {
            setAttribute() {},
            addEventListener() {},
            querySelector() { return null; }
          }
        },
        focusTracker: {
          on(event, callback) {
            if (event === 'change:isFocused') focusChange = callback;
          }
        }
      },
      model: {
        document: {
          selection: {},
          on(event, callback) {
            if (event === 'change:data') modelChange = callback;
          }
        }
      },
      editing: {view: {document: {on() {}}}},
      getData() {
        return editor.state === 'ready' ? currentData : undefined;
      },
      setData(next) {
        currentData = next;
        if (modelChange) modelChange();
      },
      updateSourceElement() {
        editor.updateCalls += 1;
        source.value = String(editor.getData());
      },
      on(event, callback) {
        if (event === 'destroy') destroyHandlers.push(callback);
      },
      triggerModelChange(next) {
        currentData = next;
        if (modelChange) modelChange();
      },
      triggerFocusChange(isFocused) {
        if (focusChange) focusChange({}, 'isFocused', isFocused);
      },
      destroy() {
        // ClassicEditor synchronizes the source element before tearing down UI/model.
        editor.updateSourceElement();
        editor.state = 'destroyed';
        for (const handler of destroyHandlers) {
          handler({source: editor});
        }
      }
    };
    return editor;
  }

  const ClassicEditor = {
    create() {
      const editor = createMockEditor(source.value);
      createdEditors.push(editor);
      return Promise.resolve(editor);
    }
  };
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
    setTimeout,
    clearTimeout,
    console
  });

  // 1. Simulate civi-rich-text-input saveAndCloseEditor():
  //    getVal -> setVal (which triggers change:data) -> destroy immediately.
  CRM.wysiwyg._create(source);
  await new Promise(resolve => setImmediate(resolve));
  const firstEditor = createdEditors[0];
  firstEditor.triggerModelChange('<p>Updated intro</p>');
  const savedVal = CRM.wysiwyg.getVal(source);
  source.value = savedVal;
  CRM.wysiwyg.setVal(source, savedVal);
  CRM.wysiwyg.destroy(source);

  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(source.value, '<p>Updated intro</p>',
    'Delayed source sync must not run on a destroyed editor and overwrite textarea with "undefined"');
  assert.equal(firstEditor.updateCalls, 1,
    'Only the synchronous destroy sync should have updated the source element');

  // 2. Re-open on the same textarea and ensure an old instance cannot clobber the new one.
  CRM.wysiwyg._create(source);
  await new Promise(resolve => setImmediate(resolve));
  const secondEditor = createdEditors[1];
  assert.equal(CRM.ckeditor5.getInstance(source), secondEditor);

  firstEditor.triggerFocusChange(false);
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.equal(CRM.ckeditor5.getInstance(source), secondEditor,
    'Stale callbacks from a destroyed instance must not detach the active instance');
  assert.equal(source.value, '<p>Updated intro</p>');
});
