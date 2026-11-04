
const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockS3Client = { send: mockS3Send };
const mockDynamoClient = { send: mockDynamoSend };
const mockBatchWriteCommand = jest.fn();

jest.doMock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  GetObjectCommand: jest.fn()
}));

jest.doMock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({}))
}));

jest.doMock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoClient)
  },
  BatchWriteCommand: mockBatchWriteCommand
}));

describe('load-quotes', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-quotes-table';
    process.env.BUCKET_NAME = 'test-bucket';
    
    delete require.cache[require.resolve('../lambdas/load-quotes/index.mjs')];
    
    return import('../lambdas/load-quotes/index.mjs').then(module => {
      lambdaHandler = module.lambdaHandler;
    });
  });

  test('should load quotes from S3 and save to DynamoDB', async () => {
    const mockQuotes = [
      { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' },
      { quoteId: 'quote2', character: 'Lancelot', text: 'Test quote 2' }
    ];

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(mockQuotes));
      }
    };

    mockS3Send.mockResolvedValueOnce({
      Body: mockStream
    });

    mockDynamoSend.mockResolvedValueOnce({});

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({ loaded: 2, unprocessed: 0 });
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });

  test('should handle quotes with null film property', async () => {
    const mockQuotes = [
      { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' },
      { quoteId: 'quote2', character: 'Lancelot', text: 'Test quote 2', film: 'Test Film' }
    ];

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(mockQuotes));
      }
    };

    mockS3Send.mockResolvedValueOnce({
      Body: mockStream
    });

    mockDynamoSend.mockResolvedValueOnce({});

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({ loaded: 2, unprocessed: 0 });
  });

  test('should default missing youtube fields to null', async () => {
    const mockQuotes = [
      { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' },
      { quoteId: 'quote2', character: 'Perceval', text: 'Test quote 2', youtubeVideoId: 'abc123', youtubeStartSeconds: 0 }
    ];

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(mockQuotes));
      }
    };

    mockS3Send.mockResolvedValueOnce({
      Body: mockStream
    });

    mockDynamoSend.mockResolvedValueOnce({});

    await lambdaHandler();

    const items = mockBatchWriteCommand.mock.calls[0][0].RequestItems['test-quotes-table']
      .map(r => r.PutRequest.Item);
    expect(items[0]).toMatchObject({ youtubeVideoId: null, youtubeStartSeconds: null });
    expect(items[1]).toMatchObject({ youtubeVideoId: 'abc123', youtubeStartSeconds: 0 });
  });

  test('should batch quotes when count exceeds batch size', async () => {
    const mockQuotes = Array.from({ length: 30 }, (_, i) => ({
      quoteId: `quote${i + 1}`,
      character: 'Arthur',
      text: `Test quote ${i + 1}`
    }));

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(mockQuotes));
      }
    };

    mockS3Send.mockResolvedValueOnce({
      Body: mockStream
    });

    mockDynamoSend.mockResolvedValue({});

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({ loaded: 30, unprocessed: 0 });
    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
  });

  test('should handle empty quotes array', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify([]));
      }
    };

    mockS3Send.mockResolvedValueOnce({
      Body: mockStream
    });

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({ loaded: 0, unprocessed: 0 });
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  test('should report items left unprocessed by BatchWrite', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mockQuotes = [
      { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' },
      { quoteId: 'quote2', character: 'Lancelot', text: 'Test quote 2' }
    ];

    const mockStream = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify(mockQuotes));
      }
    };

    mockS3Send.mockResolvedValueOnce({
      Body: mockStream
    });

    mockDynamoSend.mockResolvedValueOnce({
      UnprocessedItems: {
        'test-quotes-table': [{ PutRequest: { Item: mockQuotes[1] } }]
      }
    });

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({ loaded: 1, unprocessed: 1 });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});
