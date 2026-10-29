import { decimalToNanoUsd } from '../pricing/decimalMoney.js';

export function parseBudgetPolicy(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || ![Object.prototype, null].includes(Object.getPrototypeOf(body)) ||
      Object.getOwnPropertySymbols(body).length || Object.keys(body).sort().join(',') !== 'expectedVersion,monthlyLimitUsd,weeklyLimitUsd' ||
      Object.values(Object.getOwnPropertyDescriptors(body)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new Error('Complete budget policy required');
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 || body.expectedVersion >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid expected budget version');
  const amount = value => value === null ? null : Number(decimalToNanoUsd(value));
  return Object.freeze({ weeklyLimitNanoUsd: amount(body.weeklyLimitUsd), monthlyLimitNanoUsd: amount(body.monthlyLimitUsd), expectedVersion: body.expectedVersion });
}
