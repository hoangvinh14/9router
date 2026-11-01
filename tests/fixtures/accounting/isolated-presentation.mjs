// Node-process counterpart of isolated-setup.js. No timers, dynamic pricing
// imports or writable adapter references are created by legacy presentation.
export const appendRequestLog = async () => {};
export const saveRequestDetail = async () => {};
export const saveRequestUsage = async () => {};
export const trackPendingRequest = () => {};
export const getActiveRequests = async () => ({activeRequests:[],recentRequests:[]});
