import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { validateSubmission as computeValidation } from '../../../src/validation/validate.js';
import { findPollingUnitInState } from '../../../src/referenceData/states/index.js';

// Reuses src/validation/validate.js directly — it's pure, dependency-free
// JS, so the exact same rules run here as in src/ui/CaptureForm.jsx's
// client-side warnings, with no separate copy to drift out of sync.
//
// Duplicate detection is the reason this exists as a server-side step at
// all: it needs visibility across every submission for a party client in
// a state, which no single agent's offline device has (see
// src/sync/mockServer.js's original design, which this replaces for real).

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.SUBMISSION_TABLE_NAME as string;
// Amplify's auto-generated DynamoDB GSI name for the puCode secondary
// index — distinct from its GraphQL queryField ("listByPollingUnit");
// confirmed against the deployed schema's model_introspection output.
const PU_CODE_INDEX_NAME = 'submissionsByPuCode';

export const handler = async (event: DynamoDBStreamEvent) => {
  for (const record of event.Records) {
    try {
      if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) continue;

      const item = unmarshall(record.dynamodb.NewImage as Record<string, any>);

      // Already validated — a stream redelivery of the same insert, or a
      // MODIFY this handler isn't meant to react to in the first place.
      if (item.validationSeverity) continue;

      // AWSJSON fields (partyVotes/ocrVotes) arrive here as already-parsed
      // native objects, not JSON strings — AppSync's create resolver
      // parses the client's JSON-string input before writing to DynamoDB
      // (confirmed live: JSON.parse() on these threw "[object Object] is
      // not valid JSON", meaning they were objects already). The GraphQL
      // layer only re-serializes to a string on the way *out* to a
      // client; this Lambda reads the raw table via Streams, bypassing
      // that layer entirely.
      const { id, partyClientId, stateCode, puCode, partyVotes, ocrVotes } = item as {
        id: string;
        partyClientId: string;
        stateCode: string;
        puCode: string;
        partyVotes?: Record<string, number>;
        ocrVotes?: Record<string, number>;
      };

      const priorResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: PU_CODE_INDEX_NAME,
          KeyConditionExpression: 'puCode = :puCode',
          // Scoped to the SAME party client and state, and excluding this
          // record itself — mirrors mockServer.js's original semantics:
          // two different party clients (or the same client in two
          // different states) reporting the same PU code is normal, not a
          // duplicate.
          FilterExpression: 'partyClientId = :partyClientId AND stateCode = :stateCode AND id <> :id',
          ExpressionAttributeValues: {
            ':puCode': puCode,
            ':partyClientId': partyClientId,
            ':stateCode': stateCode,
            ':id': id,
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
          TableName: TABLE_NAME,
          Key: { id },
          UpdateExpression: 'SET validationSeverity = :sev, validationChecks = :checks',
          ExpressionAttributeValues: {
            ':sev': validation.overallSeverity,
            // Written as a native array, not a JSON string — matching how
            // partyVotes/ocrVotes are actually stored (see note above),
            // so AppSync's own AWSJSON output resolver serializes it
            // consistently when a client reads it back.
            ':checks': validation.checks,
          },
        })
      );
    } catch (err) {
      // Swallowed per-record: DynamoDB Streams retries the WHOLE batch on
      // an unhandled Lambda error, so one bad record could otherwise wedge
      // the shard indefinitely instead of just leaving that one row
      // unvalidated.
      console.error('validate-submission: failed to process stream record', record.eventID, err);
    }
  }
};
