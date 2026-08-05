import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// See resource.ts for why this exists. Four custom mutations
// (fileSubmission/fileCorrection/fileFlag/createAssignment) share this one
// function, mirroring the existing validate-submission precedent of one
// Lambda handling multiple models rather than one function per model.
//
// The invocation event shape here is Amplify Gen2's own
// function-backed-custom-mutation payload, confirmed live by a one-time
// debug log (since removed) — NOT @types/aws-lambda's AppSyncResolverEvent
// (which nests fieldName under `info` and is meant for a raw AppSync
// Direct Lambda Resolver wired by hand, a different invocation path).
// `fieldName`/`identity` sit at the top level instead. `identity.groups`
// and `identity.sub` are pre-parsed/verified by AppSync from the caller's
// real session — this is what makes the whole fix work: nothing here
// reads a client-supplied field to decide who the caller is. Note there is
// no email claim anywhere on this identity object (confirmed in the same
// debug dump — it's an access token, not an ID token) — AgentAssignment is
// keyed by sub for exactly this reason; see its schema comment.
type CreateRecordEvent = {
  fieldName: 'fileSubmission' | 'fileCorrection' | 'fileFlag' | 'createAssignment';
  identity?: { groups?: string[] | null; sub?: string };
  arguments: Record<string, unknown>;
};

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const cognitoClient = new CognitoIdentityProviderClient({});

const SUBMISSION_TABLE_NAME = process.env.SUBMISSION_TABLE_NAME as string;
const CORRECTION_TABLE_NAME = process.env.CORRECTION_TABLE_NAME as string;
const FLAG_TABLE_NAME = process.env.FLAG_TABLE_NAME as string;
const ASSIGNMENT_TABLE_NAME = process.env.ASSIGNMENT_TABLE_NAME as string;
const USER_POOL_ID = process.env.USER_POOL_ID as string;
// Amplify's auto-generated DynamoDB GSI name for AgentAssignment's
// partyClientId+userSub secondary index — same "confirm against the real
// deployed table, don't guess" discipline as validate-submission's
// PU_CODE_INDEX_NAME, which needed a live fix the first time around too.
const ASSIGNMENT_INDEX_NAME = 'agentAssignmentsByPartyClientIdAndUserSub';

// Every AgentAssignment row for this caller within this role, e.g. the PU
// codes a FieldAgent is allowed to submit for, or the ward codes a
// Coordinator is scoped to. Returns [] both when genuinely unassigned and
// when the query itself fails to find anything — callers treat an empty
// result as "no restriction configured yet" (see AgentAssignment's schema
// comment for why that's a deliberate rollout choice, not a fail-open bug).
async function getAssignedScopeValues(partyClientId: string, userSub: string, role: string): Promise<string[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ASSIGNMENT_TABLE_NAME,
      IndexName: ASSIGNMENT_INDEX_NAME,
      KeyConditionExpression: 'partyClientId = :partyClientId AND userSub = :userSub',
      FilterExpression: '#role = :role',
      ExpressionAttributeNames: { '#role': 'role' }, // "role" is a reserved word in DynamoDB's expression grammar
      ExpressionAttributeValues: {
        ':partyClientId': partyClientId,
        ':userSub': userSub,
        ':role': role,
      },
    })
  );
  return (result.Items || []).map((item) => item.scopeValue as string);
}

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

type FileFlagArgs = {
  submissionId: string;
  partyClientId: string;
  stateCode: string;
  puCode: string;
  coordinatorId: string;
  note: string;
};

type CreateAssignmentArgs = {
  partyClientId: string;
  userEmail: string;
  role: string;
  scopeValue: string;
};

