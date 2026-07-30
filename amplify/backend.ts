import { defineBackend } from '@aws-amplify/backend';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { storage } from './storage/resource.js';
import { validateSubmission } from './functions/validate-submission/resource.js';
import { postConfirmation } from './auth/post-confirmation/resource.js';

const backend = defineBackend({
  auth,
  data,
  storage,
  validateSubmission,
  postConfirmation,
});

// Wires the DynamoDB Streams -> Lambda validation pipeline
// (functions/validate-submission/handler.ts). defineData doesn't expose
// "attach a stream trigger" as a first-class option, so this reaches into
// the underlying CDK Table/Function constructs directly — the one part of
// this backend that couldn't be verified without actual deploy access,
// now that there is some.
const submissionTable = backend.data.resources.tables['Submission'];
const validateSubmissionLambda = backend.validateSubmission.resources.lambda;

validateSubmissionLambda.addEventSource(
  new DynamoEventSource(submissionTable, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 10,
    retryAttempts: 3,
  })
);

submissionTable.grantReadWriteData(validateSubmissionLambda);
// grantReadWriteData() on this table did NOT include the secondary
// indexes' ARNs (confirmed live: the Lambda's Query against
// submissionsByPuCode failed with AccessDeniedException — unlike a plain
// aws-cdk-lib/aws-dynamodb Table, whose grant methods add `/index/*`
// automatically, this doesn't). Duplicate detection queries an index, so
// it needs this explicit grant.
validateSubmissionLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [`${submissionTable.tableArn}/index/*`],
  })
);
// addEnvironment lives on the ConstructFactory backend.validateSubmission
// returns (AddEnvironmentFactory), not on the raw CDK construct at
// .resources.lambda — confirmed against @aws-amplify/backend-function's
// own type declarations after the construct-level call failed to type-check.
backend.validateSubmission.addEnvironment('SUBMISSION_TABLE_NAME', submissionTable.tableName);

// Mirrors the Submission wiring above for the reviewer/edit flow's
// SubmissionCorrection table (see amplify/data/resource.ts) — same
// Streams -> Lambda validation pattern, reusing the same function rather
// than a second one, since the only new logic is ~30 lines
// (processCorrectionInsert in the handler) and this avoids a second
// CloudFormation resource + IAM role for it.
//
// No extra dynamodb:Query PolicyStatement needed here unlike the
// Submission table above: this Lambda only ever does a plain
// UpdateCommand by id against SubmissionCorrection, never a Query against
// one of its secondary indexes, so grantReadWriteData() alone is enough.
const correctionTable = backend.data.resources.tables['SubmissionCorrection'];

validateSubmissionLambda.addEventSource(
  new DynamoEventSource(correctionTable, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 10,
    retryAttempts: 3,
  })
);

correctionTable.grantReadWriteData(validateSubmissionLambda);
backend.validateSubmission.addEnvironment('CORRECTION_TABLE_NAME', correctionTable.tableName);

// Group auto-assignment (auth/post-confirmation/). defineAuth's `triggers`
// option wires the Cognito LambdaConfig + invoke permission automatically,
// but AdminAddUserToGroup is an admin API this function also needs and
// isn't something a generic trigger wiring would know to grant — same
// reasoning as the explicit index-query grant above; Amplify's automatic
// grants have already proven not to cover everything a trigger function
// actually needs.
//
// Deliberately NOT `resources: [backend.auth.resources.userPool.userPoolArn]`
// — confirmed live: referencing the UserPool resource's own ARN token from
// a policy attached to a Lambda that's ALSO wired as that same UserPool's
// trigger creates a resource-level circular dependency within the auth
// stack (the UserPool needs the Lambda's ARN for LambdaConfig; this policy
// would need the UserPool's ARN — CloudFormation can't order that).
// Stack-level pseudo-parameters (region/account) don't reference the
// UserPool resource at all, so they don't create that edge; the tradeoff
// is a same-account/region wildcard instead of pinning to this one pool,
// which is an acceptable least-privilege loosening here since the
// trigger's own invoke permission (which Amplify does scope correctly) is
// what actually controls who can invoke this function in the first place.
const authStack = Stack.of(backend.auth.resources.userPool);
backend.postConfirmation.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['cognito-idp:AdminAddUserToGroup'],
    resources: [`arn:aws:cognito-idp:${authStack.region}:${authStack.account}:userpool/*`],
  })
);
