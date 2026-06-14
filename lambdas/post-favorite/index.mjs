import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME;
const FAVORITES_TABLE_NAME = process.env.FAVORITES_TABLE_NAME;
const MAX_ALIAS_LENGTH = 20;

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Count favorites for a quote, following LastEvaluatedKey so a COUNT spanning multiple 1MB pages stays accurate.
const countLikes = async (quoteId) => {
  let count = 0;
  let ExclusiveStartKey;
  do {
    const result = await dynamo.send(new QueryCommand({
      TableName: FAVORITES_TABLE_NAME,
      KeyConditionExpression: 'quoteId = :qid',
      ExpressionAttributeValues: { ':qid': quoteId },
      Select: 'COUNT',
      ExclusiveStartKey,
    }));
    count += result.Count ?? 0;
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return count;
};

export const lambdaHandler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { quoteId } = body;
  if (!quoteId) {
    return jsonResponse(400, { error: 'Missing required field: quoteId' });
  }

  if (typeof body.favorite !== 'boolean') {
    return jsonResponse(400, { error: 'Missing required field: favorite (boolean)' });
  }

  const alias = body.alias?.trim();
  if (!alias) {
    return jsonResponse(400, { error: 'Missing required field: alias' });
  }

  if (alias.length > MAX_ALIAS_LENGTH) {
    return jsonResponse(400, { error: `alias must be at most ${MAX_ALIAS_LENGTH} characters` });
  }

  const quoteResult = await dynamo.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { quoteId },
    ProjectionExpression: 'quoteId',
  }));
  if (!quoteResult.Item) {
    return jsonResponse(404, { error: `Quote not found: ${quoteId}` });
  }

  if (body.favorite) {
    await dynamo.send(new PutCommand({
      TableName: FAVORITES_TABLE_NAME,
      Item: { quoteId, alias },
    }));
  } else {
    await dynamo.send(new DeleteCommand({
      TableName: FAVORITES_TABLE_NAME,
      Key: { quoteId, alias },
    }));
  }

  const likes = await countLikes(quoteId);

  return jsonResponse(200, { quoteId, alias, likes });
};
