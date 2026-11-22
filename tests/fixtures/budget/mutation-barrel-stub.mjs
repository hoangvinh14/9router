// Exact unrelated DB-barrel exports only. Never called in mutation lane.
const blocked=()=>{throw new Error('unrelated DB export reached');};
export const getProviderConnections=blocked,getProviderConnectionById=blocked,createProviderConnection=blocked,updateProviderConnection=blocked,deleteProviderConnection=blocked,deleteProviderConnectionsByProvider=blocked,reorderProviderConnections=blocked,cleanupProviderConnections=blocked;
export const getProviderNodes=blocked,getProviderNodeById=blocked,createProviderNode=blocked,updateProviderNode=blocked,deleteProviderNode=blocked;
export const getProxyPools=blocked,getProxyPoolById=blocked,createProxyPool=blocked,updateProxyPool=blocked,deleteProxyPool=blocked;
export const getCombos=blocked,getComboById=blocked,getComboByName=blocked,createCombo=blocked,updateCombo=blocked,deleteCombo=blocked;
export const getModelAliases=blocked,setModelAlias=blocked,deleteModelAlias=blocked,getCustomModels=blocked,addCustomModel=blocked,deleteCustomModel=blocked,getMitmAlias=blocked,setMitmAliasAll=blocked;
export const getPricing=blocked,getPricingForModel=blocked,updatePricing=blocked,resetPricing=blocked,resetAllPricing=blocked;
export const getDisabledModels=blocked,getDisabledByProvider=blocked,disableModels=blocked,enableModels=blocked;
export const statsEmitter=blocked,trackPendingRequest=blocked,getActiveRequests=blocked,saveRequestUsage=blocked,getUsageHistory=blocked,getUsageStats=blocked,getChartData=blocked,appendRequestLog=blocked,getRecentLogs=blocked;
export const saveRequestDetail=blocked,getRequestDetails=blocked,getRequestDetailById=blocked,getDistinctProviders=blocked;
