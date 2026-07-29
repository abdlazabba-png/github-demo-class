import { defineBackend } from '@aws-amplify/backend';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { storage } from './storage/resource.js';
import { validateSubmission } from './functions/validate-submission/resource.js';

const backend = defineBackend({
  auth,
  data,
  storage,
  validateSubmission,
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
