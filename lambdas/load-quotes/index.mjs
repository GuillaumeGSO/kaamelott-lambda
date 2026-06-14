import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
const BATCH_SIZE = 25; // DynamoDB BatchWrite limit

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export const lambdaHandler = async () => {
  const s3Response = await s3.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: 'quotes.json',
  }));

  const raw = await streamToString(s3Response.Body);
  const quotes = JSON.parse(raw).map(q => ({
    ...q,
    film: q.film || null,
  }));

  let unprocessedCount = 0;

  for (let i = 0; i < quotes.length; i += BATCH_SIZE) {
    const batch = quotes.slice(i, i + BATCH_SIZE);
    const result = await dynamo.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: batch.map(q => ({ PutRequest: { Item: q } })),
      },
    }));

    // BatchWrite returns 200 even when it silently skips items (typically on
    // throttling); the skipped writes come back in UnprocessedItems.
    const unprocessed = result.UnprocessedItems?.[TABLE_NAME] ?? [];
    if (unprocessed.length) {
      unprocessedCount += unprocessed.length;
      console.warn(
        `BatchWrite left ${unprocessed.length} item(s) unprocessed in batch starting at index ${i}`
      );
    }
  }

  if (unprocessedCount) {
    console.warn(`load-quotes finished with ${unprocessedCount} unprocessed item(s) out of ${quotes.length}`);
  }

  return jsonResponse(200, { loaded: quotes.length - unprocessedCount, unprocessed: unprocessedCount });
};
