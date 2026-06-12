import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;
const FAVORITES_TABLE_NAME = process.env.FAVORITES_TABLE_NAME;

// Cached across warm invocations — refreshed only on cold start
let cachedQuoteIds = null;

const getQuoteWithLikes = async (quoteId) => {
  const [quoteResult, likesResult] = await Promise.all([
    dynamo.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { quoteId },
    })),
    dynamo.send(new QueryCommand({
      TableName: FAVORITES_TABLE_NAME,
      KeyConditionExpression: 'quoteId = :qid',
      ExpressionAttributeValues: { ':qid': quoteId },
      Select: 'COUNT',
    })),
  ]);

  return { ...quoteResult.Item, likes: likesResult.Count ?? 0 };
};

export const lambdaHandler = async (event) => {
  if (!cachedQuoteIds) {
    const result = await dynamo.send(new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'quoteId',
    }));
    cachedQuoteIds = result.Items.map(i => i.quoteId);
  }

  let batchSize = 1;
  if (event.queryStringParameters?.batchSize) {
    batchSize = parseInt(event.queryStringParameters.batchSize, 10);
    if (isNaN(batchSize) || batchSize < 1 || batchSize > 20) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'batchSize must be a number between 1 and 20' }),
      };
    }
  }

  if (batchSize === 1) {
    const randomId = cachedQuoteIds[Math.floor(Math.random() * cachedQuoteIds.length)];
    const quote = await getQuoteWithLikes(randomId);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quote),
    };
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotes }),
    };
  }
};
