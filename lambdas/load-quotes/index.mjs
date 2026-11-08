import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
const BATCH_SIZE = 25; // DynamoDB BatchWrite limit
const MAX_ATTEMPTS = 5; // per batch: the first write, then retries of what is left unprocessed
const RETRY_BASE_MS = 100; // doubled at each retry: 100, 200, 400, 800 ms

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    youtubeVideoId: q.youtubeVideoId ?? null,
    youtubeStartSeconds: q.youtubeStartSeconds ?? null,
  }));

  let unprocessedCount = 0;

  for (let i = 0; i < quotes.length; i += BATCH_SIZE) {
    let requests = quotes.slice(i, i + BATCH_SIZE).map(q => ({ PutRequest: { Item: q } }));

    // BatchWrite returns 200 even when it silently skips items (typically on
    // throttling); the skipped writes come back in UnprocessedItems and are retried
    // with exponential backoff, as the DynamoDB docs recommend.
    for (let attempt = 1; requests.length && attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await sleep(RETRY_BASE_MS * 2 ** (attempt - 2));
      const result = await dynamo.send(new BatchWriteCommand({
        RequestItems: { [TABLE_NAME]: requests },
      }));
      requests = result.UnprocessedItems?.[TABLE_NAME] ?? [];
      if (requests.length) {
        console.warn(
          `BatchWrite left ${requests.length} item(s) unprocessed in batch starting at index ${i} (attempt ${attempt}/${MAX_ATTEMPTS})`
        );
      }
    }
    unprocessedCount += requests.length;
  }

  // Thrown rather than reported in a 200: an incomplete load must fail the deploy
  // workflow, which only checks for a FunctionError.
  if (unprocessedCount) {
    throw new Error(`load-quotes left ${unprocessedCount} of ${quotes.length} quote(s) unwritten after ${MAX_ATTEMPTS} attempts per batch`);
  }

  return jsonResponse(200, { loaded: quotes.length });
};
