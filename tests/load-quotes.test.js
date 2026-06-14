
const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockS3Client = { send: mockS3Send };
const mockDynamoClient = { send: mockDynamoSend };

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
  BatchWriteCommand: jest.fn()
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
});