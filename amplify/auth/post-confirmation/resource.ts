import { defineFunction } from '@aws-amplify/backend';

// Automates the manual `aws cognito-idp admin-add-user-to-group` step
// documented (and previously required) in ../resource.ts — a newly
// confirmed user with a valid custom:partyClientId attribute gets placed
// in the matching group automatically. Still doesn't automate *setting*
// that attribute in the first place: an admin sets it at user-creation
// time (admin-create-user --user-attributes Name=custom:partyClientId,...);
// self-service sign-up with party-client selection is a separate,
// deliberately out-of-scope UX/security decision.
export const postConfirmation = defineFunction({
  name: 'post-confirmation-assign-group',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // Without this, CDK deploy fails with CloudformationStackCircularDependencyError:
  // the auth stack depends on this function (it's wired as a trigger in
  // ../resource.ts), and this function's IAM policy in ../../backend.ts
  // depends on the auth stack's userPoolArn — a genuine circular
  // dependency between nested stacks. Grouping the function into the auth
  // stack itself (rather than its own separate nested stack) resolves it;
  // this is Amplify's own documented fix for exactly this shape of trigger.
  resourceGroupName: 'auth',
});
