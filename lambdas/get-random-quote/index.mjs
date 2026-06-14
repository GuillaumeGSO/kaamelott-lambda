import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

// Cached across warm invocations — refreshed only on cold start
let cachedQuoteIds = null;

const getQuoteWithLikes = async (quoteId) => {
  const [quoteResult, likes] = await Promise.all([
    dynamo.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { quoteId },
    })),
    countLikes(quoteId),
  ]);

  return { ...quoteResult.Item, likes };
};

export const lambdaHandler = async (event) => {
  if (!cachedQuoteIds) {
    const items = await paginate(ScanCommand, {
      TableName: TABLE_NAME,
      ProjectionExpression: 'quoteId',
    });
    cachedQuoteIds = items.map(i => i.quoteId);
  }

  let batchSize = 1;
  if (event.queryStringParameters?.batchSize) {
    batchSize = parseInt(event.queryStringParameters.batchSize, 10);
    if (isNaN(batchSize) || batchSize < 1 || batchSize > 20) {
      return jsonResponse(400, { error: 'batchSize must be a number between 1 and 20' });
    }
  }

  if (batchSize === 1) {
    const randomId = cachedQuoteIds[Math.floor(Math.random() * cachedQuoteIds.length)];
    const quote = await getQuoteWithLikes(randomId);

    return jsonResponse(200, quote);
  } else {
    const quotes = [];
    const selectedIds = new Set();
    
    while (quotes.length < batchSize && selectedIds.size < cachedQuoteIds.length) {
      const randomId = cachedQuoteIds[Math.floor(Math.random() * cachedQuoteIds.length)];
      if (!selectedIds.has(randomId)) {
        selectedIds.add(randomId);
        const quote = await getQuoteWithLikes(randomId);
        quotes.push(quote);
      }
    }

    return jsonResponse(200, { quotes });
  }
};
