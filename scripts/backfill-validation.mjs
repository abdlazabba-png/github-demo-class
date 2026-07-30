#!/usr/bin/env node
// One-off backfill for Submission records created before the validation
// Lambda (amplify/functions/validate-submission/) existed. That Lambda
// only reacts to NEW DynamoDB Streams INSERT events going forward, so it
// never touches rows already in the table — this walks the table once and
// runs the exact same computation for anything still missing
// validationSeverity.
//
// Unlike the live Lambda (where the record being processed is always the
// newest, so any other existing row is inherently "prior"), this processes
// a batch of old records at once, so it must explicitly restrict "prior"
// to rows with an earlier createdAt — otherwise a record processed early
// in the loop would see chronologically-later rows (already sitting in
// the table, just not yet processed) as if they came first.
//
// Run with: node scripts/backfill-validation.mjs
// Needs AWS credentials configured (same ones `npx ampx sandbox` uses).

import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { validateSubmission as computeValidation } from '../src/validation/validate.js';
import { findPollingUnitInState } from '../src/referenceData/states/index.js';

const REGION = process.env.AWS_REGION || 'eu-north-1';
const PU_CODE_INDEX_NAME = 'submissionsByPuCode';

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

async function findSubmissionTableName() {
  const { TableNames } = await client.send(new ListTablesCommand({}));
  const matches = (TableNames || []).filter((name) => name.startsWith('Submission-'));
  if (matches.length === 0) {
    throw new Error('No DynamoDB table starting with "Submission-" found in this account/region.');
  }
  if (matches.length > 1) {
    throw new Error(`Multiple candidate tables found, refusing to guess: ${matches.join(', ')}`);
  }
  return matches[0];
}

async function main() {
  const tableName = await findSubmissionTableName();
  console.log(`Using table: ${tableName}\n`);

  const { Items } = await docClient.send(new ScanCommand({ TableName: tableName }));
  const items = (Items || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const unvalidated = items.filter((item) => !item.validationSeverity);

  console.log(`${items.length} total submission(s), ${unvalidated.length} missing validation.\n`);

  let updated = 0;
  for (const item of unvalidated) {
    const { id, partyClientId, stateCode, puCode, partyVotes, ocrVotes, createdAt } = item;

    const priorResult = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: PU_CODE_INDEX_NAME,
        KeyConditionExpression: 'puCode = :puCode',
        FilterExpression:
          'partyClientId = :partyClientId AND stateCode = :stateCode AND id <> :id AND createdAt < :createdAt',
        ExpressionAttributeValues: {
          ':puCode': puCode,
          ':partyClientId': partyClientId,
          ':stateCode': stateCode,
          ':id': id,
          ':createdAt': createdAt,
        },
      })
    );
    const priorPuCodes = (priorResult.Items || []).map(() => puCode);

    const pu = findPollingUnitInState(stateCode, puCode);
    const validation = computeValidation({
      partyVotes: partyVotes || {},
      ocrVotes: ocrVotes || {},
      registeredVoters: pu ? pu.registeredVoters : null,
      puCode,
      priorPuCodes,
    });

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id },
        UpdateExpression: 'SET validationSeverity = :sev, validationChecks = :checks',
        ExpressionAttributeValues: {
          ':sev': validation.overallSeverity,
          ':checks': validation.checks,
        },
      })
    );

    console.log(`  ${createdAt}  ${puCode}  (${id.slice(0, 8)}...)  -> ${validation.overallSeverity}`);
    updated += 1;
  }

  console.log(`\nDone. Updated ${updated} record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
