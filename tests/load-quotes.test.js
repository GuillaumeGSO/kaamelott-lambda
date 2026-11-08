
const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockS3Client = { send: mockS3Send };
const mockDynamoClient = { send: mockDynamoSend };
const mockBatchWriteCommand = jest.fn();
const mockEventsSend = jest.fn();
const mockPutEventsCommand = jest.fn();

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

jest.doMock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventsSend })),
  PutEventsCommand: mockPutEventsCommand
}));

describe('load-quotes', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-quotes-table';
    process.env.BUCKET_NAME = 'test-bucket';
    process.env.ENVIRONMENT = 'staging';
    mockEventsSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'event-1' }] });
    
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
    expect(body).toEqual({ loaded: 2 });
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
    expect(body).toEqual({ loaded: 2 });
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
    expect(body).toEqual({ loaded: 30 });
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
    expect(body).toEqual({ loaded: 0 });
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  describe('QuotesReloaded event (the contract with the website, see README)', () => {
    const quotes = [
      { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' },
      { quoteId: 'quote2', character: 'Lancelot', text: 'Test quote 2' }
    ];

    beforeEach(() => {
      mockS3Send.mockResolvedValueOnce({
        Body: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from(JSON.stringify(quotes));
          }
        }
      });
    });

    test('should be published once every quote is written', async () => {
      mockDynamoSend.mockResolvedValueOnce({});

      await lambdaHandler();

      expect(mockEventsSend).toHaveBeenCalledTimes(1);
      const [entry] = mockPutEventsCommand.mock.calls[0][0].Entries;
      expect(entry).toEqual({
        Source: 'kaamelott.quotes',
        DetailType: 'QuotesReloaded',
        Detail: expect.any(String)
      });
      expect(JSON.parse(entry.Detail)).toEqual({ environment: 'staging', count: 2 });
    });

    test('should fail the function when EventBridge rejects it', async () => {
      mockDynamoSend.mockResolvedValueOnce({});
      mockEventsSend.mockResolvedValueOnce({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'try again' }]
      });

      await expect(lambdaHandler()).rejects.toThrow('QuotesReloaded event was rejected: try again');
    });
  });

  describe('items left unprocessed by BatchWrite', () => {
    const quotes = [
      { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' },
      { quoteId: 'quote2', character: 'Lancelot', text: 'Test quote 2' }
    ];
    const unprocessed = { UnprocessedItems: { 'test-quotes-table': [{ PutRequest: { Item: quotes[1] } }] } };
    let warnSpy;

    beforeEach(() => {
      // The retries wait (backoff): fake timers keep the tests instant.
      jest.useFakeTimers();
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockS3Send.mockResolvedValueOnce({
        Body: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from(JSON.stringify(quotes));
          }
        }
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      warnSpy.mockRestore();
    });

    test('should retry only the unprocessed items until they are written', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(unprocessed)
        .mockResolvedValueOnce(unprocessed)
        .mockResolvedValueOnce({});

      const pending = lambdaHandler();
      await jest.runAllTimersAsync();
      const result = await pending;

      expect(JSON.parse(result.body)).toEqual({ loaded: 2 });
      expect(mockDynamoSend).toHaveBeenCalledTimes(3);
      const retried = mockBatchWriteCommand.mock.calls[1][0].RequestItems['test-quotes-table'];
      expect(retried).toEqual([{ PutRequest: { Item: quotes[1] } }]);
    });

    test('should fail after 5 attempts, so the deploy workflow fails too', async () => {
      mockDynamoSend.mockResolvedValue(unprocessed);

      const assertion = expect(lambdaHandler()).rejects.toThrow('left 1 of 2 quote(s) unwritten after 5 attempts');
      await jest.runAllTimersAsync();
      await assertion;

      expect(mockDynamoSend).toHaveBeenCalledTimes(5);
      // An incomplete load mustn't tell the website to refresh.
      expect(mockEventsSend).not.toHaveBeenCalled();
    });
  });
});
