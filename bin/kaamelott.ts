#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KaamelottStack } from '../lib/kaamelott-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') ?? 'staging';
if (!['staging', 'prod'].includes(env)) {
  throw new Error(`Unknown env "${env}". Use --context env=staging or --context env=prod`);
}

new KaamelottStack(app, `kaamelott-${env}`, {
  env: {
    region: 'eu-west-3',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  environment: env as 'staging' | 'prod',
});
