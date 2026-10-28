# Changelog

## 1.9 - 2026-10-28

This release requires CiviCRM 6.16 or later, PHP 8.2 or later, and Smarty 5.

### Security and dependencies

- Update the bundled CKEditor runtime from 41.0.0 to 49.0.1.
- Update elFinder from 2.1.53 to 2.1.70 with restricted image MIME types, URL uploads,
  archive operations, file editing, file creation, and network mounts disabled.
- Require `upload files` for direct server-side uploads and independently
  require `access uploaded files` to browse existing images.
- Validate embedded Base64 images in the browser and enforce a 10 MiB limit.
- Document the reviewed upstream advisories and their applicability in
  `SECURITY.md`. The three CKEditor advisories fixed by 49.0.1 affect premium
  Track Changes or CKEditor AI plugins which are not included here.

### Editor integration

- Register one canonical `CKEditor5` editor and migrate the historical
  `CKEditor5-elfinder` and `CKEditor5-base64` choices without changing their
  upload behavior.
- Use one shared build for Base64, elFinder, and disabled-upload presets.
- Replace the CKFinder command override with a first-class CiviCRM file manager
  toolbar plugin. Existing `ckfinder` toolbar entries remain compatible.
- Load CKEditor and elFinder styles reliably for editors initialized after the
  page header, including WordPress front-end forms.
- Add restricted and customizable Front-end forms and Form Builder presets.
  Front-end forms retain permitted image uploads and file browsing. Form
  Builder retains permitted direct image uploads without exposing the file
  manager.
- Add a CKEditor 5 configuration button beside the standard CiviCRM WYSIWYG
  setting and move the live preset preview above advanced controls.

### Editing and QA

- Add configurable Find and Replace, Fullscreen, and Table Layout support.
- Preserve complete email template envelopes, style blocks, legacy table
  layout, inline email images, and representative CKEditor 4 content more
  faithfully.
- Add optional HTML transformation reports for migration testing.
- Add CiviCRM token selection and inline token autocomplete without maintaining
  an extension-local token allow-list.

### Distribution

- Produce a versioned installable ZIP with a single `ckeditor5` root directory
  and a SHA-256 checksum for every Git tag.
