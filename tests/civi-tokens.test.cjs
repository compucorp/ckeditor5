const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadPlugin() {
  let registration;
  let component;
  class Plugin {}
  class ButtonView {
    constructor() {
      this.events = {};
    }
    set(values) {
      Object.assign(this, values);
    }
    on(name, callback) {
      this.events[name] = callback;
    }
  }
  const CRM = {
    $() {},
    ts: () => value => value,
    ckeditor5: {
      registerPlugin(name, constructor, metadata) {
        registration = {name, constructor, metadata};
      }
    }
  };
  CRM.$.getJSON = () => {};
  const CKEDITOR = {Plugin, ButtonView, version: '49.0.1'};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/plugins/civi-tokens.js`, 'utf8'), {
    CRM,
    window: {CKEDITOR},
    Promise,
    Object
  });
  const editor = {
    ui: {componentFactory: {add(name, factory) { component = {name, factory}; }}},
    model: {
      document: {selection: {}},
      change(callback) { callback({createText: value => ({value})}); },
      insertContent(content, selection) { this.inserted = {content, selection}; }
    },
    editing: {view: {focus() { editor.focused = true; }}},
    config: {get() { return {}; }}
  };
  const instance = new registration.constructor();
  instance.editor = editor;
  instance.init();
  return {CRM, registration, component, editor};
}

test('the token plugin registers against the shared CKEditor runtime', () => {
  const {registration, component} = loadPlugin();
  assert.equal(registration.name, 'CiviTokens');
  assert.equal(registration.constructor.pluginName, 'CiviTokens');
  assert.equal(registration.metadata.ckeditorVersion, '49.0.1');
  assert.equal(component.name, 'civiTokens');
  const button = component.factory('en');
  assert.equal(button.label, 'Tokens');
  assert.equal(button.withText, true);
  assert.equal(typeof button.events.execute, 'function');
});

test('token insertion uses model text at the current selection', () => {
  const {CRM, editor} = loadPlugin();
  CRM.ckeditor5.tokenPicker.insert(editor, '{contact.display_name}');
  assert.equal(editor.model.inserted.content.value, '{contact.display_name}');
  assert.equal(editor.model.inserted.selection, editor.model.document.selection);
  assert.equal(editor.focused, true);
});

test('page token discovery reads native CiviCRM form tokens and ranks inline matches', () => {
  const {CRM} = loadPlugin();
  CRM.crmMailing = {
    mailTokens: [
      {
        text: 'Contact',
        children: [
          {id: '{contact.first_name}', text: 'First Name'},
          {id: '{contact.last_name}', text: 'Last Name'}
        ]
      },
      {
        text: 'Action',
        children: [
          {id: '{action.unsubscribeUrl}', text: 'Unsubscribe URL'}
        ]
      }
    ]
  };
  const discovered = CRM.ckeditor5.tokenPicker.discoverPageTokens({});
  assert.equal(discovered.length, 2);
  assert.equal(discovered[0].children[0].id, '{contact.first_name}');

  const byCode = CRM.ckeditor5.tokenPicker.filterTokens(discovered, 'contact.l');
  assert.equal(byCode.length, 1);
  assert.equal(byCode[0].id, '{contact.last_name}');

  const byLabel = CRM.ckeditor5.tokenPicker.filterTokens(discovered, 'unsub');
  assert.equal(byLabel.length, 1);
  assert.equal(byLabel[0].id, '{action.unsubscribeUrl}');
});

test('inline autocomplete does not spam network requests on failure or empty responses', async () => {
  let networkCalls = 0;
  let shouldFail = true;
  let changeDataCallback;
  class Plugin {}
  class ButtonView {
    set() {}
    on() {}
  }
  const CRM = {
    $() { return {length: 0}; },
    ts: () => value => value,
    url: path => path,
    ckeditor5: {
      registerPlugin(name, constructor) {
        this.PluginClass = constructor;
      }
    }
  };
  CRM.$.getJSON = () => {
    networkCalls += 1;
    return {
      done(cb) {
        if (!shouldFail) cb({groups: []});
        return this;
      },
      fail(cb) {
        if (shouldFail) cb({}, 'error', 'Network failure');
        return this;
      }
    };
  };
  const CKEDITOR = {Plugin, ButtonView, version: '49.0.1'};
  const document = {
    body: {appendChild() {}},
    createElement: () => ({
      style: {},
      setAttribute() {},
      appendChild() {},
      addEventListener() {}
    })
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/plugins/civi-tokens.js`, 'utf8'), {
    CRM,
    window: {CKEDITOR},
    document,
    Date,
    Promise,
    Object
  });
  const editor = {
    ui: {componentFactory: {add() {}}, view: {element: {}}},
    model: {
      document: {
        selection: {
          isCollapsed: true,
          focus: {
            parent: {},
            offset: 4,
            textNode: {data: '{con'}
          }
        },
        on(evt, cb) {
          if (evt === 'change:data') changeDataCallback = cb;
        }
      }
    },
    editing: {view: {document: {isFocused: true, on() {}}}},
    config: {get() { return {preset: 'default'}; }}
  };
  const instance = new CRM.ckeditor5.PluginClass();
  instance.editor = editor;
  instance.init();

  changeDataCallback({}, {isLocal: true});
  await new Promise(r => setImmediate(r));
  assert.equal(networkCalls, 1, 'First keystroke after { triggers one catalogue fetch');

  changeDataCallback({}, {isLocal: true});
  changeDataCallback({}, {isLocal: true});
  await new Promise(r => setImmediate(r));
  assert.equal(networkCalls, 1, 'Failed catalogue fetch is throttled during cooldown instead of spamming on every keystroke');
});


