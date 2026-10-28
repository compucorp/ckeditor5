const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(settings = {}, listener = () => {}, browser = {}) {
  const created = [];
  const $ = item => ({
    0: item, length: 1,
    attr: name => name === 'data-preset' ? item.preset : undefined,
    hasClass: () => false,
    addClass() { return this; },
    trigger(name, args) {
      assert.equal(name, 'crmCkeditor5Config');
      item.context = args[1];
      listener(...args);
    }
  });
  $.Deferred = () => ({resolve() {}, reject() {}});
  $.extend = Object.assign;
  $.isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value).constructor.name === 'Object');
  const ClassicEditor = {create(config) {
    const {attachTo: item, ...options} = config;
    assert.ok(item, 'The editor must attach to the requested field');
    created.push({config: options, context: item.context});
    return {then() { return {catch() {}}; }};
  }};
  const CRM = {$, _: {}, wysiwyg: {}, config: {locale: 'en_US', ...settings}};
  const window = {
    ClassicEditor,
    location: {href: 'https://example.test/civicrm', origin: 'https://example.test'},
    ...browser.window
  };
  const context = {CRM, ClassicEditor, window, URL};
  if (browser.DOMParser) context.DOMParser = browser.DOMParser;
  if (browser.document) context.document = browser.document;
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../js/wysiwyg/crm.ckeditor5.js`, 'utf8'), context);
  const create = (preset, properties = {}) => {
    CRM.wysiwyg._create({...properties, preset});
    return created.at(-1);
  };
  create.CRM = CRM;
  return create;
}

const plain = value => JSON.parse(JSON.stringify(value));

function validatedBase64Adapter(imageOutcome = 'load') {
  class MockImage {
    constructor() {
      this.naturalWidth = imageOutcome === 'load' ? 640 : 0;
      this.naturalHeight = imageOutcome === 'load' ? 480 : 0;
    }
    set src(value) {
      this._src = value;
      queueMicrotask(() => {
        if (imageOutcome === 'load') this.onload();
        else this.onerror();
      });
    }
    decode() {
      return imageOutcome === 'load' ? Promise.resolve() : Promise.reject(new Error('decode failed'));
    }
  }
  class MockFileReader {
    static LOADING = 1;
    constructor() {
      this.listeners = {};
      this.readyState = 0;
    }
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
    readAsDataURL(file) {
      this.result = `data:${file.type};base64,AAAA`;
      this.listeners.load();
    }
    abort() {
      if (this.listeners.abort) this.listeners.abort();
    }
  }
  const create = harness({}, () => {}, {window: {
    Image: MockImage,
    FileReader: MockFileReader,
    URL: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {}
    }
  }});
  return create.CRM.ckeditor5.createValidatedBase64UploadAdapter;
}

for (const useElFinder of [false, true]) {
  test(`shared build selects exactly one upload mode: ${useElFinder ? 'elFinder' : 'Base64'}`, () => {
    const create = harness({ELFinderLocation: useElFinder ? '/elfinder.js' : null}, config => {
      config.removePlugins = ['MediaEmbed', 'Base64UploadAdapter', 'CKFinder'];
      config.toolbar = ['bold', 'ckfinder'];
    });
    const config = create('civimail').config;
    assert.deepEqual(plain(config.removePlugins), useElFinder
      ? ['MediaEmbed', 'Markdown', 'Base64UploadAdapter'] : ['MediaEmbed', 'Markdown']);
    assert.deepEqual(plain(config.toolbar), useElFinder ? ['bold', 'civiFileManager'] : ['bold']);
  });
}

test('saved presets inherit and code configuration retains precedence', () => {
  const create = harness({
    CKEditor5AdminPresets: {
      default: {fontSize: {options: [12]}, toolbar: {items: ['bold']}},
      civimail: {fontSize: {options: [16]}}
    },
    CKEditor5Presets: {civimail: {fontSize: {options: [20]}}}
  });
  assert.deepEqual(plain(create('civimail').config.fontSize.options), [20]);
  assert.deepEqual(plain(create('civievent').config.fontSize.options), [12]);
  assert.deepEqual(plain(create('civimail').config.toolbar.items), ['bold']);
  assert.equal(create('civimail').context.resolvedPreset, 'civimail');
});

test('the file manager button is omitted from the Base64 toolbar', () => {
  const settings = {CKEditor5AdminPresets: {default: {toolbar: {items: ['bold', 'ckfinder']}}}};
  assert.deepEqual(plain(harness(settings)().config.toolbar.items), ['bold']);
  assert.deepEqual(plain(harness({...settings, ELFinderLocation: '/elfinder.js'})().config.toolbar.items), ['bold', 'civiFileManager']);
});

test('front-end and Form Builder fields use restricted fallbacks unless a preset is explicit', () => {
  const frontend = harness({isFrontend: true, ELFinderLocation: '/elfinder.js', CKEditor5UploadMode: 'elfinder'});
  const publicField = frontend();
  assert.equal(publicField.context.preset, 'frontend');
  assert.equal(publicField.context.uploadAdapter, 'elfinder');
  assert.equal(publicField.config.civiHtmlRuleset, 'strict');
  assert.ok(publicField.config.toolbar.items.includes('imageUpload'));
  assert.ok(publicField.config.toolbar.items.includes('civiFileManager'));

  const formBuilder = frontend(undefined, {closest: selector => selector === 'civi-rich-text-input' ? {} : null});
  assert.equal(formBuilder.context.preset, 'formbuilder');
  assert.equal(formBuilder.context.uploadAdapter, 'elfinder');
  assert.ok(formBuilder.config.toolbar.items.includes('imageUpload'));
  assert.ok(!formBuilder.config.toolbar.items.includes('civiFileManager'));

  const event = frontend('civievent');
  assert.equal(event.context.preset, 'civievent');
  assert.equal(event.context.uploadAdapter, 'elfinder');
});

test('validated Base64 uploads enforce the 10 MiB hard limit', async () => {
  const factory = validatedBase64Adapter();
  await assert.rejects(factory({file: Promise.resolve({
    type: 'image/png',
    size: (10 * 1024 * 1024) + 1
  })}).upload(), /10 MiB/);
});

test('validated Base64 uploads require a successful browser decode', async () => {
  const factory = validatedBase64Adapter('error');
  await assert.rejects(factory({file: Promise.resolve({
    type: 'image/png',
    size: 1024
  })}).upload(), /could not be decoded/);
});

test('validated Base64 uploads preserve accepted images at the hard limit', async () => {
  const factory = validatedBase64Adapter();
  const result = await factory({file: Promise.resolve({
    type: 'image/png',
    size: 10 * 1024 * 1024
  })}).upload();
  assert.deepEqual(plain(result), {default: 'data:image/png;base64,AAAA'});
});

test('unconfigured default and civimail presets share email-safe images while other presets keep block image styles', () => {
  const create = harness();
  const original = plain(create().config);
  delete original.civiTokens;
  for (const preset of ['default', 'civimail', 'civievent']) {
    const result = create(preset);
    const presentation = plain(result.config);
    const expected = plain(original);
    assert.equal(presentation.civiTokens.preset, preset);
    delete presentation.civiTokens;
    if (preset === 'default' || preset === 'civimail') {
      assert.deepEqual(presentation.image.insert, {type: 'inline'});
      assert.equal(presentation.image.resizeUnit, 'px');
      assert.deepEqual(presentation.image.toolbar, ['imageResize', '|', 'imageTextAlternative']);
      assert.deepEqual(presentation.image.styles, ['inline']);
      assert.equal(presentation.civiEmailImageMaxWidth, 600);
      assert.equal(presentation.extraPlugins.length, 2);
      assert.equal(presentation.table.tableProperties.alignment.useInlineStyles, true);
    }
    else {
      assert.equal(presentation.civiEmailImageMaxWidth, false);
      assert.equal(presentation.extraPlugins.length, 1);
      assert.equal(presentation.table.tableProperties.alignment.useInlineStyles, false);
      assert.ok(presentation.image.styles.includes('block'));
      presentation.table.tableProperties.alignment.useInlineStyles = true;
      delete presentation.image;
      delete presentation.civiEmailImageMaxWidth;
      presentation.extraPlugins = expected.extraPlugins;
      delete expected.image;
      delete expected.civiEmailImageMaxWidth;
    }
    assert.deepEqual(presentation, expected);
    assert.equal(result.context.preset, preset);
    assert.equal(result.context.resolvedPreset, 'default');
  }
});

test('lot 1 features use safe shared defaults', () => {
  const config = harness()().config;
  assert.ok(config.toolbar.items.includes('findAndReplace'));
  assert.ok(!config.toolbar.items.includes('civiTokens'));
  assert.ok(config.toolbar.items.includes('fullscreen'));
  assert.ok(config.toolbar.items.includes('insertTable'));
  assert.ok(!config.toolbar.items.includes('insertTableLayout'));
  for (const optionalButton of ['bookmark', 'emoji', 'showBlocks', 'textPartLanguage', 'todoList', 'toggleTableCaption', 'insertImage']) {
    assert.ok(!config.toolbar.items.includes(optionalButton));
  }
  assert.equal(config.findAndReplace.uiType, 'dialog');
  assert.equal(config.fullscreen.menuBar.isVisible, false);
  assert.equal(config.fullscreen.toolbar.shouldNotGroupWhenFull, true);
  assert.equal(typeof config.fullscreen.onEnterCallback, 'function');
  assert.equal(typeof config.fullscreen.onLeaveCallback, 'function');
  const fullscreenClasses = [];
  const editableWrapper = {classList: {add: value => fullscreenClasses.push(value)}};
  config.fullscreen.onEnterCallback({
    querySelector: selector => selector === '.ck-fullscreen__editable' ? editableWrapper : null
  });
  assert.deepEqual(fullscreenClasses, ['crm-container']);
  assert.equal(config.ui.viewportOffset.top, 0);
  assert.equal(config.table.tableLayout.stripFigureFromContentTable, false);
  assert.equal(config.table.tableLayout.preferredExternalTableType, 'content');
  assert.equal(config.table.tableProperties.alignment.useInlineStyles, true);
  assert.equal(harness()('civimail').config.table.tableProperties.alignment.useInlineStyles, true);
  assert.equal(harness()('civievent').config.table.tableProperties.alignment.useInlineStyles, false);
});

test('HTML presets accept Markdown paste without changing their output format', () => {
  const config = harness()().config;
  assert.equal(config.civiDataFormat, 'html');
  assert.equal(config.civiPasteMarkdown, true);
  assert.ok(config.removePlugins.includes('Markdown'));
  assert.ok(!config.removePlugins.includes('PasteFromMarkdownExperimental'));
});

test('companion extensions can discover an initialized editor without a hard dependency', () => {
  const create = harness();
  assert.equal(typeof create.CRM.ckeditor5.getInstance, 'function');
});

test('companion extensions can enable inactive plugins from the shared bundle per field', () => {
  class FullPage {}
  FullPage.pluginName = 'FullPage';
  const create = harness({}, () => {}, {window: {CKEDITOR: {FullPage}}});
  const config = create('fullpage').config;
  assert.ok(!config.extraPlugins.includes(FullPage));
  assert.equal(create.CRM.ckeditor5.enableBundledPlugin(config, 'FullPage'), FullPage);
  assert.equal(config.extraPlugins.filter(plugin => plugin === FullPage).length, 1);
  create.CRM.ckeditor5.enableBundledPlugin(config, 'FullPage');
  assert.equal(config.extraPlugins.filter(plugin => plugin === FullPage).length, 1);
  assert.throws(
    () => create.CRM.ckeditor5.enableBundledPlugin(config, 'MissingPlugin'),
    /bundled plugin "MissingPlugin" is not available/
  );
});

test('emoji definitions use the self-hosted asset configured by CiviCRM', () => {
  const config = harness({CKEditor5EmojiDefinitions: '/civicrm/ext/ckeditor5/js/ckeditor5/emoji/16/en.json'})().config;
  assert.equal(config.emoji.definitionsUrl, 'https://example.test/civicrm/ext/ckeditor5/js/ckeditor5/emoji/16/en.json');
});

test('the Markdown preset stores Markdown and disables file handling', () => {
  const result = harness({ELFinderLocation: '/elfinder.js', CKEditor5UploadMode: 'elfinder'})('markdown');
  assert.equal(result.context.preset, 'markdown');
  assert.equal(result.context.resolvedPreset, 'markdown');
  assert.equal(result.config.civiDataFormat, 'markdown');
  assert.equal(result.config.civiUploadMode, 'none');
  assert.equal(result.config.civiHtmlQa.enabled, false);
  assert.equal(result.config.civiPreserveTemplateStyles, false);
  assert.ok(!result.config.removePlugins.includes('Markdown'));
  assert.ok(!result.config.removePlugins.includes('PasteFromMarkdownExperimental'));
  assert.ok(result.config.removePlugins.includes('ImageUpload'));
  assert.ok(result.config.removePlugins.includes('Base64UploadAdapter'));
  assert.deepEqual(plain(result.config.toolbar.items), [
    'heading', '|',
    'bold', 'italic', 'strikethrough', 'link', '|',
    'bulletedList', 'numberedList', 'blockQuote', '|',
    'sourceEditing', 'undo', 'redo'
  ]);
  assert.ok(!result.config.toolbar.items.includes('imageUpload'));
  assert.deepEqual(plain(result.config.table.contentToolbar), ['tableColumn', 'tableRow', 'mergeTableCells']);
});

test('Markdown paste can be disabled by a preset', () => {
  const config = harness({
    CKEditor5Presets: {plain: {civiPasteMarkdown: false}}
  })('plain').config;
  assert.ok(config.removePlugins.includes('Markdown'));
  assert.ok(config.removePlugins.includes('PasteFromMarkdownExperimental'));
});

test('the sticky toolbar stays below stacked Drupal and CiviCRM menus', () => {
  const elements = {
    '#toolbar-bar': {getBoundingClientRect: () => ({width: 1200, height: 40, bottom: 40})},
    '#civicrm-menu': {getBoundingClientRect: () => ({width: 1200, height: 38, bottom: 78})}
  };
  const browser = {
    document: {querySelector: selector => elements[selector] || null},
    window: {getComputedStyle: () => ({position: 'fixed', display: 'block', visibility: 'visible'})}
  };
  assert.equal(harness({}, () => {}, browser)().config.ui.viewportOffset.top, 78);
});

test('saved HTML QA mode is inherited and can be disabled by a named preset', () => {
  const create = harness({CKEditor5AdminPresets: {
    default: {civiHtmlQa: {enabled: true}},
    civievent: {civiHtmlQa: {enabled: false}}
  }});
  assert.equal(create('civimail').config.civiHtmlQa.enabled, true);
  assert.equal(create('civievent').config.civiHtmlQa.enabled, false);
});

for (const adapter of ['base64', 'elfinder']) {
  test(`nested inheritance and array replacement with ${adapter}`, () => {
    const create = harness({
      ELFinderLocation: adapter === 'elfinder' ? '/elfinder.js' : null,
      CKEditor5CustomConfig: {fontSize: {supportAllValues: true}},
      CKEditor5Presets: {
        default: {toolbar: {items: ['bold']}, fontSize: {options: [12]}},
        civimail: {toolbar: {items: ['bold', 'insertTable']}, fontSize: {options: [16]}},
        civievent: {toolbar: {items: []}}
      }
    });
    const mail = create('civimail');
    assert.deepEqual(plain(mail.config.toolbar.items), ['bold', 'insertTable']);
    assert.equal(mail.config.toolbar.shouldNotGroupWhenFull, true);
    assert.deepEqual(plain(mail.config.fontSize), {supportAllValues: true, options: [16]});
    assert.equal(mail.context.uploadAdapter, adapter);
    assert.equal(mail.context.resolvedPreset, 'civimail');
    assert.deepEqual(plain(create('civievent').config.toolbar.items), []);
    const fallback = create('unknown');
    assert.deepEqual(plain(fallback.config.toolbar.items), ['bold']);
    assert.equal(fallback.context.preset, 'unknown');
    assert.equal(fallback.context.resolvedPreset, 'default');
  });
}

test('listeners receive the requested preset and have final precedence', () => {
  const create = harness({}, (config, context) => {
    if (context.preset === 'civimail') config.toolbar.items = ['sourceEditing'];
  });
  assert.deepEqual(plain(create('civimail').config.toolbar.items), ['sourceEditing']);
  assert.ok(create('civievent').config.toolbar.items.includes('insertTable'));
});

test('field configurations do not mutate shared presets or palettes', () => {
  const presets = {default: {toolbar: {items: ['bold']}, fontSize: {options: [12]}}};
  const legacy = {link: {decorators: {custom: {mode: 'manual'}}}};
  const create = harness({CKEditor5Presets: presets, CKEditor5CustomConfig: legacy});
  const first = create('civimail').config;
  first.toolbar.items.push('insertTable');
  first.fontSize.options.push(24);
  first.fontColor.colors[0].color = '#123456';
  first.link.decorators.custom.mode = 'automatic';
  const second = create('civievent').config;
  assert.deepEqual(plain(second.toolbar.items), ['bold']);
  assert.deepEqual(plain(second.fontSize.options), [12]);
  assert.equal(second.fontColor.colors[0].color, '#000000');
  assert.equal(second.link.decorators.custom.mode, 'manual');
  assert.deepEqual(presets.default.toolbar.items, ['bold']);
  assert.equal(legacy.link.decorators.custom.mode, 'manual');
});

test('callbacks and plugin constructors are preserved', () => {
  class Plugin {}
  const callback = () => true;
  const result = harness({CKEditor5Presets: {default: {extraPlugins: [Plugin], callback}}})().config;
  assert.equal(result.extraPlugins[0], Plugin);
  assert.equal(result.callback, callback);
});

test('prototype keys and inherited presets are not applied', () => {
  const presets = Object.assign(Object.create({civimail: {language: 'unexpected'}}), {
    default: JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"toolbar":{"items":["bold"]}}')
  });
  const result = harness({CKEditor5Presets: presets})('civimail');
  assert.equal(result.config.language, 'en');
  assert.equal(result.config.polluted, undefined);
  assert.equal(result.context.resolvedPreset, 'default');
});

test('presentation policy preserves classes and selected styles without arbitrary attributes', () => {
  const config = harness()('civimail').config;
  const presentation = config.htmlSupport.allow[0];
  for (const name of ['p', 'div', 'span', 'table', 'td', 'img']) assert.ok(presentation.name.test(name));
  for (const name of ['script', 'iframe', 'input', 'svg']) assert.equal(presentation.name.test(name), false);
  assert.equal(presentation.classes, true);
  assert.ok(presentation.styles.includes('background-color'));
  assert.ok(presentation.styles.includes('font-family'));
  assert.ok(!presentation.styles.includes('position'));
  assert.ok(!presentation.attributes.includes('onclick'));
  assert.equal(config.fontFamily.supportAllValues, true);
  assert.equal(config.fontSize.supportAllValues, true);
  assert.ok(config.fontSize.options.every(option => option === 'default' || typeof option === 'number'));
  assert.ok(config.htmlSupport.allow.some(rule => rule.name === 'style'));
  const denied = config.htmlSupport.disallow[1].attributes;
  for (const name of ['onclick', 'onerror', 'ng-click', 'data-ng-include']) {
    assert.ok(denied.some(rule => typeof rule.test === 'function' && rule.test(name)));
  }
});

test('presentation policies remain replaceable and isolated per field', () => {
  const create = harness({CKEditor5Presets: {
    civievent: {htmlSupport: {allow: []}, civiPreserveTemplateStyles: false}
  }});
  assert.equal(create('civievent').config.htmlSupport.allow.length, 0);
  assert.ok(create('civimail').config.htmlSupport.allow.length > 0);
  const config = create('civievent').config;
  const processor = {toView() {}};
  const original = processor.toView;
  config.extraPlugins[0]({config: {get: name => config[name]}, data: {processor}});
  assert.equal(processor.toView, original);
  create('civimail').config.htmlSupport.allow[0].styles.push('custom-test');
  assert.ok(!create('civimail').config.htmlSupport.allow[0].styles.includes('custom-test'));
});

test('legacy named size presets do not conflict with unrestricted font-size import', () => {
  const config = harness({CKEditor5Presets: {default: {
    fontSize: {options: ['tiny', 'default', 'huge']}
  }}})().config;
  assert.equal(config.fontSize.supportAllValues, false);
  assert.deepEqual(plain(config.fontSize.options), ['tiny', 'default', 'huge']);
});

test('named HTML rulesets configure General HTML Support and template style preservation per preset', () => {
  const create = harness({CKEditor5AdminPresets: {
    default: {civiHtmlRuleset: 'strict'},
    civievent: {civiHtmlRuleset: 'presentation'},
    civimail: {civiHtmlRuleset: 'template'}
  }});
  const strict = create('default').config;
  assert.deepEqual(plain(strict.htmlSupport.allow), []);
  assert.equal(strict.civiPreserveTemplateStyles, false);

  const presentation = create('civievent').config;
  assert.ok(presentation.htmlSupport.allow.length > 0);
  assert.ok(!presentation.htmlSupport.allow.some(rule => rule.name === 'style'));
  assert.equal(presentation.civiPreserveTemplateStyles, false);

  const mail = create('civimail').config;
  assert.ok(mail.htmlSupport.allow.some(rule => rule.name === 'style'));
  assert.equal(mail.civiPreserveTemplateStyles, true);
});

test('upload mode disables imageUpload and the CiviCRM file manager when unprivileged or restricted by preset', () => {
  const unprivileged = harness({
    ELFinderLocation: null,
    CKEditor5UploadMode: 'none'
  })('default');
  assert.equal(unprivileged.context.uploadAdapter, 'none');
  assert.ok(!unprivileged.config.toolbar.items.includes('imageUpload'));
  assert.ok(!unprivileged.config.toolbar.items.includes('civiFileManager'));
  assert.ok(unprivileged.config.removePlugins.includes('ImageUpload'));
  assert.ok(unprivileged.config.removePlugins.includes('Base64UploadAdapter'));

  const unprivilegedFormBuilder = harness({
    isFrontend: true,
    ELFinderLocation: null,
    CKEditor5UploadMode: 'none'
  })(undefined, {closest: selector => selector === 'civi-rich-text-input' ? {} : null});
  assert.equal(unprivilegedFormBuilder.context.uploadAdapter, 'none');
  assert.ok(!unprivilegedFormBuilder.config.toolbar.items.includes('imageUpload'));
  assert.ok(!unprivilegedFormBuilder.config.toolbar.items.includes('civiFileManager'));

  const restrictedPreset = harness({
    ELFinderLocation: '/elfinder.js',
    CKEditor5UploadMode: 'elfinder',
    CKEditor5AdminPresets: {
      default: {civiUploadMode: 'none'},
      civimail: {civiUploadMode: 'elfinder'}
    }
  });
  const formEditor = restrictedPreset('default');
  assert.equal(formEditor.context.uploadAdapter, 'none');
  assert.ok(!formEditor.config.toolbar.items.includes('imageUpload'));
  assert.ok(!formEditor.config.toolbar.items.includes('civiFileManager'));
  assert.ok(formEditor.config.removePlugins.includes('ImageUpload'));

  const mailEditor = restrictedPreset('civimail');
  assert.equal(mailEditor.context.uploadAdapter, 'elfinder');
  assert.ok(mailEditor.config.toolbar.items.includes('imageUpload'));
  assert.ok(mailEditor.config.toolbar.items.includes('civiFileManager'));
  assert.ok(!mailEditor.config.removePlugins.includes('ImageUpload'));
});

test('upload and file browser permissions control their toolbar buttons independently', () => {
  const uploadOnly = harness({
    ELFinderLocation: null,
    CKEditor5UploadMode: 'elfinder',
    CKEditor5CanUploadFiles: true,
    CKEditor5CanBrowseFiles: false
  })('default');
  assert.equal(uploadOnly.context.uploadAdapter, 'elfinder');
  assert.ok(uploadOnly.config.toolbar.items.includes('imageUpload'));
  assert.ok(!uploadOnly.config.toolbar.items.includes('civiFileManager'));

  const browseOnly = harness({
    ELFinderLocation: '/elfinder.js',
    CKEditor5UploadMode: 'none',
    CKEditor5CanUploadFiles: false,
    CKEditor5CanBrowseFiles: true
  })('default');
  assert.equal(browseOnly.context.uploadAdapter, 'none');
  assert.ok(!browseOnly.config.toolbar.items.includes('imageUpload'));
  assert.ok(browseOnly.config.toolbar.items.includes('civiFileManager'));
});

test('preserveTemplateStyles preserves full HTML document envelope across default and civimail presets', () => {
  const create = harness();
  for (const preset of ['default', 'civimail']) {
    const config = create(preset).config;
    const preserveTemplateStyles = config.extraPlugins[0];
    let lastToViewHtml = '';
    const listeners = {};
    const processor = {
      toView(html) {
        lastToViewHtml = html;
        return {html};
      },
      toData(viewFragment) {
        return viewFragment.html;
      }
    };
    const FakeDOMParser = class {
      parseFromString(html) {
        const doctypeMatch = String(html).match(/^\s*<!doctype[^>]*>\s*/i);
        const htmlAttrMatch = String(html).match(/<html([^>]*)>/i);
        const headMatch = String(html).match(/<head([^>]*)>([\s\S]*?)<\/head>/i);
        const bodyMatch = String(html).match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
        const parseAttrs = raw => {
          const attrs = [];
          const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
          let m;
          while ((m = regex.exec(raw || '')) !== null) {
            attrs.push({name: m[1], value: m[2]});
          }
          return attrs;
        };
        const headElementMatch = !headMatch && !bodyMatch
          ? String(html).match(/^((?:\s*(?:<title\b[^>]*>[\s\S]*?<\/title>|<meta\b[^>]*>|<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->))+)/i)
          : null;
        const headContent = headMatch ? headMatch[2] : (headElementMatch ? headElementMatch[1] : '');
        const bodyContent = bodyMatch ? bodyMatch[2] : (headElementMatch ? String(html).slice(headElementMatch[1].length) : String(html));
        const styleRegex = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
        const headStyles = [];
        let sm;
        while ((sm = styleRegex.exec(headContent)) !== null) {
          const full = sm[0];
          const openTag = `<style${sm[1]}>`;
          const text = sm[2];
          headStyles.push({
            outerHTML: full,
            get textContent() { return this._text; },
            set textContent(v) { this._text = v; this.outerHTML = `${openTag}${v}</style>`; },
            _text: text,
            remove() { this._removed = true; }
          });
        }
        const bodyStyles = [];
        let bsm;
        while ((bsm = styleRegex.exec(bodyContent)) !== null) {
          const full = bsm[0];
          const openTag = `<style${bsm[1]}>`;
          const text = bsm[2];
          bodyStyles.push({
            outerHTML: full,
            get textContent() { return this._text; },
            set textContent(v) { this._text = v; this.outerHTML = `${openTag}${v}</style>`; },
            _text: text,
            remove() { this._removed = true; }
          });
        }
        const bodyAttrs = parseAttrs(bodyMatch ? bodyMatch[1] : '');
        const bodyAttrMap = Object.fromEntries(bodyAttrs.map(a => [a.name, a.value]));
        const strippedBody = bodyContent.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
        return {
          documentElement: {attributes: parseAttrs(htmlAttrMatch ? htmlAttrMatch[1] : '')},
          head: {
            attributes: parseAttrs(headMatch ? headMatch[1] : ''),
            querySelectorAll: sel => sel === 'style' ? headStyles : [],
            cloneNode: () => ({
              querySelectorAll: sel => sel === 'style' ? headStyles.map(s => ({
                parentNode: {insertBefore() {}},
                remove() {}
              })) : [],
              innerHTML: headContent.replace(/<style\b[^>]*>[\s\S]*?<\/style>/i, '<meta data-civi-head-styles="true">').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
            })
          },
          body: {
            attributes: bodyAttrs,
            hasAttribute: name => Object.prototype.hasOwnProperty.call(bodyAttrMap, name),
            getAttribute: name => bodyAttrMap[name],
            querySelectorAll: sel => sel === 'style' ? bodyStyles : [],
            childNodes: [{outerHTML: strippedBody}],
            children: [],
            innerHTML: bodyContent,
            replaceChildren(wrapper) {
              this.innerHTML = wrapper.outerHTML;
            },
            prepend(...els) {
              this.innerHTML = els.map(e => e.outerHTML).join('') + this.innerHTML;
            }
          },
          createElement(tag) {
            const attrMap = {};
            const classes = new Set();
            const children = [];
            return {
              tagName: tag.toUpperCase(),
              style: {},
              classList: {
                add: c => { classes.add(c); attrMap.class = [...classes].join(' '); },
                remove: c => { classes.delete(c); attrMap.class = [...classes].join(' '); },
                contains: c => classes.has(c)
              },
              setAttribute(k, v) { attrMap[k] = v; },
              getAttribute(k) { return attrMap[k]; },
              hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrMap, k); },
              append(...nodes) { children.push(...nodes); },
              get outerHTML() {
                const attrStr = Object.entries(attrMap).filter(([, v]) => v !== '').map(([k, v]) => ` ${k}="${v}"`).join('');
                return `<${tag}${attrStr}>${children.map(n => n.outerHTML || '').join('')}</${tag}>`;
              }
            };
          }
        };
      }
    };
    const createWithDom = harness({}, () => {}, {
      DOMParser: FakeDOMParser,
      document: {
        implementation: {
          createHTMLDocument() {
            const htmlAttrs = {};
            const headAttrs = {};
            const bodyAttrs = {};
            const injectedStyles = [];
            let headHtml = '';
            let bodyHtml = '';
            return {
              documentElement: {
                setAttribute: (k, v) => { htmlAttrs[k] = v; },
                get outerHTML() {
                  const hAttr = Object.entries(htmlAttrs).map(([k, v]) => ` ${k}="${v}"`).join('');
                  const hdAttr = Object.entries(headAttrs).map(([k, v]) => ` ${k}="${v}"`).join('');
                  const bdAttr = Object.entries(bodyAttrs).map(([k, v]) => ` ${k}="${v}"`).join('');
                  const finalHead = headHtml.replace('<meta data-civi-head-styles="true">', injectedStyles.map(s => s.outerHTML).join(''));
                  return `<html${hAttr}><head${hdAttr}>${finalHead}</head><body${bdAttr}>${bodyHtml}</body></html>`;
                }
              },
              head: {
                setAttribute: (k, v) => { headAttrs[k] = v; },
                set innerHTML(v) { headHtml = v; },
                get innerHTML() {
                  return headHtml.replace('<meta data-civi-head-styles="true">', injectedStyles.map(s => s.outerHTML).join(''));
                },
                querySelector: sel => sel === 'meta[data-civi-head-styles]' ? {
                  parentNode: {insertBefore: s => injectedStyles.push(s)},
                  remove() {}
                } : null,
                appendChild: s => injectedStyles.push(s)
              },
              body: {
                setAttribute: (k, v) => { bodyAttrs[k] = v; },
                get innerHTML() { return bodyHtml; },
                append: (...nodes) => { bodyHtml += nodes.map(n => n.outerHTML || '').join(''); }
              }
            };
          }
        }
      }
    });
    const domConfig = createWithDom(preset).config;
    domConfig.extraPlugins[0]({
      config: {get: name => domConfig[name]},
      data: {
        processor,
        on(evt, cb) { listeners[evt] = listeners[evt] || []; listeners[evt].push(cb); }
      }
    });
    const fullDoc = '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>Reçu fiscal</title><style>.a > .b { color: red; }</style></head><body class="tpl" lang="fr"><p>Bonjour</p></body></html>';
    listeners.set[0]();
    const viewFrag = processor.toView(fullDoc);
    listeners.set[1]();
    assert.ok(lastToViewHtml.includes('<style>.a > .b { color: red; }</style>'));
    const exported = processor.toData({html: viewFrag.html.replace('.a > .b', '.a &gt; .b')});
    assert.ok(exported.startsWith('<!DOCTYPE html>'));
    assert.ok(exported.includes('<html lang="fr">'));
    assert.ok(exported.includes('<title>Reçu fiscal</title>'));
    assert.ok(exported.includes('<style>.a > .b { color: red; }</style>'));
    assert.ok(!exported.includes('&gt;'));

    listeners.set[0]();
    const mjmlHeadFrag = '<title></title><!--[if !mso]><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]--><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><style type="text/css">#outlook a { padding: 0; }</style><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml></noscript><![endif]--><div dir="auto" lang="und"><p>MJML body</p></div>';
    const mjmlView = processor.toView(mjmlHeadFrag);
    listeners.set[1]();
    const exportedMjml = processor.toData(mjmlView);
    assert.ok(exportedMjml.includes('<title></title>'));
    assert.ok(exportedMjml.includes('http-equiv="Content-Type"'));
    assert.ok(exportedMjml.includes('<!--[if mso]>'));
    assert.ok(exportedMjml.includes('<style type="text/css">#outlook a { padding: 0; }</style>'));
    assert.ok(!/<(?:!doctype|html|head|body)\b/i.test(exportedMjml));

    listeners.set[0]();
    const fragView = processor.toView('<p>Simple fragment</p>');
    listeners.set[1]();
    const exportedFrag = processor.toData(fragView);
    assert.equal(exportedFrag, '<p>Simple fragment</p>');
  }
});

