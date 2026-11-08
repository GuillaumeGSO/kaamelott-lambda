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

describe('KaamelottStack alarms', () => {
  // Synthesising bundles every Lambda asset: done once per environment.
  const staging = synth('staging');
  const prod = synth('prod');

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
