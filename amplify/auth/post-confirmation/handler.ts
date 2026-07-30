import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient();

// Cognito Lambda triggers that throw block the operation they're attached
// to — an unhandled error here would stop the user's sign-up/confirmation
// from completing at all, which is far worse than just falling back to
// the pre-existing manual admin-add-user-to-group step. Every failure
// path below logs and returns normally rather than throwing.
export const handler: PostConfirmationTriggerHandler = async (event) => {
  const partyClientId = event.request.userAttributes['custom:partyClientId'];

  if (!partyClientId) {
    console.warn(
      `post-confirmation: ${event.userName} has no custom:partyClientId set — skipping auto group assignment (falls back to manual admin-add-user-to-group).`
    );
    return event;
  }

  try {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: partyClientId,
      })
    );
    console.log(`post-confirmation: added ${event.userName} to group "${partyClientId}"`);
  } catch (err) {
    // Most likely cause: custom:partyClientId doesn't match a real group
    // (typo, or a value that was never a real party client) — Cognito
    // reports that as ResourceNotFoundException. Not fatal either way.
    console.error(`post-confirmation: failed to add ${event.userName} to group "${partyClientId}"`, err);
  }

  return event;
};
