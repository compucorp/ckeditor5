<?php

require_once __DIR__ . '/../CRM/Ckeditor5/EditorRegistration.php';

function check($condition, $message) {
  if (!$condition) {
    throw new RuntimeException($message);
  }
}

check(CRM_Ckeditor5_EditorRegistration::supports('CKEditor5'), 'The canonical editor must be supported.');
check(CRM_Ckeditor5_EditorRegistration::supports('CKEditor5-elfinder'), 'The elFinder alias must remain supported.');
check(CRM_Ckeditor5_EditorRegistration::supports('CKEditor5-base64'), 'The Base64 alias must remain supported.');
check(!CRM_Ckeditor5_EditorRegistration::supports('CKEditor'), 'Unrelated editors must not be claimed.');
check(CRM_Ckeditor5_EditorRegistration::legacyUploadMode('CKEditor5') === NULL, 'The canonical editor must not encode an upload mode.');
check(CRM_Ckeditor5_EditorRegistration::legacyUploadMode('CKEditor5-elfinder') === 'elfinder', 'The elFinder alias must retain its mode.');
check(CRM_Ckeditor5_EditorRegistration::legacyUploadMode('CKEditor5-base64') === 'base64', 'The Base64 alias must retain its mode.');

$presets = [
  'default' => ['toolbar' => ['items' => ['bold']]],
  'civimail' => ['civiHtmlRuleset' => 'template'],
];
$migrated = CRM_Ckeditor5_EditorRegistration::migratePresets($presets, 'base64');
check($migrated['default']['civiUploadMode'] === 'base64', 'The migrated upload mode must be persisted.');
check($migrated['default']['toolbar'] === ['items' => ['bold']], 'Default preset properties must survive migration.');
check($migrated['civimail'] === $presets['civimail'], 'Other presets must survive migration.');
check(!isset($presets['default']['civiUploadMode']), 'Migration must not mutate the input array.');
check(CRM_Ckeditor5_EditorRegistration::migratePresets($migrated, 'base64') === $migrated, 'Migration must be idempotent.');

try {
  CRM_Ckeditor5_EditorRegistration::migratePresets([], 'invalid');
  throw new RuntimeException('An invalid legacy mode was accepted.');
}
catch (InvalidArgumentException $exception) {
}

try {
  CRM_Ckeditor5_EditorRegistration::migratePresets(['default' => 'invalid'], 'elfinder');
  throw new RuntimeException('An invalid default preset was accepted.');
}
catch (UnexpectedValueException $exception) {
}

class Civi {

  public static $settings;

  public static function settings() {
    return self::$settings;
  }

}

class TestSettings {

  public $values = [];

  public function get($name) {
    return $this->values[$name] ?? NULL;
  }

}

class CRM_Core_I18n {

  public static function getLocale() {
    return 'fr_FR';
  }

}

class CRM_Core_Permission {

  public static $allowed = [];

  public static function check($permission) {
    return self::$allowed[$permission] ?? FALSE;
  }

}

class CRM_Core_Resources {

  public static $instance;
  public $styles = [];

  public static function singleton() {
    return self::$instance;
  }

  public function getUrl($extension, $path = NULL, $absolute = FALSE) {
    return '/ext/' . $extension . '/' . $path;
  }

  public function addStyleUrl($url) {
    $this->styles[] = $url;
    return $this;
  }

}

Civi::$settings = new TestSettings();
CRM_Core_Resources::$instance = new CRM_Core_Resources();
require_once __DIR__ . '/../ckeditor5.php';

function resourcesFor($editorId, $canUpload, array $presets = [], $canBrowse = NULL) {
  Civi::$settings->values = [
    'editor_id' => $editorId,
    'ckeditor5_presets' => $presets,
  ];
  CRM_Core_Permission::$allowed = [
    'access CiviCRM' => TRUE,
    'upload files' => $canUpload,
    'access uploaded files' => $canBrowse ?? $canUpload,
  ];
  CRM_Core_Resources::$instance = new CRM_Core_Resources();
  $items = [];
  ckeditor5_civicrm_coreResourceList($items, 'html-header');
  return [$items, CRM_Core_Resources::$instance->styles];
}

