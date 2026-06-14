import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME;
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

// Cached per character across warm invocations
const characterCache = new Map();

export const lambdaHandler = async (event) => {
  let character;
  try {
    character = decodeURIComponent(event.pathParameters?.character ?? '');
  } catch {
    return jsonResponse(400, { error: 'Invalid URL encoding in character parameter' });
  }

  if (!character) {
    return jsonResponse(400, { error: 'Missing character parameter' });
  }

  if (!characterCache.has(character)) {
    const items = await paginate(QueryCommand, {
      TableName: TABLE_NAME,
      IndexName: 'character-index',
      KeyConditionExpression: '#c = :c',
      ExpressionAttributeNames: { '#c': 'character' },
      ExpressionAttributeValues: { ':c': character },
    });

    if (!items.length) {
      return jsonResponse(404, { error: `Character not found: ${character}` });
    }

    characterCache.set(character, items);
  }

  const items = characterCache.get(character);
  const quote = items[Math.floor(Math.random() * items.length)];

  const likes = await countLikes(quote.quoteId);

  return jsonResponse(200, { ...quote, likes });
};
