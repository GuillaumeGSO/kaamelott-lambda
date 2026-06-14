import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
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

export const lambdaHandler = async (event) => {
  const alias = event.queryStringParameters?.alias?.trim();
  const character = event.queryStringParameters?.character?.trim();

  // Candidate set of favorited quoteIds. With an alias, query that user's favorites via the
  // alias-index. Without an alias, scan the favorites table for every favorited quote (deduped,
  // since multiple users can favorite the same quote).
  let favoriteItems;
  if (alias) {
    favoriteItems = await paginate(QueryCommand, {
      TableName: FAVORITES_TABLE_NAME,
      IndexName: 'alias-index',
      KeyConditionExpression: 'alias = :alias',
      ExpressionAttributeValues: { ':alias': alias },
      ProjectionExpression: 'quoteId',
    });
  } else {
    favoriteItems = await paginate(ScanCommand, {
      TableName: FAVORITES_TABLE_NAME,
      ProjectionExpression: 'quoteId',
    });
  }

  let favoriteQuoteIds = [...new Set(favoriteItems.map(item => item.quoteId))];

  if (!favoriteQuoteIds.length) {
    return jsonResponse(404, {
      error: alias ? `No favorites found for alias: ${alias}` : 'No favorites found',
    });
  }

  // Narrow to a character by intersecting with that character's quoteIds (one indexed query)
  // rather than fetching every favorited quote individually.
  if (character) {
    const characterItems = await paginate(QueryCommand, {
      TableName: TABLE_NAME,
      IndexName: 'character-index',
      KeyConditionExpression: '#c = :c',
      ExpressionAttributeNames: { '#c': 'character' },
      ExpressionAttributeValues: { ':c': character },
      ProjectionExpression: 'quoteId',
    });
    const characterQuoteIds = new Set(characterItems.map(item => item.quoteId));
    favoriteQuoteIds = favoriteQuoteIds.filter(quoteId => characterQuoteIds.has(quoteId));

    if (!favoriteQuoteIds.length) {
      return jsonResponse(404, {
        error: alias
          ? `No favorites found for alias: ${alias} and character: ${character}`
          : `No favorites found for character: ${character}`,
      });
    }
  }

  const randomQuoteId = favoriteQuoteIds[Math.floor(Math.random() * favoriteQuoteIds.length)];

  const [quoteResult, likesResult] = await Promise.all([
    dynamo.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { quoteId: randomQuoteId },
    })),
    dynamo.send(new QueryCommand({
      TableName: FAVORITES_TABLE_NAME,
      KeyConditionExpression: 'quoteId = :qid',
      ExpressionAttributeValues: { ':qid': randomQuoteId },
      Select: 'COUNT',
    })),
  ]);

  return jsonResponse(200, { ...quoteResult.Item, likes: likesResult.Count ?? 0 });
};
