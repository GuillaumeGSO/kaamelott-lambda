# Kaamelott Lambda

Serverless REST API returning random quotes from the French comedy series [Kaamelott](https://fr.wikipedia.org/wiki/Kaamelott). Built with AWS CDK (TypeScript), Lambda (Node.js), API Gateway, and DynamoDB. Features user favorites, like counts, and YouTube timestamps linking each quote to its source moment.

## Architecture

```
                    data/quotes.json
                   (from kamelott-scrapping)
                           │
                           ▼
                    load-quotes Lambda
                    (admin, one-time)
                           │
                           ▼
              DynamoDB Quotes Table          DynamoDB Favorites Table
              ┌──────────────────────┐    ┌──────────────────────────┐
              │  PK: quoteId         │    │  PK: quoteId             │
              │  GSI: character-index│    │  SK: alias               │
              └──────────────────────┘    │  GSI: alias-index        │
                       │                  └──────────────────────────┘
          ┌────────────┼────────────┐                  │
          ▼            ▼            ▼                  ▼
   GetRandomQuote  GetQuoteBy  GetQuoteBy       PostFavorite
      Lambda       Character   Favorites        GetFavoriteStatus
                   Lambda      Lambda            Lambda
          │            │            │              │
          └────────────┼────────────┼──────────────┘
                       ▼
                  API Gateway
           ┌──────────────────────────┐
           │ GET  /quotes/random       │
           │ GET  /quotes/by-character │
           │ GET  /quotes/by-favorites │
           │ GET  /quotes/all          │
           │ GET  /quotes/likes        │
           │ GET  /characters          │
           │ GET  /favorites           │
           │ POST /favorites           │
           │ GET  /favorites/status    │
           └──────────────────────────┘
```

**Environments:** `staging` and `prod`, each with independent DynamoDB tables, Lambda functions, and API Gateway stage.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/quotes/random` | Random quote(s), optional `?batchSize=1..20` |
| `GET` | `/quotes/by-character/{character}` | Random quote from a specific character |
| `GET` | `/quotes/by-favorites` | Random quote from a user's favorites |
| `GET` | `/quotes/all` | Every quote, without like counts (sent with `Cache-Control: public, max-age=3600`) |
| `GET` | `/quotes/likes` | Like count of every liked quote |
| `GET` | `/characters` | Sorted list of all characters with quote counts |
| `GET` | `/favorites` | QuoteIds liked by a user (`?alias=`) |
| `POST` | `/favorites` | Add or remove a quote from favorites |
| `GET` | `/favorites/status` | Check if a quote is favorited by a user |

`/quotes/all`, `/quotes/likes` and `GET /favorites` serve the [kaamelott-app](https://github.com/GuillaumeGSO/kaamelott-app) website. It loads every quote once and filters in the browser, and its CloudFront caches the first two (1 day and 5 minutes). A visit then costs about 2 API calls instead of one or two per quote shown. The website's key (`kaamelott-web-<env>`) has its own usage plan: 1,000 calls/day on staging, 5,000 on prod, 20 calls/s (burst 40).

### Quote response format

```json
{
  "quoteId": "CdEK6uph",
  "character": "Perceval",
  "text": "C'est pas faux.",
  "actorName": "Franck Pitiot",
  "film": "Kaamelott",
  "season": "Livre I",
  "episode": "La Quête",
  "likes": 12,
  "youtubeVideoId": "dQw4w9WgXcQ",
  "youtubeStartSeconds": 142
}
```

`youtubeVideoId` and `youtubeStartSeconds` are `null` for film quotes and for TV quotes that could not be matched in a transcript.

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for full endpoint reference.

---

## Development

### Prerequisites

- Node.js 18+
- AWS CLI with an SSO profile for the `kaamelott` account (region `eu-west-3`, Paris):

```ini
[profile kaamelott]
sso_session = org
sso_account_id = YOUR_ACCOUNT_ID
sso_role_name = AdministratorAccess
region = eu-west-3
```

```bash
aws sso login --sso-session org
```

- CDK bootstrapped for your account/region (one-time):

```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/eu-west-3 --profile kaamelott
```

### Install dependencies

```bash
npm install
```

### Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

7 test suites, 52 tests, 100% statement/branch/function/line coverage.

### Build

```bash
npm run build   # compile TypeScript (CDK infra only)
```

---

## Contract tests (Pact)

The [kaamelott-app](https://github.com/GuillaumeGSO/kaamelott-app) website is a Pact **consumer** of this API: it writes a contract, the requests it sends and the response shapes it relies on (`/quotes/all`, `/quotes/likes`, `GET` and `POST /favorites`). This API is the **provider** and verifies it. There's no Pact Broker: the contract is a file committed in kaamelott-app, read from raw GitHub URLs (public repo, no token).

- `tests/pact/provider.pact.js` serves the real Lambda handlers through a small HTTP server that builds API Gateway proxy events. It runs over an in-memory DynamoDB that each Pact *provider state* seeds ("merlin has liked quote q1"…).
- `npm run pact:verify` runs it, kept out of `npm test`. By default it verifies the contract on the site's `main`. `PACT_URLS` overrides that with space-separated URLs or file paths.
- The **Pact verify** workflow runs on every push. It checks the site's `main` contract, plus the site branch with the same name as the pushed branch, if it exists. A manual run takes an API branch ("Use workflow from") and any contract URL.
- **Deploy staging** runs `pact:verify` before deploying (the equivalent of Pact's `can-i-deploy`).
- A failure means the API no longer returns what the site expects: fix the API, or change the contract on the site side first.
- GitHub caches raw files for about 5 minutes, so a just-merged contract can take a moment to show up.

```bash
npm run pact:verify                                                            # site main
PACT_URLS=../kaamelott-app/pacts/kaamelott-app-kaamelott-lambda.json npm run pact:verify   # local site checkout
```

## Deploy

Every CDK command (`deploy`, `diff`, `destroy`, `synth`) needs `ALARM_EMAIL`, the address that receives the CloudWatch alarms. It isn't committed (public repo), and synth fails without it: a deploy without it would delete the alarm subscription.

```bash
export ALARM_EMAIL=you@example.com
npx cdk deploy --context env=staging --profile kaamelott
npx cdk deploy --context env=prod --profile kaamelott
```

After the first deploy, invoke the `load-quotes` Lambda to seed DynamoDB. The function name is printed in the CDK outputs.

```bash
aws lambda invoke \
  --function-name kaamelott-load-quotes-staging \
  --region eu-west-3 --profile kaamelott \
  /tmp/load-result.json

cat /tmp/load-result.json
# → {"loaded":1028,"unprocessed":0}
```

Re-run any time `data/quotes.json` changes. Repeat for prod (`kaamelott-load-quotes-prod`).

> **Note:** `load-quotes` upserts by `quoteId`. Only seed an empty table, or one whose quoteIds match `data/quotes.json`; otherwise quotes are duplicated under new IDs and favorites point to the old ones.

### Deploy staging from GitHub

Actions → **Deploy staging** → **Run workflow** runs the tests and the Pact check, then `cdk deploy kaamelott-staging`. Tick **load_quotes** to also reload `data/quotes.json` into DynamoDB. Prod is deployed locally only. The workflow reads `ALARM_EMAIL` from a repository **secret** (Settings → Secrets and variables → Actions), not a variable, so it's masked in the public logs.

The workflow authenticates with GitHub OIDC (no stored AWS keys). It assumes the `kaamelott-github-deploy-staging` IAM role, which trusts only this repo's `staging` GitHub environment and may only use the CDK bootstrap roles and invoke `kaamelott-load-quotes-staging`.

### Alarms

Each environment has an SNS topic `kaamelott-alarms-<env>` that emails `ALARM_EMAIL` (confirm the subscription from the first email AWS sends), on alarm and on recovery:

- `kaamelott-api-5xx-<env>`: 3 or more 5XX responses in 5 minutes. A Lambda that throws or times out comes back as a 502, so this covers every endpoint.
- `kaamelott-api-quota-<env>`: more than 80% of the website's daily quota (800 calls in staging, 4,000 in prod) over a rolling day. It counts every API key, and the quota resets at midnight UTC, so it's an early warning, not an exact gauge.

Costs (budget, anomaly detection) are watched at the AWS Organization level, from the management account.

### Preview changes before deploy

```bash
npx cdk diff --context env=staging
npx cdk diff --context env=prod
```

### Destroy

```bash
npx cdk destroy --context env=staging
```

> **Note:** The prod DynamoDB tables use `RemovalPolicy.RETAIN`. After `cdk destroy --context env=prod`, delete them manually from the AWS console if needed.

---

## Project structure

```
├── bin/kaamelott.ts                  # CDK app entry point
├── lib/kaamelott-stack.ts            # All infrastructure (S3, DynamoDB, Lambdas, API GW)
├── lambdas/
│   ├── get-random-quote/             # GET /quotes/random
│   ├── get-quote-by-character/       # GET /quotes/by-character/{character}
│   ├── get-quote-by-favorites/       # GET /quotes/by-favorites
│   ├── get-favorite-status/          # GET /favorites/status
│   ├── get-characters/               # GET /characters
│   ├── get-all-quotes/               # GET /quotes/all
│   ├── get-likes/                    # GET /quotes/likes
│   ├── get-favorites/                # GET /favorites
│   ├── post-favorite/                # POST /favorites
│   └── load-quotes/                  # Admin: load quotes.json from S3 → DynamoDB
├── tests/                            # Jest test suites (one per Lambda)
│   └── pact/provider.pact.js         # Pact verification of the kaamelott-app contract
├── data/
│   └── quotes.json                   # Source quotes (produced by kamelott-scrapping)
├── API_DOCUMENTATION.md
├── cdk.json
├── package.json
└── tsconfig.json
```
