import { defineFunction } from '@aws-amplify/backend';

// DynamoDB Streams handler that populates validationSeverity/
// validationChecks on each new Submission row — the piece deliberately
// left undone in the initial backend commit (no way to verify Lambda/
// stream wiring without deploy access at the time). Wired up in
// ../../backend.ts via a CDK escape hatch (defineData doesn't expose
// "attach a stream trigger" as a first-class option).
export const validateSubmission = defineFunction({
  name: 'validate-submission',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
