import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const FAVORITES_TABLE_NAME = process.env.FAVORITES_TABLE_NAME;

export const lambdaHandler = async (event) => {
  const quoteId = event.queryStringParameters?.quoteId?.trim();
  const alias = event.queryStringParameters?.alias?.trim();

  if (!quoteId || !alias) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing required query parameters: quoteId, alias' }),
    };
  }

  const result = await dynamo.send(new GetCommand({
    TableName: FAVORITES_TABLE_NAME,
    Key: { quoteId, alias },
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId, alias, liked: !!result.Item }),
  };
};
