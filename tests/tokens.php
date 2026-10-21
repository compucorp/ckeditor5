<?php

require_once __DIR__ . '/../CRM/Ckeditor5/Tokens.php';

function checkTokenSchema($condition, $message) {
  if (!$condition) {
    throw new RuntimeException($message);
  }
}

$schema = CRM_Ckeditor5_Tokens::defaultSchema();
foreach (['contactId', 'mailingId', 'contributionId', 'participantId', 'membershipId', 'eventId', 'activityId', 'caseId', 'grantId', 'pledgeId', 'groupId'] as $field) {
  checkTokenSchema(in_array($field, $schema, TRUE), "The token schema must include $field.");
}
checkTokenSchema(count($schema) === count(array_unique($schema)), 'The token schema must not contain duplicates.');

$tokens = CRM_Ckeditor5_Tokens::normalizeLabels([
  '{contact.display_name}' => 'Display name',
  '{third_party.unlabelled}' => NULL,
  '{third_party.empty}' => '',
]);
checkTokenSchema($tokens['{contact.display_name}'] === 'Display name', 'Existing token labels must be preserved.');
checkTokenSchema($tokens['{third_party.unlabelled}'] === '{third_party.unlabelled}', 'Unlabelled third-party tokens must be preserved.');
checkTokenSchema($tokens['{third_party.empty}'] === '{third_party.empty}', 'Empty third-party token labels must fall back to the token.');

echo "Token schema assertions passed.\n";
