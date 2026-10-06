/** Entry point `@evia/contracts/authz`: the authorization manifest and the public-operation allow-list. */
export { AUTHZ_MANIFEST } from '../generated/authz.gen.ts';
export type { AuthzManifest, AuthzPolicy, OperationAuthz } from './manifest.ts';
export { PUBLIC_OPERATIONS } from './public-operations.ts';
