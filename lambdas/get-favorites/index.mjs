import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FAVORITES_TABLE_NAME = process.env.FAVORITES_TABLE_NAME;
const MAX_ALIAS_LENGTH = 20;

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

// Every quoteId liked by an alias: one call per visitor instead of a status check per quote.
// An alias with no likes gets an empty list (200), not a 404.
export const lambdaHandler = async (event) => {
  const alias = event.queryStringParameters?.alias?.trim();

  if (!alias) {
    return jsonResponse(400, { error: 'Missing required query parameter: alias' });
  }

  if (alias.length > MAX_ALIAS_LENGTH) {
    return jsonResponse(400, { error: `alias must be at most ${MAX_ALIAS_LENGTH} characters` });
  }

  const items = await paginate(QueryCommand, {
    TableName: FAVORITES_TABLE_NAME,
    IndexName: 'alias-index',
    KeyConditionExpression: 'alias = :alias',
    ExpressionAttributeValues: { ':alias': alias },
    ProjectionExpression: 'quoteId',
  });

  return jsonResponse(200, { alias, quoteIds: items.map(item => item.quoteId) });
};