async function fileSubmission(args: FileSubmissionArgs, groups: string[], userSub: string | undefined) {
  const requiredGroup = `${args.partyClientId}__FieldAgent`;
  if (!groups.includes(requiredGroup)) {
    throw new Error(`Not authorized: creating a Submission requires ${requiredGroup} membership.`);
  }

  // PU-scoping (CLAUDE.md's role matrix: FieldAgent is "assigned PU(s)
  // only"). Fail-open when this agent has zero AgentAssignment rows at
  // all — see that model's schema comment for the rollout reasoning —
  // fail-closed the moment even one row exists for them.
  if (userSub) {
    const assignedPUs = await getAssignedScopeValues(args.partyClientId, userSub, 'FieldAgent');
    if (assignedPUs.length > 0 && !assignedPUs.includes(args.puCode)) {
      throw new Error(`Not authorized: you are not assigned to polling unit ${args.puCode}.`);
    }
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

async function fileFlag(args: FileFlagArgs, groups: string[]) {
  const requiredGroup = `${args.partyClientId}__Coordinator`;
  if (!groups.includes(requiredGroup)) {
    throw new Error(`Not authorized: filing a flag requires ${requiredGroup} membership.`);
  }
  // Same reasoning as fileCorrection's reviewerNote check above — custom
  // mutation arguments don't run through the model field's minLength(1)
  // Validate Transformer, so this is the only place actually enforcing it.
  if (!args.note || !args.note.trim()) {
    throw new Error('A reason is required for every flag.');
  }

  const now = new Date().toISOString();
  const item = {
    __typename: 'SubmissionFlag',
    id: randomUUID(),
    submissionId: args.submissionId,
    partyClientId: args.partyClientId,
    stateCode: args.stateCode,
    puCode: args.puCode,
    coordinatorId: args.coordinatorId,
    note: args.note,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: FLAG_TABLE_NAME,
      Item: item,
    })
  );

  return item;
}

const ASSIGNABLE_ROLES = new Set(['FieldAgent', 'Coordinator']);

// The roster flow (CLAUDE.md: PartyAdmin can "manage agent roster & PU
// assignments"). Unlike the three functions above, the caller here never
// supplies who the assignment is FOR by identity — they supply an email,
// since that's what a human PartyAdmin actually knows. This function is
// the one place in the app that resolves a party member's email to their
// real Cognito sub (via ListUsers) and independently re-verifies their
// real group membership (via AdminListGroupsForUser) before writing
// anything — a PartyAdmin can't create a bogus assignment for an email
// outside their own party's tenant group, or for a role that user isn't
// actually in, no matter what this call claims.
async function createAssignment(args: CreateAssignmentArgs, groups: string[]) {
  const requiredGroup = `${args.partyClientId}__PartyAdmin`;
  if (!groups.includes(requiredGroup)) {
    throw new Error(`Not authorized: managing the roster requires ${requiredGroup} membership.`);
  }
  if (!ASSIGNABLE_ROLES.has(args.role)) {
    throw new Error(`Invalid role for an assignment: ${args.role}. Must be FieldAgent or Coordinator.`);
  }
  if (!args.scopeValue || !args.scopeValue.trim()) {
    throw new Error('A PU or ward code is required for every assignment.');
  }

  const lookup = await cognitoClient.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${args.userEmail}"`,
      Limit: 1,
    })
  );
  const targetUser = lookup.Users?.[0];
  const targetSub = targetUser?.Username; // Cognito's own Username IS the sub for this pool (no alias attribute configured)
  if (!targetSub) {
    throw new Error(`No account found for ${args.userEmail}.`);
  }

  const groupsResult = await cognitoClient.send(
    new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: targetSub })
  );
  const targetGroups = (groupsResult.Groups || []).map((g) => g.GroupName);
  if (!targetGroups.includes(args.partyClientId)) {
    throw new Error(`${args.userEmail} is not a member of ${args.partyClientId} — cannot assign them.`);
  }
  if (!targetGroups.includes(`${args.partyClientId}__${args.role}`)) {
    throw new Error(`${args.userEmail} is not in the ${args.role} role for ${args.partyClientId}.`);
  }

  const now = new Date().toISOString();
  const item = {
    __typename: 'AgentAssignment',
    id: randomUUID(),
    partyClientId: args.partyClientId,
    userSub: targetSub,
    userEmail: args.userEmail,
    role: args.role,
    scopeValue: args.scopeValue,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: ASSIGNMENT_TABLE_NAME,
      Item: item,
    })
  );

  return item;
}

export const handler = async (event: CreateRecordEvent) => {
  const groups = event.identity?.groups || [];
  const userSub = event.identity?.sub;

  switch (event.fieldName) {
    case 'fileSubmission':
      return fileSubmission(event.arguments as unknown as FileSubmissionArgs, groups, userSub);
    case 'fileCorrection':
      return fileCorrection(event.arguments as unknown as FileCorrectionArgs, groups);
    case 'fileFlag':
      return fileFlag(event.arguments as unknown as FileFlagArgs, groups);
    case 'createAssignment':
      return createAssignment(event.arguments as unknown as CreateAssignmentArgs, groups);
    default:
      throw new Error(`create-role-checked-record: unknown operation ${event.fieldName}`);
  }
};
