const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runtime(settings = {}, onLoadScript = () => {}) {
  const created = [];
  const rejected = [];
  const loadedStylesheets = [];
  const $ = item => ({
    0: item,
    length: 1,
    attr: name => name === 'data-preset' ? item.preset : undefined,
    hasClass: () => false,
    addClass() { return this; },
    trigger() {}
  });
  $.Deferred = () => ({resolve() {}, reject(error) { rejected.push(error); }});
  $.extend = Object.assign;
  $.isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value).constructor.name === 'Object');
  const ClassicEditor = {create(config) {
    created.push(config);
    return {then() { return {catch() {}}; }};
  }};
  const window = {
    ClassicEditor,
    CKEDITOR_VERSION: '49.0.0',
    CKEDITOR: {version: '49.0.0'},
    location: {href: 'https://example.test/civicrm', origin: 'https://example.test'}
  };
  const document = {
    querySelectorAll() { return []; },
    createElement() { return {dataset: {}}; },
    head: {appendChild(link) {
      loadedStylesheets.push(link.href);
      setImmediate(link.onload);
    }}
  };
  const CRM = {$, _: {}, wysiwyg: {}, config: {locale: 'en_US', ...settings}};
  CRM.loadScript = url => ({
    done(callback) {
      onLoadScript(url, CRM);
      callback();
      return this;
    },
    fail() { return this; }
  });
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/wysiwyg/crm.ckeditor5.js`, 'utf8'), {
    CRM, ClassicEditor, window, document, URL, Promise, console: {error() {}}
  });
  return {CRM, created, rejected, loadedStylesheets};
}

test('registered plugins are added to each editor configuration once', () => {
  const {CRM} = runtime();
  class ExternalPlugin {}
  Object.defineProperty(ExternalPlugin, 'pluginName', {value: 'ExternalPlugin'});
  CRM.ckeditor5.registerPlugin('ExternalPlugin', ExternalPlugin, {ckeditorVersion: '49.0.0'});
  CRM.ckeditor5.registerPlugin('ExternalPlugin', ExternalPlugin, {ckeditorVersion: '49.0.0'});
  const config = CRM.wysiwyg.getConfig({preset: 'default'}, false);
  assert.equal(config.extraPlugins.filter(plugin => plugin === ExternalPlugin).length, 1);
  assert.equal(CRM.ckeditor5.getRegisteredPlugins().ExternalPlugin, ExternalPlugin);
});

test('registration rejects incompatible and ambiguous plugins', () => {
  const {CRM} = runtime();
  class Plugin {}
  assert.throws(
    () => CRM.ckeditor5.registerPlugin('Plugin', Plugin, {}),
    /must declare metadata\.ckeditorVersion/
  );
  assert.throws(
    () => CRM.ckeditor5.registerPlugin('Plugin', Plugin, {ckeditorVersion: '48.0.0'}),
    /targets 48\.0\.0; the shared runtime is 49\.0\.0/
  );
  CRM.ckeditor5.registerPlugin('Plugin', Plugin, {ckeditorVersion: '49.0.0'});
  assert.throws(
    () => CRM.ckeditor5.registerPlugin('Plugin', class OtherPlugin {}, {ckeditorVersion: '49.0.0'}),
    /already registered/
  );
});

test('registration rejects a constructor with a conflicting pluginName', () => {
  const {CRM} = runtime();
  class Plugin {}
  Object.defineProperty(Plugin, 'pluginName', {value: 'ActualName'});
  assert.throws(
    () => CRM.ckeditor5.registerPlugin('ConfiguredName', Plugin, {ckeditorVersion: '49.0.0'}),
    /plugin name mismatch/
  );
});

test('local plugin assets load once before multiple editors initialize', async () => {
  const loadedScripts = [];
  let Plugin;
  const {CRM, created, rejected, loadedStylesheets} = runtime({
    CKEditor5PluginAssets: [{
      name: 'external-extension',
      scripts: ['/assets/external-plugin.js'],
      stylesheets: ['/assets/external-plugin.css'],
      plugins: ['ExternalPlugin']
    }]
  }, (url, runtimeCRM) => {
    loadedScripts.push(url);
    Plugin = class ExternalPlugin {};
    Object.defineProperty(Plugin, 'pluginName', {value: 'ExternalPlugin'});
    runtimeCRM.ckeditor5.registerPlugin('ExternalPlugin', Plugin, {ckeditorVersion: '49.0.0'});
  });

  CRM.wysiwyg._create({preset: 'default'});
  await new Promise(resolve => setImmediate(resolve));
  CRM.wysiwyg._create({preset: 'civimail'});
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(loadedScripts, ['https://example.test/assets/external-plugin.js']);
  assert.deepEqual(loadedStylesheets, ['https://example.test/assets/external-plugin.css']);
  assert.equal(created.length, 2);
  assert.ok(created.every(config => config.extraPlugins.includes(Plugin)));
  assert.deepEqual(rejected, []);
});

test('core and extension plugin assets load together', async () => {
  const loadedScripts = [];
  const {CRM, created, rejected} = runtime({
    CKEditor5CorePluginAssets: [{name: 'core', scripts: ['/assets/core.js'], plugins: ['CorePlugin']}],
    CKEditor5PluginAssets: [{name: 'extension', scripts: ['/assets/extension.js'], plugins: ['ExtensionPlugin']}]
  }, (url, runtimeCRM) => {
    loadedScripts.push(url);
    const name = url.endsWith('/core.js') ? 'CorePlugin' : 'ExtensionPlugin';
    class Plugin {}
    Object.defineProperty(Plugin, 'pluginName', {value: name});
    runtimeCRM.ckeditor5.registerPlugin(name, Plugin, {ckeditorVersion: '49.0.0'});
  });

  CRM.wysiwyg._create({preset: 'default'});
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(loadedScripts, [
    'https://example.test/assets/core.js',
    'https://example.test/assets/extension.js'
  ]);
  assert.equal(created.length, 1);
  assert.equal(created[0].extraPlugins.filter(plugin => ['CorePlugin', 'ExtensionPlugin'].includes(plugin.pluginName)).length, 2);
  assert.deepEqual(rejected, []);
});

test('cross-origin plugin scripts are rejected before loading', async () => {
  const loadedScripts = [];
  const {CRM, created, rejected} = runtime({
    CKEditor5PluginAssets: [{name: 'remote', scripts: ['https://cdn.example/plugin.js']}]
  }, url => loadedScripts.push(url));

  CRM.wysiwyg._create({preset: 'default'});
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(loadedScripts, []);
  assert.equal(created.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].message, /assets must be local/);
});
