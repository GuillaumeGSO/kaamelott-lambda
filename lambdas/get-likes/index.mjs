import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FAVORITES_TABLE_NAME = process.env.FAVORITES_TABLE_NAME;

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Run a Query/Scan command, following LastEvaluatedKey so results past the 1MB page are not dropped.
const paginate = async (CommandClass, params) => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await dynamo.send(new CommandClass({ ...params, ExclusiveStartKey }));
    if (result.Items?.length) items.push(...result.Items);
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};

// Like counts of every liked quote, in one response. Not cached here: the website's CloudFront
// caches it for a few minutes, so counts stay close to live without a scan per visitor.
export const lambdaHandler = async () => {
  const items = await paginate(ScanCommand, {
    TableName: FAVORITES_TABLE_NAME,
    ProjectionExpression: 'quoteId',
  });

  const likes = {};
  for (const { quoteId } of items) {
    likes[quoteId] = (likes[quoteId] ?? 0) + 1;
  }

  return jsonResponse(200, { likes });
};
