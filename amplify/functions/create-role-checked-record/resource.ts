import { defineFunction } from '@aws-amplify/backend';

// Closes the residual gap documented in ../../data/resource.ts's history:
// groupDefinedIn('requiredCreatorGroup') trusted a client-supplied field
// naming its own group, so a caller honestly in SOME compound group for a
// party could claim it on the WRONG model's create and be authorized (e.g.
// a FieldAgent claiming `${partyClientId}__Reviewer}` doesn't work since
// they're not really in it, but a FieldAgent claiming their OWN real
// `${partyClientId}__FieldAgent` group on a SubmissionCorrection create
// did). This function backs two custom mutations
// (fileSubmission/fileCorrection in ../../data/resource.ts) instead — a
// custom-business-logic resolver, NOT another authorizer, invoked from
// inside an already-userPool-authenticated request. It never hits the
// auth-mode-resolution wall that killed the original Lambda-authorizer
// attempt (see ../../auth/resource.ts's history): AppSync populates
// event.identity.groups from the caller's REAL, verified Cognito session
// before this ever runs, so nothing here trusts client-supplied input for
// who the caller is or what they're allowed to do.
//
// The model-generated createSubmission/createSubmissionCorrection
// mutations still exist in the schema (Amplify always generates full CRUD
// per model) but are permanently unreachable — no rule grants 'create' on
// either model anymore, same as update/delete already were. These two
// custom mutations are the only path left to create either record.
//
// resourceGroupName: 'data' co-locates this function in the SAME
// CloudFormation stack as the tables it writes to and the schema that
// references it as a mutation handler — avoiding the cross-stack
// circular dependency that hit party-role-authorizer twice (data needing
// the function's ARN for the handler wiring, the function needing the
// tables' ARNs for write grants, in opposite directions across two
// stacks). Intra-stack references don't have that problem, so
// ../../backend.ts can use the standard high-level `.grantWriteData()`
// here instead of the pseudo-parameter wildcard workaround that ARN-based
// cross-stack grants needed elsewhere in this file's history.
export const createRoleCheckedRecord = defineFunction({
  name: 'create-role-checked-record',
  entry: './handler.ts',
  timeoutSeconds: 10,
  resourceGroupName: 'data',
});
