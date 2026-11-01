// One registry for raw upstream liveness, independent of transformed output.
const activities=new WeakMap();
export const accountingStreamActivity=response=>activities.get(response);
export function bindAccountingStreamActivity(response,activity){activities.set(response,activity);return response;}
