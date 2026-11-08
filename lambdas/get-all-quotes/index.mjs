import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME;

const jsonResponse = (statusCode, body, cacheControl) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    ...(cacheControl && { 'Cache-Control': cacheControl }),
  },
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

// Scans on every call, with no cache in the function: the website's CloudFront already caches
// the response (a day per edge region), and a cache here kept serving the old quotes after a
// reload until the next cold start.
export const lambdaHandler = async () => {
  // Strongly consistent: this runs right after a reload (CloudFront refetches once the site
  // invalidates its copy), and a read missing the last writes would then be cached for a day.
  const items = await paginate(ScanCommand, { TableName: TABLE_NAME, ConsistentRead: true });
  // Stable order, so identical data gives an identical response.
  const quotes = items.sort((a, b) => a.quoteId.localeCompare(b.quoteId));

  // Browsers keep the list for an hour; the website's CloudFront caches it longer, so most
  // visitors never reach this function.
  return jsonResponse(200, { quotes }, 'public, max-age=3600');
};
