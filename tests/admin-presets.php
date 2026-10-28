<?php

require_once __DIR__ . '/../CRM/Ckeditor5/Presets.php';

function check($condition, $message) {
  if (!$condition) {
    throw new RuntimeException($message);
  }
}

check(CRM_Ckeditor5_Presets::parse([]) === [], 'Unchecked sections must inherit.');
$config = CRM_Ckeditor5_Presets::parse([
  'custom_toolbar' => 1, 'toolbar_items' => '["bold","|","style","|"]',
  'custom_find_replace' => 1, 'find_replace_ui' => 'dropdown',
  'custom_fullscreen' => 1, 'fullscreen_menu_bar' => 0, 'fullscreen_ungrouped_toolbar' => 1,
  'custom_table_layout' => 1, 'external_table_type' => 'layout', 'strip_content_table_figure' => 1,
  'custom_html_ruleset' => 1, 'html_ruleset' => 'strict',
  'custom_upload_mode' => 1, 'upload_mode' => 'none',
  'custom_qa' => 1, 'qa_enabled' => 1,
  'custom_fonts' => 1, 'fonts' => "default\nArial, Helvetica, sans-serif",
  'custom_sizes' => 1, 'sizes' => 'default, 12, 16, 12',
  'custom_palette' => 1, 'palette' => "#aabbcc | Brand\n#000000",
  'custom_styles' => 1, 'styles' => 'Lead | p | lead brand',
]);
check($config['toolbar']['items'] === ['bold', '|', 'style', '|'], 'Toolbar order must be retained.');
check($config['findAndReplace']['uiType'] === 'dropdown', 'Find and replace UI must be retained.');
check($config['fullscreen']['menuBar']['isVisible'] === FALSE, 'Fullscreen menu bar setting must be typed.');
check($config['fullscreen']['toolbar']['shouldNotGroupWhenFull'] === TRUE, 'Fullscreen toolbar setting must be typed.');
check($config['table']['tableLayout']['preferredExternalTableType'] === 'layout', 'External table type must be retained.');
check($config['table']['tableLayout']['stripFigureFromContentTable'] === TRUE, 'Content table output setting must be typed.');
check($config['civiHtmlRuleset'] === 'strict', 'HTML ruleset must be retained.');
check($config['civiUploadMode'] === 'none', 'Upload mode must be retained.');
check($config['fontFamily']['supportAllValues'] === TRUE, 'Custom font families must still preserve imported fonts.');
check($config['civiHtmlQa']['enabled'] === TRUE, 'HTML QA mode must be enabled explicitly.');
check(CRM_Ckeditor5_Presets::parse(['custom_qa' => 1]) === ['civiHtmlQa' => ['enabled' => FALSE]], 'A named preset must be able to disable inherited HTML QA.');
check($config['fontSize']['options'] === ['default', 12, 16], 'Font sizes must be typed and deduplicated.');
check($config['fontColor']['colors'][0]['color'] === '#AABBCC', 'Colors must be normalized.');
check($config['table']['tableCellProperties']['backgroundColors'] === $config['fontColor']['colors'], 'Table and text palettes must match.');
check($config['style']['definitions'][0]['classes'] === ['lead', 'brand'], 'Style classes must survive.');
check(CRM_Ckeditor5_Presets::parse(['custom_styles' => 1, 'styles' => '']) === ['style' => ['definitions' => []]], 'Empty styles must clear inheritance.');
check(CRM_Ckeditor5_Presets::parse(['custom_toolbar' => 1, 'toolbar_items' => '[]']) === ['toolbar' => ['items' => []]], 'An empty toolbar must be supported.');
check(
  CRM_Ckeditor5_Presets::parse(['custom_toolbar' => 1, 'toolbar_items' => '["imageUpload","ckfinder"]'])
    === ['toolbar' => ['items' => ['imageUpload', 'civiFileManager']]],
  'Legacy CKFinder toolbar entries must migrate to the CiviCRM file manager.'
);

$invalid = [
  ['custom_toolbar' => 1, 'toolbar_items' => '["unknown"]'],
  ['custom_toolbar' => 1, 'toolbar_items' => '["bold","bold"]'],
  ['custom_toolbar' => 1, 'toolbar_items' => '{"foo":"bold"}'],
  ['custom_toolbar' => 1, 'toolbar_items' => '[{}]'],
  ['custom_find_replace' => 1, 'find_replace_ui' => 'panel'],
  ['custom_table_layout' => 1, 'external_table_type' => 'email'],
  ['custom_html_ruleset' => 1, 'html_ruleset' => 'unsafe'],
  ['custom_upload_mode' => 1, 'upload_mode' => 's3'],
  ['custom_sizes' => 1, 'sizes' => '12px'],
  ['custom_sizes' => 1, 'sizes' => '201'],
  ['custom_sizes' => 1, 'sizes' => ''],
  ['custom_palette' => 1, 'palette' => 'hsl(0, 75%, 60%)'],
  ['custom_styles' => 1, 'styles' => 'Bad | script | unsafe'],
  ['custom_styles' => 1, 'styles' => 'Bad | p | x"onclick=bad'],
  ['custom_styles' => 1, 'styles' => "Same | p | a\nSame | span | b"],
  ['palette' => ['unexpected']],
];
foreach ($invalid as $values) {
  try {
    CRM_Ckeditor5_Presets::parse($values);
  }
  catch (InvalidArgumentException $e) {
    continue;
  }
  throw new RuntimeException('Invalid configuration was accepted: ' . json_encode($values));
}
echo "Admin preset assertions passed.\n";
