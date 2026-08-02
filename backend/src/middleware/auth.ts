/**
 * middleware/auth.ts — backward-compatibility re-export shim.
 *
 * All logic now lives in AuthMiddleware.ts.
 * Any existing imports of `../middleware/auth` continue to resolve correctly.
 */
export type { AuthenticatedRequest, AuthenticatedSocket } from './AuthMiddleware';
export { AuthMiddleware } from './AuthMiddleware';

import { AuthMiddleware } from './AuthMiddleware';

/** @deprecated Import from AuthMiddleware directly */
export const authenticateJWT = AuthMiddleware.authenticateJWT.bind(AuthMiddleware);

/** @deprecated Import from AuthMiddleware directly */
export const authenticateSocket = AuthMiddleware.authenticateSocket.bind(AuthMiddleware);
