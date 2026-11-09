/*jshint esversion: 6 */
// https://civicrm.org/licensing
(function($, _) {

  var instances = {};

  function getInstance(item) {
    var name = $(item).attr("name"),
      id = $(item).attr("id");
    if (name && instances[name]) {
      return instances[name];
    }
    if (id && instances[id]) {
      return instances[id];
    }
  }

  CRM.wysiwyg.supportsFileUploads = true;

  CRM.wysiwyg._create = function(item) {
    var deferred = $.Deferred();

    /**
     * Add script for elfinder - this might be cleaner as it's own file but for now....
     * @param editor
     */
    function onReadyElFinder(editor) {
      // elfinder folder hash of the destination folder to be uploaded in this CKeditor 5
      const uploadTargetHash = 'l1_Lw';
      // elFinder connector URL
      const connectorUrl = CRM.url('civicrm/image/access', null, 'back');
      const ckf = editor.commands.get('ckfinder'),
        fileRepo = editor.plugins.get('FileRepository'),
        ntf = editor.plugins.get('Notification'),
        i18 = editor.locale.t,
        // Insert images to editor window
        insertImages = urls => {
          const imgCmd = editor.commands.get('imageUpload');
          if (!imgCmd.isEnabled) {
            ntf.showWarning(i18('Could not insert image at the current position.'), {
              title: i18('Inserting image failed'),
              namespace: 'ckfinder'
            });
            return;
          }
          editor.execute('imageInsert', { source: urls });
        },
        // To get elFinder instance
        getfm = open => {
          return new Promise((resolve, reject) => {
            // Execute when the elFinder instance is created
            const done = () => {
              if (open) {
                // request to open folder specify
                if (!Object.keys(_fm.files()).length) {
                  // when initial request
                  _fm.one('open', () => {
                    _fm.file(open)? resolve(_fm) : reject(_fm, 'errFolderNotFound');
                  });
                } else {
                  // elFinder has already been initialized
                  new Promise((res, rej) => {
                    if (_fm.file(open)) {
                      res();
                    } else {
                      // To acquire target folder information
                      _fm.request({cmd: 'parents', target: open}).done(e =>{
                        _fm.file(open)? res() : rej();
                      }).fail(() => {
                        rej();
                      });
                    }
                  }).then(() => {
                    // Open folder after folder information is acquired
                    _fm.exec('open', open).done(() => {
                      resolve(_fm);
                    }).fail(err => {
                      reject(_fm, err? err : 'errFolderNotFound');
                    });
                  }).catch((err) => {
                    reject(_fm, err? err : 'errFolderNotFound');
                  });
                }
              } else {
                // show elFinder manager only
                resolve(_fm);
              }
            };

            // Check elFinder instance
            if (_fm) {
              // elFinder instance has already been created
              done();
            } else {
              // To create elFinder instance
              _fm = $('<div/>').dialogelfinder({
                // dialog title
                title : 'File Manager',
                // connector URL
                url : connectorUrl,
                cssAutoLoad : false,
                // start folder setting
                startPathHash : open? open : void(0),
                // Set to do not use browser history to un-use location.hash
                useBrowserHistory : false,
                // Disable auto open
                autoOpen : false,
                // elFinder dialog width
                width : '80%',
                // set getfile command options
                commandsOptions : {
                  getfile: {
                    oncomplete : 'close',
                    multiple : true
                  }
                },
                // Insert in CKEditor when choosing files
                getFileCallback : (files, fm) => {
                  let imgs = [];
                  fm.getUI('cwd').trigger('unselectall');
                  $.each(files, function(i, f) {
                    if (f && f.mime.match(/^image\//i)) {
                      imgs.push(fm.convAbsUrl(f.url));
                    } else {
                      editor.execute('link', fm.convAbsUrl(f.url));
                    }
                  });
                  if (imgs.length) {
                    insertImages(imgs);
                  }
                }
              }).elfinder('instance');
              done();
            }
          });
        };

      // elFinder instance
      let _fm;

      if (ckf) {
        // Take over ckfinder execute()
        ckf.execute = () => {
          getfm().then(fm => {
            fm.getUI().dialogelfinder('open');
          });
        };
      }

      // Make uploader
      const uploder = function(loader) {
        let upload = function(file, resolve, reject) {
          getfm(uploadTargetHash).then(fm => {
            let fmNode = fm.getUI();
            fmNode.dialogelfinder('open');
            fm.exec('upload', {files: [file], target: uploadTargetHash}, void(0), uploadTargetHash)
              .done(data => {
                if (data.added && data.added.length) {
                  fm.url(data.added[0].hash, { async: true }).done(function(url) {
                    resolve({
                      'default': fm.convAbsUrl(url)
                    });
                    fmNode.dialogelfinder('close');
                  }).fail(function() {
                    reject('errFileNotFound');
                  });
                } else {
                  reject(fm.i18n(data.error? data.error : 'errUpload'));
                  fmNode.dialogelfinder('close');
                }
              })
              .fail(err => {
                const error = fm.parseError(err);
                reject(fm.i18n(error? (error === 'userabort'? 'errAbort' : error) : 'errUploadNoFiles'));
              });
          }).catch((fm, err) => {
            console.log(err);
            const error = fm.parseError(err);
            reject(fm.i18n(error? (error === 'userabort'? 'errAbort' : error) : 'errUploadNoFiles'));
          });
        };

        this.upload = function() {
          return new Promise(function(resolve, reject) {
            if (loader.file instanceof Promise || (loader.file && typeof loader.file.then === 'function')) {
              loader.file.then(function(file) {
                upload(file, resolve, reject);
              });
            } else {
              upload(loader.file, resolve, reject);
            }
          });
        };
        this.abort = function() {
          _fm && _fm.getUI().trigger('uploadabort');
        };
      };

      // Set up image uploader
      fileRepo.createUploadAdapter = loader => {
        return new uploder(loader);
      };
      onReady(editor);
    }

    function onReady(editor) {
      var debounce,
        name = $(editor.sourceElement).attr('name') || $(editor.sourceElement).attr('id');

      instances[name] = editor;

      // Update source element on blur; especially important for javascript-based UIs.
      // The editable itself loses focus when CKEditor opens contextual UI such
      // as the link balloon. Only notify CiviCRM after the entire editor UI has
      // lost focus, otherwise collapsed fields close while their dialogs are in use.
      editor.ui.focusTracker.on('change:isFocused', function(evt, name, isFocused) {
        if (isFocused) {
          return;
        }
        editor.updateSourceElement();
        $(item).trigger("blur");
        $(item).trigger("change");
      });

      editor.on('destroy', function(e) {
        var name = $(e.source.sourceElement).attr('name') || $(e.source.sourceElement).attr('id');
        delete instances[name];
      });
      $(editor.sourceElement).trigger('crmWysiwygCreate', ['ckeditor', editor]);
      deferred.resolve();
    }

    /**
     * Create the editor instance.
     */
    function initialize() {
      if (CRM.config.ELFinderLocation) {
        if (CRM.config.CKEditor5CustomConfig) {
          initializeCustomWithELFinder();
        }
        else{
          initializeWithELFinder();
        }
      }
      else {
        initializeWithBaseUploader();
      }
    }

    /**
     * Create a custom editor instance with Elfinder.
     */
    function initializeCustomWithELFinder() {
      $(item).addClass('crm-wysiwyg-enabled');
      ClassicEditor.create($(item)[0], CRM.config.CKEditor5CustomConfig).then(onReadyElFinder);
    }

    /**
     * Create the editor instance with the BaseUploader.
     */
    function initializeWithBaseUploader() {
      $(item).addClass('crm-wysiwyg-enabled');
      var config = CRM.config.CKEditor5CustomConfig || getDefaultConfig(false);
      ClassicEditor.create($(item)[0], config).then(onReady);
    }

    /**
     * Create the editor instance with Elfinder.
     */
    function initializeWithELFinder() {
      $(item).addClass('crm-wysiwyg-enabled');
      ClassicEditor.create($(item)[0], getDefaultConfig(true)).then(onReadyElFinder);
    }

    /**
     * Default editor configuration, shared by both packaged editors.
     *
     * @param {Boolean} withElFinder
     *   Whether the elFinder file manager is available (adds the 'ckfinder'
     *   button, whose command is taken over in onReadyElFinder()).
     * @return {Object}
     */
    function getDefaultConfig(withElFinder) {
      var toolbarItems = [
        'heading',
        'style',
        '|',
        'bold',
        'italic',
        'underline',
        'strikethrough',
        'subscript',
        'superscript',
        'removeFormat',
        '|',
        'fontFamily',
        'fontSize',
        'fontColor',
        'fontBackgroundColor',
        'highlight',
        '|',
        'bulletedList',
        'numberedList',
        'todoList',
        'outdent',
        'indent',
        'alignment',
        '|',
        'link',
        'insertImage',
        'insertTable',
        'blockQuote',
        'mediaEmbed',
        'horizontalLine',
        'pageBreak',
        'specialCharacters',
        '|',
        'findAndReplace',
        'undo',
        'redo',
        '|',
        'sourceEditing',
        'htmlEmbed',
        'code'
      ];

      if (withElFinder) {
        toolbarItems.splice(toolbarItems.indexOf('insertImage') + 1, 0, 'ckfinder');
      }

      return {
        toolbar: {
          // With this it wraps rather than offering a drop down for more.
          // I'm on the fence about which is better but this is consistent with
          // ckeditor4. If we added configurability we could expose this.
          // https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editorconfig-EditorConfig.html#member-toolbar
          shouldNotGroupWhenFull: true,
          items: toolbarItems
        },
        language: (typeof CRM.config.locale == 'string' ? CRM.config.locale.substr(0, 2) : 'en'),
        image: {
          toolbar: [
            'imageStyle:inline',
            'imageStyle:block',
            'imageStyle:side',
            '|',
            'imageStyle:alignLeft',
            'imageStyle:alignCenter',
            'imageStyle:alignRight',
            '|',
            'toggleImageCaption',
            'imageTextAlternative',
            'linkImage',
            '|',
            'resizeImage'
          ]
        },
        table: {
          contentToolbar: [
            'tableColumn',
            'tableRow',
            'mergeTableCells',
            'tableCellProperties',
            'tableProperties',
            'toggleTableCaption'
          ]
        },
        // The "Styles" dropdown, the closest equivalent to ckeditor4's Styles
        // menu. These are deliberately generic - a site that wants its own
        // house styles should override `style.definitions` through
        // CRM.config.CKEditor5CustomConfig. The matching CSS lives in
        // css/ckeditor.css.
        style: {
          definitions: [
            {name: 'Lead paragraph', element: 'p', classes: ['crm-lead']},
            {name: 'Small print', element: 'p', classes: ['crm-small']},
            {name: 'Callout box', element: 'p', classes: ['crm-callout']},
            {name: 'Bordered table', element: 'table', classes: ['crm-table-bordered']},
            {name: 'Marker', element: 'span', classes: ['crm-marker']},
            {name: 'Muted text', element: 'span', classes: ['crm-muted']}
          ]
        },
        // GeneralHtmlSupport is in both builds but does nothing until it is told
        // what to allow. Without this, ckeditor5 strips anything it has no model
        // for - inline styles, classes, <div> wrappers - which quietly mangles
        // markup typed into the Source view or pasted from an existing template.
        // https://ckeditor.com/docs/ckeditor5/latest/features/html/general-html-support.html
        //
        // The FullPage plugin (also from ckeditor5-html-support, and built into
        // both bundles) is what preserves everything OUTSIDE <body> - the
        // doctype, <html>, <head>, <title>, <meta> and any <style> block. It is
        // the ckeditor5 equivalent of ckeditor4's config.fullPage, and it is what
        // lets a complete HTML email survive being saved as a message template.
        // Content that is only a fragment is left as a fragment - no wrapper is
        // added - so existing templates are unaffected.
        // https://ckeditor.com/docs/ckeditor5/latest/features/html/full-page-html.html
        htmlSupport: {
          allow: [
            {name: /.*/, styles: true, classes: true},
            {name: /^(div|section|article|header|footer|aside|font|table|tbody|thead|tr|td|th)$/, attributes: /^(?!on)/},
            {name: 'style'}
          ]
        },
        fontSize: {
          options: ['default', 10, 12, 14, 16, 18, 20, 24, 32],
          supportAllValues: true
        },
        licenseKey: ''
      };
    }

    if ($(item).hasClass('crm-wysiwyg-enabled')) {
      deferred.resolve();
    }
    else if ($(item).length) {
      // Lazy-load ckeditor.js
      if (window.ClassicEditor) {
        initialize();
      } else {
        // Every one of these has to have finished before initialize() runs.
        var pending = [CRM.loadScript(CRM.config.CKEditor5Location)];
        if (CRM.config.ELFinderLocation) {
          pending.push(CRM.loadScript(CRM.config.ELFinderLocation));
          if (CRM.config.CKEditor5Language) {
            pending.push(CRM.loadScript(CRM.config.CKEditor5Language));
          }
        }
        $.when.apply($, pending).done(initialize);
      }
    } else {
      deferred.reject();
    }
    return deferred;
  };

  CRM.wysiwyg.destroy = function(item) {
    $(item).removeClass('crm-wysiwyg-enabled');
    var editor = getInstance(item);
    if (editor) {
      editor.destroy();
    }
  };

  CRM.wysiwyg.updateElement = function(item) {
    var editor = getInstance(item);
    if (editor) {
      editor.updateSourceElement();
    }
  };

  CRM.wysiwyg.getVal = function(item) {
    var editor = getInstance(item);
    if (editor) {
      return editor.getData();
    } else {
      return $(item).val();
    }
  };

  CRM.wysiwyg.setVal = function(item, val) {
    var editor = getInstance(item);
    if (editor) {
      return editor.setData(val);
    } else {
      return $(item).val(val);
    }
  };

  CRM.wysiwyg.insert = function(item, text) {
    var editor = getInstance(item);
    if (editor) {
      editor.model.change(writer => {
        const insertPosition = editor.model.document.selection.getFirstPosition();
        writer.insertText(text, insertPosition);
      });
    } else {
      CRM.wysiwyg._insertIntoTextarea(item, text);
    }
  };

  CRM.wysiwyg.focus = function(item) {
    var editor = getInstance(item);
    if (editor) {
      editor.focus();
    } else {
      $(item).focus();
    }
  };

})(CRM.$, CRM._);
