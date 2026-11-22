import { pathToFileURL } from 'node:url';
const aliases = {
 '@/lib/dataDir.js':'/app/src/lib/dataDir.js',
 '@/shared/constants/keyAccess.js':'/app/src/shared/constants/keyAccess.js',
 '@/lib/accounting/request-boundary.js':'/app/src/lib/accounting/request-boundary.js',
 '@/lib/accounting/profile-registry.js':'/app/src/lib/accounting/profile-registry.js',
 'next/server':'/app/fixtures/next-server.js',
 '@/lib/localDb':'/app/fixtures/local-db.js',
 '@/shared/utils/machineId':'/app/fixtures/machine-id.js',
 '@/lib/auth/dashboardSession':'/app/fixtures/dashboard-session.js',
 '@/lib/auth/trustedPeer':'/app/fixtures/trusted-peer.js',
};
export function resolve(specifier,context,nextResolve){
 if(Object.hasOwn(aliases,specifier))return nextResolve(pathToFileURL(aliases[specifier]).href,context);
 return nextResolve(specifier,context);
}
