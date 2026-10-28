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

test('native mention feed does not spam network requests after a failure', async () => {
  let networkCalls = 0;
  let shouldFail = true;
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
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/plugins/civi-tokens.js`, 'utf8'), {
    CRM,
    window: {CKEDITOR},
    Date,
    Promise,
    Object
  });
  const editor = {
    config: {get() { return {preset: 'default'}; }}
  };
  const feed = CRM.ckeditor5.tokenPicker.createMentionFeed();

  await feed.feed.call(editor, 'con');
  assert.equal(networkCalls, 1, 'First keystroke after { triggers one catalogue fetch');

  await feed.feed.call(editor, 'cont');
  await feed.feed.call(editor, 'conta');
  assert.equal(networkCalls, 1, 'Failed catalogue fetch is throttled during cooldown instead of spamming on every keystroke');
});

test('mention configuration preserves other markers and adds one CiviCRM feed', () => {
  const {CRM} = loadPlugin();
  const existingFeed = {marker: '@', feed: ['@alice']};
  const config = {mention: {feeds: [existingFeed], dropdownLimit: 20}};

  CRM.ckeditor5.tokenPicker.configureMention(config);
  CRM.ckeditor5.tokenPicker.configureMention(config);

  assert.equal(config.mention.dropdownLimit, 20);
  assert.equal(config.mention.feeds.length, 2);
  assert.equal(config.mention.feeds[0], existingFeed);
  assert.equal(config.mention.feeds[1].marker, '{');
  assert.equal(typeof config.mention.feeds[1].feed, 'function');
  assert.equal(config.mention.feeds[1].feed('contact.display_name}').length, 0);
});

test('CiviCRM mentions insert plain token text while other mention markers remain native', () => {
  let executeListener;
  let executeOptions;
  let stopped = false;
  const {CRM, registration} = loadPlugin();
  const mentionCommand = {
    on(event, listener, options) {
      assert.equal(event, 'execute');
      executeListener = listener;
      executeOptions = options;
    }
  };
  const selection = {
    getAttributes() {
      return [['bold', true], ['mention', {id: '{old.token}'}]];
    }
  };
  const editor = {
    commands: {get(name) { return name === 'mention' ? mentionCommand : null; }},
    ui: {componentFactory: {add() {}}},
    model: {
      document: {selection},
      change(callback) {
        callback({createText: (value, attributes) => ({value, attributes})});
      },
      insertContent(content, range) {
        this.inserted = {content, range};
      }
    },
    config: {get() { return {}; }}
  };
  const instance = new registration.constructor();
  instance.editor = editor;
  instance.init();

  assert.equal(executeOptions.priority, 'highest');
  const range = {name: 'completion-range'};
  executeListener({stop() { stopped = true; }}, [{
    marker: '{',
    mention: {id: '{contact.display_name}'},
    text: '{contact.display_name}',
    range
  }]);

  assert.equal(stopped, true);
  assert.equal(editor.model.inserted.content.value, '{contact.display_name}');
  assert.deepEqual(Array.from(editor.model.inserted.content.attributes), [['bold', true]]);
  assert.equal(editor.model.inserted.range, range);

  stopped = false;
  executeListener({stop() { stopped = true; }}, [{marker: '@', mention: {id: '@alice'}}]);
  assert.equal(stopped, false, 'Non-CiviCRM mention markers keep CKEditor native behavior');
});


