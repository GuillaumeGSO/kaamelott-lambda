import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FAVORITES_TABLE_NAME = process.env.FAVORITES_TABLE_NAME;
const MAX_ALIAS_LENGTH = 20;

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const lambdaHandler = async (event) => {
  let quoteId, alias;
  try {
    quoteId = event.queryStringParameters?.quoteId && decodeURIComponent(event.queryStringParameters.quoteId).trim();
    alias = event.queryStringParameters?.alias && decodeURIComponent(event.queryStringParameters.alias).trim();
  } catch {
    return jsonResponse(400, { error: 'Invalid URL encoding in query parameters' });
  }

  if (!quoteId || !alias) {
    return jsonResponse(400, { error: 'Missing required query parameters: quoteId, alias' });
  }

  if (alias.length > MAX_ALIAS_LENGTH) {
    return jsonResponse(400, { error: `alias must be at most ${MAX_ALIAS_LENGTH} characters` });
  }

  const result = await dynamo.send(new GetCommand({
    TableName: FAVORITES_TABLE_NAME,
    Key: { quoteId, alias },
  }));

  return jsonResponse(200, { quoteId, alias, liked: !!result.Item });
};
