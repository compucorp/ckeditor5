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

  // Widest an image is written into the saved HTML, in pixels: the usual
  // width of an email body.
  var emailImageMaxWidth = 600;

  /**
   * Write each image's display size onto the <img> itself.
   *
   * A resized image keeps its size on the <figure> around it, and only the
   * editor's own stylesheet scales the <img> to fit. Email clients don't get
   * that stylesheet, so they show the image at its full natural width. This
   * puts a pixel width and height on the <img>, capped at emailImageMaxWidth.
   *
   * Based on emailImageOutput() in upstream 1.9, which handles pixel widths. A
   * percentage width is taken as a share of emailImageMaxWidth, so images
   * resized before resizeUnit was 'px' keep their relative size.
   *
   * @param {Object} editor
   */
  function emailImageOutput(editor) {
    editor.conversion.for('dataDowncast').add(function(dispatcher) {
      var convertImage = function(event, data, conversionApi) {
        var image = data.item;
        var viewElement = conversionApi.mapper.toViewElement(image);
        var viewImage = viewElement && editor.plugins.get('ImageUtils').findViewImgElement(viewElement);
        if (!viewImage) {
          return;
        }

        var writer = conversionApi.writer;
        writer.setAttribute('border', '0', viewImage);
        writer.setStyle('max-width', '100%', viewImage);
        writer.setStyle('height', 'auto', viewImage);

        var naturalWidth = Number(image.getAttribute('width'));
        var naturalHeight = Number(image.getAttribute('height'));
        var resizedWidth = String(image.getAttribute('resizedWidth') || '');
        var pixels = resizedWidth.match(/^([0-9]+(?:\.[0-9]+)?)px$/i);
        var percent = resizedWidth.match(/^([0-9]+(?:\.[0-9]+)?)%$/);
        var displayWidth = naturalWidth;
        if (pixels) {
          displayWidth = Number(pixels[1]);
        }
        else if (percent) {
          displayWidth = emailImageMaxWidth * Number(percent[1]) / 100;
        }
        if (!isFinite(displayWidth) || displayWidth <= 0) {
          return;
        }
        displayWidth = Math.max(1, Math.min(Math.round(displayWidth), emailImageMaxWidth));

        writer.setAttribute('width', String(displayWidth), viewImage);
        if (naturalWidth > 0 && naturalHeight > 0) {
          writer.setAttribute('height', String(Math.max(1, Math.round(naturalHeight * displayWidth / naturalWidth))), viewImage);
        }
        writer.setStyle('width', displayWidth + 'px', viewImage);
      };

      dispatcher.on('insert:imageInline', convertImage, {priority: 'lowest'});
      dispatcher.on('insert:imageBlock', convertImage, {priority: 'lowest'});
    });
  }

  /**
   * Save tables and images without their <figure> wrappers.
   *
   * PDF engines and email clients give a figure default margins, so a table
   * is indented and narrowed, a fixed-width form can spill onto another page,
   * and an image gets space around it. Save the <table> or the image on its
   * own. Upstream 1.9 gets the table result from CKEditor's PlainTableOutput
   * plugin, which this build doesn't include.
   *
   * It wraps the data processor in afterInit(), because the FullPage plugin
   * replaces the data processor during init().
   */
  class UnwrappedFigureOutput {
    constructor(editor) {
      this.editor = editor;
    }

    init() {
      blockImageOutput(this.editor);
    }

    afterInit() {
      var processor = this.editor.data.processor;
      var toData = processor.toData.bind(processor);
      processor.toData = function(viewFragment) {
        return unwrapFigures(toData(viewFragment));
      };
    }
  }

  /**
   * @param {String} html
   *   A fragment, or a full document from the FullPage plugin.
   * @return {String}
   */
  function unwrapFigures(html) {
    if (html.indexOf('<figure class="table') === -1 && html.indexOf('<figure class="image') === -1) {
      return html;
    }
    return rewriteBody(html, function(root) {
      unwrapTableFigures(root);
      unwrapImageFigures(root);
    });
  }

  /**
   * Change HTML through the DOM.
   *
   * Only what is inside <body> is rewritten, so a full document keeps its
   * doctype, <html>, <head> and <body> exactly as they were.
   *
   * @param {String} html
   *   A fragment, or a full document from the FullPage plugin.
   * @param {Function} rewrite
   *   Changes the DocumentFragment it is given in place.
   * @return {String}
   */
  function rewriteBody(html, rewrite) {
    var body = html.match(/(<body\b[^>]*>)([\s\S]*)(<\/body>)/i);
    var start = body ? body.index + body[1].length : 0;
    var end = body ? start + body[2].length : html.length;
    var template = document.createElement('template');
    template.innerHTML = html.slice(start, end);
    rewrite(template.content);
    return html.slice(0, start) + template.innerHTML + html.slice(end);
  }

  /**
   * @param {DocumentFragment} root
   */
  function unwrapTableFigures(root) {
    root.querySelectorAll('figure.table').forEach(function(figure) {
      var table = figure.querySelector(':scope > table');
      if (!table) {
        return;
      }
      for (var i = 0; i < figure.style.length; i++) {
        var property = figure.style[i];
        if (!table.style.getPropertyValue(property)) {
          table.style.setProperty(property, figure.style.getPropertyValue(property));
        }
      }
      var figcaption = figure.querySelector(':scope > figcaption');
      if (figcaption) {
        var caption = document.createElement('caption');
        caption.innerHTML = figcaption.innerHTML;
        table.insertBefore(caption, table.firstChild);
      }
      figure.replaceWith(table);
    });
  }

  // Image styles that only the editor's stylesheet lays out, and the inline
  // margins or float that give the same layout in an email.
  var imageStyleMargins = {
    alignCenter: ['auto', 'auto'],
    alignBlockLeft: ['0', 'auto'],
    alignBlockRight: ['auto', '0']
  };
  var imageStyleFloats = {
    side: 'right',
    alignRight: 'right',
    alignLeft: 'left'
  };

  /**
   * Lay out each block image on its <img>, ready for unwrapImageFigures().
   *
   * Once the <figure> is gone, CKEditor reads an <img> back as a block image
   * only if it has display:block. Without it, the image came back as an
   * inline image in a new paragraph on the next save. The image's style
   * becomes inline margins or a float, and its class goes onto the <img> too,
   * so the editor shows the same style when the content is opened again.
   * Margins or a float already on the <img> are kept. A captioned image keeps
   * its figure, so only gets display:block.
   *
   * This is done in the downcast, not on the saved HTML, so that CKEditor
   * writes the style attribute and a second save gives the same HTML. On
   * load, the display:block and the style's margins or float are taken as
   * part of the image and its style, not kept as the <img>'s own styles, so
   * changing the image's style or type later changes them too.
   *
   * @param {Object} editor
   */
  function blockImageOutput(editor) {
    var styleClass = function(name) {
      var definition = editor.plugins.get('ImageStyleEditing').normalizedStyles.find(function(definition) {
        return definition.name === name;
      });
      return definition && definition.className;
    };

    editor.conversion.for('upcast').add(function(dispatcher) {
      dispatcher.on('element:img', function(event, data, conversionApi) {
        var img = data.viewItem;
        var consumable = conversionApi.consumable;
        if (img.getStyle('display') === 'block') {
          consumable.consume(img, {styles: ['display']});
        }
        Object.keys(imageStyleMargins).forEach(function(name) {
          var margins = imageStyleMargins[name];
          if (img.hasClass(styleClass(name)) && img.getStyle('margin-left') === margins[0] && img.getStyle('margin-right') === margins[1]) {
            consumable.consume(img, {styles: ['margin-left', 'margin-right']});
          }
        });
        Object.keys(imageStyleFloats).forEach(function(name) {
          if (img.hasClass(styleClass(name)) && img.getStyle('float') === imageStyleFloats[name]) {
            consumable.consume(img, {styles: ['float']});
          }
        });
      }, {priority: 'high'});
    });

    editor.conversion.for('dataDowncast').add(function(dispatcher) {
      dispatcher.on('insert:imageBlock', function(event, data, conversionApi) {
        var image = data.item;
        var figure = conversionApi.mapper.toViewElement(image);
        var img = figure && editor.plugins.get('ImageUtils').findViewImgElement(figure);
        if (!img) {
          return;
        }
        var writer = conversionApi.writer;
        writer.setStyle('display', 'block', img);

        var captioned = Array.from(image.getChildren()).some(function(child) {
          return child.is('element', 'caption');
        });
        var style = image.getAttribute('imageStyle');
        if (captioned || !style) {
          return;
        }
        var saved = (image.getAttribute('htmlImgAttributes') || {}).styles || {};
        if (imageStyleMargins[style] && !saved.margin && !saved['margin-left'] && !saved['margin-right']) {
          writer.setStyle('margin-left', imageStyleMargins[style][0], img);
          writer.setStyle('margin-right', imageStyleMargins[style][1], img);
        }
        if (imageStyleFloats[style] && !saved.float) {
          writer.setStyle('float', imageStyleFloats[style], img);
        }
        if (styleClass(style)) {
          writer.addClass(styleClass(style), img);
        }
      }, {priority: 'lowest'});
    });
  }

  /**
   * Replace each <figure class="image"> with the image (or its link). The
   * image already carries its size and layout (see emailImageOutput and
   * blockImageOutput). A captioned image keeps its figure.
   *
   * @param {DocumentFragment} root
   */
  function unwrapImageFigures(root) {
    root.querySelectorAll('figure.image').forEach(function(figure) {
      if (!figure.querySelector('img') || figure.querySelector(':scope > figcaption')) {
        return;
      }
      figure.replaceWith.apply(figure, Array.from(figure.childNodes));
    });
  }

  /**
   * Keep table-based email templates laid out as stored.
   *
   * Such templates centre their content with align="center" on table cells,
   * which CKEditor turns into text-align:center. That doesn't centre a nested
   * table or a display:block image, so the content column, the logo and
   * buttons moved to the left. Upstream 1.9 rewrites the legacy layout when
   * the content is loaded, with preserveLegacyEmailLayout(), and writes the
   * nested tables' margins back on save. Both are copied from upstream as
   * they are. This build's FullPage plugin replaces the data processor
   * during init(), so the loading step is wired in afterInit().
   */
  class LegacyEmailLayout {
    constructor(editor) {
      this.editor = editor;
    }

    init() {
      this.editor.conversion.for('dataDowncast').add(function(dispatcher) {
        dispatcher.on('insert:table', function(event, data, conversionApi) {
          const viewTable = findViewElement(conversionApi.mapper.toViewElement(data.item), 'table');
          if (!viewTable) return;
          const writer = conversionApi.writer;
          if (viewTable.hasClass('civi-email-align-center')) {
            writer.setStyle('margin-left', 'auto', viewTable);
            writer.setStyle('margin-right', 'auto', viewTable);
          }
          else if (viewTable.hasClass('civi-email-align-left')) {
            writer.setStyle('margin-left', '0', viewTable);
            writer.setStyle('margin-right', 'auto', viewTable);
          }
          else if (viewTable.hasClass('civi-email-align-right')) {
            writer.setStyle('margin-left', 'auto', viewTable);
            writer.setStyle('margin-right', '0', viewTable);
          }
        }, {priority: 'lowest'});
      });
    }

    afterInit() {
      var processor = this.editor.data.processor;
      var toView = processor.toView.bind(processor);
      processor.toView = function(html) {
        if (typeof html === 'string' && html.trim() !== '') {
          html = rewriteBody(html, preserveLegacyEmailLayout);
        }
        return toView(html);
      };
      var toData = processor.toData.bind(processor);
      processor.toData = function(viewFragment) {
        return restoreEmptyCells(toData(viewFragment));
      };
    }
  }

  function preserveLegacyEmailLayout(root) {
    root.querySelectorAll('[align]').forEach(function(element) {
      const alignment = String(element.getAttribute('align') || '').toLowerCase();
      if (!['left', 'center', 'right', 'justify'].includes(alignment)) return;
      if (element.tagName === 'TABLE') {
        if (alignment === 'center') {
          element.classList.add('civi-email-align-center');
          if (!element.style.marginLeft) element.style.marginLeft = 'auto';
          if (!element.style.marginRight) element.style.marginRight = 'auto';
        }
        else if (alignment === 'left' || alignment === 'right') {
          element.classList.add(`civi-email-align-${alignment}`);
          if (!element.style.marginLeft) element.style.marginLeft = alignment === 'right' ? 'auto' : '0';
          if (!element.style.marginRight) element.style.marginRight = alignment === 'left' ? 'auto' : '0';
        }
      }
      else if (!element.style.textAlign) {
        element.style.textAlign = alignment;
      }
    });
    // CKEditor saves every empty cell with &nbsp; in it, and once loaded an
    // empty cell looks the same as one holding &nbsp;. Mark the cells that
    // are stored empty (or only hold comments) so they are saved empty
    // again; see restoreEmptyCells().
    root.querySelectorAll('td, th').forEach(function(cell) {
      const empty = Array.from(cell.childNodes).every(node => node.nodeName === '#comment'
        || (node.nodeName === '#text' && /^[ \t\n\r\f]*$/.test(node.data)));
      if (empty) cell.classList.add('civi-email-empty-cell');
    });
    root.querySelectorAll('[valign]').forEach(function(element) {
      if (!element.style.verticalAlign) element.style.verticalAlign = element.getAttribute('valign');
    });
    root.querySelectorAll('[bgcolor]').forEach(function(element) {
      if (!element.style.backgroundColor) element.style.backgroundColor = element.getAttribute('bgcolor');
    });
    root.querySelectorAll('td, th').forEach(function(cell) {
      if (cell.children.length === 1 && cell.firstElementChild.tagName === 'TABLE') {
        const innerTable = cell.firstElementChild;
        let alignSource = cell;
        let cellAlign = '';
        while (alignSource && !cellAlign) {
          cellAlign = String(alignSource.getAttribute('align') || (alignSource.style && alignSource.style.textAlign) || '').toLowerCase();
          alignSource = alignSource.parentElement && typeof alignSource.parentElement.closest === 'function'
            ? alignSource.parentElement.closest('td, th')
            : null;
        }
        if (cellAlign === 'center' && !innerTable.classList.contains('civi-email-align-center')) {
          innerTable.classList.add('civi-email-align-center');
          if (!innerTable.style.marginLeft) innerTable.style.marginLeft = 'auto';
          if (!innerTable.style.marginRight) innerTable.style.marginRight = 'auto';
        }
        else if ((cellAlign === 'left' || cellAlign === 'right') && !innerTable.classList.contains(`civi-email-align-${cellAlign}`)) {
          innerTable.classList.add(`civi-email-align-${cellAlign}`);
          if (!innerTable.style.marginLeft) innerTable.style.marginLeft = cellAlign === 'right' ? 'auto' : '0';
          if (!innerTable.style.marginRight) innerTable.style.marginRight = cellAlign === 'left' ? 'auto' : '0';
        }
      }
      if (cell.children.length !== 1) return;
      let child = cell.firstElementChild;
      if (child.tagName === 'FIGURE' && child.classList.contains('image') && !child.querySelector('figcaption')) {
        const image = child.querySelector('img');
        const linkedImage = image && image.parentElement.tagName === 'A' ? image.parentElement : image;
        if (linkedImage) {
          cell.insertBefore(linkedImage, child);
          child.remove();
          child = linkedImage;
          if (!cell.style.textAlign) cell.style.textAlign = 'center';
        }
      }
      const image = child && child.tagName === 'IMG'
        ? child
        : child && child.tagName === 'A' && child.children.length === 1 && child.firstElementChild.tagName === 'IMG'
          ? child.firstElementChild
          : null;
      if (!image) return;
      if (image.style && image.style.display === 'block') {
        image.style.display = 'inline-block';
      }
      const inlineWrapper = root.ownerDocument.createElement('span');
      inlineWrapper.style.display = 'inline-block';
      cell.insertBefore(inlineWrapper, child);
      inlineWrapper.appendChild(child);
    });
  }

  // Take out the &nbsp; that CKEditor fills a cell marked by
  // preserveLegacyEmailLayout() with, so a cell stored empty, such as a
  // coloured spacer row, doesn't gain a line of text height. A cell that has
  // since been given content keeps it.
  function restoreEmptyCells(html) {
    if (!html.includes('civi-email-empty-cell')) return html;
    return rewriteBody(html, root => root.querySelectorAll('.civi-email-empty-cell').forEach(function(cell) {
      cell.classList.remove('civi-email-empty-cell');
      if (!cell.classList.length) cell.removeAttribute('class');
      const content = Array.from(cell.childNodes).filter(node => node.nodeName !== '#comment');
      if (content.length === 1 && content[0].nodeName === '#text' && content[0].data === '\u00a0') {
        content[0].remove();
      }
    }));
  }

  function findViewElement(viewElement, name) {
    if (!viewElement) return null;
    if (viewElement.is('element', name)) return viewElement;
    if (typeof viewElement.getChildren === 'function') {
      for (const child of viewElement.getChildren()) {
        const found = findViewElement(child, name);
        if (found) return found;
      }
    }
    return null;
  }

  // Save page breaks without the page-break class. CiviCRM's print.css starts
  // a new page before div.page-break, and the break's inline style starts
  // another after it, so every break printed a blank page. The editor reads
  // the break back from its inline style.
  function pageBreakOutput(editor) {
    editor.conversion.for('dataDowncast').add(function(dispatcher) {
      dispatcher.on('insert:pageBreak', function(event, data, conversionApi) {
        const viewPageBreak = conversionApi.mapper.toViewElement(data.item);
        if (viewPageBreak && viewPageBreak.hasClass('page-break')) {
          conversionApi.writer.removeClass('page-break', viewPageBreak);
        }
      }, {priority: 'lowest'});
    });
  }

  /**
   * Keep HTML comments, including Outlook's conditional comments.
   *
   * Email templates use conditional comments (<!--[if mso]>...<![endif]-->)
   * to give Outlook for Windows a fixed-width layout. CKEditor drops every
   * comment on load unless its HtmlComment plugin is loaded, and this build
   * doesn't include it (nor does upstream 1.9). This is that plugin from
   * CKEditor 41.0.0 (ckeditor5-html-support/src/htmlcomment.ts), except that:
   * - Comments next to each other keep their order (see the dataDowncast
   *   converter below).
   * - skipComments is turned off in afterInit(), because the FullPage plugin
   *   replaces the data processor during init().
   * - Marker ids come from a counter, because the build doesn't expose uid().
   * - Only the methods its listeners use are kept.
   *
   * A comment placed directly in a table, between its rows, is still lost:
   * CKEditor's table converter only reads the rows and cells.
   */
  class HtmlCommentOutput {
    constructor(editor) {
      this.editor = editor;
    }

    init() {
      var editor = this.editor;
      var plugin = this;
      var loadedCommentsContent = new Map();
      var commentCount = 0;

      // Allow storing comment's content as the $root attribute with the name
      // `$comment:<unique id>`.
      editor.model.schema.addAttributeCheck(function(context, attributeName) {
        if (context.endsWith('$root') && attributeName.startsWith('$comment')) {
          return true;
        }
      });

      // Convert the `$comment` view element to `$comment:<unique id>` marker
      // and store its content (the comment itself) as a $root attribute. The
      // comment content is needed in the `dataDowncast` pipeline to re-create
      // the comment node.
      editor.conversion.for('upcast').elementToMarker({
        view: '$comment',
        model: function(viewElement) {
          var markerName = '$comment:crm' + (++commentCount);
          loadedCommentsContent.set(markerName, viewElement.getCustomProperty('$rawContent'));
          return markerName;
        }
      });

      // Convert the `$comment` marker to `$comment` UI element with
      // `$rawContent` custom property containing the comment content.
      //
      // HtmlComment does this with markerToElement(), which inserts a comment
      // before any comment already converted at the same place, so comments
      // next to each other swapped places on every save (an Outlook table's
      // closing comment ended up before its opening one). Insert each comment
      // after the ones already at its place instead.
      var placedComments = new WeakMap();
      editor.conversion.for('dataDowncast').add(function(dispatcher) {
        dispatcher.on('addMarker:$comment', function(evt, data, conversionApi) {
          var markerRange = data.markerRange;
          if (!conversionApi.consumable.consume(markerRange, evt.name)) {
            return;
          }
          var root;
          for (var rootName of editor.model.document.getRootNames()) {
            root = editor.model.document.getRoot(rootName);
            if (root.hasAttribute(data.markerName)) {
              break;
            }
          }
          var writer = conversionApi.writer;
          var comment = writer.createUIElement('$comment');
          writer.setCustomProperty('$rawContent', root.getAttribute(data.markerName), comment);

          // The last comment converted at each model position, in this conversion.
          var placed = placedComments.get(conversionApi) || new Map();
          placedComments.set(conversionApi, placed);
          var place = markerRange.start.root.rootName + ':' + markerRange.start.path.join(',');
          var previous = placed.get(place);
          writer.insert(previous ? writer.createPositionAfter(previous) : conversionApi.mapper.toViewPosition(markerRange.start), comment);
          placed.set(place, comment);

          conversionApi.mapper.bindElementToMarker(comment, data.markerName);
          evt.stop();
        });
      });

      // Remove comments' markers and their corresponding $root attributes,
      // which are moved to the graveyard.
      editor.model.document.registerPostFixer(function(writer) {
        var changed = false;
        var markers = editor.model.document.differ.getChangedMarkers().filter(function(marker) {
          return marker.name.startsWith('$comment:');
        });
        markers.forEach(function(marker) {
          var oldRange = marker.data.oldRange;
          var newRange = marker.data.newRange;
          if (oldRange && newRange && oldRange.root == newRange.root) {
            // The marker was moved in the same root. Don't do anything.
            return;
          }
          if (oldRange) {
            // The comment marker was moved from one root to another (most
            // probably to the graveyard). Remove the related attribute from
            // the previous root.
            var oldRoot = oldRange.root;
            if (oldRoot.hasAttribute(marker.name)) {
              writer.removeAttribute(marker.name, oldRoot);
              changed = true;
            }
          }
          if (newRange) {
            var newRoot = newRange.root;
            if (newRoot.rootName == '$graveyard') {
              // Comment marker was moved to the graveyard -- remove it entirely.
              writer.removeMarker(marker.name);
              changed = true;
            }
            else if (!newRoot.hasAttribute(marker.name)) {
              // Comment marker was just added or was moved to another root -
              // updated roots attributes.
              writer.setAttribute(marker.name, loadedCommentsContent.get(marker.name) || '', newRoot);
              changed = true;
            }
          }
        });
        return changed;
      });

      // Delete all comment markers from the document before setting new data.
      editor.data.on('set', function() {
        for (var commentMarker of editor.model.markers.getMarkersGroup('$comment')) {
          plugin.removeHtmlComment(commentMarker.name);
        }
      }, {priority: 'high'});

      // Delete all comment markers that are within a removed range.
      // Delete all comment markers at the limit element boundaries if the
      // whole content of the limit element is removed.
      editor.model.on('deleteContent', function(evt, args) {
        for (var range of args[0].getRanges()) {
          var limitElement = editor.model.schema.getLimitElement(range);
          var firstPosition = editor.model.createPositionAt(limitElement, 0);
          var lastPosition = editor.model.createPositionAt(limitElement, 'end');
          var affectedCommentIDs;
          if (firstPosition.isTouching(range.start) && lastPosition.isTouching(range.end)) {
            affectedCommentIDs = plugin.getHtmlCommentsInRange(editor.model.createRange(firstPosition, lastPosition));
          }
          else {
            affectedCommentIDs = plugin.getHtmlCommentsInRange(range, {skipBoundaries: true});
          }
          affectedCommentIDs.forEach(function(commentMarkerID) {
            plugin.removeHtmlComment(commentMarkerID);
          });
        }
      }, {priority: 'high'});
    }

    afterInit() {
      this.editor.data.processor.skipComments = false;
    }

    /**
     * @param {String} commentID
     * @return {Boolean}
     *   Whether there was a comment with this id to remove.
     */
    removeHtmlComment(commentID) {
      var marker = this.editor.model.markers.get(commentID);
      if (!marker) {
        return false;
      }
      this.editor.model.change(function(writer) {
        writer.removeMarker(marker);
      });
      return true;
    }

    /**
     * @param {Object} range
     * @param {Object} [options]
     *   skipBoundaries: leave out comments at the range boundaries.
     * @return {String[]}
     *   HTML comment ids.
     */
    getHtmlCommentsInRange(range, options) {
      var includeBoundaries = !(options && options.skipBoundaries);
      // Unfortunately, MarkerCollection#getMarkersAtPosition() filters out
      // collapsed markers.
      return Array.from(this.editor.model.markers.getMarkersGroup('$comment'))
        .filter(function(marker) {
          var position = marker.getRange().start;
          return (position.isAfter(range.start) || (includeBoundaries && position.isEqual(range.start))) &&
            (position.isBefore(range.end) || (includeBoundaries && position.isEqual(range.end)));
        })
        .map(function(marker) {
          return marker.name;
        });
    }
  }

  /**
   * Save an empty editor as an empty value.
   *
   * The FullPage plugin turns off trimming, so an editor with nothing in it
   * returns an empty paragraph (<p>&nbsp;</p>), and a field left blank was
   * saved with that instead of nothing. Return '' instead, as upstream 1.9
   * does. A full HTML document with an empty body keeps its <head>.
   *
   * @param {Object} editor
   */
  function emptyAsBlank(editor) {
    editor.data.on('get', function(evt, args) {
      var rootName = (args[0] && args[0].rootName) || 'main';
      var root = editor.model.document.getRoot(rootName);
      if (typeof evt.return !== 'string' || !root || editor.model.hasContent(root, {ignoreWhitespaces: true})) {
        return;
      }
      if (!/<(?:!doctype|html|head|body)[\s>]/i.test(evt.return)) {
        evt.return = '';
      }
    }, {priority: 'low'});
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
      emptyAsBlank(editor);

      // The toolbar sticks to the top of the window when the editor scrolls up
      // out of view. In a CiviCRM popup it sticks over the popup's content
      // instead, and as a fixed element it leaves the form's layout, so the
      // editor narrows and the wrapped toolbar covers the text. In a popup,
      // let the toolbar scroll with the content.
      if ($(editor.sourceElement).closest('.ui-dialog').length && editor.ui.view.stickyPanel) {
        editor.ui.view.stickyPanel.unbind('isActive');
        editor.ui.view.stickyPanel.isActive = false;
      }

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
        extraPlugins: [emailImageOutput, UnwrappedFigureOutput, pageBreakOutput, LegacyEmailLayout, HtmlCommentOutput],
        image: {
          // Resize in pixels, which email clients understand.
          resizeUnit: 'px',
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
