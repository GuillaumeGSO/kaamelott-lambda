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
           │ GET  /characters          │
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
| `GET` | `/characters` | Sorted list of all characters with quote counts |
| `POST` | `/favorites` | Add or remove a quote from favorites |
| `GET` | `/favorites/status` | Check if a quote is favorited by a user |

### Quote response format

```json
{
  "quoteId": "CdEK6uph",
  "character": "Perceval",
  "text": "C'est pas faux.",
  "actor": "Franck Pitiot",
  "film": "Kaamelott",
  "season": "Livre I",
  "episode": "La Quête",
  "likes": 12,
  "youtube_video_id": "dQw4w9WgXcQ",
  "youtube_start_seconds": 142
}
```

`youtube_video_id` and `youtube_start_seconds` are `null` for film quotes and for TV quotes that could not be matched in a transcript.

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for full endpoint reference.

---

## Development

### Prerequisites

- Node.js 18+
- AWS CLI configured (`aws configure`)
- CDK bootstrapped for your account/region (one-time):

```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/ap-southeast-1
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

7 test suites, 37 tests, 100% statement/function/line coverage.

### Build

```bash
npm run build   # compile TypeScript (CDK infra only)
```

---

## Deploy

```bash
npx cdk deploy --context env=staging
npx cdk deploy --context env=prod
```

After the first deploy, invoke the `load-quotes` Lambda to seed DynamoDB. The function name is printed in the CDK outputs.

```bash
aws lambda invoke \
  --function-name kaamelott-load-quotes-staging \
  --region ap-southeast-1 \
  /tmp/load-result.json

cat /tmp/load-result.json
# → {"loaded":1028,"unprocessed":0}
```

Re-run any time `data/quotes.json` changes. Repeat for prod (`kaamelott-load-quotes-prod`).

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
│   ├── post-favorite/                # POST /favorites
│   └── load-quotes/                  # Admin: load quotes.json from S3 → DynamoDB
├── tests/                            # Jest test suites (one per Lambda)
├── data/
│   └── quotes.json                   # Source quotes (produced by kamelott-scrapping)
├── API_DOCUMENTATION.md
├── cdk.json
├── package.json
└── tsconfig.json
```
