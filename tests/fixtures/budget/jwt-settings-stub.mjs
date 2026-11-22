// Session signing/verification does not use settings. Password authentication
// stays out of this bounded lane; fail if reached rather than import app startup.
export function getSettings(){throw new Error('password/settings outside JWT lane');}
