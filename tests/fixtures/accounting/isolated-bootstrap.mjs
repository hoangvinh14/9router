import { assertAccountingIsolation } from './isolation-attestation.mjs';
// Import this dependency before any application-bearing dependency. ESM static
// imports evaluate dependencies before the importing module's body can guard it.
export const isolatedRoot = assertAccountingIsolation();
