import { cloudFeatureFlags, isCloudConfigured } from '../cloudConfig';
import { leadCreate } from '../serverApi';

type TestResult = { name: string; passed: boolean; details?: string };

const createTestLead = () => ({
  name: 'Test User',
  phone: '+971501234567',
  message: 'Test message',
  orderId: `test-${Date.now()}`
});

export const runLeadCreationTestSuite = async (): Promise<TestResult[]> => {
  const results: TestResult[] = [];

  results.push({
    name: 'cloud configured',
    passed: isCloudConfigured,
    details: isCloudConfigured ? 'isCloudConfigured=true' : 'Cloud config is not ready'
  });

  results.push({
    name: 'CLIENT_FORM feature enabled',
    passed: cloudFeatureFlags.clientForm,
    details: cloudFeatureFlags.clientForm ? 'cloudFeatureFlags.clientForm=true' : 'CLIENT_FORM disabled'
  });

  const success = await leadCreate(createTestLead());
  results.push({
    name: 'create lead successfully',
    passed: success.ok,
    details: success.ok ? `leadId=${success.data.leadId}` : `${success.code}: ${success.error}`
  });

  const timeoutResult = await leadCreate(createTestLead(), { timeoutMs: 1 });
  results.push({
    name: 'network/timeout handled gracefully',
    passed: !timeoutResult.ok,
    details: timeoutResult.ok ? 'Expected failure for forced timeout' : `${timeoutResult.code}: ${timeoutResult.error}`
  });

  return results;
};
