#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KaamelottStack } from '../lib/kaamelott-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') ?? 'staging';
if (!['staging', 'prod'].includes(env)) {
  throw new Error(`Unknown env "${env}". Use --context env=staging or --context env=prod`);
}

// Required rather than optional: a deploy without it would delete the alarm subscription.
// Not committed (public repo): exported locally, a GitHub secret in CI.
const alarmEmail = process.env.ALARM_EMAIL;
if (!alarmEmail) {
  throw new Error('ALARM_EMAIL is not set: export ALARM_EMAIL=<address that receives the alarms>');
}

new KaamelottStack(app, `kaamelott-${env}`, {
  env: {
    region: 'eu-west-3',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  environment: env as 'staging' | 'prod',
  alarmEmail,
});
