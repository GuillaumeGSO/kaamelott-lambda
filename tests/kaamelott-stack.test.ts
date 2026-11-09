import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { KaamelottStack } from '../lib/kaamelott-stack';

const synth = (environment: 'staging' | 'prod') => {
  const app = new cdk.App();
  const stack = new KaamelottStack(app, `kaamelott-${environment}`, {
    env: { region: 'eu-west-3', account: '123456789012' },
    environment,
    alarmEmail: 'alarms@example.com',
  });
  return Template.fromStack(stack);
};

// Synthesising bundles every Lambda asset: done once per environment.
const staging = synth('staging');
const prod = synth('prod');

describe('KaamelottStack Lambdas', () => {
  test('run on arm64 (Graviton), the API ones and the loader alike', () => {
    // CDK's own helper functions (S3 deployment, auto-delete) aren't ours: only check kaamelott-*.
    const functions = Object.values(staging.findResources('AWS::Lambda::Function')).filter(f =>
      String(f.Properties.FunctionName ?? '').startsWith('kaamelott-'),
    );
    expect(functions).toHaveLength(10);
    for (const f of functions) expect(f.Properties.Architectures).toEqual(['arm64']);
  });

  test('let only the loader publish QuotesReloaded, on the default bus', () => {
    const publishers = Object.values(staging.findResources('AWS::IAM::Policy')).filter(p =>
      JSON.stringify(p.Properties.PolicyDocument).includes('events:PutEvents'),
    );
    expect(publishers).toHaveLength(1);
    expect(JSON.stringify(publishers[0].Properties.Roles)).toMatch(/LoadQuotes/);
    expect(JSON.stringify(publishers[0].Properties.PolicyDocument)).toMatch(/event-bus\/default/);
  });
});

describe('KaamelottStack alarms', () => {
  test('emails the alarm topic', () => {
    staging.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'kaamelott-alarms-staging' });
    staging.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alarms@example.com',
    });
  });

  test('keeps the address out of logical ids, which deploy logs print', () => {
    const ids = Object.keys(staging.toJSON().Resources);
    expect(ids.filter(id => /example/i.test(id))).toEqual([]);
  });

  test('alarms on API 5XX errors, and notifies the recovery too', () => {
    staging.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'kaamelott-api-5xx-staging',
      Namespace: 'AWS/ApiGateway',
      MetricName: '5XXError',
      Statistic: 'Sum',
      Period: 300,
      Threshold: 3,
      TreatMissingData: 'notBreaching',
      AlarmActions: [{ Ref: Match.stringLikeRegexp('AlarmTopic') }],
      OKActions: [{ Ref: Match.stringLikeRegexp('AlarmTopic') }],
    });
  });

  test('warns at 80% of the web daily quota, which differs per environment', () => {
    for (const [template, environment, quota] of [
      [staging, 'staging', 1000],
      [prod, 'prod', 5000],
    ] as const) {
      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        UsagePlanName: `kaamelott-web-usage-plan-${environment}`,
        Quota: { Limit: quota, Period: 'DAY' },
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: `kaamelott-api-quota-${environment}`,
        MetricName: 'Count',
        Period: 86400,
        Threshold: quota * 0.8,
      });
    }
  });
});

describe('KaamelottStack API logs', () => {
  test('log why a request failed, and with which key', () => {
    const [stage] = Object.values(staging.findResources('AWS::ApiGateway::Stage'));
    const format = JSON.parse(stage.Properties.AccessLogSetting.Format);
    expect(format).toMatchObject({
      status: '$context.status',
      lambdaStatus: '$context.integrationStatus',
      functionStatus: '$context.integration.status',
      errorType: '$context.error.responseType',
      errorMessage: '$context.error.message',
      apiKeyId: '$context.identity.apiKeyId',
    });
  });
});

describe('KaamelottStack Lambda concurrency alarm', () => {
  test("watches the account's total, from the staging stack only", () => {
    staging.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'kaamelott-lambda-concurrency',
      Namespace: 'AWS/Lambda',
      MetricName: 'ConcurrentExecutions',
      Dimensions: Match.absent(),
      Statistic: 'Maximum',
      Threshold: 100,
      AlarmActions: [{ Ref: Match.stringLikeRegexp('AlarmTopic') }],
    });
    prod.resourcePropertiesCountIs('AWS::CloudWatch::Alarm', { AlarmName: 'kaamelott-lambda-concurrency' }, 0);
  });
});
