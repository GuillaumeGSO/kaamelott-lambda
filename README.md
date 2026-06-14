# Kaamelott Lambda

Serverless REST API returning random quotes from the French comedy series [Kaamelott](https://fr.wikipedia.org/wiki/Kaamelott). Built with AWS CDK (TypeScript), Lambda (Node.js 18.x), API Gateway, DynamoDB, and S3. Features user favorites functionality with like counts and personalized quote retrieval.

## Architecture

```
S3 (quotes.json)
     │
     └─► LoadQuotes Lambda (admin, one-time)
               │
               ▼
          DynamoDB Quotes Table          DynamoDB Favorites Table
          ┌──────────────────────────┐    ┌─────────────────────────┐
          │  PK: quoteId             │    │  PK: quoteId            │
          │  GSI: character-index    │    │  SK: alias              │
          └──────────────────────────┘    └─────────────────────────┘
               │        │        │                     │
               ▼        ▼        ▼                     ▼
     GetRandomQuote  GetQuoteBy  GetQuoteBy    PostFavorite
        Lambda       Character   Favorites     GetFavoriteStatus
                     Lambda      Lambda         Lambda
               │        │        │              │
               └────────┼────────┼──────────────┘
                        ▼        ▼
                    API Gateway
                   ┌─────────────┐
                   │ GET /quotes/random │
                   │ GET /quotes/{character} │
                   │ GET /quotes/by-favorites │
                   │ GET /characters │
                   │ POST /favorites │
                   │ GET /favorites/status │
                   └─────────────┘
```

**Environments:** `staging` and `prod`, each with their own DynamoDB table, S3 bucket, Lambda functions, and API Gateway stage.

## API Endpoints

### Core Quote Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/quotes/random` | Random quote(s) from any character (supports batchSize) |
| `GET` | `/quotes/{character}` | Random quote for a specific character |
| `GET` | `/characters` | Sorted list of all character names with quote counts |

### Favorites Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/favorites` | Add or remove a quote from user favorites |
| `GET` | `/favorites/status` | Check if a quote is favorited by a user |
| `GET` | `/quotes/by-favorites` | Get random quote from user's favorites |

### Quote Response Format

```json
{
  "quoteId": "7XLMZGpC",
  "character": "Perceval",
  "text": "C'est pas faux.",
  "actor": "Franck Pitiot",
  "film": null,
  "season": "Livre I",
  "episode": "La Quête",
  "likes": 12
}
```

| Field | Type | Description |
|-------|------|-------------|
| `quoteId` | string | Unique identifier |
| `character` | string | Character who says the quote |
| `text` | string | The quote |
| `actor` | string | Actor who plays the character |
| `film` | string \| null | Film title if from the movie |
| `season` | string \| null | Season if from the series |
| `episode` | string \| null | Episode title if from the series |
| `likes` | number | Total number of users who favorited this quote |

### Batch Quote Response

For `/quotes/random?batchSize=N` where N > 1:

```json
{
  "quotes": [
    {
      "quoteId": "7XLMZGpC",
      "character": "Perceval",
      "text": "C'est pas faux.",
      "likes": 12
    },
    {
      "quoteId": "8YMN9HqD",
      "character": "Arthur",
      "text": "C'est de la provocation !",
      "likes": 8
    }
  ]
}
```

### Characters Response Format

```json
[
  {
    "character": "Arthur",
    "numberOfQuotes": 156
  },
  {
    "character": "Léodagan",
    "numberOfQuotes": 89
  }
]
```

### Favorites Endpoints

#### POST /favorites

Add or remove a quote from user favorites.

**Request Body:**
```json
{
  "quoteId": "7XLMZGpC",
  "favorite": true,
  "alias": "username"
}
```

**Fields:**
- `quoteId`: Quote identifier (must reference an existing quote)
- `favorite`: `true` to add, `false` to remove
- `alias`: User identifier (max 20 characters)

**Response:**
```json
{
  "quoteId": "7XLMZGpC",
  "alias": "username",
  "likes": 13
}
```

A `400` is returned for an invalid body, a missing field, or an `alias` longer than 20 characters. A `404` is returned when `quoteId` does not reference an existing quote.

#### GET /favorites/status

Check if a quote is favorited by a user.

**Query Parameters:**
- `quoteId`: Quote identifier
- `alias`: User identifier (max 20 characters)

**Response:**
```json
{
  "quoteId": "7XLMZGpC",
  "alias": "username",
  "liked": true
}
```

#### GET /quotes/by-favorites

Get a random favorited quote. Both query parameters are optional, giving four behaviours:

| `alias` | `character` | Result |
|---------|-------------|--------|
| —       | —           | Any quote favorited by **any** user |
| —       | set         | Any quote of that character favorited by any user |
| set     | —           | Any quote favorited by `alias` |
| set     | set         | Any quote of that character favorited by `alias` |

**Query Parameters:**
- `alias`: User identifier (optional, max 20 characters). When omitted, quotes favorited by any user are considered.
- `character`: Character filter (optional).

**Response:** Standard quote object, or `404` when no favorites match the requested combination.

### Character names with accents

Some character names contain French accented characters. Use percent-encoding in the URL:

```bash
# Léodagan → L%C3%A9odagan
curl "https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/staging/quotes/L%C3%A9odagan"
```

A `404` is returned when the character name is not found in the dataset.

## Prerequisites

- Node.js 18+
- AWS CLI configured (`aws configure` or a named profile)
- CDK bootstrapped for your account/region (one-time, see below)

## Setup

```bash
npm install
```

Bootstrap CDK for `ap-southeast-1` (one-time per AWS account):

```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/ap-southeast-1
```

## Development

### Testing

The project includes comprehensive Jest test suites for all Lambda functions:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

**Test Coverage:**
- 37 test cases across 7 test suites
- 100% statement, function, and line coverage
- 93.44% branch coverage
- Comprehensive mocking of AWS SDK services

### Building

```bash
# Compile TypeScript
npm run build
```

## Deploy

```bash
# Staging
npx cdk deploy --context env=staging

# Production (after validating on staging)
npx cdk deploy --context env=prod
```

Both commands upload `kamelott/quotes.json` to S3 automatically via CDK BucketDeployment.

CDK outputs the API URL and the load-quotes function name at the end of each deploy.

### Populate DynamoDB (once per environment)

After the first deploy, invoke the `load-quotes` Lambda to seed DynamoDB with the 1 028 quotes. The exact function name is printed in the CDK outputs.

```bash
aws lambda invoke \
  --function-name kaamelott-load-quotes-staging \
  --region ap-southeast-1 \
  /tmp/load-result.json

cat /tmp/load-result.json
# → {"loaded":1028,"unprocessed":0}
```

`loaded` is the number of quotes actually written and `unprocessed` the number DynamoDB skipped (typically under write throttling — these are also logged via `console.warn`). A non-zero `unprocessed` means the load was incomplete; re-run the Lambda.

Repeat for prod (`kaamelott-load-quotes-prod`). Re-run any time the quotes dataset changes.

## Preview changes before deploy

```bash
npx cdk diff --context env=staging
npx cdk diff --context env=prod
```

## Destroy

```bash
npx cdk destroy --context env=staging
```

> **Note:** The prod DynamoDB table and S3 bucket use `RemovalPolicy.RETAIN`. After `cdk destroy --context env=prod`, delete them manually from the AWS console if needed.

## Project structure

```
├── bin/kaamelott.ts              # CDK app entry point
├── lib/kaamelott-stack.ts        # All infrastructure (S3, DynamoDB, Lambdas, API GW)
├── lambdas/
│   ├── get-random-quote/         # GET /quotes/random (supports batchSize)
│   ├── get-quote-by-character/   # GET /quotes/{character}
│   ├── get-characters/           # GET /characters
│   ├── get-quote-by-favorites/   # GET /quotes/by-favorites
│   ├── get-favorite-status/      # GET /favorites/status
│   ├── post-favorite/            # POST /favorites
│   └── load-quotes/              # Admin: load quotes.json from S3 → DynamoDB
├── tests/                        # Jest test suites
│   ├── get-random-quote.test.js
│   ├── get-quote-by-character.test.js
│   ├── get-characters.test.js
│   ├── get-quote-by-favorites.test.js
│   ├── get-favorite-status.test.js
│   ├── post-favorite.test.js
│   └── load-quotes.test.js
├── data/
│   └── quotes.json               # 1 028 Kaamelott quotes (source of truth, uploaded to S3 on deploy)
├── API_DOCUMENTATION.md          # Detailed API documentation
├── cdk.json
├── package.json
└── tsconfig.json
```

## Features

### Core Functionality
- **Random quotes**: Get single or multiple random quotes with optional `batchSize` parameter (default=1)
- **Character filtering**: Get quotes from specific characters with URL encoding support
- **Character listing**: Browse all available characters with quote counts
- **Caching**: Lambda functions use intelligent caching for optimal performance

### Favorites System
- **User favorites**: Users can like/unlike quotes using an alias system
- **Like counts**: All quotes show total number of likes from all users
- **Personalized quotes**: Get random quotes from a user's favorites collection
- **Favorite status**: Check if a specific quote is liked by a user
- **Character filtering**: Filter favorite quotes by character

### Infrastructure
- **Multi-environment**: Separate staging and production deployments
- **Serverless**: AWS Lambda functions with Node.js 18.x runtime
- **NoSQL storage**: DynamoDB for quotes and favorites with GSI indexing
- **API Gateway**: RESTful API with proper HTTP methods and status codes
- **S3 storage**: Source data storage and CDK deployment artifacts
- **TypeScript**: Full type safety for infrastructure code
