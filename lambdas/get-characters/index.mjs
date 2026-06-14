import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME;

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

let cachedCharacters = null;

export const lambdaHandler = async () => {
  if (!cachedCharacters) {
    const items = await paginate(ScanCommand, {
      TableName: TABLE_NAME,
      ProjectionExpression: '#c',
      ExpressionAttributeNames: { '#c': 'character' },
    });

    const counts = new Map();
    for (const item of items) {
      counts.set(item.character, (counts.get(item.character) ?? 0) + 1);
    }

    cachedCharacters = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([character, numberOfQuotes]) => ({ character, numberOfQuotes }));
  }

  return jsonResponse(200, cachedCharacters);
};
