import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;
const FAVORITES_TABLE_NAME = process.env.FAVORITES_TABLE_NAME;

export const lambdaHandler = async (event) => {
  const alias = event.queryStringParameters?.alias?.trim();
  const character = event.queryStringParameters?.character?.trim();

  if (!alias) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing required query parameter: alias' }),
    };
  }

  const favoritesResult = await dynamo.send(new QueryCommand({
    TableName: FAVORITES_TABLE_NAME,
    IndexName: 'alias-index',
    KeyConditionExpression: 'alias = :alias',
    ExpressionAttributeValues: { ':alias': alias },
  }));

  if (!favoritesResult.Items?.length) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `No favorites found for alias: ${alias}` }),
    };
  }

  let favoriteQuoteIds = favoritesResult.Items.map(item => item.quoteId);

  if (character) {
    const filteredQuoteIds = [];
    for (const quoteId of favoriteQuoteIds) {
      const quoteResult = await dynamo.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { quoteId },
      }));
      
      if (quoteResult.Item?.character === character) {
        filteredQuoteIds.push(quoteId);
      }
    }
    
    if (!filteredQuoteIds.length) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `No favorites found for alias: ${alias} and character: ${character}` }),
      };
    }
    
    favoriteQuoteIds = filteredQuoteIds;
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

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...quoteResult.Item, likes: likesResult.Count ?? 0 }),
  };
};