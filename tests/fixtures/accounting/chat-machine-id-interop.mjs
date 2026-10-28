import implementation from 'node-machine-id';
// Match the bundler's CommonJS interop while retaining the actual functions.
export const machineIdSync = implementation.machineIdSync;
export const machineId = implementation.machineId;
export default implementation;
