{$form.ckeditor5_config.html}
{literal}
  <script type="text/javascript">
    CRM.$(function($) {
      var button = $('#ckeditor5_config').appendTo($('#editor_id').parent());
      function toggleCKEditor5Config() {
        var editorId = $(this).val();
        button.css('visibility', ['CKEditor5', 'CKEditor5-elfinder', 'CKEditor5-base64'].indexOf(editorId) !== -1 ? 'visible' : 'hidden');
      }
      $(':input[name=editor_id]').each(toggleCKEditor5Config).on('change', toggleCKEditor5Config);
    });
  </script>
{/literal}
