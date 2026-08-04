import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// See resource.ts for why this exists. Two custom mutations
// (fileSubmission/fileCorrection) share this one function, mirroring the
// existing validate-submission precedent of one Lambda handling both
// models rather than two functions with duplicated wiring.
//
// The invocation event shape here is Amplify Gen2's own
// function-backed-custom-mutation payload, confirmed live by a one-time
// debug log (since removed) — NOT @types/aws-lambda's AppSyncResolverEvent
// (which nests fieldName under `info` and is meant for a raw AppSync
// Direct Lambda Resolver wired by hand, a different invocation path).
// `fieldName`/`identity` sit at the top level instead. `identity.groups`
// is pre-parsed by AppSync from the caller's verified session — this is
// what makes the whole fix work: nothing here reads a client-supplied
// field to decide who the caller is.
type CreateRecordEvent = {
  fieldName: 'fileSubmission' | 'fileCorrection';
  identity?: { groups?: string[] | null };
  arguments: Record<string, unknown>;
};

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SUBMISSION_TABLE_NAME = process.env.SUBMISSION_TABLE_NAME as string;
const CORRECTION_TABLE_NAME = process.env.CORRECTION_TABLE_NAME as string;

// AWSJSON arguments have gone through both shapes elsewhere in this
// codebase depending on the resolver path (see validate-submission's own
// comment on this ambiguity) — not assumed here either way, just handled.
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return (value as Record<string, unknown>) || {};
}

type FileSubmissionArgs = {
  id: string;
  partyClientId: string;
  stateCode: string;
  agentId: string;
  puCode: string;
  wardCode: string;
  lgaCode: string;
  partyVotes: unknown;
  ocrVotes?: unknown;
  photoKey?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsAccuracy?: number | null;
  deviceId?: string | null;
  submissionHash: string;
  clientTimestamp?: number | null;
};

type FileCorrectionArgs = {
  submissionId: string;
  partyClientId: string;
  stateCode: string;
  puCode: string;
  reviewerId: string;
  reviewerNote: string;
  previousPartyVotes: unknown;
  correctedPartyVotes: unknown;
};

async function fileSubmission(args: FileSubmissionArgs, groups: string[]) {
  const requiredGroup = `${args.partyClientId}__FieldAgent`;
  if (!groups.includes(requiredGroup)) {
    throw new Error(`Not authorized: creating a Submission requires ${requiredGroup} membership.`);
  }

  const now = new Date().toISOString();
  const item = {
    __typename: 'Submission',
    id: args.id,
    partyClientId: args.partyClientId,
    stateCode: args.stateCode,
    agentId: args.agentId,
    puCode: args.puCode,
    wardCode: args.wardCode,
    lgaCode: args.lgaCode,
    partyVotes: asObject(args.partyVotes),
    ocrVotes: asObject(args.ocrVotes),
    photoKey: args.photoKey ?? null,
    gpsLat: args.gpsLat ?? null,
    gpsLng: args.gpsLng ?? null,
    gpsAccuracy: args.gpsAccuracy ?? null,
    deviceId: args.deviceId ?? null,
    submissionHash: args.submissionHash,
    clientTimestamp: args.clientTimestamp ?? null,
    // Left unpopulated here on purpose — validate-submission's own
    // DynamoDB Streams handler fills these in asynchronously after
    // insert, same as it always has for the model-generated create path.
    validationSeverity: null,
    validationChecks: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: SUBMISSION_TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
  } catch (err: any) {
    // A create() whose id already exists is an idempotent resend after a
    // crash/restart (see src/sync/syncQueue.js), not a real failure — this
    // used to be handled by amplifyClient.js string-matching the error
    // message from the model resolver; now handled once, here, since this
    // Lambda is the only path that can ever write this table.
    if (err.name === 'ConditionalCheckFailedException') {
      return { id: args.id };
    }
    throw err;
  }

  return { id: args.id };
}

async function fileCorrection(args: FileCorrectionArgs, groups: string[]) {
  const requiredGroup = `${args.partyClientId}__Reviewer`;
  if (!groups.includes(requiredGroup)) {
    throw new Error(`Not authorized: creating a Correction requires ${requiredGroup} membership.`);
  }
  // Mirrors amplify/data/resource.ts's schema-level minLength(1) rule on
  // SubmissionCorrection.reviewerNote — that rule is generated for the
  // model's own (now-unreachable) create resolver, not for this custom
  // mutation's arguments, so this Lambda is the only place left enforcing
  // it for the path anyone can actually reach.
  if (!args.reviewerNote || !args.reviewerNote.trim()) {
    throw new Error('A reason is required for every correction.');
  }

  const now = new Date().toISOString();
  const item = {
    __typename: 'SubmissionCorrection',
    id: randomUUID(),
    submissionId: args.submissionId,
    partyClientId: args.partyClientId,
    stateCode: args.stateCode,
    puCode: args.puCode,
    reviewerId: args.reviewerId,
    reviewerNote: args.reviewerNote,
    previousPartyVotes: asObject(args.previousPartyVotes),
    correctedPartyVotes: asObject(args.correctedPartyVotes),
    validationSeverity: null,
    validationChecks: null,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: CORRECTION_TABLE_NAME,
      Item: item,
    })
  );

  return item;
}

export const handler = async (event: CreateRecordEvent) => {
  const groups = event.identity?.groups || [];

  switch (event.fieldName) {
    case 'fileSubmission':
      return fileSubmission(event.arguments as unknown as FileSubmissionArgs, groups);
    case 'fileCorrection':
      return fileCorrection(event.arguments as unknown as FileCorrectionArgs, groups);
    default:
      throw new Error(`create-role-checked-record: unknown operation ${event.fieldName}`);
  }
};