[$items, $styles] = resourcesFor('CKEditor', TRUE);
check($items === [] && $styles === [], 'Unrelated editors must not receive CKEditor 5 resources.');

[$items, $styles] = resourcesFor('CKEditor5', TRUE, ['default' => ['toolbar' => ['items' => ['bold']]]]);
check(count($items) === 1, 'The canonical editor must receive one configuration block.');
check($items[0]['config']['CKEditor5UploadMode'] === 'elfinder', 'The canonical editor must expose elFinder when permitted.');
check($items[0]['config']['CKEditor5CanUploadFiles'] === TRUE, 'The canonical editor must expose direct upload permission.');
check($items[0]['config']['CKEditor5CanBrowseFiles'] === TRUE, 'The canonical editor must expose file browser permission.');
check($items[0]['config']['ELFinderLocation'] !== NULL, 'The canonical editor must receive the elFinder runtime when permitted.');
check($items[0]['config']['CKEditor5Stylesheets'] === ['/ext/ckeditor5/css/ckeditor.css'], 'The canonical editor must expose integration styles to late initializers.');
check(count($items[0]['config']['ELFinderStylesheets']) === 2, 'The canonical editor must expose elFinder styles when permitted.');
check(count($styles) === 3, 'The canonical editor must receive CKEditor and elFinder styles when permitted.');
check($items[0]['config']['CKEditor5AdminPresets']->default['toolbar']['items'] === ['bold'], 'Stored presets must be retained.');

[$items, $styles] = resourcesFor('CKEditor5-base64', TRUE);
check($items[0]['config']['CKEditor5UploadMode'] === 'base64', 'The Base64 alias must retain its upload mode.');
check($items[0]['config']['ELFinderLocation'] === NULL, 'The Base64 alias must not load elFinder.');
check($items[0]['config']['ELFinderStylesheets'] === [], 'The Base64 alias must not expose elFinder styles.');
check($styles === ['/ext/ckeditor5/css/ckeditor.css'], 'The Base64 alias must load only CKEditor integration styles.');

[$items, $styles] = resourcesFor('CKEditor5-elfinder', FALSE);
check($items[0]['config']['CKEditor5UploadMode'] === 'none', 'Users without file permissions must not receive uploads.');
check($items[0]['config']['ELFinderLocation'] === NULL, 'Users without file permissions must not receive elFinder.');
check($items[0]['config']['ELFinderStylesheets'] === [], 'Users without file permissions must not receive elFinder styles.');
check($styles === ['/ext/ckeditor5/css/ckeditor.css'], 'Users without file permissions must receive only editor styles.');

[$items, $styles] = resourcesFor('CKEditor5', TRUE, [], FALSE);
check($items[0]['config']['CKEditor5UploadMode'] === 'elfinder', 'Upload permission must enable direct uploads without browser permission.');
check($items[0]['config']['ELFinderLocation'] === NULL, 'Upload permission alone must not expose the file browser runtime.');
check($items[0]['config']['CKEditor5CanUploadFiles'] === TRUE, 'Upload permission must be exposed independently.');
check($items[0]['config']['CKEditor5CanBrowseFiles'] === FALSE, 'Missing browser permission must be exposed independently.');

[$items, $styles] = resourcesFor('CKEditor5', FALSE, [], TRUE);
check($items[0]['config']['CKEditor5UploadMode'] === 'none', 'Browser permission alone must not enable direct uploads.');
check($items[0]['config']['ELFinderLocation'] !== NULL, 'Browser permission must expose the file browser runtime.');
check($items[0]['config']['CKEditor5CanUploadFiles'] === FALSE, 'Browser permission must not imply upload permission.');
check($items[0]['config']['CKEditor5CanBrowseFiles'] === TRUE, 'Browser permission must be exposed independently.');

echo "PASS: CKEditor 5 registration, aliases, permissions, and preset migration are valid.\n";
