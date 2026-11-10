import type { ReadonlyApi } from '../../../shared/safety/guarded-test';
import { contractValue, signupContract, type SignupOptions } from '../signup-contract';

export async function fetchSignupOptions(api: ReadonlyApi): Promise<{ status: number; options: SignupOptions }> {
  const { status, body } = await api.getJson(contractValue(signupContract.paths.signupOptionsApi));
  return { status, options: contractValue(signupContract.api.parseSignupOptions)(body) };
}
