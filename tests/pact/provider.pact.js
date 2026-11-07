// Pact provider verification: replays the kaamelott-app contract against the real Lambda handlers.
//
// The contract is written by kaamelott-app (`npm run pact:publish`) and committed in that repo.
// By default it's read from its main branch on GitHub (public repo, no token). PACT_URLS
// overrides it with space-separated URLs or file paths (a site branch, a local checkout).
//
// The handlers run behind a small HTTP server that turns each request into an API Gateway proxy
// event, over an in-memory DynamoDB that each provider state seeds. Run with `npm run pact:verify`
// (needs the network for the default URL), not `npm test`.
const http = require('node:http');
const { Verifier } = require('@pact-foundation/pact');

const SITE_MAIN_CONTRACT =
  'https://raw.githubusercontent.com/GuillaumeGSO/kaamelott-app/refs/heads/main/pacts/kaamelott-app-kaamelott-lambda.json';

// In-memory DynamoDB: just enough of each command for the handlers in the contract.
const tables = { quotes: [], favorites: [] };
const sameKey = key => item => Object.entries(key).every(([name, value]) => item[name] === value);
const send = async command => {
  const input = command.input;
  const table = tables[input.TableName];
  switch (command.constructor.name) {
    case 'ScanCommand':
      return { Items: [...table] };
    case 'QueryCommand': {
      const values = input.ExpressionAttributeValues;
      const items = table.filter(item =>
        input.IndexName === 'alias-index' ? item.alias === values[':alias'] : item.quoteId === values[':qid'],
      );
      return input.Select === 'COUNT' ? { Count: items.length } : { Items: items };
    }
    case 'GetCommand':
      return { Item: table.find(sameKey(input.Key)) };
    case 'PutCommand': {
      const { quoteId, alias } = input.Item;
      tables[input.TableName] = [...table.filter(item => !sameKey({ quoteId, alias })(item)), input.Item];
      return {};
    }
    case 'DeleteCommand':
      tables[input.TableName] = table.filter(item => !sameKey(input.Key)(item));
      return {};
    default:
      throw new Error(`Fake DynamoDB: unsupported ${command.constructor.name}`);
  }
};

const command = name => ({ [name]: class { constructor(input) { this.input = input; } } })[name];

jest.doMock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.doMock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send }) },
  ScanCommand: command('ScanCommand'),
  QueryCommand: command('QueryCommand'),
  GetCommand: command('GetCommand'),
  PutCommand: command('PutCommand'),
  DeleteCommand: command('DeleteCommand'),
}));

process.env.TABLE_NAME = 'quotes';
process.env.FAVORITES_TABLE_NAME = 'favorites';

const ROUTES = {
  'GET /quotes/all': 'get-all-quotes',
  'GET /quotes/likes': 'get-likes',
  'GET /favorites': 'get-favorites',
  'POST /favorites': 'post-favorite',
};

// Fresh modules for every state: some handlers cache what they read (get-all-quotes).
let handlers = {};
const loadHandlers = async () => {
  jest.resetModules();
  handlers = {};
  for (const [route, name] of Object.entries(ROUTES)) {
    handlers[route] = (await import(`../../lambdas/${name}/index.mjs`)).lambdaHandler;
  }
};

const seed = async ({ quotes = [], favorites = [] }) => {
  tables.quotes = quotes;
  tables.favorites = favorites;
  await loadHandlers();
};

const quote = quoteId => ({ quoteId, character: 'Perceval', text: "C'est pas faux.", actorName: 'Franck Pitiot' });

// API Gateway in front of the handlers: request → proxy event → handler → response.
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const handler = handlers[`${request.method} ${url.pathname}`];
  if (!handler) {
    response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"message":"Missing Authentication Token"}');
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  const query = Object.fromEntries(url.searchParams);
  const result = await handler({
    httpMethod: request.method,
    path: url.pathname,
    queryStringParameters: Object.keys(query).length ? query : null,
    body: body || null,
  });
  response.writeHead(result.statusCode, result.headers).end(result.body);
});

describe('kaamelott-app contract', () => {
  beforeAll(done => { server.listen(0, '127.0.0.1', () => done()); });
  afterAll(done => { server.close(() => done()); });

  test('the API honours every interaction the site relies on', async () => {
    const pactUrls = (process.env.PACT_URLS ?? SITE_MAIN_CONTRACT).split(/\s+/).filter(Boolean);

    await new Verifier({
      provider: 'kaamelott-lambda',
      providerBaseUrl: `http://127.0.0.1:${server.address().port}`,
      pactUrls,
      stateHandlers: {
        'quotes exist': () => seed({ quotes: [quote('q1'), quote('q2')] }),
        'quote q1 has 2 likes': () =>
          seed({ quotes: [quote('q1')], favorites: [{ quoteId: 'q1', alias: 'arthur' }, { quoteId: 'q1', alias: 'merlin' }] }),
        'merlin has liked quote q1': () =>
          seed({ quotes: [quote('q1')], favorites: [{ quoteId: 'q1', alias: 'merlin' }] }),
        'quote q1 exists': () => seed({ quotes: [quote('q1')] }),
      },
    }).verifyProvider();
  }, 60_000);
});
